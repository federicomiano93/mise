// recipe-label-model.js — the contents of a food label: the ingredient list in
// the order the law requires, which of them carry allergens, and the nutrition
// declaration per 100 g of the FINISHED food. PURE, asserted under Node (P15).
//
// ⚠️⚠️ NOTHING HERE PRODUCES A LABEL UNLESS recipe-allergen-model.js SAYS THE
// RECIPE IS FULLY DECLARED. That check is not repeated here; it is asked once, at
// the top of buildLabel(), and a caller that reaches past it into the parts is
// building a declaration out of a recipe with holes in it.
//
// ⚠️ AND WHAT IT PRODUCES IS A DRAFT FOR A HUMAN TO CHECK, NOT A COMPLIANT LABEL.
// The app knows what it was told about ingredients. It does not know what else is
// on the bench, what the last-minute substitution was, or that a supplier changed
// their recipe last month. Every screen that shows this says so.

import { unitOf, isWeighableUnit, ingredientGrams, linkOf, normalizeLossPct } from './catalogue-model.js';
import { MAX_RECIPE_DEPTH } from './recipe-cost-model.js';
import { recipeAllergens, canLabel } from './recipe-allergen-model.js';
import {
  normalizeAllergens, normalizeMayContain, normalizeNutrition, hasFullNutrition,
  allergenLabel, NUTRIENT_KEYS,
} from '../allergen-model.js';

function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// ── The ingredient list ──────────────────────────────────────────────────────
//
// ⚠️ SUB-RECIPES ARE FLATTENED, NOT NAMED. A label may not say "filling" and stop
// — the person reading it needs the actual ingredients. So a row pointing at
// another recipe contributes that recipe's OWN rows, scaled to how much of it
// goes in.
//
// ⚠️ AND THE SAME INGREDIENT USED TWICE IS ONE LINE, SUMMED. Butter in the dough
// and butter in the filling is butter, and listing it twice would both look wrong
// and put it in the wrong position — the order is by weight, and two half-weights
// sort lower than the one real weight.
export function flattenIngredients(recipe, tables = {}, scale = 1, depth = 1, seen = new Set()) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  const branch = recipe && recipe.id ? new Set([...seen, String(recipe.id)]) : seen;
  const totals = new Map();   // ingredient id -> { id, name, grams }

  const add = (id, name, grams) => {
    if (!totals.has(id)) totals.set(id, { id, name, grams: 0 });
    totals.get(id).grams += grams;
  };

  for (const row of rows) {
    const link = linkOf(row);
    if (!link) continue;
    // A row with no weight cannot take a place in a list ORDERED by weight. It is
    // not lost: canLabel() has already refused the whole recipe if such a row is
    // undeclared, and a declared one with no amount is a recipe-writing problem
    // the allergen panel already reports.
    const grams = isWeighableUnit(unitOf(row)) ? (ingredientGrams(row) || 0) : 0;
    if (grams <= 0) continue;

    if (link.kind === 'recipe') {
      if (branch.has(link.refId) || depth >= MAX_RECIPE_DEPTH) continue;
      const sub = lookup(tables.recipes, link.refId);
      if (!sub) continue;
      // How much of the sub-recipe goes in, as a fraction of what the sub-recipe
      // makes. Its own rows are scaled by that, so 200 g of a 1000 g filling
      // contributes a fifth of each of its ingredients.
      const subTotal = weighableGramsOf(sub);
      if (subTotal <= 0) continue;
      const inner = flattenIngredients(sub, tables, scale * (grams / subTotal), depth + 1, new Set([...branch, link.refId]));
      inner.forEach(item => add(item.id, item.name, item.grams));
      continue;
    }

    const ingredient = lookup(tables.ingredients, link.refId);
    if (!ingredient) continue;
    add(link.refId, String(ingredient.name || '').trim() || 'Unnamed ingredient', grams * scale);
  }

  // ⚠️ DESCENDING BY WEIGHT — the order is not a presentation choice, it is what
  // the regulation asks for. Ties break by name so two runs produce the same
  // label rather than shuffling with Map insertion order.
  return [...totals.values()].sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name));
}

// The weight the flattening divides by: only rows that HAVE a weight.
function weighableGramsOf(recipe) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
  return rows.reduce((sum, row) =>
    sum + (isWeighableUnit(unitOf(row)) ? (ingredientGrams(row) || 0) : 0), 0);
}

// ── The nutrition declaration ────────────────────────────────────────────────
//
// ⚠️ PER 100 g OF THE FINISHED FOOD, NOT OF THE DOUGH. Water leaves in the oven:
// 100 g of dough becomes about 80 g of bread, so every value per 100 g of the
// finished loaf is HIGHER than per 100 g of what went in the mixer. `lossPct`
// already exists on a recipe for exactly this, and recipe-cost-model.js divides
// by the same yield. Using the mixing weight instead understates a bread label by
// roughly a fifth.
export function nutritionPer100g(recipe, tables = {}) {
  const items = flattenIngredients(recipe, tables);
  if (!items.length) return null;

  const totals = {};
  NUTRIENT_KEYS.forEach(key => { totals[key] = 0; });
  let grams = 0;

  for (const item of items) {
    const ingredient = lookup(tables.ingredients, item.id);
    // ⚠️ ONE INGREDIENT WITHOUT A FULL TABLE MEANS NO TABLE AT ALL. A declaration
    // is defined as a whole; summing the seven over the ingredients that happen to
    // have them would under-declare every value by however much is missing, and
    // nothing on the label would say so.
    if (!hasFullNutrition(ingredient)) return null;
    const per100 = normalizeNutrition(ingredient.nutrition);
    const factor = item.grams / 100;
    NUTRIENT_KEYS.forEach(key => { totals[key] += per100[key] * factor; });
    grams += item.grams;
  }

  if (grams <= 0) return null;
  const lossPct = normalizeLossPct(recipe && recipe.lossPct);
  const yieldGrams = grams * (1 - lossPct / 100);
  if (yieldGrams <= 0) return null;

  const out = {};
  NUTRIENT_KEYS.forEach(key => {
    // Energy to whole units, everything else to one decimal — the precision a
    // declaration is printed at. Salt is the exception: it is routinely under
    // 0.1 g and rounding it there would print 0.0 for something real.
    const value = totals[key] / (yieldGrams / 100);
    out[key] = (key === 'kj' || key === 'kcal') ? Math.round(value)
      : (key === 'salt' ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);
  });
  out.yieldGrams = Math.round(yieldGrams);
  out.lossPct = lossPct;
  return out;
}

// ── The whole thing ──────────────────────────────────────────────────────────

export const LABEL_SHOWS = Object.freeze(['allergens', 'nutrition', 'both']);

// What a label can say about this recipe, or why it cannot say anything.
//
//   { ok, reason, name, ingredients, allergens, mayContain, nutrition }
//
// `ingredients` carries `emphasise: true` on the ones that ARE an allergen, so
// the screen can put them in bold — the regulation asks for the allergen to be
// emphasised INSIDE the ingredient list, not only summarised underneath.
export function buildLabel(recipe, tables = {}, { shows = 'both' } = {}) {
  const declared = recipeAllergens(recipe, tables);

  // ⚠️ THE ONE GATE. Everything below assumes every row is accounted for.
  if (!canLabel(declared)) {
    return { ok: false, reason: 'not-declared', gaps: declared.gaps };
  }

  const items = flattenIngredients(recipe, tables);
  if (!items.length) return { ok: false, reason: 'no-ingredients', gaps: [] };

  const ingredients = items.map(item => {
    const ingredient = lookup(tables.ingredients, item.id);
    const own = normalizeAllergens(ingredient && ingredient.allergens);
    return {
      id: item.id,
      name: item.name,
      grams: Math.round(item.grams * 10) / 10,
      // The allergens this line itself carries, so the screen can emphasise the
      // word rather than only listing it at the bottom.
      allergens: own,
      emphasise: own.length > 0,
    };
  });

  const wants = LABEL_SHOWS.includes(shows) ? shows : 'both';
  const nutrition = wants === 'allergens' ? null : nutritionPer100g(recipe, tables);

  return {
    ok: true,
    reason: null,
    shows: wants,
    name: String((recipe && recipe.name) || '').trim(),
    ingredients,
    allergens: declared.allergens,
    mayContain: declared.mayContain,
    nutrition,
    // ⚠️ SAID OUT LOUD RATHER THAN LEFT TO THE SCREEN. A label asked to show
    // nutrition that cannot be worked out must say which it is missing, not
    // quietly print the allergens half and look finished.
    nutritionMissing: wants !== 'allergens' && nutrition === null,
  };
}

// The ingredient list as one line of text, allergens in CAPITALS — the plainest
// way to emphasise them in a medium that has no bold, and the fallback the screen
// falls back to when it is copied into a message.
export function ingredientLine(label) {
  if (!label || !label.ok) return '';
  return label.ingredients
    .map(item => (item.emphasise ? item.name.toUpperCase() : item.name))
    .join(', ');
}

// "Contains: Wheat, Milk" — the summary under the list. Empty when there are none,
// because "Contains: nothing" is not a sentence anybody prints.
export function containsLine(label) {
  if (!label || !label.ok || !label.allergens.length) return '';
  return `Contains: ${label.allergens.map(allergenLabel).join(', ')}`;
}
