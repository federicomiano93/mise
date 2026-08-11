// catalogue-store.js — the live recipe list, bridging Firestore and the UI.
//
// Resilience (P17) + cost (P14): the list is held in memory and mirrored to
// localStorage, so the catalogue paints instantly and works offline. The
// full-collection listener is attached only when the catalogue page initialises
// (via initCatalogue), never at app boot. Writes are per-document and LOCAL-FIRST:
// the in-memory list + cache + UI update immediately (instant, offline-friendly);
// the Firestore write is best-effort and, if it is REJECTED (e.g. rules/App Check
// denial), the optimistic change is rolled back and the error is surfaced.
//
// "Most used first" is driven by a LOCAL open-count map (per device, free, no
// extra Firestore writes) — see the usage helpers below.

import {
  normalizeCatalogueRecipe, normalizeCatalogueRecipes, isScaledEntryFresh, normalizeLossPct,
} from './catalogue-model.js';
import { withRowIds, normalizeSteps, normalizeEndNote } from './guided-model.js';
import {
  watchRecipes,
  watchIngredients,
  watchSuppliers,
  saveRecipeDoc,
  removeRecipeDoc,
  newRecipeId,
} from './firebase-catalogue.js';

const CACHE_KEY = 'catalogue-recipes';
const USAGE_KEY = 'catalogue-usage';
const SCALED_KEY = 'catalogue-scaled';
const INGREDIENTS_KEY = 'catalogue-ingredients';
const SUPPLIERS_KEY = 'catalogue-suppliers';

let recipes = readCache();
let ingredients = readIngredientCache();
let suppliers = readJsonMap(SUPPLIERS_KEY);
let usage = readUsage();
let scaled = readScaled();
let notify = null;         // called with the new recipe list whenever it changes
let onSyncError = null;    // called with a message when a background write is rejected

// ── Recipe cache (localStorage mirror for instant/offline first paint) ─────────

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return normalizeCatalogueRecipes(JSON.parse(raw));
  } catch (e) {
    // Corrupt/unavailable cache — start empty; the listener will fill it in.
  }
  return [];
}

function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch (e) {
    // Storage full/unavailable — the in-memory copy still works this session.
  }
}

// The recipes currently in memory (cache until the listener streams in).
export function getRecipes() {
  return recipes;
}

// Register a handler for background write failures (shown as a toast by the UI).
export function setSyncErrorHandler(fn) {
  onSyncError = typeof fn === 'function' ? fn : null;
}

// Start syncing with Firestore. onUpdate(recipes) fires whenever the collection
// changes. onError(err) fires if the live stream dies (no auto-resubscribe).
// Returns the synchronous cached list so the first paint never waits on the
// network. The listener is attached here (page open), not at app boot.
export function initCatalogue(onUpdate, onError) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchRecipes(
    remote => {
      recipes = normalizeCatalogueRecipes(remote);
      writeCache(recipes);
      pruneUsage();
      pruneScaled();
      if (notify) notify(recipes);
    },
    err => { if (onError) onError(err); },
  ).catch(err => { console.error('Catalogue live sync failed to start:', err); if (onError) onError(err); });

  // The ingredient list, for costing. A failure here is DELIBERATELY quiet: it is
  // Orders' collection, a venue may not use Orders at all, and the worst outcome is
  // that every row reads "not priced yet" — which is exactly what the screen says
  // anyway when nothing is linked. Shouting about it would put an alarm on the
  // recipe screen of a venue that has no ingredients and never wanted any.
  watchIngredients(
    remote => {
      ingredients = indexById(remote);
      writeIngredientCache(remote);
      if (notify) notify(recipes);
    },
    err => { console.warn('Ingredient prices unavailable:', err); },
  ).catch(err => { console.warn('Ingredient prices unavailable:', err); });

  // Supplier NAMES only, and only so the chooser can tell two similar articles
  // apart. Quiet on failure for the same reason as the ingredients.
  watchSuppliers(
    remote => {
      suppliers = indexById(remote);
      writeJsonMap(SUPPLIERS_KEY, remote);
      if (notify) notify(recipes);
    },
    () => {},
  ).catch(() => {});

  return recipes;
}

// ── Ingredient prices (read-only, owned by Orders) ────────────────────────────
// Mirrored to localStorage like the recipes, so a recipe opened offline still
// shows its cost instead of silently reading as unpriced.

function readJsonMap(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return indexById(JSON.parse(raw));
  } catch (e) {
    // Corrupt/unavailable cache — the listener will fill it in.
  }
  return {};
}

function writeJsonMap(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    // Storage full/unavailable — the in-memory copy still works this session.
  }
}

// ⚠️ DECLARATIONS, NOT const ARROWS. The module initialises its state at the top
// of the file — `let ingredients = readIngredientCache()` — which runs BEFORE this
// line. A function declaration is hoisted and works; a const arrow is in the
// temporal dead zone and throws "Cannot access before initialization", which kills
// the whole module and leaves the catalogue page blank with no screen at all.
// That is exactly what it did, and no unit test could have caught it: this file
// touches Firestore, so it is one of the deliberately untested ones.
function readIngredientCache() {
  return readJsonMap(INGREDIENTS_KEY);
}

function writeIngredientCache(list) {
  return writeJsonMap(INGREDIENTS_KEY, list);
}

function indexById(list) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (item && item.id) out[item.id] = item;
  });
  return out;
}

// { id: ingredient } — what the cost model looks rows up in.
export function getIngredients() {
  return ingredients;
}

// { id: supplier } — names only, for the chooser.
export function getSuppliers() {
  return suppliers;
}

// { id: recipe } — the other half of the same lookup, for rows that point at a
// sub-recipe. Built on demand rather than kept in step with `recipes`, so there is
// only ever one list of recipes to go wrong.
export function getRecipesById() {
  return indexById(recipes);
}

// Optimistically upsert a recipe into the in-memory list + cache + UI.
function upsertLocal(recipe) {
  const norm = normalizeCatalogueRecipe(recipe);
  if (!norm) return;
  const idx = recipes.findIndex(r => r.id === norm.id);
  const next = recipes.slice();
  if (idx >= 0) next[idx] = norm; else next.push(norm);
  recipes = next;
  writeCache(recipes);
  if (notify) notify(recipes);
}

function removeLocal(id) {
  recipes = recipes.filter(r => r.id !== id);
  writeCache(recipes);
  if (notify) notify(recipes);
}

// Save a recipe, LOCAL-FIRST. A new recipe (no id) gets a client-side id so it can
// appear instantly and offline; an existing one is merged. The UI update happens
// before the network write, so this returns the id immediately (never blocks on
// the network — no freeze, no duplicate from repeated taps). If the write is later
// REJECTED (not merely offline-pending), the optimistic change is rolled back and
// the error is surfaced.
export function saveRecipe(recipe) {
  // ⚠️ THE FIELDS ARE LISTED BY HAND HERE ON PURPOSE, unlike the editor's
  // cleanWorking() which spreads. This object becomes the Firestore DOCUMENT, and
  // the rules whitelist exactly bakery/name/ingredients/lossPct — spreading the
  // recipe would send `id` as a field and every save would be refused.
  //
  // The cost of that is this list has to be kept up to date: lossPct was added
  // here in the same commit that added it to the model, because a field the model
  // carries and this line does not is dropped on every save, silently.
  // ⚠️ SAVE IS THE ONE PLACE ROW IDS ARE MINTED. Any row that has never had one
  // gets one now, so a guided mixing step written today still points at the right
  // ingredient in a year — through a rename, and through rows being inserted
  // above it. Minting on READ instead would produce a different id every load and
  // match nothing; minting only in the steps editor would leave a recipe edited
  // anywhere else with rows no step can ever name.
  const ingredients = withRowIds(recipe.ingredients);
  const data = {
    name: recipe.name,
    ingredients,
    lossPct: normalizeLossPct(recipe.lossPct),
    // The mixing procedure. Written even when EMPTY, deliberately: setDoc runs
    // with merge:true, which never deletes a field it is not sent, so omitting it
    // would leave the old steps in the document and the screen would go on
    // showing a procedure the owner had just deleted.
    steps: normalizeSteps(recipe.steps),
    // The closing message, on exactly the same terms and for the same reason:
    // written even when empty, or clearing it would leave the old text in the
    // document and the finish screen would keep showing a message just deleted.
    endNote: normalizeEndNote(recipe.endNote),
  };
  const id = recipe.id || newRecipeId();
  const prev = recipes.find(r => r.id === id) || null;
  upsertLocal({ id, ...data });
  saveRecipeDoc(id, data).catch(err => {
    console.warn('Recipe did not sync to Firestore:', err);
    if (prev) upsertLocal(prev); else removeLocal(id);
    if (onSyncError) onSyncError(`Couldn't save "${recipe.name || 'recipe'}" — check your connection.`);
  });
  return id;
}

// Delete a recipe, LOCAL-FIRST (mirrors saveRecipe). Also prunes the local usage
// entry so the map doesn't accumulate orphans.
export function deleteRecipe(id) {
  const prev = recipes.find(r => r.id === id) || null;
  removeLocal(id);
  if (usage[id] != null) { const u = { ...usage }; delete u[id]; usage = u; writeUsage(usage); }
  clearScaledTarget(id);
  removeRecipeDoc(id).catch(err => {
    console.warn('Recipe delete did not sync to Firestore:', err);
    if (prev) upsertLocal(prev);
    if (onSyncError) onSyncError("Couldn't delete the recipe — check your connection.");
  });
}

// ── Local usage map ("most used first") ────────────────────────────────────────

function readUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    // ignore corrupt usage map
  }
  return {};
}

function writeUsage(map) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // ignore storage failure — ordering is a nicety, not data
  }
}

// Drop usage entries for recipes that no longer exist (keeps the map from growing
// with orphans as recipes are deleted here or on other devices).
function pruneUsage() {
  const ids = new Set(recipes.map(r => r.id));
  let changed = false;
  const next = {};
  for (const key of Object.keys(usage)) {
    if (ids.has(key)) next[key] = usage[key]; else changed = true;
  }
  if (changed) { usage = next; writeUsage(usage); }
}

// The current open-count map { recipeId: count }.
export function getUsage() {
  return usage;
}

// Record that a recipe was opened/used (drives "most used first").
export function bumpUsage(id) {
  if (!id) return;
  usage = { ...usage, [id]: (usage[id] || 0) + 1 };
  writeUsage(usage);
}

// ── Local "scaled batch" map (keep a calculated total-dough-weight per recipe) ──
// Per device, no Firestore writes. { recipeId: { target: grams, ts: ms } }. The
// detail view restores it on open so a calculated batch stays shown until Clear or
// it ages out (isScaledEntryFresh — 12h). Same corrupt-safe JSON idiom as usage.

function readScaled() {
  try {
    const raw = localStorage.getItem(SCALED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    // ignore corrupt scaled map
  }
  return {};
}

function writeScaled(map) {
  try {
    localStorage.setItem(SCALED_KEY, JSON.stringify(map));
  } catch (e) {
    // ignore storage failure — a remembered batch is a nicety, not data
  }
}

// The remembered scaled target (grams) for a recipe, or null if none / expired.
// A stale entry is tidied away on read.
export function getScaledTarget(id) {
  const entry = scaled[id];
  if (isScaledEntryFresh(entry, Date.now())) return entry.target;
  if (entry) clearScaledTarget(id);
  return null;
}

// Remember a freshly calculated target (grams) for a recipe, stamped with now.
export function setScaledTarget(id, targetGrams) {
  if (!id || !(targetGrams > 0)) return;
  scaled = { ...scaled, [id]: { target: targetGrams, ts: Date.now() } };
  writeScaled(scaled);
}

// Forget a recipe's remembered target (tapping Clear, or deleting the recipe).
export function clearScaledTarget(id) {
  if (scaled[id] == null) return;
  const next = { ...scaled };
  delete next[id];
  scaled = next;
  writeScaled(scaled);
}

// Drop scaled entries that are orphaned (recipe gone) or expired (>12h), like
// pruneUsage — keeps the map from growing.
function pruneScaled() {
  const ids = new Set(recipes.map(r => r.id));
  const now = Date.now();
  let changed = false;
  const next = {};
  for (const key of Object.keys(scaled)) {
    if (ids.has(key) && isScaledEntryFresh(scaled[key], now)) next[key] = scaled[key];
    else changed = true;
  }
  if (changed) { scaled = next; writeScaled(scaled); }
}
