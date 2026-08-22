// catalogue-main.js — entry point / orchestrator for the Recipe catalogue page.
// Owns the view routing (list ↔ detail ↔ editor), the header controls, the shared
// confirm dialog and toast, and the live-list subscription. Feature-local only:
// imports firebaseConfig indirectly (via the data layer) and the pure Calculator
// data model only inside import-to-calculator.js — never from js/orders/.

import { t, onLanguageChange } from '../i18n.js';
import {
  initCatalogue, getRecipes, getUsage, bumpUsage, saveRecipe, deleteRecipe, setSyncErrorHandler,
  getIngredients, getSuppliers, getRecipesById,
} from './catalogue-store.js';
import { renderList } from './catalogue-list.js';
import { renderAllergenSheet } from './allergen-sheet.js';
import { renderPhotoCapture } from './photo-capture.js';
import { renderLabel } from './label-view.js';
import { renderDetail } from './catalogue-detail.js';
import { renderEditor } from './catalogue-editor.js';
import { renderGuidedEditor } from './guided-editor.js';
import { renderRun, resumableSession, clearSession } from './guided-run.js';
import { importRecipeIntoCalculator, isRecipeLinkedToCalculator } from './import-to-calculator.js';
import { nonWeighableLabels, weighableTotalGrams } from './catalogue-model.js';
import { normalizeSteps, progressText } from './guided-model.js';
import { confirmDialog } from './confirm-dialog.js';
// The session, for the venue's own document: its country decides what language a
// label is printed in. Imported from js/ root, not from a feature folder.
import { currentSession } from '../firebase.js';

const screen = document.getElementById('catScreen');
const titleEl = document.getElementById('catTitle');
const subEl = document.getElementById('catSub');
const homeBtn = document.getElementById('catHome');
const backBtn = document.getElementById('catBack');
const addBtn = document.getElementById('catAdd');
const editBtn = document.getElementById('catEdit');

// Which of the three the label screen opens on. Session-only on purpose: it is a
// property of this morning's job, not of a recipe.
let labelShows = 'both';
let view = 'list';        // 'list' | 'detail' | 'editor' | 'steps' | 'run'
let searchQuery = '';
let activeList = null;     // { root, refresh } while the list is shown
let activeDetail = null;   // { root, refreshCost } while a recipe is shown
let activeRun = null;      // { root, confirmLeave, stop } while a guided mix is on screen
let currentRecipe = null;  // the recipe shown in detail (for the header Edit button)
let leaveGuard = null;     // async () => boolean; blocks Back when there are unsaved edits
let resumeOffered = false; // the "you were mixing" offer is made once per page load

// ── Header + view helpers ───────────────────────────────────────────────────────

function setHeader({ title, sub, back, add, edit = false }) {
  // ⚠️⚠️ THE data-i18n ATTRIBUTES HAVE TO GO, AND THIS WAS A REAL DEFECT ON EVERY
  // SCREEN OF THIS PAGE. catalogue.html marks both elements `data-i18n` so they read
  // correctly before any JavaScript runs — but js/i18n-dom.js rewrites EVERY
  // [data-i18n] element whenever the language changes, and the venue's language
  // arrives a moment AFTER the page has drawn itself. Open a recipe, or the allergen
  // sheet, or this screen, in that moment and the header silently reverted to
  // "Recipes": the title said one thing and the screen showed another.
  //
  // Found by driving the new photo screen, which is simply fast enough to be there
  // when it happens. Once a screen has named itself, the static pass no longer owns
  // these two.
  titleEl.removeAttribute('data-i18n');
  subEl.removeAttribute('data-i18n');
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

// ⚠️ EVERY ROUTE OUT OF THE RUN GOES THROUGH HERE. The run holds a repeating
// timer, a visibilitychange listener, the alarm and the screen wake lock; leaving
// the screen without releasing them leaves a phone that never sleeps and, worse,
// an alarm that can still go off on a screen showing something else.
function stopRun() {
  if (activeRun) { activeRun.stop(); activeRun = null; }
}

function showList() {
  stopRun();
  view = 'list';
  activeDetail = null;
  leaveGuard = null;
  setHeader({ title: t('ui.recipes'), sub: t('cat.recipeCatalogue'), back: false, add: true });
  activeList = renderList({
    recipes: getRecipes(),
    usageMap: getUsage(),
    initialQuery: searchQuery,
    onQueryChange: (q) => { searchQuery = q; },
    onOpen: openDetail,
    onAllergenSheet: showAllergenSheet,
    onPhotoRecipe: showPhotoCapture,
  });
  swap(activeList.root);
}

// The label for one recipe. Read-only like the sheet, so no leave guard.
//
// ⚠️ Back goes to the LIST, not to the recipe, because handleBack() is the app's
// one way out and always goes there. Consistent with every other screen here, and
// the recipe is one tap away from the list.
function openLabel(recipe) {
  stopRun();
  view = 'label';
  activeList = null;
  activeDetail = null;
  currentRecipe = recipe;
  leaveGuard = null;
  setHeader({ title: recipe.name || 'Label', sub: 'Label', back: true, add: false });
  swap(renderLabel({
    recipe,
    ingredients: getIngredients(),
    recipesById: getRecipesById(),
    // ⚠️ THE VENUE'S OWN DOCUMENT, because its `country` decides what language the
    // label is PRINTED in — a legal matter, not a preference (js/market.js). Read
    // fresh on every open rather than captured once: a country set from another
    // phone must reach this screen without a reload.
    location: currentSession().location,
    initialShows: labelShows,
    // Remembered for the session only: which of the three somebody wants is a
    // property of the job they are doing this morning, not of the recipe.
    onShowsChange: (value) => { labelShows = value; },
  }).root);
}

// Every recipe's allergens on one screen, plus the work list. Read-only, so it
// needs no leave guard: nothing here can be half-typed and lost.
function showAllergenSheet() {
  stopRun();
  view = 'allergens';
  activeList = null;
  activeDetail = null;
  leaveGuard = null;
  setHeader({ title: 'Allergens', sub: t('cat.recipeCatalogue'), back: true, add: false });
  swap(renderAllergenSheet({
    recipes: getRecipes(),
    ingredients: getIngredients(),
    recipesById: getRecipesById(),
    onOpen: openDetail,
  }).root);
}

function openDetail(recipe) {
  stopRun();
  view = 'detail';
  activeList = null;
  currentRecipe = recipe;
  leaveGuard = null;
  bumpUsage(recipe.id);
  setHeader({ title: recipe.name || 'Recipe', sub: 'Recipe', back: true, add: false, edit: true });
  activeDetail = renderDetail({ recipe, app });
  swap(activeDetail.root);
}

function openEditor(recipe, draft) {
  stopRun();
  view = 'editor';
  activeList = null;
  activeDetail = null;
  setHeader({
    // ⚠️ A draft is a NEW recipe, so `recipe` stays null and the title is right
    // without a special case. See renderEditor for the four things that depends on.
    title: recipe ? t('cat.editRecipe') : t('cat.newRecipe'),
    sub: t('cat.recipeCatalogue'), back: true, add: false,
  });
  swap(renderEditor({ recipe, draft, allRecipes: getRecipes(), app }));
}

// Read a recipe from a photograph. ⚠️ Reached ONLY from the list, never from an
// open editor: from there it would have to ask "merge this with what you have
// typed, or replace it?", and neither answer is one somebody can give safely.
function showPhotoCapture() {
  stopRun();
  view = 'photo';
  activeList = null;
  activeDetail = null;
  leaveGuard = null;
  setHeader({ title: t('cat.photo.title'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  swap(renderPhotoCapture({
    app,
    // The draft never touches the database. It goes straight into the ordinary
    // editor as a working copy, and waits there for the same Save as any recipe
    // typed by hand.
    onDraft: (draft, notes) => {
      openEditor(null, draft);
      if (notes && notes.rowsCapped) toast(t('cat.photo.capped'));
    },
  }).root);
}

function openGuidedEditor(recipe) {
  stopRun();
  view = 'steps';
  activeList = null;
  activeDetail = null;
  currentRecipe = recipe;
  setHeader({ title: t('cat.mixingSteps'), sub: recipe.name || 'Recipe', back: true, add: false });
  swap(renderGuidedEditor({ recipe, app }));
}

// Start a mix, or pick one back up. `resume` is a saved session or null.
//
// ⚠️ THE HEADER PENCIL IS HIDDEN HERE (edit: false). It opens the recipe editor,
// which rebuilds the ingredient rows — reachable from a running mix, it is one tap
// between somebody's hands in dough and the amounts they are working to.
function openRun(recipe, targetGrams, resume) {
  stopRun();
  view = 'run';
  activeList = null;
  activeDetail = null;
  currentRecipe = recipe;
  setHeader({ title: recipe.name || 'Recipe', sub: t('cat.guidedMixing'), back: true, add: false, edit: false });
  activeRun = renderRun({ recipe, targetGrams, app, resume });
  leaveGuard = activeRun.confirmLeave;
  swap(activeRun.root);
}

// Offered once per page load, and only when there is genuinely a dough on the go
// — see isResumable() in the model for what "genuinely" rules out (another day, a
// clock that moved, a recipe since deleted).
async function offerResume() {
  if (resumeOffered) return;
  const saved = resumableSession(getRecipes());
  if (!saved) return;
  resumeOffered = true;
  const recipe = getRecipes().find(r => r.id === saved.recipeId);
  const total = normalizeSteps(saved.snapshot.steps).length;
  const ok = await confirmDialog({
    title: t('cat.carryOnMixing'),
    message: `You were part-way through “${saved.snapshot.name || recipe.name}” — ${progressText(saved.stepIndex, total).toLowerCase()}.`,
    okLabel: t('cat.carryOn'), cancelLabel: t('cat.notNow'),
  });
  // "Not now" KEEPS the session: it answers where to go next, never whether the
  // dough exists. The recipe's own screen still offers to resume it.
  if (ok) openRun(recipe, saved.snapshot.targetGrams, saved);
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
  openDetail,
  openEditor,
  openLabel,
  openGuidedEditor,
  saveRecipe,
  deleteRecipe,
  bumpUsage,
  setLeaveGuard: (fn) => { leaveGuard = fn; },
  startGuided: (recipe, targetGrams) => openRun(recipe, targetGrams, null),
  resumeGuided: (recipe) => {
    const saved = resumableSession(getRecipes());
    if (saved && saved.recipeId === recipe.id) openRun(recipe, saved.snapshot.targetGrams, saved);
    // A session that has aged out (or belongs to another recipe) is not silently
    // swapped for a fresh run: the button said "resume", and starting from step
    // one instead would look identical and be a different dough.
    else { clearSession(); toast(t('cat.thatMixIsNo')); openDetail(recipe); }
  },
  // The saved run, but only if it is this recipe's — so a recipe screen never
  // offers to resume somebody else's dough.
  guidedSessionFor: (recipeId) => {
    const saved = resumableSession(getRecipes());
    return saved && saved.recipeId === recipeId ? saved : null;
  },
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

    const base = `Delete “${recipe.name || 'this recipe'}”? This cannot be undone.`;
    const message = linked
      ? base + t('cat.itWasImportedInto')
      : base;

    const ok = await confirmDialog({ title: t('cat.deleteRecipe2'), message, okLabel: t('ui.delete'), danger: true });
    if (!ok) return false;
    deleteRecipe(recipe.id);
    toast(t('cat.recipeDeleted'));
    showList();
    return true;
  },
  async importRecipe(recipe) {
    // The Calculator is grams-only. If there's no weighable ingredient there is
    // nothing to import; otherwise warn about any rows that will be left out.
    if (weighableTotalGrams(recipe) <= 0) {
      toast('This recipe has no weight-based ingredients, so there’s nothing to import into the grams-only Calculator.');
      return;
    }
    const skipped = nonWeighableLabels(recipe);
    const warn = skipped.length
      ? `\n\nNote: ${skipped.join(', ')} use a unit the Calculator can’t scale (it works in grams only) and won’t be imported.`
      : '';
    const ok = await confirmDialog({
      title: t('cat.importIntoCalculator2'),
      message: `Copy “${recipe.name}” into the Calculator? You can then tweak it there without changing the catalogue.${warn}`,
      okLabel: t('ui.import'),
    });
    if (!ok) return;
    try {
      const { action } = await importRecipeIntoCalculator(recipe);
      bumpUsage(recipe.id);
      toast(action === 'updated'
        ? `“${recipe.name}” updated in the Calculator.`
        : `“${recipe.name}” added to the Calculator.`);
    } catch (err) {
      console.error('Import into Calculator failed:', err);
      toast(t('cat.importFailedCheckYour'));
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
    // The offer needs the recipes to have arrived — a session is only worth
    // resuming if its recipe is still in the catalogue.
    if (view === 'list') offerResume();
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
  () => toast(t('cat.liveSyncInterruptedRecipes')),
);

// ⚠️ AND AGAIN WHEN THE LANGUAGE ARRIVES — see js/foodcost/foodcost-main.js.
// Only from the list, so an open editor is never redrawn under somebody's hands.
// ⚠️ THE LIST REDRAWS ITSELF; EVERY OTHER SCREEN MUST NOT. Redrawing over an open
// editor would throw away what somebody has typed, which is why this has always
// been narrow. The photo screen is the exception that is safe: it holds only the
// photographs, and its own paint() rebuilds them — so it repaints itself (see
// photo-capture.js) and only its HEADER, which lives out here, is re-applied.
onLanguageChange(() => {
  if (view === 'list') showList();
  else if (view === 'photo') {
    setHeader({ title: t('cat.photo.title'), sub: t('cat.recipeCatalogue'), back: true, add: false });
  }
});

showList();
