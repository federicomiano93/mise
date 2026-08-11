// catalogue-model.js — pure data model + kg-scaling for the Recipe catalogue.
//
// This module is intentionally FREE of any DOM / Firebase / localStorage imports
// so the model and the scaling math can be unit-tested in isolation under Node
// (see tests/catalogue-model.test.mjs). The owner cannot read code, so these tests
// are the safety net (P15).
//
// A catalogue recipe is deliberately minimal: { id, name, ingredients:[{label,grams}] }.
// The Firestore document id is the recipe's id (assigned by the data layer on create).
// Advanced fields (leavening, calc logic) are the Calculator's concern; a recipe is
// imported into the Calculator as a plain pro-rata ('total') recipe — see toCalculatorRecipe.

// ── Units (bakery / pastry / restaurant) ──────────────────────────────────────
// Each ingredient carries a unit. Weight and volume are "weighable": they convert
// to grams for the total-dough-weight scaling (volume at 1 ml = 1 g, the standard
// bakery approximation). Pieces / spoons / pinch / to-taste are NOT weighable, so
// they scale in proportion but stay out of the weight total (and can't be imported
// into the grams-only Calculator). Legacy rows with no unit are treated as grams.
export const CATALOGUE_UNITS = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste'];
export const DEFAULT_UNIT = 'g';

// Grams per one of each weighable unit; a unit absent here is not weighable.
const UNIT_TO_GRAMS = { g: 1, kg: 1000, mg: 0.001, ml: 1, cl: 10, dl: 100, l: 1000 };

// The ingredient's unit, defaulting to grams for legacy rows with no unit field.
export function unitOf(ing) {
  const u = ing && ing.unit;
  return (typeof u === 'string' && CATALOGUE_UNITS.includes(u)) ? u : DEFAULT_UNIT;
}

// True when a unit contributes to the weight total (and can be imported to the Calculator).
export function isWeighableUnit(unit) {
  return Object.prototype.hasOwnProperty.call(UNIT_TO_GRAMS, unit);
}

// One ingredient's amount converted to grams, or 0 when its unit isn't weighable.
// Exported because the cost model needs exactly this conversion: costing a row is
// "how many grams is it" times "what does a gram cost", and a second copy of the
// unit table is a second place for ml-to-g to drift.
export function ingredientGrams(ing) {
  const factor = UNIT_TO_GRAMS[unitOf(ing)];
  return factor ? (Number(ing.grams) || 0) * factor : 0;
}
const ingGrams = ingredientGrams;

// The recipe's total WEIGHABLE mass in grams (weight + volume rows only) — what the
// "Total dough weight" scaling targets.
export function weighableTotalGrams(recipe) {
  const ings = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  return ings.reduce((s, i) => s + ingGrams(i), 0);
}

// ── Normalisation (junk-safe: never throws, never yields NaN) ──────────────────

// One ingredient row: a display label, a non-negative amount, and a unit. Non-numeric
// or negative amounts coerce to 0 so the scaling math never sees NaN; an unknown or
// missing unit falls back to grams. This is the client-side shape guarantee (Firestore
// rules v2 cannot iterate a list to assert it).
function normalizeIngredient(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label != null ? raw.label : (raw.name || '')).trim();
  const grams = Number(raw.grams);
  const unit = (typeof raw.unit === 'string' && CATALOGUE_UNITS.includes(raw.unit)) ? raw.unit : DEFAULT_UNIT;
  const row = { label, grams: Number.isFinite(grams) && grams >= 0 ? grams : 0, unit };

  // ⚠️ THE LINK HAS TO BE CARRIED THROUGH HERE, AND THROUGH cleanWorking() IN THE
  // EDITOR. This function rebuilds every row from scratch, so a field it does not
  // mention is DROPPED — silently, on the way in from Firestore. Before this, a
  // recipe opened to fix a typo in its name came back out with every ingredient
  // link gone, and nothing anywhere would have said so.
  //
  // Absent rather than null when there is no link, so the rows written today are
  // byte-identical to the rows written before this feature existed: no migration,
  // and a recipe never touched again keeps exactly the shape it has now.
  const link = linkOf(raw);
  if (link) { row.kind = link.kind; row.refId = link.refId; }

  // ⚠️ SAME TRAP AGAIN, AND IT IS THE ONE THIS FUNCTION IS ALREADY SCARRED BY:
  // `rid` is the stable id a guided mixing step points at, so dropping it here
  // would unhook every step from its ingredient on the way in from Firestore —
  // silently, and permanently once the recipe is next saved.
  //
  // Carried through, never MINTED here: an id invented on read would be a
  // different one on every load and would match nothing. js/catalogue/
  // guided-model.js withRowIds() assigns them, and only on save.
  const rid = raw.rid != null ? String(raw.rid).trim() : '';
  if (rid) row.rid = rid;
  return row;
}

// What a row points at, or null for a plain hand-typed row. `kind` decides where
// refId is looked up — an ingredient in Orders, or another recipe in this
// catalogue — and defaults to 'ingredient', which is what every link written by
// the current editor is unless it says otherwise.
export const ROW_KINDS = Object.freeze(['ingredient', 'recipe']);

export function linkOf(raw) {
  const refId = raw && raw.refId != null ? String(raw.refId).trim() : '';
  if (!refId) return null;
  const kind = ROW_KINDS.includes(raw.kind) ? raw.kind : 'ingredient';
  return { kind, refId };
}

function normalizeIngredients(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeIngredient).filter(Boolean);
}

// A catalogue recipe from arbitrary (e.g. Firestore) input. Returns null only for
// non-object input; an empty name is kept (the editor's validation blocks saving it).
export function normalizeCatalogueRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    id: raw.id != null ? String(raw.id) : '',
    name: String(raw.name != null ? raw.name : '').trim(),
    ingredients: normalizeIngredients(raw.ingredients),
    lossPct: normalizeLossPct(raw.lossPct),
  };
  // The guided mixing procedure, carried through as it was stored and SHAPED
  // elsewhere (js/catalogue/guided-model.js normalizeSteps), which is what keeps
  // this file free of an import back from a module that already imports it — a
  // cycle whose only symptom would be a screen that renders blank with nothing
  // in the console, exactly as happened to the catalogue in v247.
  //
  // Absent rather than empty when there is no procedure, so the hundreds of
  // recipes nobody has written one for stay byte-identical to what they are now.
  if (Array.isArray(raw.steps) && raw.steps.length) out.steps = raw.steps;
  // The closing message shown at the end of a guided mix, carried through on the
  // same terms and for the same reason: absent rather than empty.
  if (typeof raw.endNote === 'string' && raw.endNote.trim()) out.endNote = raw.endNote;
  return out;
}

// How much weight this recipe loses on the way to being finished — evaporation in
// the oven, mostly. 0 by default, which is what every recipe written before this
// field existed means: nothing is assumed to be lost unless somebody says so.
//
// ⚠️ CAPPED AT 99, AND THE CAP IS LOAD-BEARING. The yield weight is the divisor of
// the price per kilo, so a loss of 100 would divide by zero and a recipe would cost
// Infinity per kilo — shown, and carried into every product built on it. Nothing
// real loses all of its weight.
export const MAX_LOSS_PCT = 99;

export function normalizeLossPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_LOSS_PCT);
}

// A list of catalogue recipes, dropping junk entries.
export function normalizeCatalogueRecipes(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeCatalogueRecipe).filter(Boolean);
}

// ── List helpers (used by the catalogue list UI) ──────────────────────────────

// Most-used first: sort by open-count (from the local usage map) descending, then
// by name ascending as a stable tie-break. Never mutates the input array.
export function sortByUsage(recipes, usageMap = {}) {
  return recipes.slice().sort((a, b) => {
    const ua = usageMap[a.id] || 0;
    const ub = usageMap[b.id] || 0;
    if (ub !== ua) return ub - ua;
    return String(a.name).localeCompare(String(b.name));
  });
}

// Case-insensitive substring filter by recipe name. Empty query returns all.
export function filterByName(recipes, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return recipes;
  return recipes.filter(r => String(r.name).toLowerCase().includes(q));
}

// ── Choosing what a row points at ─────────────────────────────────────────────

// Lower-cased and stripped of accents, so "però" is found by typing "pero".
//
// ⚠️ js/orders/ingredient-search.js has the same three lines, and that duplication
// is ACCEPTED here where the price maths was not. The two failures are not
// comparable: two copies of a price calculation that drift produce two different
// food-cost percentages with nothing to say which is right, while two copies of
// this produce a search that finds one row more or fewer. One is a wrong number,
// the other is a shrug.
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// The things a recipe row can be linked to, filtered by what was typed.
//
//   { ingredients: [{ id, name, supplierName, pricePerKg }], recipes: [{ id, name }] }
//
// Ingredients first, because they are what almost every row is. Deactivated ones
// are left out — they are not orderable, so building a live cost on one would be
// building on something the kitchen has stopped buying.
//
// `excludeRecipeId` keeps a recipe out of its own picker. The cost model catches a
// cycle anyway, but offering the choice and then refusing it is a worse screen than
// never offering it.
export function linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId } = {}) {
  const q = normalizeSearchText(query);
  const matches = (...fields) => !q || fields.some(f => normalizeSearchText(f).includes(q));
  const supplierName = id => (suppliers && (suppliers[id] || {}).name) || '';

  const ingredientList = Object.values(ingredients || {})
    .filter(ing => ing && ing.active !== false)
    .map(ing => ({
      id: ing.id,
      name: String(ing.name || '').trim(),
      weight: String(ing.weight || '').trim(),
      supplierName: supplierName(ing.supplierId),
      ingredient: ing,
    }))
    .filter(row => row.name && matches(row.name, row.weight, row.supplierName))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));

  const recipeList = (Array.isArray(recipes) ? recipes : Object.values(recipes || {}))
    .filter(r => r && r.id !== excludeRecipeId && String(r.name || '').trim())
    .filter(r => matches(r.name))
    .map(r => ({ id: r.id, name: String(r.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ingredients: ingredientList, recipes: recipeList };
}

// ── kg scaling (pure pro-rata "total" — the catalogue's only calc logic) ──────

// Round an array of gram values so the displayed integers sum EXACTLY to
// Math.round(total). Any ±rounding residual is assigned to the largest ingredient.
// Mirrors fixRounding in js/calculator-dough-math.js (kept independent so the
// catalogue folder stays self-contained — no cross-feature import for a one-liner).
function fixRounding(amounts, total) {
  const rounded = amounts.map(Math.round);
  if (!rounded.length) return rounded;
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i] > rounded[maxIdx]) maxIdx = i;
    }
    rounded[maxIdx] += diff;
  }
  return rounded;
}

// Scale a recipe to a target TOTAL weight in grams: every ingredient in proportion
// to the weighable total. Returns an array aligned with recipe.ingredients — a whole
// number in EACH ingredient's own unit, or null for a 'to taste' row (no quantity).
// Empty recipe / non-positive target / no weighable mass → zeros (defensive, no NaN).
export function scaleCatalogue(recipe, targetGrams) {
  const ings = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  const target = Number(targetGrams);
  const weighTotal = weighableTotalGrams(recipe);
  if (!Number.isFinite(target) || target <= 0 || weighTotal <= 0) {
    return ings.map(i => unitOf(i) === 'to taste' ? null : 0);
  }
  const factor = target / weighTotal;
  // Common case — every ingredient in grams: exact-sum to the target (fixRounding).
  if (ings.every(i => unitOf(i) === 'g')) {
    return fixRounding(ings.map(i => (Number(i.grams) || 0) * factor), target);
  }
  // Mixed units: proportional, each rounded in its own unit; to-taste has no number.
  return ings.map(i => unitOf(i) === 'to taste' ? null : Math.round((Number(i.grams) || 0) * factor));
}

// The base (unscaled) amounts, aligned with recipe.ingredients — whole numbers in
// each ingredient's own unit (null for 'to taste'). For an all-grams recipe the
// integer rows sum exactly to the rounded total (fixRounding), so rows and Total agree.
export function baseAmounts(recipe) {
  const ings = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  if (ings.every(i => unitOf(i) === 'g')) {
    const raw = ings.map(i => Number(i.grams) || 0);
    return fixRounding(raw, raw.reduce((a, b) => a + b, 0));
  }
  return ings.map(i => unitOf(i) === 'to taste' ? null : Math.round(Number(i.grams) || 0));
}

// ── Batch size: a readable weight, and a guard against a mistyped total ────────
// The "Total dough weight" field takes GRAMS — the unit the recipes themselves are
// written in ("Croissant (4 x 3500gr.)"), so what you type matches what you read.
// It used to take kilograms, which invited exactly the wrong number: typing 17500
// (meaning 17500 g) asked for 17500 KG and produced a 17.5-tonne batch, scaled and
// displayed without a murmur.
//
// Grams remove that trap but not the fat-finger one: a single extra zero still turns
// a 17.5 kg batch into 175 kg. So a total far outside any real batch is FLAGGED before
// it is applied — a loud confirm, never a silent scale, and never a hard block (an
// unusual but intended batch still goes through).

// Beyond any bakery mixer, and far out of proportion to the recipe as written.
export const MAX_SANE_BATCH_G = 100000; // 100 kg
export const MAX_SANE_MULTIPLE = 50;    // 50x the base recipe

const gnum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
// Drop a trailing '.0' so 17.5 kg stays "17.5 kg" but 18.0 kg reads "18 kg".
const trim = (n) => String(Math.round(n * 100) / 100);

// A weight named the way a person would say it, so a wrong order of magnitude is
// obvious at a glance: 17500 g → "17.5 kg"; 17500000 g → "17.5 tonnes".
export function formatWeight(grams) {
  const g = gnum(grams);
  if (g >= 1000000) return trim(g / 1000000) + ' tonnes';
  if (g >= 1000) return trim(g / 1000) + ' kg';
  return trim(g) + ' g';
}

// null when the batch is plausible; otherwise a plain-language warning naming the
// weight and how it compares to the recipe as written. Pure, so it is unit-tested.
export function batchWarning(targetGrams, baseGrams) {
  const target = gnum(targetGrams);
  const base = gnum(baseGrams);
  if (!target) return null;

  const tooHeavy = target > MAX_SANE_BATCH_G;
  const tooBig = base > 0 && target / base > MAX_SANE_MULTIPLE;
  if (!tooHeavy && !tooBig) return null;

  const parts = ['That is ' + formatWeight(target) + ' of dough'];
  if (base > 0) parts.push('— ' + trim(target / base) + '× the recipe as written (' + formatWeight(base) + ')');
  return parts.join(' ') + '. Check the amount before calculating.';
}

// ── Persisted "scaled batch" freshness ─────────────────────────────────────────
// A calculated total-dough-weight stays shown when you leave and reopen a recipe,
// until you tap Clear or it ages out. This TTL + the pure check live here so the
// 12-hour rule is unit-testable without the storage/Firestore layer.
export const SCALED_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// True if a stored { target, ts } entry is still valid: a positive gram target
// calculated less than SCALED_TTL_MS ago (relative to nowMs).
export function isScaledEntryFresh(entry, nowMs) {
  return !!entry
    && Number.isFinite(entry.target) && entry.target > 0
    && Number.isFinite(entry.ts) && (nowMs - entry.ts) < SCALED_TTL_MS;
}

// ── Editor validation ─────────────────────────────────────────────────────────

// The first problem with a recipe, or null if it is valid: 'name' (blank name),
// 'ingredients' (no ingredient with a non-empty label), or 'weight' (every named
// ingredient is 0 g, so the recipe can never be scaled). Used to block Save.
export function findInvalidRecipe(recipe) {
  if (!recipe || !String(recipe.name || '').trim()) return 'name';
  const ings = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const named = ings.filter(i => i && String(i.label || '').trim());
  if (!named.length) return 'ingredients';
  // At least one named ingredient must carry a positive amount (in any unit), so the
  // recipe is more than a list of names. ('weight' is kept as the problem key.)
  if (!named.some(i => (Number(i.grams) || 0) > 0)) return 'weight';
  return null;
}

// ── Import into the Calculator (the single coupling; still pure here) ──────────

// Map a catalogue recipe to the raw Calculator-recipe shape the Calculator's
// normalizeRecipe accepts. 'cat-' + the opaque Firestore id is a stable, unique
// provenance id; logic 'total' = plain pro-rata; visible:false keeps it out of the
// max-4 tab bar until the owner opts it in from Calculator Settings.
export function toCalculatorRecipe(recipe) {
  return {
    id: 'cat-' + recipe.id,
    name: recipe.name,
    logic: 'total',
    // The Calculator is grams-only: convert weighable rows to grams and leave out
    // non-weighable ones (pieces / spoons / pinch / to-taste). The UI warns first
    // when anything is left out — see nonWeighableLabels.
    ingredients: (recipe.ingredients || [])
      .filter(i => isWeighableUnit(unitOf(i)))
      .map(i => ({ label: i.label, grams: Math.round(ingGrams(i)) })),
    visible: false,
  };
}

// The labels of ingredients that CAN'T be imported into the grams-only Calculator
// (pieces / spoons / pinch / to-taste). Empty when the whole recipe is weighable;
// drives the pre-import warning.
export function nonWeighableLabels(recipe) {
  const ings = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  return ings
    .filter(i => String(i.label || '').trim() && !isWeighableUnit(unitOf(i)))
    .map(i => i.label);
}

// Add or update an imported recipe inside a config's recipes[]. If a recipe with the
// same id already exists it is replaced in place, preserving its tab order/visibility
// (so a re-import never duplicates and never hijacks the tab bar); otherwise it is
// appended. Pure: returns a new config plus the action taken.
export function mergeImportedRecipe(config, recipe) {
  const recipes = Array.isArray(config.recipes) ? config.recipes.slice() : [];
  const idx = recipes.findIndex(r => r && r.id === recipe.id);
  let action;
  if (idx >= 0) {
    const prev = recipes[idx];
    recipes[idx] = { ...recipe, order: prev.order, visible: prev.visible };
    action = 'updated';
  } else {
    recipes.push(recipe);
    action = 'added';
  }
  return { config: { ...config, recipes }, action };
}

// Find the Calculator copy of a catalogue recipe (imported as 'cat-<id>'), or null.
// Pure — used to WARN before deleting a catalogue recipe that was imported into the
// Calculator (the two are independent copies; deleting here never touches the Calculator).
export function findCalculatorImport(config, catalogueId) {
  const recipes = (config && Array.isArray(config.recipes)) ? config.recipes : [];
  const importId = 'cat-' + catalogueId;
  return recipes.find((r) => r && r.id === importId) || null;
}
