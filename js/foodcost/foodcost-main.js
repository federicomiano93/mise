// foodcost-main.js — entry point / orchestrator for the Food Cost page.
// Owns the view routing (list ↔ product ↔ history), the header, the shared
// confirm dialog and toast, and the live subscriptions.
//
// Feature-local only: it reads the catalogue's recipes and Orders' ingredients as
// Firestore COLLECTIONS, through its own data layer — js/foodcost/ imports nothing
// from js/catalogue/ or js/orders/, except the two shared, non-feature modules in
// js/ root (price-model.js and the recipe cost maths), which both features already
// share for the same reason.

import { t, onLanguageChange } from '../i18n.js';
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
let activeEditor = null;
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
  activeEditor = null;
  currentProduct = null;
  leaveGuard = null;
  setHeader({ title: t('fc.foodCost'), sub: t('fc.productsAndMargins'), back: false });
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
  setHeader({ title: product ? (product.name || 'Product') : t('fc.newProduct'), sub: t('fc.foodCost'), back: true });
  activeEditor = renderEditor({ product, app });
  swap(activeEditor.root);
}

// The margin over time. Read on demand, never watched.
async function openHistory(product) {
  view = 'history';
  activeEditor = null;
  leaveGuard = null;
  setHeader({ title: t('fc.marginHistory'), sub: product.name || 'Product', back: true });

  const body = el('div', { class: 'fc-view' }, [el('p', { class: 'fc-empty', text: t('fc.loading') })]);
  swap(body);

  let entries;
  try {
    entries = await getProductHistory(product.id);
  } catch (err) {
    console.error('Could not read the margin history:', err);
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      t('fc.couldNotLoadThe') }));
    return;
  }

  if (!entries.length) {
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      t('fc.nothingRecordedYetA') }));
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
      t('fc.aPointIsRecorded') }),
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
  () => {
    if (view === 'list' && activeList) activeList.refresh(getProducts(), tables());
    // A product on screen picks up the recipes and prices as they arrive, and any
    // change made on another phone, without losing the edit in progress.
    if (view === 'editor' && activeEditor) activeEditor.refreshData();
  },
  () => toast(t('fc.liveSyncInterruptedProducts')),
);

// ⚠️ AND AGAIN WHEN THE LANGUAGE ARRIVES — the same rule js/i18n-dom.js already
// applies to the markup, and for the same reason: this screen is built once, at load,
// while the venue's language arrives later with the session. Without this the page
// header translated (i18n-dom does that) and everything inside it stayed English.
// ⚠️ ONLY FROM THE LIST. Redrawing while somebody is editing would throw away what
// they have typed — and the language only ever changes at startup or from settings.
onLanguageChange(() => { if (view === 'list') showList(); });

showList();
