// calculator-whatsapp-settings.js — the WhatsApp order-lists editor (#wa-overlay).
//
// Opened from its own entry in the Settings hub (next to Recipes / Extra dough /
// Divisor). WhatsApp orders are INDEPENDENT of the dough tabs. The top screen holds
// two kinds of sendable item, each editable here:
//   • Lists    (+ Add list)   — a named list grouping client entries; each entry
//                pairs an address-book client with products picked from the WHOLE
//                address book (not only that client's own products).
//   • Clients  (+ Add client) — a standalone "direct client": a TYPED name plus
//                products picked from the address book. Sent on its own, no list.
//
// Drill-in shape:
//   • Level 0  → the saved lists and direct clients, each with a delete icon
//                (+ Add list / + Add client)
//   • Level 1  → a list: its name + a card per client                (+ Add client)
//   • Level 1b → choose which address-book client to add to the list
//   • Level 2  → a client's products (list entry OR direct client)   (+ Add product)
//   • Level 3  → choose a product to add (UNIQUE product names)
//
// PERSISTENCE MODEL: each item is saved from ITS OWN detail screen (a bottom Save).
// The top screen has NO Save — it only lists items and deletes them, and a delete is
// applied immediately (with confirmation). Leaving a detail with unsaved edits prompts
// to discard. Returning to the top re-reads the saved config, so unsaved edits never
// linger. Products show by UNIQUE NAME only (the message uses only the name; a
// representative product id is stored). Names resolve live from the address book.

import { getConfig, saveConfig } from './calculator-config-store.js';
import { cloneConfig, getClients, getClientById, getProductById, getAllProducts } from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';

let working = null;          // deep copy being edited (re-synced from live at the top)
let activeList = null;       // null = top screen, else the edited list's index
let activeEntry = null;      // null = list detail, else the edited client entry's index
let activeDirect = null;     // null = not editing a direct client, else its index
let choosingClient = false;  // true = the "add client to list" chooser is showing
let addingProduct = false;   // true = the "add product" picker is showing
let showErrors = false;      // after a failed Save, mark the empty name
let dirty = false;           // unsaved edits exist in the current detail session

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }
function genId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }
function isBlank(s) { return !s || !String(s).trim(); }

// Working-copy arrays (always present, even on a garbage config).
function lists() {
  if (!Array.isArray(working.whatsappLists)) working.whatsappLists = [];
  return working.whatsappLists;
}
function directClients() {
  if (!Array.isArray(working.whatsappClients)) working.whatsappClients = [];
  return working.whatsappClients;
}

function waTitle() { return document.querySelector('#wa-overlay .recipe-overlay-title'); }

// Home is shown on the top screen, hidden on detail/sub-screens (to avoid an
// accidental exit mid-edit), matching the Clients editor.
function setHomeVisible(visible) {
  const btn = document.getElementById('wa-home-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

function markDirty() { dirty = true; }

// The object whose `.products` the product picker/rows are editing: a direct client,
// or the active list entry.
function currentTarget() {
  if (activeDirect !== null) return directClients()[activeDirect];
  return lists()[activeList].clients[activeEntry];
}

// ── Address-book product pool (unique by name) ─────────────────────────────────
// The WhatsApp message uses only the product name, so the picker shows each distinct
// name once, keeping the first product that bears it as the representative to store.
// Products now belong to their client, so this walks every client's list — two clients
// ordering the same thing still offer that name once.
function uniqueProducts() {
  const seen = new Set();
  const out = [];
  for (const p of getAllProducts(getConfig())) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push({ id: p.id, name: p.name });
  }
  return out;
}

// The display names of the products a target has chosen (skipping ids whose product
// has since been deleted). Used for the entry summary and the "already added" set.
function targetProductNames(target) {
  const ids = Array.isArray(target.products) ? target.products : [];
  return ids.map(id => { const p = getProductById(getConfig(), id); return p ? p.name : null; }).filter(Boolean);
}

// ── Open / navigate ────────────────────────────────────────────────────────────
export function openWhatsapp() {
  activeList = null;
  activeEntry = null;
  activeDirect = null;
  choosingClient = false;
  addingProduct = false;
  showErrors = false;
  renderEditor(); // renderTopScreen re-clones the working copy and clears dirty
  show('wa-overlay');
}

// Contextual "back": within an item step up one level (edits live in the working
// copy); leaving a detail to the top prompts to discard unsaved edits; from the top
// it exits the overlay (nothing is pending there — the top re-reads the saved config).
async function backWhatsapp() {
  const discardOk = () => confirmDialog({ message: 'Discard unsaved changes?', okLabel: 'Discard', danger: true });
  if (activeDirect !== null) {
    if (addingProduct) { addingProduct = false; renderEditor(); return; }
    if (dirty && !(await discardOk())) return;
    activeDirect = null;
    renderEditor();
    return;
  }
  if (activeList !== null) {
    if (choosingClient) { choosingClient = false; renderEditor(); return; }
    if (activeEntry !== null) {
      if (addingProduct) { addingProduct = false; renderEditor(); return; }
      activeEntry = null; // back to the list detail, edits kept in the working copy
      renderEditor();
      return;
    }
    if (dirty && !(await discardOk())) return;
    activeList = null;
    renderEditor();
    return;
  }
  hide('wa-overlay');
}

function goHome() { window.location.href = 'index.html'; }

// ── Render dispatch ────────────────────────────────────────────────────────────
function renderEditor() {
  if (activeDirect !== null) {
    if (addingProduct) { renderProductPicker(); return; }
    renderDirectDetail();
    return;
  }
  if (activeList === null) { renderTopScreen(); return; }
  if (choosingClient) { renderClientChooser(); return; }
  if (activeEntry === null) { renderListDetail(); return; }
  if (addingProduct) { renderProductPicker(); return; }
  renderEntryDetail();
}

function saveBottomButton() {
  const btn = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save');
  btn.addEventListener('click', saveDetail);
  return btn;
}

function deleteIcon(label, onDelete) {
  const btn = el('button', { class: 'cp-del-icon', type: 'button', 'aria-label': label }, icon('trash', 17));
  btn.addEventListener('click', onDelete);
  return btn;
}

// Save the currently-edited top-level item (a list or a direct client). The name is
// required; on success the whole config is persisted and we return to the top screen.
async function saveDetail() {
  if (activeDirect !== null) {
    if (isBlank(directClients()[activeDirect].name)) {
      showErrors = true; renderEditor();
      alertDialog('Please name this client before saving.');
      return;
    }
  } else if (activeList !== null) {
    if (isBlank(lists()[activeList].title)) {
      showErrors = true; renderEditor();
      alertDialog('Please name this list before saving.');
      return;
    }
  }
  if (!(await confirmDialog({ message: 'Save these changes?', okLabel: 'Save' }))) return;
  try {
    await saveConfig(working);
    showErrors = false;
    dirty = false;
    activeList = null;
    activeEntry = null;
    activeDirect = null;
    choosingClient = false;
    addingProduct = false;
    renderEditor();
  } catch (e) {
    alertDialog('Could not save. Check your connection and try again.');
  }
}

// ── Level 0: the saved lists and direct clients (with delete icons) ────────────
// Re-reads the saved config so the screen always reflects what is persisted and any
// unsaved edits from a backed-out detail are dropped. Deletes apply immediately.
function renderTopScreen() {
  working = cloneConfig(getConfig());
  dirty = false;
  waTitle().textContent = 'WhatsApp lists';
  setHomeVisible(true);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  content.appendChild(el('div', { class: 'send-picker-label' }, 'Lists'));
  lists().forEach((list, li) => {
    content.appendChild(topRow(
      list.title || 'Untitled list',
      () => { activeList = li; activeEntry = null; renderEditor(); },
      'Delete list',
      () => deleteList(li),
    ));
  });
  const addList = el('button', { class: 'cp-add-client', type: 'button' }, '+ Add list');
  addList.addEventListener('click', () => {
    lists().push({ id: genId('wl'), title: '', clients: [] });
    markDirty();
    activeList = lists().length - 1;
    activeEntry = null;
    renderEditor();
  });
  content.appendChild(addList);

  content.appendChild(el('div', { class: 'send-picker-label' }, 'Clients'));
  directClients().forEach((dc, di) => {
    content.appendChild(topRow(
      dc.name || 'Unnamed client',
      () => { activeDirect = di; renderEditor(); },
      'Delete client',
      () => deleteDirect(di),
    ));
  });
  const addClient = el('button', { class: 'cp-add-client', type: 'button' }, '+ Add client');
  addClient.addEventListener('click', () => {
    directClients().push({ id: genId('wc'), name: '', products: [] });
    markDirty();
    activeDirect = directClients().length - 1;
    renderEditor();
  });
  content.appendChild(addClient);
}

// A top-screen row: a drill-in box (tap to edit) beside a low-key delete icon.
function topRow(label, onOpen, delLabel, onDelete) {
  const box = el('button', { class: 'drill-item wa-entry-open', type: 'button' }, [
    el('span', {}, label),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  box.addEventListener('click', onOpen);
  return el('div', { class: 'wa-entry-card' }, [box, deleteIcon(delLabel, onDelete)]);
}

// Delete a saved list / direct client straight from the top screen, persisting at
// once (there is no Save here). Always confirmed.
async function deleteList(li) {
  if (!(await confirmDialog({ message: 'Delete this list?', okLabel: 'Delete', danger: true }))) return;
  lists().splice(li, 1);
  saveConfig(working);
  renderEditor();
}
async function deleteDirect(di) {
  if (!(await confirmDialog({ message: 'Delete this client?', okLabel: 'Delete', danger: true }))) return;
  directClients().splice(di, 1);
  saveConfig(working);
  renderEditor();
}

// ── Level 1: a list's detail (name + client-entry cards) ───────────────────────
function renderListDetail() {
  const list = lists()[activeList];
  if (!Array.isArray(list.clients)) list.clients = [];
  waTitle().textContent = 'Edit list';
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: list.title || '', placeholder: 'List name' });
  if (showErrors && isBlank(list.title)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { list.title = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, 'List name'),
    nameInput,
  ]));

  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Clients in this list')]);
  if (list.clients.length === 0) {
    field.appendChild(el('div', { class: 'cp-empty-hint' }, 'Add a client, then add the products to send for it.'));
  } else {
    list.clients.forEach((entry, ei) => field.appendChild(entryCard(list, entry, ei)));
  }
  content.appendChild(field);

  const addClient = el('button', { class: 'cp-add-prod', type: 'button' }, '+ Add client');
  addClient.addEventListener('click', () => { choosingClient = true; renderEditor(); });
  content.appendChild(addClient);

  content.appendChild(saveBottomButton());
}

// One client-entry card: the client's name (from the address book), a summary of its
// chosen products (names only), a tap target to edit them, and a small remove icon.
function entryCard(list, entry, ei) {
  const client = getClientById(getConfig(), entry.clientId);
  const name = client ? (client.name || 'Unnamed client') : 'Unknown client';
  const names = targetProductNames(entry);
  const summary = names.length ? names.join(', ') : 'No products yet — tap to add';

  const open = el('button', { class: 'drill-item wa-entry-open', type: 'button' }, [
    el('span', { class: 'wa-entry-text' }, [
      el('span', { class: 'wa-entry-name' }, name),
      el('span', { class: 'wa-entry-sub' }, summary),
    ]),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  open.addEventListener('click', () => { activeEntry = ei; addingProduct = false; renderEditor(); });

  const del = deleteIcon('Remove client from list', async () => {
    if (!(await confirmDialog({ message: 'Remove this client from the list?', okLabel: 'Remove', danger: true }))) return;
    list.clients.splice(ei, 1);
    markDirty();
    renderEditor();
  });

  return el('div', { class: 'wa-entry-card' }, [open, del]);
}

// ── Level 1b: choose which address-book client to add to the list ──────────────
function renderClientChooser() {
  const list = lists()[activeList];
  waTitle().textContent = 'Add client';
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  // Offer only clients not already in this list, so a client is never duplicated.
  const already = new Set(list.clients.map(e => e.clientId));
  const available = getClients(getConfig()).filter(c => !already.has(c.id));

  if (getClients(getConfig()).length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, 'No clients yet. Add them in Settings → Clients first.'));
    return;
  }
  if (available.length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, 'All clients are already in this list.'));
    return;
  }

  content.appendChild(el('p', { class: 'extra-help' }, 'Pick a client to add. Next you add the products to send for it.'));
  available.forEach(client => {
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('span', {}, client.name || 'Unnamed client'),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    box.addEventListener('click', () => {
      list.clients.push({ clientId: client.id, products: [] });
      markDirty();
      choosingClient = false;
      activeEntry = list.clients.length - 1; // drill straight into its product list
      renderEditor();
    });
    content.appendChild(box);
  });
}

// ── Level 2: a client's products (a list entry OR a direct client) + Add product ─
// The products field is shared; the screen above it differs (a list entry has no
// editable name — it comes from the address book; a direct client has a name field).
function productsField(target) {
  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Products to send')]);
  const ids = Array.isArray(target.products) ? target.products : [];
  if (ids.length === 0) {
    field.appendChild(el('div', { class: 'cp-empty-hint' }, 'No products yet. Add products from the address book.'));
  } else {
    ids.forEach(id => {
      const product = getProductById(getConfig(), id);
      if (!product) return; // a deleted product is simply not shown (pruned on save)
      field.appendChild(productRow(target, id, product.name));
    });
  }
  return field;
}

function addProductButton() {
  const btn = el('button', { class: 'cp-add-prod', type: 'button' }, '+ Add product');
  btn.addEventListener('click', () => { addingProduct = true; renderEditor(); });
  return btn;
}

function renderEntryDetail() {
  const entry = lists()[activeList].clients[activeEntry];
  if (!Array.isArray(entry.products)) entry.products = [];
  const client = getClientById(getConfig(), entry.clientId);
  waTitle().textContent = client ? (client.name || 'Client') : 'Client';
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';
  content.appendChild(productsField(entry));
  content.appendChild(addProductButton());
  content.appendChild(saveBottomButton());
}

function renderDirectDetail() {
  const dc = directClients()[activeDirect];
  if (!Array.isArray(dc.products)) dc.products = [];
  waTitle().textContent = 'Edit client';
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: dc.name || '', placeholder: 'Client name' });
  if (showErrors && isBlank(dc.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { dc.name = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, 'Client name'),
    nameInput,
  ]));

  content.appendChild(productsField(dc));
  content.appendChild(addProductButton());
  content.appendChild(saveBottomButton());
}

// One added-product row: the product name and a small remove icon. Removing a single
// product is low-friction (no confirm), matching the Clients editor's product cards.
function productRow(target, id, name) {
  const del = deleteIcon('Remove product', () => {
    const i = target.products.indexOf(id);
    if (i !== -1) target.products.splice(i, 1);
    markDirty();
    renderEditor();
  });
  return el('div', { class: 'wa-prod-row' }, [el('span', {}, name), del]);
}

// ── Level 3: choose a product (unique names) to add to the current target ──────
function renderProductPicker() {
  const target = currentTarget();
  waTitle().textContent = 'Add product';
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  // Unique product names not already added to this target.
  const addedNames = new Set(targetProductNames(target));
  const available = uniqueProducts().filter(p => !addedNames.has(p.name));

  if (uniqueProducts().length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, 'No products in the address book yet.'));
    return;
  }
  if (available.length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, 'All products are already added.'));
    return;
  }

  content.appendChild(el('p', { class: 'extra-help' }, 'Tap a product to add it. It need not belong to this client.'));
  available.forEach(product => {
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('span', {}, product.name),
      el('span', { class: 'drill-chevron' }, '+'),
    ]);
    box.addEventListener('click', () => {
      target.products.push(product.id); // store the representative id for this name
      markDirty();
      addingProduct = false; // back to the product list, showing the addition
      renderEditor();
    });
    content.appendChild(box);
  });
}

// ── Static wiring (elements exist in calculator.html) ──────────────────────────
document.querySelector('.wa-back-btn').addEventListener('click', backWhatsapp);
document.getElementById('wa-home-btn').addEventListener('click', goHome);
