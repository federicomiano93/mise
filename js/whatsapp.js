// whatsapp.js — the order picker, order modal and its WhatsApp share.
//
// WhatsApp orders come from the INDEPENDENT lists (`whatsappLists`), built in
// Settings → WhatsApp and decoupled from the dough tabs. Tapping the header
// WhatsApp button opens a "Send order" picker listing every saved list. Picking
// one shows the order modal: a section per client entry, one row per chosen
// product, with the quantities you type becoming a WhatsApp message grouped by
// client. Client and product names are resolved live from the address book.
//
// A list may attach the SAME product id to two different client entries, so the
// modal inputs are namespaced by the client-entry index AND the product id
// (`wa-<entryIndex>-<productId>`). This avoids both colliding with each other and
// colliding with the calculator's own quantity fields living in the same document.

import { t } from './i18n.js';
import { getConfig } from './calculator-config-store.js';
import { getWhatsappLists, getWhatsappClients, resolveListClients, resolveDirectClient, getOrderPrefillWindow } from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { alertDialog, confirmDialog } from './confirm-dialog.js';
import { getLogs } from './log-store.js';
import { latestVersion } from './log-model.js';
import { prefillFromLogs, prefillNote } from './calculator-order-prefill.js';
import { orderSections, buildOrderMessage, whatsappUrl } from './calculator-order-text.js';

// The resolved client entries we are sending: [{ client, products }]. The order
// message heading is the chosen list's title.
let selectedEntries = [];
let selectedTitle = '';

// Build the per-row input id for a product under a given client entry.
function inputId(entryIndex, productId) {
  return 'wa-' + entryIndex + '-' + productId;
}

// Set every quantity in the order back to 0, after confirming (P20 — resetting is
// confirmed, and this can throw away a whole order somebody has just typed).
//
// ⚠️ IT WALKS selectedEntries AND ADDRESSES EACH INPUT BY ITS OWN ID, rather than
// sweeping a class. The calculator's own quantity fields live in the SAME document
// as this modal — that collision is why these inputs are namespaced in the first
// place (see the header) — and a broad selector would be one rename away from
// clearing the dough tabs behind the modal instead.
async function clearAllQuantities() {
  if (!(await confirmDialog({
    message: t('calc.setEveryQuantityIn'),
    okLabel: t('calc.clearAll'),
    danger: true,
  }))) return;

  selectedEntries.forEach((entry, ei) => {
    (entry.products || []).forEach(p => {
      const input = document.getElementById(inputId(ei, p.id));
      if (input) input.value = '0';
    });
  });
}

// Entry point from the header WhatsApp button.
export function shareMarketOrder() {
  const config = getConfig();
  const lists = getWhatsappLists(config);
  const directs = getWhatsappClients(config);
  if (lists.length + directs.length === 0) {
    alertDialog(t('calc.noWhatsappListsOr'));
    return;
  }
  // Shortcut: a single saved item opens straight into its order modal.
  if (lists.length + directs.length === 1) {
    if (lists.length === 1) openList(config, lists[0]);
    else openDirect(config, directs[0]);
    return;
  }
  openSendPicker(config, lists, directs);
}

// Resolve a list against the address book and open its order modal, or warn if
// every client it referenced has since been deleted.
function openList(config, list) {
  const entries = resolveListClients(config, list);
  if (!entries.length) {
    alertDialog(t('calc.thisListHasNo'));
    return;
  }
  selectedEntries = entries;
  selectedTitle = list.title || 'Order';
  openOrderModal();
}

// Open the order modal for a single direct client: one section (its typed name) with
// its chosen products. The heading is the client name, so the section is not labelled.
function openDirect(config, dc) {
  const resolved = resolveDirectClient(config, dc);
  selectedEntries = [{ client: { name: resolved.name }, products: resolved.products }];
  selectedTitle = resolved.name || 'Order';
  openOrderModal();
}

// ── "Send order" picker: saved lists first, then direct clients ───────────────
function openSendPicker(config, lists, directs) {
  const box = document.querySelector('#list-select-box .loaf-modal-title');
  if (box) box.textContent = t('calc.sendOrder');
  const body = document.getElementById('list-select-body');
  body.textContent = '';

  if (lists.length) {
    body.appendChild(el('div', { class: 'send-picker-label' }, 'Lists'));
    lists.forEach(list => {
      body.appendChild(pickerItem(list.title || t('calc.untitledList'), () => openList(config, list)));
    });
  }
  if (directs.length) {
    body.appendChild(el('div', { class: 'send-picker-label' }, 'Clients'));
    directs.forEach(dc => {
      body.appendChild(pickerItem(dc.name || t('calc.unnamedClient'), () => openDirect(config, dc)));
    });
  }

  document.getElementById('list-select-modal').classList.add('visible');
}

function pickerItem(label, onPick) {
  const btn = el('button', { class: 'drill-item', type: 'button' }, [
    el('span', {}, label),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  btn.addEventListener('click', () => { closeListPicker(); onPick(); });
  return btn;
}

export function closeListPicker() {
  document.getElementById('list-select-modal').classList.remove('visible');
}

// ── Order modal for the chosen list ───────────────────────────────────────────
function openOrderModal() {
  renderOrderModal();
  document.getElementById('loaf-modal').classList.add('visible');
}

// Rebuild the modal body (one section per client entry, one row per chosen
// product) from the resolved list. CSP-safe DOM building, no innerHTML.
function renderOrderModal() {
  document.getElementById('loaf-modal-title').textContent = selectedTitle || 'Order';
  const body = document.getElementById('loaf-order-body');
  body.textContent = '';

  // Fill in what has already been calculated and logged, rather than making the same
  // numbers be typed twice. ⚠️ The note below is what makes this acceptable at all:
  // the numbers must never appear as if from nowhere (see calculator-order-prefill.js).
  const prefillWindow = getOrderPrefillWindow(getConfig());
  const prefilled = prefillFromLogs(selectedEntries, getLogs(), latestVersion,
    { nowMs: Date.now(), window: prefillWindow });

  // The note and the way to undo it, side by side: "Clear all" empties exactly the
  // quantities the note has just explained. It stays OUT of the footer so Cancel and
  // Send remain a plain two-way choice — a third button beside Send is one mis-tap
  // away from wiping a finished order.
  const clearBtn = el('button', { type: 'button', class: 'order-clear-btn' }, t('calc.clearAll'));
  clearBtn.addEventListener('click', clearAllQuantities);
  body.appendChild(el('div', { class: 'order-prefill-bar' }, [
    el('p', { class: 'order-prefill-note' }, prefillNote(Object.keys(prefilled).length, prefillWindow)),
    clearBtn,
  ]));

  selectedEntries.forEach((entry, ei) => {
    const rows = entry.products.map(p => {
      const start = prefilled[ei + '|' + p.id];
      const input = el('input', {
        type: 'number', id: inputId(ei, p.id), class: 'order-qty-input',
        value: String(start === undefined ? 0 : start), min: '0', inputmode: 'numeric',
      });
      // Same focus/blur convenience as the calculator fields: tapping a 0 clears
      // it, leaving it empty restores 0.
      input.addEventListener('focus', function() {
        if (this.value === '0' || this.value === '') this.value = '';
        else this.select();
      });
      input.addEventListener('blur', function() {
        if (this.value === '' || isNaN(parseFloat(this.value))) this.value = '0';
      });
      return el('div', { class: 'order-row' }, [el('span', { class: 'order-label' }, p.name), input]);
    });
    body.appendChild(el('div', { class: 'order-section' }, [
      el('div', { class: 'order-section-title' }, entry.client.name),
      ...rows,
    ]));
  });
}

export function closeLoafModal() {
  document.getElementById('loaf-modal').classList.remove('visible');
}

// What was typed, read straight off the modal. The ONE place the page is consulted;
// everything downstream is pure.
function typedQty(entryIndex, productId) {
  const input = document.getElementById(inputId(entryIndex, productId));
  return input ? (+input.value || 0) : 0;
}

// Send. With more than one client holding quantities, ask WHO first — everything
// together, or one client on its own.
//
// ⚠️ The chooser only appears when it has a real choice to offer. With a single
// client filled in there is nothing to decide, and a step that always says the same
// thing is a step people stop reading.
export function sendWithLoaves() {
  const sections = orderSections(selectedEntries, typedQty);
  if (!sections.length) { alertDialog(t('calc.noOrdersToShare')); return; }

  if (sections.length === 1) { sendSections(sections, selectedEntries.length > 1); return; }
  openWhoPicker(sections);
}

// Build the message and hand it to WhatsApp. `multi` decides whether each section is
// headed by its client's name — see buildOrderMessage for why it is not derived.
function sendSections(sections, multi, title) {
  closeLoafModal();
  window.open(whatsappUrl(buildOrderMessage(title || selectedTitle, sections, multi)), '_blank');
}

// ── "Who is this for?" ────────────────────────────────────────────────────────
// Everything together keeps exactly the message it always sent — same title, same
// per-client headings. A single client is sent under ITS OWN name, so the recipient
// reads their own order rather than the name of a list they are one line of.
//
// ⚠️ The modal id ends in `-modal` and it is shown with `.visible`, which is what
// puts it in the update gate's busy list (update-gate.js keys on exactly that). A
// compulsory update landing on top of this would throw away a typed order.
function openWhoPicker(sections) {
  const box = document.querySelector('#send-who-box .loaf-modal-title');
  if (box) box.textContent = t('calc.sendTo');
  const body = document.getElementById('send-who-body');
  body.textContent = '';

  body.appendChild(whoItem(t('calc.allClientsTogether'), () => sendSections(sections, true)));
  body.appendChild(el('div', { class: 'send-picker-label' }, t('calc.orOneClient')));
  sections.forEach(section => {
    body.appendChild(whoItem(section.name, () => sendSections([section], false, section.name)));
  });

  document.getElementById('send-who-modal').classList.add('visible');
}

function whoItem(label, onPick) {
  const btn = el('button', { class: 'drill-item', type: 'button' }, [
    el('span', {}, label),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  btn.addEventListener('click', () => { closeWhoPicker(); onPick(); });
  return btn;
}

export function closeWhoPicker() {
  document.getElementById('send-who-modal').classList.remove('visible');
}
