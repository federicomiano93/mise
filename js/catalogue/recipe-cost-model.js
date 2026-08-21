// recipe-cost-model.js — what a recipe costs per kilo. PURE: no DOM, no Firestore,
// so every rule below is asserted under Node (P15).
//
// THE ONE SENTENCE: a row that points at a priced ingredient contributes both its
// COST and its WEIGHT; a row that points at nothing contributes NEITHER, and the
// recipe says so out loud.
//
// ⚠️ THAT IS WHY THE WEIGHT USED HERE IS NOT THE RECIPE'S TOTAL WEIGHT. If 8 rows
// out of 10 are linked, the price per kilo is the price per kilo OF THOSE 8 — an
// honest partial answer. Dividing their cost by the FULL weight instead would look
// like a complete answer and be quietly too low, which is the one failure mode
// that matters here: a food cost that is wrong in the direction of "we are making
// money". Every screen showing this number must show `partial` with it.
//
// ⚠️ AND A ROW IS COSTED FROM ITS SUPPLIER'S PRICE, not from the batch that was
// actually in the kitchen. Buying elsewhere for a week because the van did not
// come leaves no trace here. Declared, accepted, and not worth asking anyone to
// record every substitution.

import { t } from '../i18n.js';
import {
  unitOf, isWeighableUnit, ingredientGrams, linkOf, normalizeLossPct,
} from './catalogue-model.js';
import { pricePerKg as ingredientPricePerKg, roundTo } from '../price-model.js';

// How many recipes deep a recipe may reach. A pastry cream inside a filling inside
// a cake is three; four is past anything real, and the limit exists so a chain
// nobody meant to build ends with a message instead of a hung screen.
export const MAX_RECIPE_DEPTH = 4;

// Why a row could not be costed. The order is the order they are TESTED in, and
// each names one thing to go and do.
// ⚠️ KEYS, resolved at draw time — see js/calculator-render.js. And eight of these
// nine were BARE ENGLISH beside one t() call: the same list, one line translated and
// eight not, which is how a half-translated screen happens.
export const COST_REASON_TEXT = Object.freeze({
  'not-weighable': 'cat.notWeighedPiecesSpoons',
  'no-amount': 'cat.cost.noAmount',
  'not-linked': 'cat.cost.notLinked',
  'missing-ingredient': 'cat.cost.missingIngredient',
  'missing-recipe': 'cat.cost.missingRecipe',
  'no-price': 'cat.cost.noPrice',
  'sub-not-costable': 'cat.cost.subNotCostable',
  'cycle': 'cat.cost.cycle',
  'too-deep': 'cat.cost.tooDeep',
});

// The one place a cost reason becomes words.
export function costReasonLabel(reason) {
  return COST_REASON_TEXT[reason] ? t(COST_REASON_TEXT[reason]) : '';
}

// Accept a Map or a plain object for the two lookup tables, so callers can hand
// over whatever they already have without building a second copy.
function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// The cost of ONE row, in pounds, or a reason it has none.
// `resolveRecipe` is passed in rather than called directly so the recursion — and
// its cycle and depth guards — stays in one place, below.
function costRow(row, { ingredients }, resolveRecipe) {
  if (!isWeighableUnit(unitOf(row))) return { cost: null, reason: 'not-weighable' };

  const grams = ingredientGrams(row);
  // A named row with no amount is not an error and not a cost — it is a line
  // somebody has not finished typing.
  if (!(grams > 0)) return { cost: null, reason: 'no-amount' };

  const link = linkOf(row);
  if (!link) return { cost: null, grams, reason: 'not-linked' };

  if (link.kind === 'recipe') {
    const sub = resolveRecipe(link.refId);
    if (sub.reason) return { cost: null, grams, reason: sub.reason };
    return { cost: roundTo(grams / 1000 * sub.pricePerKg, 4), grams, reason: null, partial: sub.partial };
  }

  const ingredient = lookup(ingredients, link.refId);
  if (!ingredient) return { cost: null, grams, reason: 'missing-ingredient' };

  const rate = ingredientPricePerKg(ingredient);
  if (rate === null) return { cost: null, grams, reason: 'no-price' };

  return { cost: roundTo(grams / 1000 * rate, 4), grams, reason: null };
}

// What one recipe costs per kilo of what comes OUT of it.
//
//   { pricePerKg, totalCost, costedGrams, yieldGrams, rows, partial, unpriced }
//
// pricePerKg is null — never 0 — when nothing could be costed. Zero would read as
// "this is free", which is the opposite of "nobody has priced it yet".
export function costRecipe(recipe, tables = {}, depth = 1, seen = new Set()) {
  const rows = (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];

  // The recipe being costed is itself on the branch, so a row pointing back at it
  // is caught as a cycle here rather than one level down, where the message would
  // name the wrong recipe.
  const branch = recipe && recipe.id ? new Set([...seen, String(recipe.id)]) : seen;

  let totalCost = 0;
  let costedGrams = 0;
  let partial = false;

  const detailed = rows.map(row => {
    const result = costRow(row, tables, refId => resolveIn(refId, tables, depth, branch));
    const label = String(row && row.label || '').trim();

    if (result.reason === null) {
      totalCost += result.cost;
      costedGrams += result.grams;
      // A sub-recipe that is itself only partly costed makes THIS recipe partly
      // costed too, even though every row here resolved. Without this the doubt
      // disappears one level up and a half-known number looks complete.
      if (result.partial) partial = true;
    } else if (label) {
      partial = true;
    }

    return {
      label,
      grams: result.grams || 0,
      cost: result.cost,
      costed: result.reason === null,
      reason: result.reason,
    };
  });

  const lossPct = normalizeLossPct(recipe && recipe.lossPct);
  const yieldGrams = roundTo(costedGrams * (1 - lossPct / 100), 4);

  const pricePerKg = (costedGrams > 0 && yieldGrams > 0)
    ? roundTo(totalCost / (yieldGrams / 1000), 4)
    : null;

  return {
    pricePerKg,
    totalCost: roundTo(totalCost, 4),
    costedGrams: roundTo(costedGrams, 4),
    yieldGrams,
    lossPct,
    rows: detailed,
    partial,
    // The rows a person could go and fix, in the order they appear. Rows with no
    // label at all are left out: a blank line is not a job.
    unpriced: detailed.filter(r => !r.costed && r.label && r.reason !== 'not-weighable'),
  };
}

// Descend into a sub-recipe. The branch's own set is COPIED on the way down, never
// shared between siblings: two rows may legitimately use the same sub-recipe, and
// one shared set would call the second one a cycle.
//
// The guards are ordered cheapest-and-most-specific first — a recipe that contains
// itself is reported as a cycle even when it also happens to be at the depth limit,
// because "this recipe contains itself" is the one a person can act on.
function resolveIn(refId, tables, depth, branch) {
  if (branch.has(refId)) return { reason: 'cycle' };
  if (depth >= MAX_RECIPE_DEPTH) return { reason: 'too-deep' };

  const sub = lookup(tables.recipes, refId);
  if (!sub) return { reason: 'missing-recipe' };

  const result = costRecipe(sub, tables, depth + 1, new Set([...branch, refId]));
  if (result.pricePerKg === null) return { reason: 'sub-not-costable' };
  return { pricePerKg: result.pricePerKg, partial: result.partial };
}

// One line saying how complete the answer is, or '' when it is complete.
// Plain words, and it names a count rather than listing rows the screen already
// shows: "3 ingredients are not priced yet".
export function partialCostText(result) {
  if (!result || !result.partial) return '';
  const n = result.unpriced.length;
  if (!n) return t('cat.partOfThisRecipe');
  return `${n} ${n === 1 ? 'ingredient is' : 'ingredients are'} not priced yet — this cost is partial`;
}
