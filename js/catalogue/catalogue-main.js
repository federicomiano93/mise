// catalogue-main.js — entry point / orchestrator for the Recipe catalogue page.
// Owns the view routing (list ↔ detail ↔ editor), the header controls, the shared
// confirm dialog and toast, and the live-list subscription. Feature-local only:
// imports firebaseConfig indirectly (via the data layer) and the pure Calculator
// data model only inside import-to-calculator.js — never from js/orders/.

import {
  initCatalogue, getRecipes, getUsage, bumpUsage, saveRecipe, deleteRecipe, setSyncErrorHandler,
  getIngredients, getSuppliers,
} from './catalogue-store.js';
import { renderList } from './catalogue-list.js';
import { renderDetail } from './catalogue-detail.js';
import { renderEditor } from './catalogue-editor.js';
import { importRecipeIntoCalculator, isRecipeLinkedToCalculator } from './import-to-calculator.js';
import { nonWeighableLabels, weighableTotalGrams } from './catalogue-model.js';
import { confirmDialog } from './confirm-dialog.js';

const screen = document.getElementById('catScreen');
const titleEl = document.getElementById('catTitle');
const subEl = document.getElementById('catSub');
const homeBtn = document.getElementById('catHome');
const backBtn = document.getElementById('catBack');
const addBtn = document.getElementById('catAdd');
const editBtn = document.getElementById('catEdit');

let view = 'list';        // 'list' | 'detail' | 'editor'
let searchQuery = '';
let activeList = null;     // { root, refresh } while the list is shown
let activeDetail = null;   // { root, refreshCost } while a recipe is shown
let currentRecipe = null;  // the recipe shown in detail (for the header Edit button)
let leaveGuard = null;     // async () => boolean; blocks Back when there are unsaved edits

// ── Header + view helpers ───────────────────────────────────────────────────────

function setHeader({ title, sub, back, add, edit = false }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  homeBtn.hidden = back;   // Home shows only on the list; Back replaces it elsewhere
  backBtn.hidden = !back;
  addBtn.hidden = !add;
  editBtn.hidden = !edit;
}

function swap(node) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  // Move focus into the new view so keyboard/screen-reader users don't drop to the
  // top of the document on every transition. The view container itself is focused
  // (not an input) to avoid popping the mobile keyboard.
  node.setAttribute('tabindex', '-1');
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

function showList() {
  view = 'list';
  activeDetail = null;
  leaveGuard = null;
  setHeader({ title: 'Recipes', sub: 'Recipe catalogue', back: false, add: true });
  activeList = renderList({
    recipes: getRecipes(),
    usageMap: getUsage(),
    initialQuery: searchQuery,
    onQueryChange: (q) => { searchQuery = q; },
    onOpen: openDetail,
  });
  swap(activeList.root);
}

function openDetail(recipe) {
  view = 'detail';
  activeList = null;
  currentRecipe = recipe;
  leaveGuard = null;
  bumpUsage(recipe.id);
  setHeader({ title: recipe.name || 'Recipe', sub: 'Recipe', back: true, add: false, edit: true });
  activeDetail = renderDetail({ recipe, app });
  swap(activeDetail.root);
}

function openEditor(recipe) {
  view = 'editor';
  activeList = null;
  activeDetail = null;
  setHeader({
    title: recipe ? 'Edit recipe' : 'New recipe',
    sub: 'Recipe catalogue', back: true, add: false,
  });
  swap(renderEditor({ recipe, allRecipes: getRecipes(), app }));
}

async function handleBack() {
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
  }
  leaveGuard = null;
  showList();
}

function toast(msg) {
  const t = document.getElementById('catToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── The app object handed to the detail/editor views ────────────────────────────

const app = {
  confirm: confirmDialog,
  toast,
  showList,
  openEditor,
  saveRecipe,
  deleteRecipe,
  bumpUsage,
  setLeaveGuard: (fn) => { leaveGuard = fn; },
  // Live getters, not snapshots: the editor is open while the ingredient listener
  // is still streaming in, so a price corrected in Orders reaches an open recipe
  // without a reload — and a chooser opened before the first snapshot is not stuck
  // showing an empty list for as long as the screen stays open.
  ingredients: getIngredients,
  suppliers: getSuppliers,
  allRecipes: getRecipes,
  // Delete a catalogue recipe with a strong confirm, warning first if the recipe
  // was imported into the Calculator (the two are independent copies — deleting
  // here never touches the Calculator). The link check is raced with a short
  // timeout so a slow/offline read never blocks the delete. Returns true if it was
  // deleted (and navigation moved back to the list), false if cancelled.
  async confirmAndDelete(recipe) {
    let linked = false;
    try {
      linked = await Promise.race([
        isRecipeLinkedToCalculator(recipe.id),
        new Promise((res) => setTimeout(() => res(false), 2500)),
      ]);
    } catch (e) { linked = false; }

    const base = `Delete "${recipe.name || 'this recipe'}"? This cannot be undone.`;
    const message = linked
      ? base + ' It was imported into the Calculator — that copy will stay; remove it separately in the Calculator if you want it gone.'
      : base;

    const ok = await confirmDialog({ title: 'Delete recipe?', message, okLabel: 'Delete', danger: true });
    if (!ok) return false;
    deleteRecipe(recipe.id);
    toast('Recipe deleted.');
    showList();
    return true;
  },
  async importRecipe(recipe) {
    // The Calculator is grams-only. If there's no weighable ingredient there is
    // nothing to import; otherwise warn about any rows that will be left out.
    if (weighableTotalGrams(recipe) <= 0) {
      toast("This recipe has no weight-based ingredients, so there's nothing to import into the grams-only Calculator.");
      return;
    }
    const skipped = nonWeighableLabels(recipe);
    const warn = skipped.length
      ? `\n\nNote: ${skipped.join(', ')} use a unit the Calculator can't scale (it works in grams only) and won't be imported.`
      : '';
    const ok = await confirmDialog({
      title: 'Import into Calculator?',
      message: `Copy "${recipe.name}" into the Calculator? You can then tweak it there without changing the catalogue.${warn}`,
      okLabel: 'Import',
    });
    if (!ok) return;
    try {
      const { action } = await importRecipeIntoCalculator(recipe);
      bumpUsage(recipe.id);
      toast(action === 'updated'
        ? `"${recipe.name}" updated in the Calculator.`
        : `"${recipe.name}" added to the Calculator.`);
    } catch (err) {
      console.error('Import into Calculator failed:', err);
      toast('Import failed — check your connection and try again.');
    }
  },
};

// ── Wire up ─────────────────────────────────────────────────────────────────────

backBtn.addEventListener('click', handleBack);
addBtn.addEventListener('click', () => openEditor(null));
editBtn.addEventListener('click', () => { if (currentRecipe) openEditor(currentRecipe); });

// Surface background write failures (rolled back by the store) as a toast.
setSyncErrorHandler((msg) => toast(msg));

// Start the live sync; when the collection changes and the list is showing, refresh
// its cards in place (without rebuilding the search box). If the live stream dies,
// tell the user their view may be stale.
initCatalogue(
  () => {
    if (view === 'list' && activeList) activeList.refresh(getRecipes(), getUsage());
    // A recipe on screen recomputes its cost whenever anything it depends on
    // arrives — the ingredient prices (still streaming in on a cold open), or the
    // recipe itself edited on another phone. The freshest copy wins; if it has
    // been deleted elsewhere, the one already on screen is kept rather than
    // blanking the panel under the reader.
    if (view === 'detail' && activeDetail && currentRecipe) {
      const latest = getRecipes().find(r => r.id === currentRecipe.id) || currentRecipe;
      activeDetail.refreshCost(latest);
    }
  },
  () => toast('Live sync interrupted — recipes may be out of date.'),
);

showList();
