// recipe-cost-model.test.mjs — what a recipe costs per kilo.
//
// The owner cannot read code, so these tests are the safety net (P15). The thing
// they are really guarding is a cost that is wrong in the direction of "we are
// making money": a partial recipe divided by its FULL weight, a gram/kilo slip, a
// row silently counted as free.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  costRecipe, partialCostText, MAX_RECIPE_DEPTH, COST_REASON_TEXT,
} from '../js/catalogue/recipe-cost-model.js';
import { normalizeCatalogueRecipe, normalizeLossPct, linkOf, MAX_LOSS_PCT }
  from '../js/catalogue/catalogue-model.js';

// £2.00/kg flour and £8.00/kg butter, priced the way Orders stores them.
const INGREDIENTS = {
  FLOUR: { name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  MILK: { name: 'Milk', priceUnit: 'l', pricePerUnit: 1.2 },
  EGG: { name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.055 },
  SALT: { name: 'Salt' },                       // in Orders, but never priced
};

const row = (label, grams, over = {}) =>
  ({ label, grams, unit: 'g', kind: 'ingredient', ...over });

const recipe = (over = {}) => ({ id: 'R1', name: 'Test', ingredients: [], lossPct: 0, ...over });

// ── The basic sum ────────────────────────────────────────────────────────────

test('a fully linked recipe costs the sum of its rows, per kilo of dough', () => {
  // 800 g flour at £2/kg = £1.60; 200 g butter at £8/kg = £1.60. £3.20 for 1000 g.
  const r = recipe({ ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Butter', 200, { refId: 'BUTTER' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });

  assert.equal(out.totalCost, 3.2);
  assert.equal(out.costedGrams, 1000);
  assert.equal(out.yieldGrams, 1000);
  assert.equal(out.pricePerKg, 3.2);
  assert.equal(out.partial, false);
});

test('grams and kilos are not confused — a thousandfold error is the classic one', () => {
  const r = recipe({ ingredients: [row('Flour', 1, { refId: 'FLOUR' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.totalCost, 0.002);       // one gram of £2/kg flour
  assert.equal(out.pricePerKg, 2);          // …and a kilo of it still costs £2
});

test('a row written in kilos weighs the same as the equivalent in grams', () => {
  const inG = costRecipe(recipe({ ingredients: [row('Flour', 2000, { refId: 'FLOUR' })] }), { ingredients: INGREDIENTS });
  const inKg = costRecipe(recipe({ ingredients: [row('Flour', 2, { refId: 'FLOUR', unit: 'kg' })] }), { ingredients: INGREDIENTS });
  assert.deepEqual([inKg.totalCost, inKg.costedGrams], [inG.totalCost, inG.costedGrams]);
});

test('a row in millilitres is costed as the same number of grams', () => {
  // The declared 1:1 volume approximation, and the SAME one the price model uses
  // for an ingredient bought by the litre. The two have to agree or a litre of
  // milk costs one thing on the shelf and another in the recipe.
  const r = recipe({ ingredients: [row('Milk', 500, { refId: 'MILK', unit: 'ml' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.costedGrams, 500);
  assert.equal(out.totalCost, 0.6);
});

test('an ingredient bought by the piece is costed through its piece weight', () => {
  // 165 g of egg, from eggs at £0.30 each weighing 55 g → £5.4545/kg.
  const r = recipe({ ingredients: [row('Egg', 165, { refId: 'EGG' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.totalCost, 0.9);
  assert.equal(out.partial, false);
});

// ── Weight loss ──────────────────────────────────────────────────────────────

test('weight lost in the oven raises the price per kilo of what comes out', () => {
  // £3.20 of ingredients, 1000 g in, 20% lost → 800 g out → £4.00/kg.
  const r = recipe({
    lossPct: 20,
    ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Butter', 200, { refId: 'BUTTER' })],
  });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.yieldGrams, 800);
  assert.equal(out.pricePerKg, 4);
  assert.equal(out.totalCost, 3.2);         // the money spent does not change
});

test('no loss is the default, so every recipe written before this field is unaffected', () => {
  const r = { id: 'R1', name: 'Old', ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] };
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.lossPct, 0);
  assert.equal(out.pricePerKg, 2);
});

test('a loss of 100% cannot divide the price by zero', () => {
  // Capped at 99, so the worst case is an expensive kilo, never Infinity — which
  // would be shown on screen and carried into every product built on this recipe.
  assert.equal(normalizeLossPct(100), MAX_LOSS_PCT);
  assert.equal(normalizeLossPct(1000), MAX_LOSS_PCT);
  const out = costRecipe(recipe({ lossPct: 100, ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] }),
    { ingredients: INGREDIENTS });
  assert.ok(Number.isFinite(out.pricePerKg), `got ${out.pricePerKg}`);
  assert.equal(out.pricePerKg, 200);
});

test('a nonsense loss is treated as none', () => {
  for (const bad of [undefined, null, '', 'abc', NaN, -5, -0.1]) {
    assert.equal(normalizeLossPct(bad), 0, String(bad));
  }
});

// ── Partial cost: flagged, never blocked ─────────────────────────────────────

test('an unlinked row is left out of BOTH the cost and the weight', () => {
  // The heart of it. 800 g of linked flour plus 200 g of unlinked "Sugar" is
  // £1.60 over 800 g = £2.00/kg — not £1.60 over 1000 g = £1.60/kg, which would
  // look complete and be 20% too cheap.
  const r = recipe({ ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Sugar', 200)] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });

  assert.equal(out.costedGrams, 800);
  assert.equal(out.pricePerKg, 2);
  assert.equal(out.partial, true);
  assert.equal(out.unpriced.length, 1);
  assert.equal(out.unpriced[0].label, 'Sugar');
  assert.equal(out.unpriced[0].reason, 'not-linked');
});

test('a linked ingredient with no price yet is left out and named', () => {
  const r = recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Salt', 100, { refId: 'SALT' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.costedGrams, 900);
  assert.equal(out.partial, true);
  assert.equal(out.unpriced[0].reason, 'no-price');
});

test('a link to an ingredient that has been deleted is named as such', () => {
  const r = recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Gone', 100, { refId: 'NOPE' })] });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.unpriced[0].reason, 'missing-ingredient');
});

test('rows that are not weighed are excluded from cost AND weight, and are not a job', () => {
  // Pieces, spoons and to-taste rows carry no weight, so they cannot be costed and
  // there is nothing to fix about them — they stay out of the to-do list, but the
  // recipe is still honest that the cost is partial.
  const r = recipe({
    ingredients: [
      row('Flour', 1000, { refId: 'FLOUR' }),
      row('Salt', 1, { unit: 'pinch' }),
      row('Vanilla', 1, { unit: 'pcs' }),
      row('Pepper', 0, { unit: 'to taste' }),
    ],
  });
  const out = costRecipe(r, { ingredients: INGREDIENTS });
  assert.equal(out.costedGrams, 1000);
  assert.equal(out.pricePerKg, 2);
  assert.equal(out.partial, true);
  assert.equal(out.unpriced.length, 0, 'a pinch of salt is not something to go and fix');
});

test('nothing costable at all gives NO price, not a price of zero', () => {
  // £0.00/kg reads as "this is free". It has to read as "nobody has priced it".
  const out = costRecipe(recipe({ ingredients: [row('Sugar', 500), row('Salt', 10)] }), { ingredients: INGREDIENTS });
  assert.equal(out.pricePerKg, null);
  assert.equal(out.totalCost, 0);
  assert.equal(out.partial, true);
});

test('an empty recipe has no price and nothing to complain about', () => {
  const out = costRecipe(recipe(), { ingredients: INGREDIENTS });
  assert.equal(out.pricePerKg, null);
  assert.equal(out.partial, false);
  assert.deepEqual(out.unpriced, []);
});

test('a named row with no amount is unfinished, not free', () => {
  const out = costRecipe(recipe({ ingredients: [row('Flour', 0, { refId: 'FLOUR' })] }), { ingredients: INGREDIENTS });
  assert.equal(out.pricePerKg, null);
  assert.equal(out.rows[0].reason, 'no-amount');
});

test('a blank row is not reported as a job', () => {
  const out = costRecipe(recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' }), row('', 0)] }),
    { ingredients: INGREDIENTS });
  assert.equal(out.unpriced.length, 0);
  assert.equal(out.partial, false);
});

// ── Recipes inside recipes ───────────────────────────────────────────────────

const CREAM = { id: 'CREAM', name: 'Pastry cream', lossPct: 0,
  ingredients: [row('Milk', 500, { refId: 'MILK', unit: 'ml' }), row('Egg', 500, { refId: 'EGG' })] };

test('a recipe used inside another is costed at its own price per kilo', () => {
  // Cream: £0.60 of milk + £2.7273 of egg over 1000 g → £3.3273/kg.
  const cream = costRecipe(CREAM, { ingredients: INGREDIENTS });
  assert.equal(cream.pricePerKg, 3.3273);

  // A cake using 500 g of that cream plus 500 g of flour.
  const cake = recipe({ id: 'CAKE', ingredients: [
    row('Pastry cream', 500, { kind: 'recipe', refId: 'CREAM' }),
    row('Flour', 500, { refId: 'FLOUR' }),
  ] });
  const out = costRecipe(cake, { ingredients: INGREDIENTS, recipes: { CREAM } });

  assert.equal(out.totalCost, roundish(500 / 1000 * 3.3273 + 1));
  assert.equal(out.costedGrams, 1000);
  assert.equal(out.partial, false);
});

test("a sub-recipe's own weight loss is already inside the price it contributes", () => {
  const reduced = { ...CREAM, id: 'REDUCED', lossPct: 50 };
  const sub = costRecipe(reduced, { ingredients: INGREDIENTS });
  assert.equal(sub.pricePerKg, 6.6546);   // same money, half the yield

  const cake = recipe({ id: 'CAKE', ingredients: [row('Reduction', 100, { kind: 'recipe', refId: 'REDUCED' })] });
  const out = costRecipe(cake, { ingredients: INGREDIENTS, recipes: { REDUCED: reduced } });
  assert.equal(out.totalCost, 0.6655);
});

test('a partly priced sub-recipe makes the parent partly priced too', () => {
  // Otherwise the doubt vanishes one level up and a half-known number looks
  // complete — the same failure as dividing by the full weight, one layer deeper.
  const half = { id: 'HALF', name: 'Half', lossPct: 0,
    ingredients: [row('Flour', 500, { refId: 'FLOUR' }), row('Mystery', 500)] };
  const cake = recipe({ id: 'CAKE', ingredients: [row('Half', 100, { kind: 'recipe', refId: 'HALF' })] });
  const out = costRecipe(cake, { ingredients: INGREDIENTS, recipes: { HALF: half } });

  assert.ok(out.pricePerKg > 0);
  assert.equal(out.partial, true, 'the parent must inherit the doubt');
});

test('two rows may use the same sub-recipe without the second looking like a cycle', () => {
  const cake = recipe({ id: 'CAKE', ingredients: [
    row('Cream', 200, { kind: 'recipe', refId: 'CREAM' }),
    row('More cream', 300, { kind: 'recipe', refId: 'CREAM' }),
  ] });
  const out = costRecipe(cake, { ingredients: INGREDIENTS, recipes: { CREAM } });
  assert.equal(out.partial, false);
  assert.equal(out.costedGrams, 500);
});

test('a recipe that contains itself is caught, not followed', () => {
  const loop = { id: 'LOOP', name: 'Loop', lossPct: 0,
    ingredients: [row('Itself', 100, { kind: 'recipe', refId: 'LOOP' })] };
  const out = costRecipe(loop, { ingredients: INGREDIENTS, recipes: { LOOP: loop } });
  assert.equal(out.rows[0].reason, 'cycle');
  assert.equal(out.pricePerKg, null);
  assert.equal(out.partial, true);
});

test('a cycle two recipes long is caught as well', () => {
  const a = { id: 'A', name: 'A', lossPct: 0, ingredients: [row('B', 100, { kind: 'recipe', refId: 'B' })] };
  const b = { id: 'B', name: 'B', lossPct: 0, ingredients: [row('A', 100, { kind: 'recipe', refId: 'A' })] };
  const out = costRecipe(a, { ingredients: INGREDIENTS, recipes: { A: a, B: b } });
  assert.equal(out.pricePerKg, null);
  assert.equal(out.partial, true);
});

test('nesting stops at the depth limit instead of running away', () => {
  // A chain longer than the limit: each recipe uses the next one.
  const recipes = {};
  const depth = MAX_RECIPE_DEPTH + 3;
  for (let i = 0; i < depth; i += 1) {
    recipes[`L${i}`] = {
      id: `L${i}`, name: `L${i}`, lossPct: 0,
      ingredients: i === depth - 1
        ? [row('Flour', 1000, { refId: 'FLOUR' })]
        : [row(`L${i + 1}`, 1000, { kind: 'recipe', refId: `L${i + 1}` })],
    };
  }
  const out = costRecipe(recipes.L0, { ingredients: INGREDIENTS, recipes });
  assert.equal(out.pricePerKg, null);
  assert.equal(out.partial, true);
  // The chain is refused, and nothing hangs or overflows getting there.
  assert.ok(['too-deep', 'sub-not-costable'].includes(out.rows[0].reason), out.rows[0].reason);
});

test('a link to a recipe that has been deleted is named as such', () => {
  const cake = recipe({ ingredients: [row('Gone', 100, { kind: 'recipe', refId: 'NOPE' })] });
  const out = costRecipe(cake, { ingredients: INGREDIENTS, recipes: {} });
  assert.equal(out.rows[0].reason, 'missing-recipe');
});

// ── The link survives being loaded and saved ─────────────────────────────────

test('normalising a recipe keeps its ingredient links', () => {
  // The regression this feature could most easily have shipped: normalizeIngredient
  // rebuilds every row, so a field it does not mention is dropped on the way in
  // from Firestore — and opening a recipe to fix a typo would wipe every link.
  const stored = { id: 'R1', name: 'Bread', lossPct: 12, ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Cream', grams: 200, unit: 'g', kind: 'recipe', refId: 'CREAM' },
  ] };
  const out = normalizeCatalogueRecipe(stored);
  assert.deepEqual(out.ingredients[0], { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
  assert.deepEqual(out.ingredients[1], { label: 'Cream', grams: 200, unit: 'g', kind: 'recipe', refId: 'CREAM' });
  assert.equal(out.lossPct, 12);
});

test('a row with no link stays exactly the shape it has always had', () => {
  // No migration: a recipe nobody links keeps the three fields it has today, so an
  // older copy of the app reads it back unchanged.
  const out = normalizeCatalogueRecipe({ id: 'R1', name: 'Old', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] });
  assert.deepEqual(out.ingredients[0], { label: 'Flour', grams: 500, unit: 'g' });
});

test('a junk link is treated as no link, never as a link to nothing', () => {
  assert.equal(linkOf({ refId: '' }), null);
  assert.equal(linkOf({ refId: '   ' }), null);
  assert.equal(linkOf({}), null);
  assert.equal(linkOf(null), null);
  // An unknown kind falls back to 'ingredient', which is what every link the
  // editor writes is unless it says otherwise.
  assert.deepEqual(linkOf({ refId: 'X', kind: 'nonsense' }), { kind: 'ingredient', refId: 'X' });
});

// ── The wording under the number ─────────────────────────────────────────────

test('a complete cost says nothing; a partial one says how much is missing', () => {
  const complete = costRecipe(recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] }), { ingredients: INGREDIENTS });
  assert.equal(partialCostText(complete), '');

  const one = costRecipe(recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Sugar', 100)] }), { ingredients: INGREDIENTS });
  assert.match(partialCostText(one), /^1 ingredient is not priced yet/);

  const two = costRecipe(recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Sugar', 100), row('Salt', 10)] }), { ingredients: INGREDIENTS });
  assert.match(partialCostText(two), /^2 ingredients are not priced yet/);
});

test('every reason a row can fail has wording to show for it', () => {
  const reasons = new Set();
  const collect = out => out.rows.forEach(r => { if (r.reason) reasons.add(r.reason); });

  collect(costRecipe(recipe({ ingredients: [
    row('Pinch', 1, { unit: 'pinch' }),
    row('Empty', 0, { refId: 'FLOUR' }),
    row('Free text', 100),
    row('Deleted', 100, { refId: 'NOPE' }),
    row('Unpriced', 100, { refId: 'SALT' }),
    row('Gone recipe', 100, { kind: 'recipe', refId: 'NOPE' }),
  ] }), { ingredients: INGREDIENTS, recipes: {} }));

  const loop = { id: 'LOOP', name: 'Loop', lossPct: 0, ingredients: [row('Itself', 100, { kind: 'recipe', refId: 'LOOP' })] };
  collect(costRecipe(loop, { ingredients: INGREDIENTS, recipes: { LOOP: loop } }));

  assert.ok(reasons.size >= 7, `only saw ${[...reasons].join(', ')}`);
  reasons.forEach(reason => {
    assert.ok(COST_REASON_TEXT[reason], `no wording for "${reason}"`);
  });
});

test('the lookup tables may be Maps as well as plain objects', () => {
  const r = recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] });
  const asMap = costRecipe(r, { ingredients: new Map([['FLOUR', INGREDIENTS.FLOUR]]) });
  assert.equal(asMap.pricePerKg, 2);
});

test('missing tables do not throw — a screen that has not loaded yet is normal', () => {
  const r = recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] });
  assert.equal(costRecipe(r).pricePerKg, null);
  assert.equal(costRecipe(r, {}).pricePerKg, null);
  assert.equal(costRecipe(null).pricePerKg, null);
});

// Round the way the model does, so an expected value written by hand here does not
// fail on the fifteenth decimal.
function roundish(n) { return Math.round((n + Number.EPSILON) * 1e4) / 1e4; }
