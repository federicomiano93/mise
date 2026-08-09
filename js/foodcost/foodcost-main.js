// foodcost-main.js — entry point / orchestrator for the Food Cost page.
// Owns the view routing (list ↔ product ↔ history), the header, the shared
// confirm dialog and toast, and the live subscriptions.
//
// Feature-local only: it reads the catalogue's recipes and Orders' ingredients as
// Firestore COLLECTIONS, through its own data layer — js/foodcost/ imports nothing
// from js/catalogue/ or js/orders/, except the two shared, non-feature modules in
// js/ root (price-model.js and the recipe cost maths), which both features already
// share for the same reason.

import {
  initFoodCost, getProducts, tables, saveProduct, deleteProduct, setSyncErrorHandler,
  getRecipes, getIngredients,
} from './foodcost-store.js';
import { renderList } from './foodcost-list.js';
import { renderEditor } from './foodcost-editor.js';
import { getProductHistory } from './firebase-foodcost.js';
import { confirmDialog } from './confirm-dialog.js';
import { el } from './dom.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';
import { formatRate, formatMoney, pricePerKg } from '../price-model.js';

const screen = document.getElementById('fcScreen');
const titleEl = document.getElementById('fcTitle');
const subEl = document.getElementById('fcSub');
const homeBtn = document.getElementById('fcHome');
const backBtn = document.getElementById('fcBack');

let view = 'list';
let activeList = null;
let currentProduct = null;
let leaveGuard = null;

function setHeader({ title, sub, back }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  homeBtn.hidden = back;
  backBtn.hidden = !back;
}

function swap(node) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  node.setAttribute('tabindex', '-1');
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

function showList() {
  view = 'list';
  currentProduct = null;
  leaveGuard = null;
  setHeader({ title: 'Food cost', sub: 'Products and margins', back: false });
  activeList = renderList({
    products: getProducts(), tables: tables(), onOpen: openProduct, onAdd: () => openProduct(null),
  });
  swap(activeList.root);
}

function openProduct(product) {
  view = 'editor';
  activeList = null;
  currentProduct = product;
  leaveGuard = null;
  setHeader({ title: product ? (product.name || 'Product') : 'New product', sub: 'Food cost', back: true });
  swap(renderEditor({ product, app }));
}

// The margin over time. Read on demand, never watched.
async function openHistory(product) {
  view = 'history';
  leaveGuard = null;
  setHeader({ title: 'Margin history', sub: product.name || 'Product', back: true });

  const body = el('div', { class: 'fc-view' }, [el('p', { class: 'fc-empty', text: 'Loading…' })]);
  swap(body);

  let entries;
  try {
    entries = await getProductHistory(product.id);
  } catch (err) {
    console.error('Could not read the margin history:', err);
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      'Could not load the history — check your connection and try again.' }));
    return;
  }

  if (!entries.length) {
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      'Nothing recorded yet. A point is added whenever the price or the recipe changes.' }));
    return;
  }

  body.replaceChildren(
    ...entries.map(entry => el('div', { class: 'fc-hist-row' }, [
      el('span', { class: 'fc-hist-pct', text: `${entry.foodCostPct}%` }),
      el('span', { class: 'fc-hist-detail', text:
        `${formatRate(entry.unitCost)} cost  ·  ${formatMoney(entry.sellingPrice)} at ${entry.vatRate}% VAT` }),
      el('span', { class: 'fc-hist-when', text: shortDate(entry.recordedAt) }),
    ])),
    // ⚠️ SAID OUT LOUD, because the gap is invisible otherwise. A point exists only
    // where somebody changed something; ingredient prices drifting upward leave no
    // mark here at all, so a flat line does NOT mean a flat margin.
    el('p', { class: 'fc-note', text:
      'A point is recorded when the price or the recipe changes — not when ingredient prices drift, so a flat line here does not mean the margin held.' }),
  );
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function handleBack() {
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
  }
  leaveGuard = null;
  // From the history, step back into the product it belongs to — one level at a
  // time, the app's drill-in rule — rather than jumping out to the list.
  if (view === 'history' && currentProduct) { openProduct(currentProduct); return; }
  showList();
}

function toast(msg) {
  const t = document.getElementById('fcToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

const app = {
  confirm: confirmDialog,
  toast,
  showList,
  openHistory,
  saveProduct,
  deleteProduct,
  tables,
  setLeaveGuard: (fn) => { leaveGuard = fn; },

  // The recipes a component can point at, named with what they cost so the wrong
  // one is obvious at the moment of choosing.
  recipeOptions() {
    return Object.values(getRecipes())
      .filter(r => r && String(r.name || '').trim())
      .map(r => {
        const costed = costRecipe(r, tables());
        const rate = costed.pricePerKg === null ? 'not priced' : `${formatRate(costed.pricePerKg)} / kg`;
        return { id: r.id, label: `${r.name} — ${rate}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  // Packaging can only be counted in pieces, so anything priced another way is
  // shown but flagged — hiding it would look like the item had been deleted.
  packagingOptions() {
    return Object.values(getIngredients())
      .filter(i => i && i.active !== false && String(i.name || '').trim())
      .map(i => {
        const each = i.priceUnit === 'pcs' ? Number(i.pricePerUnit) : null;
        const perKg = pricePerKg(i);
        const note = each ? `${formatRate(each)} each`
          : perKg !== null ? 'priced by weight'
            : 'not priced';
        return { id: i.id, label: `${i.name} — ${note}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  },
};

backBtn.addEventListener('click', handleBack);
setSyncErrorHandler(msg => toast(msg));

initFoodCost(
  () => { if (view === 'list' && activeList) activeList.refresh(getProducts(), tables()); },
  () => toast('Live sync interrupted — products may be out of date.'),
);

showList();
