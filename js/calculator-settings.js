// calculator-settings.js — the Settings hub and the Clients editor.
//
// The footer "Settings" button opens a small chooser (#settings-overlay) whose entries
// each open their own overlay: Clients (this editor, #cp-overlay), WhatsApp
// (calculator-whatsapp-settings.js), Recipes (recipes.js), Extra dough and Divisor.
//
// THE MODEL: a product belongs to the client that orders it. Open a client and you see
// everything about each of its products — name, recipe, weight, how the quantity is
// typed, and the crate box — with nothing to visit first. The separate Products screen
// (a shared catalogue you had to fill in before a client could reference it) is gone:
// it cost two screens and seven steps to add one product, and in the real data only one
// product out of ten was ever shared between two clients.
//
// The editor works on a deep copy of the live config and touches nothing until the user
// taps Save (with a confirm), which persists through the config store (Firestore +
// cache) and triggers a calculator re-render. Required fields are validated on Save;
// deleting is a small low-key icon, never competing with Save (P20).

import { getConfig, saveConfig } from './calculator-config-store.js';
import {
  WEIGHT_MIN, WEIGHT_MAX, cloneConfig, isExtraDoughEnabled, getTabProducts, isInDivisor,
  getRecipes, getRecipeById, getIngredients, pairId,
} from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { openRecipes } from './recipes.js';
import { openWhatsapp } from './calculator-whatsapp-settings.js';
import { confirmDiscard } from './calculator-confirm.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import Sortable from './vendor/sortable.esm.js';

// A recipe's display name (falls back to its id if the recipe was deleted).
function recipeLabel(id) { const r = getRecipeById(getConfig(), id); return r ? r.name : id; }

// How the quantity is entered on the calculator. 'kg' is not offered here (it is a
// legacy widget tied to the old extra-dough product, no longer creatable).
const TYPE_LABELS = { number: 'Number', dropdown: 'Dropdown' };

let working = null;        // Clients editor: deep copy being edited
let activeClient = null;   // null = the client list, an index = a client's detail
let freshlyAdded = false;  // the item just opened was created by an "Add" button
let showErrors = false;    // after a failed Save, mark empty required fields
let dirty = false;

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

// Unique element id for a newly created client/product/group.
function genId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8);
}

function isBlank(s) { return !s || !String(s).trim(); }

// ── Hub ───────────────────────────────────────────────────────────────────────
export function openSettings() { show('settings-overlay'); }
function closeSettings() { hide('settings-overlay'); }

// ── Clients editor ─────────────────────────────────────────────────────────────
function clients() {
  if (!Array.isArray(working.clients)) working.clients = [];
  return working.clients;
}

function cpTitle() { return document.querySelector('#cp-overlay .recipe-overlay-title'); }

// The header Home button is hidden on detail screens, shown on the list.
function setHomeVisible(visible) {
  const btn = document.getElementById('cp-home-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

function openClients() {
  working = cloneConfig(getConfig());
  activeClient = null;
  freshlyAdded = false;
  showErrors = false;
  dirty = false;
  renderEditor();
  updateSaveBtn();
  show('cp-overlay');
}

// True when a just-added client was left untouched (no name, no products), so it should
// not be kept when leaving its detail screen.
function isEmptyClient(c) {
  return !c || (isBlank(c.name) && (!c.products || c.products.length === 0));
}

async function closeClients() {
  if (activeClient !== null) {
    const client = clients()[activeClient];
    if (freshlyAdded && isEmptyClient(client)) {
      if (!(await confirmDialog({ message: 'Discard this new client? You have not added anything to it.', okLabel: 'Discard', danger: true }))) return;
      clients().splice(activeClient, 1);
    }
    freshlyAdded = false;
    activeClient = null;
    renderEditor();
    return;
  }
  if (!(await confirmDiscard(dirty))) return;
  hide('cp-overlay');
}

async function goHomeFromClients() {
  if (!(await confirmDiscard(dirty))) return;
  window.location.href = 'index.html';
}

function markDirty() { dirty = true; updateSaveBtn(); }

function updateSaveBtn() {
  const btn = document.getElementById('cp-save-btn');
  btn.disabled = !dirty;
  btn.classList.toggle('dirty', dirty);
}

// The index of the first client that is invalid (a blank name, or a product with no
// name), or null if every client and product is complete.
function findInvalid() {
  const cs = clients();
  for (let i = 0; i < cs.length; i++) {
    if (isBlank(cs[i].name)) return i;
    for (const p of (cs[i].products || [])) if (isBlank(p.name)) return i;
  }
  return null;
}

async function saveClients() {
  const invalid = findInvalid();
  if (invalid !== null) {
    showErrors = true;
    activeClient = invalid;
    renderEditor();
    alertDialog('Please give every client and every product a name before saving.');
    return;
  }
  if (!(await confirmDialog({ message: 'Save these changes?', okLabel: 'Save' }))) return;
  try {
    await saveConfig(working);
    forgetPausedQuantities();
    showErrors = false;
    dirty = false;
    updateSaveBtn();
    freshlyAdded = false;
    activeClient = null;
    renderEditor();
  } catch (e) {
    alertDialog('Could not save. Check your connection and try again.');
  }
}

// Drop the typed quantity of every paused product.
//
// ⚠️ Quantities live for days — only "Reset all fields" clears them, and that clears
// only the rows it can SEE. A paused product has no row, so its number would become
// unreachable and then reappear inside a real dough on the day it is switched back on,
// with no warning. Idempotent, so it needs no before/after comparison.
function forgetPausedQuantities() {
  for (const client of clients()) {
    for (const product of (client.products || [])) {
      if (product && product.active === false) {
        try { localStorage.removeItem('qty-' + pairId(client.id, product.id)); } catch (e) {}
      }
    }
  }
}

function renderEditor() {
  if (activeClient === null) renderClientList();
  else renderClientDetail(activeClient);
}

function saveBottomButton(onSave) {
  const btn = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save');
  btn.addEventListener('click', onSave);
  return btn;
}

function deleteIcon(label, onDelete) {
  const btn = el('button', { class: 'cp-del-icon', type: 'button', 'aria-label': label }, icon('trash', 17));
  btn.addEventListener('click', onDelete);
  return btn;
}

// ── Clients Level 0: the address book ─────────────────────────────────────────
let clientSortable = null;

function renderClientList() {
  cpTitle().textContent = 'Clients';
  setHomeVisible(true);
  const content = document.getElementById('cp-content');
  if (clientSortable) { clientSortable.destroy(); clientSortable = null; }
  content.textContent = '';

  const listWrap = el('div', { class: 'cp-client-list' });
  clients().forEach((client, ci) => listWrap.appendChild(clientBox(client, ci)));
  content.appendChild(listWrap);

  if (clients().length > 1) {
    clientSortable = Sortable.create(listWrap, {
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true,
      draggable: '.drill-reorder',
      ghostClass: 'cp-sortable-ghost',
      chosenClass: 'cp-sortable-chosen',
      dragClass: 'cp-sortable-drag',
      onEnd: syncClientOrderFromDom,
    });
  }

  const add = el('button', { class: 'cp-add-client', type: 'button' }, '+ Add client');
  add.addEventListener('click', () => {
    clients().push({ id: genId('c'), name: '', items: [] });
    markDirty();
    freshlyAdded = true;
    activeClient = clients().length - 1;
    renderEditor();
  });
  content.appendChild(add);
}

function clientBox(client, ci) {
  const box = el('button', { class: 'drill-item drill-reorder', type: 'button', 'data-cid': client.id }, [
    el('span', {}, client.name || 'Unnamed client'),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  box.addEventListener('click', () => {
    const idx = clients().findIndex(c => c.id === client.id);
    if (idx === -1) return;
    freshlyAdded = false;
    activeClient = idx;
    renderEditor();
  });
  return box;
}

function syncClientOrderFromDom() {
  const ids = [...document.querySelectorAll('#cp-content .drill-reorder')].map(n => n.dataset.cid);
  const cs = clients();
  const before = cs.map(c => c.id).join('|');
  cs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (cs.map(c => c.id).join('|') !== before) markDirty();
}

// ── Clients Level 1: a client's detail (name + ordered-product cards) ──────────
function renderClientDetail(ci) {
  const client = clients()[ci];
  if (!Array.isArray(client.products)) client.products = [];
  cpTitle().textContent = 'Edit client';
  setHomeVisible(false);
  const content = document.getElementById('cp-content');
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: client.name || '', placeholder: 'Client name' });
  if (showErrors && isBlank(client.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { client.name = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  const del = deleteIcon('Delete client', async () => {
    if (!(await confirmDialog({ message: 'Delete this client and its products?', okLabel: 'Delete', danger: true }))) return;
    clients().splice(ci, 1);
    markDirty();
    activeClient = null;
    renderEditor();
  });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, 'Client name'),
    el('div', { class: 'cp-name-row' }, [nameInput, del]),
  ]));

  // The products this client orders, each described in full right here.
  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Products ordered')]);
  client.products.forEach((p, pi) => field.appendChild(productCard(client, p, pi)));
  const addProd = el('button', { class: 'cp-add-prod', type: 'button' }, '+ Add product');
  addProd.addEventListener('click', () => {
    const recipes = getRecipes(working);
    client.products.push({
      id: genId('p'), name: '', recipeId: recipes[0] ? recipes[0].id : '',
      weight: 100, kind: 'number', crate: { show: false, perBox: 20 },
    });
    markDirty();
    renderEditor();
  });
  field.appendChild(addProd);
  content.appendChild(field);

  content.appendChild(saveBottomButton(saveClients));
}

// One product of this client, described in full: its name, the recipe it belongs to,
// its unit weight, how the quantity is typed, and the optional crate box. Everything a
// product is now lives here — there is no separate catalogue screen to visit first.
function productCard(client, product, pi) {
  const paused = product.active === false;

  const del = deleteIcon('Remove product', () => {
    client.products.splice(pi, 1);
    markDirty();
    renderEditor();
  });

  const nameInput = el('input', { class: 'cp-prod-name', type: 'text', value: product.name || '', placeholder: 'Product name' });
  if (showErrors && isBlank(product.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => {
    product.name = nameInput.value;
    nameInput.classList.remove('cp-invalid');
    markDirty();
  });

  const head = [nameInput];
  if (paused) head.push(el('span', { class: 'cp-paused-tag' }, 'Paused'));
  head.push(del);
  const children = [el('div', { class: 'cp-prod-card-head' }, head)];

  // Recipe. A product whose recipe was deleted is re-homed onto the first one, so the
  // select always shows something real rather than an empty box.
  const recipes = getRecipes(working);
  const recipeSel = el('select', { class: 'cp-prod-dough', 'aria-label': 'Recipe' });
  for (const r of recipes) recipeSel.appendChild(el('option', { value: r.id }, r.name));
  const known = recipes.some(r => r.id === product.recipeId);
  if (!known && recipes[0]) product.recipeId = recipes[0].id;
  recipeSel.value = product.recipeId;
  recipeSel.addEventListener('change', () => { product.recipeId = recipeSel.value; markDirty(); });
  children.push(el('div', { class: 'cp-prod-card-row' }, [el('span', { class: 'cp-unit' }, 'Recipe'), recipeSel]));

  const weight = el('input', {
    class: 'cp-prod-weight', type: 'number', min: String(WEIGHT_MIN), max: String(WEIGHT_MAX),
    step: '1', value: String(product.weight), inputmode: 'numeric',
  });
  weight.addEventListener('input', () => { product.weight = +weight.value || 0; markDirty(); });
  children.push(el('div', { class: 'cp-prod-card-row' }, [
    el('span', { class: 'cp-unit' }, 'Weight'), weight, el('span', { class: 'cp-unit' }, 'g'),
  ]));

  if (product.kind === 'kg') {
    // Legacy kg product: quantity entered in kilograms; no type/crate options.
    children.push(el('div', { class: 'cp-prod-card-row' }, [el('span', { class: 'cp-kg-note' }, 'kg')]));
  } else {
    const type = el('select', { class: 'cp-prod-dough', 'aria-label': 'Quantity type' });
    for (const k of ['number', 'dropdown']) type.appendChild(el('option', { value: k }, TYPE_LABELS[k]));
    type.value = product.kind === 'dropdown' ? 'dropdown' : 'number';
    type.addEventListener('change', () => { product.kind = type.value; markDirty(); });
    children.push(el('div', { class: 'cp-prod-card-row' }, [el('span', { class: 'cp-unit' }, 'Type'), type]));

    if (!product.crate || typeof product.crate !== 'object') product.crate = { show: false, perBox: 20 };
    const crateToggle = el('input', { type: 'checkbox' });
    crateToggle.checked = !!product.crate.show;
    // Re-render on toggle: the pieces field APPEARS only once the box is ticked, rather
    // than sitting there greyed out.
    crateToggle.addEventListener('change', () => {
      product.crate.show = crateToggle.checked;
      markDirty();
      renderEditor();
    });
    const crateRow = [el('label', { class: 'cp-crate-label' }, [crateToggle, el('span', {}, 'Crate box')])];
    if (product.crate.show) {
      const perBoxInput = el('input', {
        class: 'cp-prod-weight', type: 'number', min: '1', max: '1000', step: '1',
        value: String(product.crate.perBox || 20), inputmode: 'numeric',
      });
      perBoxInput.addEventListener('input', () => { product.crate.perBox = +perBoxInput.value || 0; markDirty(); });
      crateRow.push(perBoxInput, el('span', { class: 'cp-unit' }, 'pz'));
    }
    children.push(el('div', { class: 'cp-prod-card-row' }, crateRow));
  }

  // Pause instead of delete: the product stays here with its recipe, weight, type and
  // crate, but leaves the calculator until it is switched back on.
  const activeToggle = el('input', { type: 'checkbox' });
  activeToggle.checked = !paused;
  activeToggle.addEventListener('change', () => {
    product.active = activeToggle.checked;
    markDirty();
    renderEditor();
  });
  children.push(el('label', { class: 'cp-crate-label' }, [activeToggle, el('span', {}, 'Active')]));

  return el('div', { class: 'cp-prod-card' + (paused ? ' cp-prod-card-paused' : '') }, children);
}

// ── Ingredients registry (separate Settings screen) ───────────────────────────
// The master list of ingredient names used for autocomplete when composing a recipe.
// Independent of the recipes: a name can exist here unused. Names used by a recipe are
// always present (re-seeded on save), so deleting one only removes an UNUSED name.
let ingWorking = null;
let ingDirty = false;

function ingList() {
  if (!Array.isArray(ingWorking.ingredients)) ingWorking.ingredients = [];
  return ingWorking.ingredients;
}
function updateIngSaveBtn() {
  const btn = document.getElementById('ingredients-save-btn');
  if (!btn) return;
  btn.disabled = !ingDirty;
  btn.classList.toggle('dirty', ingDirty);
}
function ingMarkDirty() { ingDirty = true; updateIngSaveBtn(); }

function openIngredients() {
  ingWorking = cloneConfig(getConfig());
  ingDirty = false;
  renderIngredientsList();
  updateIngSaveBtn();
  show('ingredients-overlay');
}
async function closeIngredients() {
  if (!(await confirmDiscard(ingDirty))) return;
  hide('ingredients-overlay');
}

function renderIngredientsList() {
  const content = document.getElementById('ingredients-content');
  content.textContent = '';
  content.appendChild(el('p', { class: 'extra-help' },
    'The ingredient names that autocomplete when you build a recipe. Names used by a recipe always stay; deleting only removes an unused name.'));
  ingList().forEach((ing, ii) => {
    const nameInput = el('input', { class: 'cp-prod-name', type: 'text', value: ing.name || '', placeholder: 'Ingredient name' });
    nameInput.addEventListener('input', () => { ing.name = nameInput.value; ingMarkDirty(); });
    const del = deleteIcon('Delete ingredient', () => { ingList().splice(ii, 1); ingMarkDirty(); renderIngredientsList(); });
    content.appendChild(el('div', { class: 'cp-prod-card' }, [el('div', { class: 'cp-prod-card-head' }, [nameInput, del])]));
  });
  const add = el('button', { class: 'cp-add-client', type: 'button' }, '+ Add ingredient');
  add.addEventListener('click', () => { ingList().push({ id: genId('ing'), name: '' }); ingMarkDirty(); renderIngredientsList(); });
  content.appendChild(add);
}

async function saveIngredients() {
  // Drop blank rows; normalizeConfig de-dupes and re-seeds names used by recipes.
  ingWorking.ingredients = ingList().filter(i => !isBlank(i.name));
  if (!(await confirmDialog({ message: 'Save these changes?', okLabel: 'Save' }))) return;
  try {
    await saveConfig(ingWorking);
    ingDirty = false;
    updateIngSaveBtn();
    ingWorking = cloneConfig(getConfig());
    renderIngredientsList();
  } catch (e) {
    alertDialog('Could not save. Check your connection and try again.');
  }
}

// ── Extra-dough visibility (separate Settings screen) ─────────────────────────
let extraWorking = null;
let extraDirty = false;

function updateExtraSaveBtn() {
  const btn = document.getElementById('extra-save-btn');
  if (!btn) return;
  btn.disabled = !extraDirty;
  btn.classList.toggle('dirty', extraDirty);
}

function openExtra() {
  extraWorking = cloneConfig(getConfig());
  extraDirty = false;
  // One toggle per recipe, generated (recipes are dynamic).
  const list = document.getElementById('extra-content-list');
  if (list) {
    list.textContent = '';
    for (const recipe of getRecipes(extraWorking)) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = isExtraDoughEnabled(extraWorking, recipe.id);
      cb.addEventListener('change', () => {
        if (!extraWorking.extraDough || typeof extraWorking.extraDough !== 'object') extraWorking.extraDough = {};
        extraWorking.extraDough[recipe.id] = cb.checked;
        extraDirty = true;
        updateExtraSaveBtn();
      });
      list.appendChild(el('label', { class: 'extra-toggle-row' }, [el('span', {}, recipe.name), cb]));
    }
  }
  updateExtraSaveBtn();
  show('extra-overlay');
}
async function closeExtra() {
  if (!(await confirmDiscard(extraDirty))) return;
  hide('extra-overlay');
}

async function saveExtra() {
  if (!(await confirmDialog({ message: 'Save these changes?', okLabel: 'Save' }))) return;
  try {
    await saveConfig(extraWorking);
    extraDirty = false;
    updateExtraSaveBtn();
  } catch (e) {
    alertDialog('Could not save. Check your connection and try again.');
  }
}

document.getElementById('open-extra-btn').addEventListener('click', openExtra);
document.querySelector('.extra-back-btn').addEventListener('click', closeExtra);
document.getElementById('extra-save-btn').addEventListener('click', saveExtra);
document.getElementById('extra-home-btn').addEventListener('click', async () => {
  if (!(await confirmDiscard(extraDirty))) return;
  window.location.href = 'index.html';
});

// ── Divisor selection (separate Settings screen) ──────────────────────────────
let divisorTab = null;
let divisorWorking = null;
let divisorDirty = false;

function openDivisor() {
  divisorTab = null; divisorWorking = null; divisorDirty = false;
  renderDivisorSettings();
  show('divisor-overlay');
}
function closeDivisor() { hide('divisor-overlay'); }

async function backDivisor() {
  if (divisorTab !== null) {
    if (!(await confirmDiscard(divisorDirty))) return;
    divisorTab = null; divisorWorking = null; divisorDirty = false;
    renderDivisorSettings();
    return;
  }
  closeDivisor();
}

function setDivisorTitle(text) {
  const t = document.querySelector('#divisor-overlay .recipe-overlay-title');
  if (t) t.textContent = text;
}
function setDivisorHomeVisible(visible) {
  const btn = document.getElementById('divisor-home-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

function updateDivisorSaveBtn() {
  const btn = document.getElementById('divisor-save-btn');
  if (!btn) return;
  btn.disabled = !divisorDirty;
  btn.classList.toggle('dirty', divisorDirty);
}

function renderDivisorSettings() {
  if (divisorTab === null) renderDivisorTabChooser();
  else renderDivisorTabDetail(divisorTab);
}

function renderDivisorTabChooser() {
  setDivisorTitle('Divisor');
  setDivisorHomeVisible(true);
  const content = document.getElementById('divisor-content');
  content.textContent = '';
  content.appendChild(el('p', { class: 'extra-help' },
    'Pick which products each recipe’s divisor box splits into crates. Nothing is split until you tick it. Tap Save to apply.'));
  for (const recipe of getRecipes(getConfig())) {
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('span', {}, recipe.name),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    box.addEventListener('click', () => { divisorTab = recipe.id; renderDivisorSettings(); });
    content.appendChild(box);
  }
}

function renderDivisorTabDetail(tab) {
  setDivisorTitle(recipeLabel(tab) + ' divisor');
  setDivisorHomeVisible(false);
  if (divisorWorking === null) { divisorWorking = cloneConfig(getConfig()); divisorDirty = false; }
  const content = document.getElementById('divisor-content');
  content.textContent = '';
  // One checkbox per product of this recipe (by product id, not per client), so a
  // ticked product is split across every client that orders it. De-duplicate the
  // tab rows (which are per client) down to one row per product.
  const seen = new Set();
  const products = getTabProducts(getConfig(), tab).filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  if (products.length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, 'No products in this tab yet.'));
    return;
  }
  products.forEach(p => content.appendChild(divisorProductRow(tab, p)));
  const clearBtn = el('button', { class: 'divisor-clear-btn', type: 'button' }, 'Untick all');
  clearBtn.addEventListener('click', () => clearDivisorTab(tab));
  content.appendChild(clearBtn);
  const saveBtn = el('button', { class: 'cp-save-bottom', id: 'divisor-save-btn', type: 'button' }, 'Save');
  saveBtn.addEventListener('click', saveDivisor);
  content.appendChild(saveBtn);
  updateDivisorSaveBtn();
}

function divisorProductRow(tab, product) {
  const box = el('input', { type: 'checkbox' });
  box.checked = isInDivisor(divisorWorking, tab, product.id);
  box.addEventListener('change', () => toggleDivisorProduct(tab, product.id, box.checked));
  return el('label', { class: 'cp-check-row' }, [box, el('span', {}, product.name)]);
}

function toggleDivisorProduct(tab, productId, included) {
  if (!divisorWorking.divisorIncluded || typeof divisorWorking.divisorIncluded !== 'object') divisorWorking.divisorIncluded = {};
  const list = Array.isArray(divisorWorking.divisorIncluded[tab]) ? divisorWorking.divisorIncluded[tab] : [];
  const i = list.indexOf(productId);
  if (included && i === -1) list.push(productId);
  else if (!included && i !== -1) list.splice(i, 1);
  divisorWorking.divisorIncluded[tab] = list;
  divisorDirty = true;
  updateDivisorSaveBtn();
}

function clearDivisorTab(tab) {
  if (!divisorWorking.divisorIncluded || typeof divisorWorking.divisorIncluded !== 'object') divisorWorking.divisorIncluded = {};
  divisorWorking.divisorIncluded[tab] = [];
  divisorDirty = true;
  renderDivisorSettings();
}

async function saveDivisor() {
  if (!(await confirmDialog({ message: 'Save these changes?', okLabel: 'Save' }))) return;
  try {
    await saveConfig(divisorWorking);
    divisorWorking = cloneConfig(getConfig());
    divisorDirty = false;
    updateDivisorSaveBtn();
  } catch (e) {
    alertDialog('Could not save. Check your connection and try again.');
  }
}

document.getElementById('open-divisor-btn').addEventListener('click', openDivisor);
document.querySelector('.divisor-back-btn').addEventListener('click', backDivisor);
document.getElementById('divisor-home-btn').addEventListener('click', async () => {
  if (!(await confirmDiscard(divisorDirty))) return;
  window.location.href = 'index.html';
});

// ── Static wiring (elements exist in calculator.html) ─────────────────────────
document.querySelector('.settings-back-btn').addEventListener('click', closeSettings);
document.getElementById('open-clients-btn').addEventListener('click', openClients);
document.getElementById('open-whatsapp-btn').addEventListener('click', openWhatsapp);
document.getElementById('open-recipes-btn').addEventListener('click', openRecipes);
document.querySelector('.cp-back-btn').addEventListener('click', closeClients);
document.getElementById('cp-home-btn').addEventListener('click', goHomeFromClients);
document.getElementById('cp-save-btn').addEventListener('click', saveClients);
document.getElementById('open-ingredients-btn').addEventListener('click', openIngredients);
document.querySelector('.ingredients-back-btn').addEventListener('click', closeIngredients);
document.getElementById('ingredients-home-btn').addEventListener('click', async () => {
  if (!(await confirmDiscard(ingDirty))) return;
  window.location.href = 'index.html';
});
document.getElementById('ingredients-save-btn').addEventListener('click', saveIngredients);
