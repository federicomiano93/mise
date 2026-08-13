// foodcost-model.js — what a finished product costs to make, and what share of
// its price that is. PURE: no DOM, no Firestore, so every rule below is asserted
// under Node (P15).
//
// THE CHAIN, end to end:
//   Orders    knows what an ingredient costs per kilo
//   Catalogue turns that into what a RECIPE costs per kilo
//   here      turns that into what a PRODUCT costs, and what it earns
//
// A product is a batch: some kilos of one or more recipes, plus packaging counted
// in pieces. It is sold either BY THE PIECE (so the batch is divided by how many
// come out of it) or BY WEIGHT (so the cost per kilo is the answer directly).
//
// ⚠️ THE SELLING PRICE IS TYPED GROSS — with VAT, the number on the label, the one
// a person can check against the till. The food cost is worked out on the NET
// price, because the VAT is never the business's money. Getting this backwards
// makes every margin look better than it is, by exactly the VAT rate.

import { t } from '../i18n.js';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from '../price-model.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';

// UK rates: standard, reduced, zero. Not a closed list — a free field sits beside
// the choices, because the rate that applies to a bakery product is a question for
// an accountant, not for this file.
//
// ⚠️ ZERO IS A REAL, COMMON ANSWER HERE, not a missing one. Most bread and cakes
// sold to take away are zero-rated in the UK, while the same thing eaten in is
// standard-rated — which is exactly why the rate lives on each PRODUCT. Anything
// that treats 0 as "not filled in" will refuse to cost the bakery's main line.
export const VAT_RATES = Object.freeze([20, 5, 0]);

// How the product is sold. There is no default: a product with neither cannot be
// costed, and it says so, rather than being silently treated as one of them.
export const SELLING_MODES = Object.freeze(['piece', 'weight']);

// The traffic light. Green up to the target, amber up to a tenth above it, red
// beyond. RELATIVE rather than a fixed number of points, so a 12% target and a 35%
// target both get a proportionate warning band instead of one being far stricter
// than the other by accident.
export const AMBER_MULTIPLIER = 1.1;

// Why a product cannot be costed. Each names one thing to go and fill in; the
// order is the order a person would fill them in.
export const BLOCKER_TEXT = Object.freeze({
  'no-components': t('fc.addAtLeastOne'),
  'no-selling-mode': t('fc.chooseWhetherThisIs'),
  'no-pieces': t('fc.sayHowManyPieces'),
  'no-vat': t('fc.chooseTheVatRate'),
  'no-price': t('fc.enterTheSellingPrice'),
  'no-recipe-cost': t('fc.theRecipesInThis'),
  'no-weight': t('fc.theRecipesInThis2'),
});

// A number that may legitimately be zero — a VAT rate, and nothing else here.
// Kept separate from positiveNumber so the difference is deliberate and visible:
// everywhere else zero means "not filled in", and here it does not.
export function zeroOrMore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isSellingMode(mode) {
  return SELLING_MODES.includes(mode);
}

// ── Normalisation (junk-safe: never throws, never yields NaN) ─────────────────

function normalizeComponent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const recipeId = raw.recipeId != null ? String(raw.recipeId).trim() : '';
  if (!recipeId) return null;
  const qtyKg = Number(raw.qtyKg);
  return { recipeId, qtyKg: Number.isFinite(qtyKg) && qtyKg >= 0 ? qtyKg : 0 };
}

function normalizePackaging(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredientId = raw.ingredientId != null ? String(raw.ingredientId).trim() : '';
  if (!ingredientId) return null;
  const qtyPcs = Number(raw.qtyPcs);
  return { ingredientId, qtyPcs: Number.isFinite(qtyPcs) && qtyPcs >= 0 ? qtyPcs : 0 };
}

// A product from arbitrary (Firestore) input. Missing values stay missing — null,
// not 0 — because "no VAT rate chosen" and "zero-rated" are different answers and
// only one of them can be costed.
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id != null ? String(raw.id) : '',
    name: String(raw.name != null ? raw.name : '').trim(),
    components: (Array.isArray(raw.components) ? raw.components : []).map(normalizeComponent).filter(Boolean),
    packaging: (Array.isArray(raw.packaging) ? raw.packaging : []).map(normalizePackaging).filter(Boolean),
    sellingMode: isSellingMode(raw.sellingMode) ? raw.sellingMode : null,
    piecesPerBatch: positiveNumber(raw.piecesPerBatch),
    sellingPrice: positiveNumber(raw.sellingPrice),
    vatRate: zeroOrMore(raw.vatRate),
    foodCostTarget: positiveNumber(raw.foodCostTarget),
  };
}

export function normalizeProducts(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProduct).filter(Boolean);
}

// ── The maths ────────────────────────────────────────────────────────────────

// The price without VAT. A rate of 0 returns the price unchanged, which is correct
// and is the common case for takeaway bakery in the UK.
export function netPrice(gross, vatRate) {
  const price = positiveNumber(gross);
  const rate = zeroOrMore(vatRate);
  if (price === null || rate === null) return null;
  return roundTo(price / (1 + rate / 100), 4);
}

// What one batch costs, and what it weighs.
//
// Returns { cost, kg, partial, rows } — `rows` explains each line, so the screen
// can say WHICH recipe has no price rather than only that something has none.
//
// ⚠️ PACKAGING ADDS COST BUT NOT WEIGHT. A box is not part of what is sold by the
// kilo, and counting it would make a product look heavier and cheaper per kilo
// than it is. Packaging is also costed only when the ingredient is bought BY THE
// PIECE, because "3 boxes" of something priced per kilo means nothing.
export function batchTotals(product, tables = {}) {
  const p = normalizeProduct(product) || { components: [], packaging: [] };
  const recipesById = tables.recipes || {};
  let cost = 0;
  let kg = 0;
  let partial = false;
  const rows = [];

  p.components.forEach(component => {
    const recipe = lookup(recipesById, component.recipeId);
    if (!recipe) {
      partial = true;
      rows.push({ kind: 'recipe', id: component.recipeId, name: '', qty: component.qtyKg, cost: null, reason: 'missing-recipe' });
      return;
    }
    const costed = costRecipe(recipe, tables);
    if (costed.pricePerKg === null) {
      partial = true;
      rows.push({ kind: 'recipe', id: component.recipeId, name: recipe.name, qty: component.qtyKg, cost: null, reason: 'no-recipe-cost' });
      return;
    }
    // A recipe that is only PARTLY priced makes the product partly priced too —
    // the same rule, and the same reason, as one recipe inside another.
    if (costed.partial) partial = true;
    const lineCost = roundTo(component.qtyKg * costed.pricePerKg, 4);
    cost += lineCost;
    kg += component.qtyKg;
    rows.push({ kind: 'recipe', id: component.recipeId, name: recipe.name, qty: component.qtyKg, cost: lineCost, reason: null });
  });

  p.packaging.forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId);
    if (!ingredient) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: '', qty: item.qtyPcs, cost: null, reason: 'missing-ingredient' });
      return;
    }
    // Priced per piece, or it cannot be counted in pieces.
    const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each === null) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredient.name || '', qty: item.qtyPcs, cost: null, reason: 'no-piece-price' });
      return;
    }
    const lineCost = roundTo(item.qtyPcs * each, 4);
    cost += lineCost;
    rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredient.name || '', qty: item.qtyPcs, cost: lineCost, reason: null });
  });

  return { cost: roundTo(cost, 4), kg: roundTo(kg, 4), partial, rows };
}

function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// The whole answer for one product.
//
//   { unitCost, netUnitPrice, foodCostPct, margin, status, partial, blockers, batch }
//
// foodCostPct is null whenever anything needed is missing, and `blockers` says
// what. It is never guessed and never shown as 0 — a food cost of nothing would be
// read as a product that costs nothing to make.
export function costProduct(product, tables = {}) {
  const p = normalizeProduct(product);
  const batch = batchTotals(p, tables);
  const blockers = [];

  if (!p || !p.components.length) blockers.push('no-components');
  if (p && !p.sellingMode) blockers.push('no-selling-mode');
  if (p && p.sellingMode === 'piece' && p.piecesPerBatch === null) blockers.push('no-pieces');
  if (p && p.vatRate === null) blockers.push('no-vat');
  if (p && p.sellingPrice === null) blockers.push('no-price');

  // A batch of nothing cannot be divided. Reported as its own reason rather than
  // folded into "no components": the components may be there and simply unpriced.
  if (p && p.components.length && batch.cost <= 0) blockers.push('no-recipe-cost');
  if (p && p.sellingMode === 'weight' && batch.kg <= 0) blockers.push('no-weight');

  const base = {
    unitCost: null, netUnitPrice: null, foodCostPct: null, margin: null,
    status: null, partial: batch.partial, blockers, batch,
  };
  if (blockers.length) return base;

  const unitCost = p.sellingMode === 'piece'
    ? roundTo(batch.cost / p.piecesPerBatch, 4)
    : roundTo(batch.cost / batch.kg, 4);

  const netUnitPrice = netPrice(p.sellingPrice, p.vatRate);
  if (netUnitPrice === null || netUnitPrice <= 0) {
    return { ...base, blockers: [...blockers, 'no-price'] };
  }

  const foodCostPct = roundTo(unitCost / netUnitPrice * 100, 2);

  return {
    ...base,
    unitCost,
    netUnitPrice,
    foodCostPct,
    // What one piece (or one kilo) actually leaves behind, in pounds. The
    // percentage is the comparable number; this is the one that pays the rent.
    margin: roundTo(netUnitPrice - unitCost, 4),
    status: statusFor(foodCostPct, p.foodCostTarget),
  };
}

// green / amber / red against the product's own target, or null when it has none —
// a product with no target is not failing, it simply has nothing to be measured
// against, and colouring it would be inventing a standard nobody set.
export function statusFor(foodCostPct, target) {
  const pct = Number(foodCostPct);
  const goal = positiveNumber(target);
  if (!Number.isFinite(pct) || goal === null) return null;
  if (pct <= goal) return 'green';
  if (pct <= goal * AMBER_MULTIPLIER) return 'amber';
  return 'red';
}

// The products worst first — the order somebody opening this screen wants, because
// the reason to open it is to find what is losing money.
//
// Products that cannot be costed sort LAST, not first: they are a data-entry job,
// not a margin problem, and putting them at the top would bury the real answer
// under a list of half-filled cards.
export function sortByMargin(products, tables = {}) {
  // A corrupt entry must not take the whole screen down. costProduct already
  // tolerates null; the NAME is read here too, and reading it straight off the
  // object threw inside Array.sort — which is the worst place for it, because the
  // list is drawn from a live Firestore snapshot and one bad document would blank
  // the whole page rather than one row.
  const nameOf = p => String((p && p.name) || '');

  return (products || []).slice()
    .map(product => ({ product, result: costProduct(product, tables) }))
    .sort((a, b) => {
      const av = a.result.foodCostPct;
      const bv = b.result.foodCostPct;
      if (av === null && bv === null) return nameOf(a.product).localeCompare(nameOf(b.product));
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av || nameOf(a.product).localeCompare(nameOf(b.product));
    });
}

// ── Snapshots ────────────────────────────────────────────────────────────────

// Should this change be recorded? The design's rule: a snapshot is taken when the
// SELLING PRICE or the COMPOSITION changes — the two things a person does
// deliberately — and at no other time.
//
// ⚠️ KNOWN LIMITATION, WRITTEN DOWN ON PURPOSE. Ingredient prices drift upwards
// without anybody touching the product, and that erosion leaves NO point on this
// series. The history therefore answers "what did we decide, and when", not "what
// did it cost every week". Revisit after two or three months of real use; the fix
// is a periodic snapshot, which was deliberately not built now.
export function snapshotWorthTaking(before, after) {
  const a = normalizeProduct(before);
  const b = normalizeProduct(after);
  if (!b) return false;
  if (!a) return true;                                  // the first save is a point
  if (a.sellingPrice !== b.sellingPrice) return true;
  if (a.vatRate !== b.vatRate) return true;             // it changes the net price
  if (a.sellingMode !== b.sellingMode) return true;
  if (a.piecesPerBatch !== b.piecesPerBatch) return true;
  return compositionKey(a) !== compositionKey(b);
}

// A stable string for "what this product is made of", so a reordered list of the
// same components is NOT a change. Sorted, because the editor can reorder rows and
// nobody means anything by it.
function compositionKey(product) {
  const parts = [
    ...product.components.map(c => `r:${c.recipeId}:${c.qtyKg}`),
    ...product.packaging.map(p => `p:${p.ingredientId}:${p.qtyPcs}`),
  ];
  return parts.sort().join('|');
}

// One entry in the append-only history. It freezes the ingredient prices of the
// moment as well as the answer, so a margin from six months ago can still be
// explained rather than merely asserted.
//
// ⚠️ THE VAT RATE IS FROZEN TOO. Rates change by law, and without this every past
// margin would silently be recomputed against today's rate — corrupting a series
// whose whole purpose is to be comparable over time.
export function productSnapshot(product, result, nowIso, tables = {}) {
  const p = normalizeProduct(product) || {};
  return {
    recordedAt: nowIso,
    unitCost: result.unitCost,
    foodCostPct: result.foodCostPct,
    sellingPrice: p.sellingPrice ?? null,
    vatRate: p.vatRate ?? null,
    sellingMode: p.sellingMode ?? null,
    frozenPrices: frozenPricesFor(p, tables),
  };
}

// What every ingredient this product depends on cost at this moment, flattened to
// { ingredientId: pricePerKg }. Recipes are walked so an ingredient two levels down
// is captured too — otherwise the frozen record could not explain a change that
// came from inside a sub-recipe.
function frozenPricesFor(product, tables) {
  const out = {};
  const seen = new Set();

  const walkRecipe = (recipeId, depth) => {
    if (depth > 4 || seen.has(recipeId)) return;
    seen.add(recipeId);
    const recipe = lookup(tables.recipes, recipeId);
    if (!recipe || !Array.isArray(recipe.ingredients)) return;
    recipe.ingredients.forEach(row => {
      const refId = row && row.refId ? String(row.refId) : '';
      if (!refId) return;
      if (row.kind === 'recipe') { walkRecipe(refId, depth + 1); return; }
      const rate = ingredientPricePerKg(lookup(tables.ingredients, refId));
      if (rate !== null) out[refId] = rate;
    });
  };

  (product.components || []).forEach(c => walkRecipe(c.recipeId, 1));
  (product.packaging || []).forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId);
    const each = ingredient && ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each !== null) out[item.ingredientId] = each;
  });

  return out;
}
