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
//                plus the lines TYPED BY HAND, which live only in the message
//   • Level 3  → add to the message: this client's own products, then everyone
//                else's, then a box for a name that is in neither list
//
// PERSISTENCE MODEL: each item is saved from ITS OWN detail screen (a bottom Save).
// The top screen has NO Save — it only lists items and deletes them, and a delete is
// applied immediately (with confirmation). Leaving a detail with unsaved edits prompts
// to discard. Returning to the top re-reads the saved config, so unsaved edits never
// linger. Products show by UNIQUE NAME only (the message uses only the name; a
// representative product id is stored). Names resolve live from the address book.

import { t } from './i18n.js';
import { getConfig, saveConfig } from './calculator-config-store.js';
import {
  cloneConfig, getClients, getClientById, getProductById, getAllProducts,
  getOrderPrefillWindow, ORDER_PREFILL_WINDOWS, orderPrefillLabel,
} from './calculator-config.js';
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

// The display names of the products a target has chosen (skipping ids whose product
// has since been deleted). Used for the entry summary and the "already added" set.
function targetProductNames(target) {
  const ids = Array.isArray(target.products) ? target.products : [];
  return ids.map(id => { const p = getProductById(getConfig(), id); return p ? p.name : null; }).filter(Boolean);
}

// Everything that will appear in the message for this target: its products AND its
// free lines. The summary on the card must count both, or an entry that carries only
// free lines reads "No products yet" while the message it sends is full.
function targetLineNames(target) {
  const extras = Array.isArray(target.extras) ? target.extras : [];
  return targetProductNames(target)
    .concat(extras.map(l => (l && String(l.name || '').trim()) || null).filter(Boolean));
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
  const discardOk = () => confirmDialog({ message: t('calc.discardUnsavedChanges'), okLabel: t('ui.discard'), danger: true });
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
  const btn = el('button', { class: 'cp-save-bottom', type: 'button' }, t('ui.save'));
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
      alertDialog(t('calc.pleaseNameThisClient'));
      return;
    }
  } else if (activeList !== null) {
    if (isBlank(lists()[activeList].title)) {
      showErrors = true; renderEditor();
      alertDialog(t('calc.pleaseNameThisList'));
      return;
    }
  }
  if (!(await confirmDialog({ message: t('calc.saveTheseChanges'), okLabel: t('ui.save') }))) return;
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
    alertDialog(t('calc.couldNotSaveCheck'));
  }
}

// ── Level 0: the saved lists and direct clients (with delete icons) ────────────
// Re-reads the saved config so the screen always reflects what is persisted and any
// unsaved edits from a backed-out detail are dropped. Deletes apply immediately.
function renderTopScreen() {
  working = cloneConfig(getConfig());
  dirty = false;
  waTitle().textContent = t('calc.whatsappLists');
  setHomeVisible(true);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  content.appendChild(buildPrefillWindowField());

  content.appendChild(el('div', { class: 'send-picker-label' }, t('ui.lists')));
  lists().forEach((list, li) => {
    content.appendChild(topRow(
      list.title || t('calc.untitledList'),
      () => { activeList = li; activeEntry = null; renderEditor(); },
      t('calc.deleteList'),
      () => deleteList(li),
    ));
  });
  const addList = el('button', { class: 'cp-add-client', type: 'button' }, t('calc.addList'));
  addList.addEventListener('click', () => {
    lists().push({ id: genId('wl'), title: '', clients: [] });
    markDirty();
    activeList = lists().length - 1;
    activeEntry = null;
    renderEditor();
  });
  content.appendChild(addList);

  content.appendChild(el('div', { class: 'send-picker-label' }, t('ui.clients')));
  directClients().forEach((dc, di) => {
    content.appendChild(topRow(
      dc.name || t('calc.unnamedClient'),
      () => { activeDirect = di; renderEditor(); },
      t('calc.deleteClient'),
      () => deleteDirect(di),
    ));
  });
  const addClient = el('button', { class: 'cp-add-client', type: 'button' }, t('calc.addClient'));
  addClient.addEventListener('click', () => {
    directClients().push({ id: genId('wc'), name: '', products: [] });
    markDirty();
    activeDirect = directClients().length - 1;
    renderEditor();
  });
  content.appendChild(addClient);
}

// Which days the order form fills itself from. It sits on the TOP screen because it
// governs every list, not one of them.
//
// ⚠️ APPLIED ON THE CHANGE, not behind a Save — and that is not a shortcut. This
// screen deliberately has no Save (each list is saved from its own detail), so a
// control waiting for one would never be saved at all. It is safe here for the same
// reason as the Orders "Show stock" toggle: nothing is lost by getting it wrong, the
// numbers are still shown before anything is sent, and one more tap undoes it.
//
// ⚠️ THE BOX IS NEVER PUT BACK ON A FAILED SYNC, and that is deliberate. saveConfig
// is LOCAL-FIRST: it applies the change to memory and the cache before it sends
// anything, and it never rejects — it resolves saying whether the write reached
// Firestore. Reverting the box would therefore make the screen disagree with the
// setting the app is actually using. What is owed instead is the truth: the change
// works on this phone, and has not reached the others yet.
function buildPrefillWindowField() {
  const sel = el('select', { class: 'extra-unit-select', 'aria-label': t('calc.fillTheOrderFrom') });
  ORDER_PREFILL_WINDOWS.forEach(w => sel.appendChild(el('option', { value: w }, orderPrefillLabel(w))));
  sel.value = getOrderPrefillWindow(getConfig());

  sel.addEventListener('change', async () => {
    const wanted = sel.value;
    if (wanted === getOrderPrefillWindow(getConfig())) return;
    sel.disabled = true;
    const cfg = cloneConfig(getConfig());
    cfg.orderPrefillWindow = wanted;
    const result = await saveConfig(cfg);
    sel.disabled = false;
    // 'no-server-answer' has already explained itself inside saveConfig; saying it
    // twice would be noise.
    if (result && result.synced === false && result.reason === 'write-failed') {
      await alertDialog(t('calc.savedNotSent'));
    }
  });

  const row = el('label', { class: 'extra-toggle-row' }, [el('span', {}, t('calc.fillTheOrderFrom'))]);
  row.appendChild(sel);

  return el('div', {}, [
    row,
    el('p', { class: 'notif-note' },
      t('calc.prefillWindow.help')),
  ]);
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
  if (!(await confirmDialog({ message: t('calc.deleteThisList'), okLabel: t('ui.delete'), danger: true }))) return;
  lists().splice(li, 1);
  saveConfig(working);
  renderEditor();
}
async function deleteDirect(di) {
  if (!(await confirmDialog({ message: t('calc.deleteThisClient'), okLabel: t('ui.delete'), danger: true }))) return;
  directClients().splice(di, 1);
  saveConfig(working);
  renderEditor();
}

// ── Level 1: a list's detail (name + client-entry cards) ───────────────────────
function renderListDetail() {
  const list = lists()[activeList];
  if (!Array.isArray(list.clients)) list.clients = [];
  waTitle().textContent = t('calc.editList');
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: list.title || '', placeholder: t('calc.listName') });
  if (showErrors && isBlank(list.title)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { list.title = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.listName')),
    nameInput,
  ]));

  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, t('calc.clientsInThisList'))]);
  if (list.clients.length === 0) {
    field.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.addAClientThen')));
  } else {
    list.clients.forEach((entry, ei) => field.appendChild(entryCard(list, entry, ei)));
  }
  content.appendChild(field);

  const addClient = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addClient'));
  addClient.addEventListener('click', () => { choosingClient = true; renderEditor(); });
  content.appendChild(addClient);

  content.appendChild(saveBottomButton());
}

// One client-entry card: the client's name (from the address book), a summary of its
// chosen products (names only), a tap target to edit them, and a small remove icon.
function entryCard(list, entry, ei) {
  const client = getClientById(getConfig(), entry.clientId);
  const name = client ? (client.name || t('calc.unnamedClient')) : t('calc.unknownClient');
  const names = targetLineNames(entry);
  const summary = names.length ? names.join(', ') : t('calc.nothingToSendYet');

  const open = el('button', { class: 'drill-item wa-entry-open', type: 'button' }, [
    el('span', { class: 'wa-entry-text' }, [
      el('span', { class: 'wa-entry-name' }, name),
      el('span', { class: 'wa-entry-sub' }, summary),
    ]),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  open.addEventListener('click', () => { activeEntry = ei; addingProduct = false; renderEditor(); });

  const del = deleteIcon(t('calc.removeClientFromList'), async () => {
    if (!(await confirmDialog({ message: t('calc.removeThisClientFrom'), okLabel: t('ui.remove'), danger: true }))) return;
    list.clients.splice(ei, 1);
    markDirty();
    renderEditor();
  });

  return el('div', { class: 'wa-entry-card' }, [open, del]);
}

// ── Level 1b: choose which address-book client to add to the list ──────────────
function renderClientChooser() {
  const list = lists()[activeList];
  waTitle().textContent = t('calc.addClient2');
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  // Offer only clients not already in this list, so a client is never duplicated.
  const already = new Set(list.clients.map(e => e.clientId));
  const available = getClients(getConfig()).filter(c => !already.has(c.id));

  if (getClients(getConfig()).length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noClientsYetAdd')));
    return;
  }
  if (available.length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.allClientsAreAlready')));
    return;
  }

  content.appendChild(el('p', { class: 'extra-help' }, t('calc.pickAClientTo')));
  available.forEach(client => {
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('span', {}, client.name || t('calc.unnamedClient')),
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
  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, t('calc.productsToSend'))]);
  const ids = Array.isArray(target.products) ? target.products : [];
  if (ids.length === 0) {
    field.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noProductsYetAdd')));
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
  const btn = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addProduct'));
  btn.addEventListener('click', () => { addingProduct = true; renderEditor(); });
  return btn;
}

// ── Free lines: things this client buys that the bakery does not calculate ────
// A typed name that lives ONLY in the message. It is not a product, so it cannot
// reach a dough total and cannot be pruned when somebody tidies the address book.
//
// The real case: a client buys loaves cut from the bread baked for ANOTHER client.
// The dough is already counted once and must not be counted twice — but the line
// still has to reach that client's message.
//
// ⚠️ EDITED IN PLACE, not through a picker. There is nothing to pick from: the whole
// point is that this thing is not in the address book. Typing straight into the row
// is also what makes it obvious it is a free line rather than a product, which the
// rows above it are.
function freeLinesField(target) {
  if (!Array.isArray(target.extras)) target.extras = [];

  const field = el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.addedByHand')),
    el('p', { class: 'extra-help' },
      t('calc.byHand.help')),
  ]);

  target.extras.forEach((line, i) => {
    const input = el('input', {
      class: 'cp-client-name', type: 'text', value: line.name || '',
      placeholder: t('calc.eGLoavesOf'),
      'aria-label': t('calc.extraLine') + (i + 1),
    });
    // ⚠️ The id is NOT recomputed as the name is typed. It keys the quantity box in
    // the order modal, so changing it mid-edit would move somebody's typed number to
    // a different row. A blank line is dropped on save, which is where ids settle.
    input.addEventListener('input', () => { line.name = input.value; markDirty(); });

    const del = deleteIcon(t('calc.removeLine'), () => {
      target.extras.splice(i, 1);
      markDirty();
      renderEditor();
    });
    field.appendChild(el('div', { class: 'wa-prod-row' }, [input, del]));
  });

  return field;
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
  content.appendChild(freeLinesField(entry));
  content.appendChild(saveBottomButton());
}

function renderDirectDetail() {
  const dc = directClients()[activeDirect];
  if (!Array.isArray(dc.products)) dc.products = [];
  waTitle().textContent = t('calc.editClient');
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: dc.name || '', placeholder: t('calc.clientName') });
  if (showErrors && isBlank(dc.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { dc.name = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.clientName')),
    nameInput,
  ]));

  content.appendChild(productsField(dc));
  content.appendChild(addProductButton());
  content.appendChild(freeLinesField(dc));
  content.appendChild(saveBottomButton());
}

// One added-product row: the product name and a small remove icon. Removing a single
// product is low-friction (no confirm), matching the Clients editor's product cards.
function productRow(target, id, name) {
  const del = deleteIcon(t('calc.removeProduct'), () => {
    const i = target.products.indexOf(id);
    if (i !== -1) target.products.splice(i, 1);
    markDirty();
    renderEditor();
  });
  return el('div', { class: 'wa-prod-row' }, [el('span', {}, name), del]);
}

// The address book as this picker sees it: unique by NAME, because the message only
// ever carries a name.
//
// ⚠️ WHEN TWO CLIENTS SELL THE SAME NAME, THIS CLIENT'S OWN COPY WINS. Picking the
// first one found would file a client's own product under "other products" — exactly
// backwards — whenever somebody else happened to be earlier in the address book.
function pickerProducts(client) {
  const ownIds = new Set(client ? (client.products || []).map(p => p.id) : []);
  const byName = new Map();
  for (const p of getAllProducts(getConfig())) {
    const seen = byName.get(p.name);
    if (!seen || (!ownIds.has(seen.id) && ownIds.has(p.id))) byName.set(p.name, { id: p.id, name: p.name });
  }
  return { rows: [...byName.values()], ownIds };
}

// The client this target belongs to, or null for a direct client — which is a typed
// name with no address-book entry, so it has no products "of its own".
function targetClient(target) {
  return activeDirect !== null ? null : getClientById(getConfig(), target.clientId);
}

// ── Level 3: choose what to add ───────────────────────────────────────────────
// Three ways in, in the order somebody looks for them: this client's own products
// first, then everything else in the address book, and last a box for a name that is
// in neither — the escape hatch that makes the WhatsApp side independent of the
// Clients screen.
//
// ⚠️ THE TYPING BOX IS LAST ON PURPOSE. At the top it would be the first thing
// reached, and half the free lines would be hand-typed copies of products that were
// already there two rows below — two rows in one message for the same thing.
function renderProductPicker() {
  const target = currentTarget();
  const client = targetClient(target);
  waTitle().textContent = t('calc.addToTheMessage');
  setHomeVisible(false);
  const content = document.getElementById('wa-content');
  content.textContent = '';

  // Already on this target, by name: products AND hand-typed lines, so the picker
  // cannot offer something the message already carries.
  const added = new Set(targetLineNames(target));
  const { rows, ownIds } = pickerProducts(client);
  const available = rows.filter(p => !added.has(p.name));
  const own = available.filter(p => ownIds.has(p.id));
  const others = available.filter(p => !ownIds.has(p.id));

  const addProduct = product => {
    target.products.push(product.id); // store the representative id for this name
    markDirty();
    addingProduct = false;            // back to the list, showing the addition
    renderEditor();
  };

  if (own.length) {
    content.appendChild(el('div', { class: 'send-picker-label' },
      client ? `${client.name}’s products` : t('calc.itsProducts')));
    own.forEach(p => content.appendChild(pickRow(p.name, () => addProduct(p))));
  }

  if (others.length) {
    content.appendChild(el('div', { class: 'send-picker-label' },
      own.length ? t('calc.otherProducts') : 'Products'));
    content.appendChild(el('p', { class: 'extra-help' },
      t('calc.otherProducts.help')));
    others.forEach(p => content.appendChild(pickRow(p.name, () => addProduct(p))));
  }

  if (!own.length && !others.length) {
    content.appendChild(el('div', { class: 'cp-empty-hint' },
      rows.length ? t('calc.everythingInTheAddress')
        : t('calc.noProductsInThe')));
  }

  content.appendChild(byHandField(target, added));
}

function pickRow(label, onPick) {
  const box = el('button', { class: 'drill-item', type: 'button' }, [
    el('span', {}, label),
    el('span', { class: 'drill-chevron' }, '+'),
  ]);
  box.addEventListener('click', onPick);
  return box;
}

// ── Type a name that is in neither list ───────────────────────────────────────
// This is what makes the WhatsApp side independent of the Clients screen: something
// a client buys but the bakery does not calculate — bread cut from another client's
// batch, say — needs a line in the message and must never reach a dough total.
//
// It is stored as a FREE LINE, not as a product, so there is nothing to count and
// nothing to prune. The order form always leaves it empty for you to fill in, because
// no production log can ever name it.
function byHandField(target, added) {
  const input = el('input', {
    class: 'cp-client-name', type: 'text',
    placeholder: t('calc.eGLoavesOf'),
    'aria-label': t('calc.addALineBy'),
  });
  const warning = el('p', { class: 'extra-help cp-empty-hint' });
  warning.hidden = true;

  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    // Refuse a name the message already carries, rather than sending the client the
    // same thing on two lines. Said out loud — silently ignoring the tap reads as a
    // broken button.
    if (added.has(name)) {
      warning.textContent = `“${name}” is already in this message.`;
      warning.hidden = false;
      return;
    }
    if (!Array.isArray(target.extras)) target.extras = [];
    target.extras.push({ id: '', name });   // the id settles on save
    markDirty();
    addingProduct = false;
    renderEditor();
  };

  input.addEventListener('input', () => { warning.hidden = true; });
  const btn = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addThisLine'));
  btn.addEventListener('click', add);

  return el('div', { class: 'cp-field' }, [
    el('div', { class: 'send-picker-label' }, t('calc.notInTheAddress')),
    el('p', { class: 'extra-help' },
      t('calc.typeItHere.help')),
    input,
    warning,
    btn,
  ]);
}

// ── Static wiring (elements exist in calculator.html) ──────────────────────────
document.querySelector('.wa-back-btn').addEventListener('click', backWhatsapp);
document.getElementById('wa-home-btn').addEventListener('click', goHome);
