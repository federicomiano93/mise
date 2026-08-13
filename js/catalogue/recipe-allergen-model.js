// recipe-allergen-model.js — which allergens a recipe contains, gathered from the
// ingredients its rows point at. PURE, and asserted under Node (P15).
//
// ⚠️⚠️ IT LOOKS LIKE recipe-cost-model.js AND ITS CONCLUSION IS THE OPPOSITE.
//
// Both walk the same links, both meet the same gaps: a row nobody linked, an
// ingredient with nothing filled in, a sub-recipe that is itself incomplete. The
// cost model answers those by giving a PARTIAL number and saying so — a price per
// kilo of the part it could price, which is a useful, honest, slightly-too-low
// answer.
//
// Here a partial answer is not slightly wrong, it is DANGEROUS. The row nobody
// linked could be the one with the hazelnuts. So:
//
//     complete === false  ⇒  NOTHING may be printed as a label.
//
// The list of allergens found is still returned, because a working sheet can show
// "so far we know about milk and wheat, and these four rows are unaccounted for"
// — that is a job list. What must never happen is that list being presented as a
// declaration. The screens enforce it; this file makes it impossible to miss by
// putting `complete` in the same object.
//
// ⚠️ IT LIVES IN js/catalogue/ BESIDE recipe-cost-model.js, and Food Cost imports
// it the same way it already imports that one (foodcost-main.js:20). Walking a
// recipe's rows needs to know how a catalogue row is shaped — unitOf, linkOf,
// ingredientGrams — so the walk belongs where that shape is defined. The
// alternative, a second copy of the walk, is the thing this project refuses.

import { t } from '../i18n.js';
import { unitOf, isWeighableUnit, ingredientGrams, linkOf } from './catalogue-model.js';
import { MAX_RECIPE_DEPTH } from './recipe-cost-model.js';
import { normalizeAllergens, normalizeMayContain, isDeclared } from '../allergen-model.js';

// Why a row could not be accounted for. The order is the order they are TESTED
// in, and each names one thing to go and do — the same shape as COST_REASON_TEXT
// in the cost model, so the two screens read alike.
//
// ⚠️ 'not-weighable' IS NOT AN EXCUSE HERE, and that is the sharpest difference
// from the cost model. A pinch of something still contains what it contains; a
// row measured in spoons can be pure mustard. The cost model can skip those
// because a pinch costs nothing worth counting — an allergen declaration cannot.
export const ALLERGEN_REASON_TEXT = Object.freeze({
  'not-linked': 'not linked to an ingredient',
  'missing-ingredient': 'linked to an ingredient that no longer exists',
  'not-declared': 'the linked ingredient has no allergen information yet',
  'missing-recipe': 'linked to a recipe that no longer exists',
  'sub-incomplete': 'the linked recipe is not fully declared',
  'cycle': 'this recipe contains itself',
  'too-deep': 'nested too many recipes deep',
});

function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// Everything one row contributes, or the reason it contributes nothing.
function readRow(row, { ingredients }, resolveRecipe) {
  const link = linkOf(row);
  if (!link) return { reason: 'not-linked' };

  if (link.kind === 'recipe') {
    const sub = resolveRecipe(link.refId);
    if (sub.reason) return { reason: sub.reason };
    return { allergens: sub.allergens, mayContain: sub.mayContain, reason: null };
  }

  const ingredient = lookup(ingredients, link.refId);
  if (!ingredient) return { reason: 'missing-ingredient' };
  // ⚠️ THE WHOLE FEATURE TURNS ON THIS LINE. An ingredient nobody has checked
  // contributes NOTHING and makes the recipe incomplete — it does not contribute
  // "no allergens". isDeclared() is the only thing allowed to answer that, and it
  // reads the verification stamp rather than the emptiness of a list.
  if (!isDeclared(ingredient)) return { reason: 'not-declared' };

  return {
    allergens: normalizeAllergens(ingredient.allergens),
    mayContain: normalizeMayContain(ingredient.mayContain),
    reason: null,
  };
}

// What a recipe contains.
//
//   { allergens, mayContain, complete, rows, gaps }
//
// `complete` is true only when EVERY row is accounted for. There is no middle.
export function recipeAllergens(recipe, tables = {}, depth = 1, seen = new Set()) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];

  // The recipe being read is itself on the branch, so a row pointing back at it is
  // caught here rather than one level down, where the message would name the wrong
  // recipe. Same reasoning as the cost model.
  const branch = recipe && recipe.id ? new Set([...seen, String(recipe.id)]) : seen;

  const found = new Set();
  const traces = new Set();
  let complete = true;

  const detailed = rows.map(row => {
    const label = String((row && row.label) || '').trim();
    const result = readRow(row, tables, refId => resolveIn(refId, tables, depth, branch));

    if (result.reason === null) {
      result.allergens.forEach(code => found.add(code));
      result.mayContain.forEach(code => traces.add(code));
    } else if (label) {
      // ⚠️ A BLANK LINE IS NOT A GAP. A row with no label at all is somebody
      // half-way through typing, not an undeclared ingredient — counting it would
      // make every recipe permanently incomplete for a reason nobody can fix.
      complete = false;
    }

    return {
      label,
      grams: ingredientGrams(row) || 0,
      unit: unitOf(row),
      declared: result.reason === null,
      reason: result.reason,
    };
  });

  // A recipe with no rows at all declares nothing, and saying "contains none of
  // the 14" about it would be a statement nobody made.
  if (!rows.length) complete = false;

  return {
    allergens: [...found].sort((a, b) => a.localeCompare(b)),
    mayContain: [...traces].filter(code => !found.has(code)).sort((a, b) => a.localeCompare(b)),
    complete,
    rows: detailed,
    // The rows somebody can go and fix, in the order they appear. Unlike the cost
    // model's `unpriced`, nothing is excluded for being un-weighable: a pinch of
    // mustard is still mustard.
    gaps: detailed.filter(r => !r.declared && r.label),
  };
}

// Descend into a sub-recipe. The branch set is COPIED on the way down, never
// shared between siblings: two rows may legitimately use the same sub-recipe, and
// one shared set would call the second a cycle.
function resolveIn(refId, tables, depth, branch) {
  if (branch.has(refId)) return { reason: 'cycle' };
  if (depth >= MAX_RECIPE_DEPTH) return { reason: 'too-deep' };

  const sub = lookup(tables.recipes, refId);
  if (!sub) return { reason: 'missing-recipe' };

  const result = recipeAllergens(sub, tables, depth + 1, new Set([...branch, refId]));
  // ⚠️ AN INCOMPLETE SUB-RECIPE POISONS THE WHOLE THING, and contributes nothing.
  // Taking its known allergens while ignoring its gaps is how doubt disappears one
  // level up and a half-known answer starts looking complete.
  if (!result.complete) return { reason: 'sub-incomplete' };
  return { allergens: result.allergens, mayContain: result.mayContain, reason: null };
}

// One line saying why this cannot be declared, or '' when it can.
// Names a count rather than listing rows the screen already shows.
export function incompleteText(result) {
  if (!result || result.complete) return '';
  const n = result.gaps.length;
  if (!n) return t('cat.nothingInThisRecipe');
  return `${n} ${n === 1 ? 'ingredient is' : 'ingredients are'} not declared — no label can be made`;
}

// ⚠️ THE ONE FUNCTION EVERY LABEL MUST ASK, so there is a single place to look and
// a single place to break on purpose in a mutation test. A label screen that tests
// `result.allergens.length` instead would happily print a list gathered from three
// rows out of ten.
export function canLabel(result) {
  return !!result && result.complete === true;
}

// ── Where to start ───────────────────────────────────────────────────────────
//
// ⚠️ THE ANSWER TO "DO I REALLY HAVE TO FILL IN 65 INGREDIENTS?" — and it is
// usually no. A handful of ingredients appear in almost everything, so declaring
// six of them can unblock twenty recipes while the other fifty-nine matter to one
// recipe each. Handed a flat list, somebody starts at A and gives up at F having
// unblocked nothing; handed this, the first afternoon's work is the whole point.
//
// Counts each UNDECLARED ingredient once per recipe that is waiting on it,
// including through sub-recipes, and returns the busiest first.
export function blockingIngredients(recipes, tables = {}) {
  const list = Array.isArray(recipes) ? recipes : [];
  const counts = new Map();   // id -> { id, name, recipes: Set }

  for (const recipe of list) {
    if (!recipe || !recipe.id) continue;
    for (const id of undeclaredIdsIn(recipe, tables, 1, new Set())) {
      if (!counts.has(id)) {
        const ingredient = lookup(tables.ingredients, id);
        counts.set(id, { id, name: (ingredient && ingredient.name) || t('cat.unknownIngredient'), recipes: new Set() });
      }
      counts.get(id).recipes.add(recipe.id);
    }
  }

  return [...counts.values()]
    .map(entry => ({ id: entry.id, name: entry.name, blocks: entry.recipes.size }))
    // Busiest first; ties by name so the order is stable between two openings of
    // the screen rather than shuffling with Map insertion order.
    .sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name));
}

// ── The job BEFORE that one ──────────────────────────────────────────────────
//
// ⚠️ THIS EXISTS BECAUSE THE WORK LIST ABOVE WAS EMPTY ON THE REAL DATA, AND THAT
// WAS WORSE THAN USELESS — a screen whose whole point is "start here" showing
// nothing at all. blockingIngredients() counts ingredients that are LINKED and
// undeclared; on 11 August 2026 the bakery had 77 recipe rows and **none of them
// linked**, so it had nothing to count and no guidance appeared for the job that
// actually comes first.
//
// Linking and declaring are two different actions, and they are strictly ordered:
// an ingredient's declaration cannot reach a recipe that does not point at it. So
// this is asked first, and the screen shows it first.
//
// Counted by row LABEL rather than by ingredient, because an unlinked row has no
// ingredient — the label is the only handle it has. The same name across eleven
// recipes is eleven separate links to make, and knowing that is the point.
export function unlinkedRowNames(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const counts = new Map();

  for (const recipe of list) {
    const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
    for (const row of rows) {
      if (linkOf(row)) continue;
      const label = String((row && row.label) || '').trim();
      // A blank line is somebody mid-edit, not a job — the same rule the walk uses.
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

// Which linked-but-undeclared ingredient ids this recipe waits on. Rows that are
// not linked at all have no id to report — they are counted by the recipe's own
// `gaps`, and are a different job (link it) from this one (declare it).
function undeclaredIdsIn(recipe, tables, depth, branch) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  const here = recipe && recipe.id ? new Set([...branch, String(recipe.id)]) : branch;
  const out = new Set();

  for (const row of rows) {
    const link = linkOf(row);
    if (!link) continue;

    if (link.kind === 'recipe') {
      // The same guards as the walk above, for the same reasons — a cycle or a
      // runaway nesting must end here rather than hang the screen this feeds.
      if (here.has(link.refId) || depth >= MAX_RECIPE_DEPTH) continue;
      const sub = lookup(tables.recipes, link.refId);
      if (!sub) continue;
      undeclaredIdsIn(sub, tables, depth + 1, new Set([...here, link.refId]))
        .forEach(id => out.add(id));
      continue;
    }

    const ingredient = lookup(tables.ingredients, link.refId);
    // ⚠️ A DELETED INGREDIENT IS NOT A JOB FOR THIS LIST. It cannot be declared —
    // it does not exist — so it would sit at the top of the work list for ever.
    // The recipe's own gaps still report it, which is where it can be acted on.
    if (!ingredient) continue;
    if (!isDeclared(ingredient)) out.add(link.refId);
  }

  return out;
}
