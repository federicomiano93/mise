// foodcost-model.test.mjs — what a product costs, and what share of its price
// that is.
//
// The owner cannot read code, so these tests are the safety net (P15). The failure
// they exist to stop is a margin that reads BETTER than it is: VAT left in the
// price, packaging counted as weight, an unpriced recipe silently costing nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VAT_RATES, SELLING_MODES, AMBER_MULTIPLIER, BLOCKER_TEXT,
  zeroOrMore, isSellingMode, normalizeProduct, normalizeProducts,
  netPrice, batchTotals, costProduct, statusFor, sortByMargin,
  snapshotWorthTaking, productSnapshot,
} from '../js/foodcost/foodcost-model.js';

const AT = '2026-08-10T09:00:00.000Z';

// £2/kg flour, £8/kg butter, a box at 12p each, and a bag priced by WEIGHT (which
// cannot be counted in pieces).
const INGREDIENTS = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  BOX: { id: 'BOX', name: 'Cake box', priceUnit: 'pcs', pricePerUnit: 0.12 },
  BAGS: { id: 'BAGS', name: 'Paper bags', priceUnit: 'kg', pricePerUnit: 3 },
  UNPRICED: { id: 'UNPRICED', name: 'Ribbon' },
};

// £3.20 per 1000 g → £3.20/kg. No weight lost.
const DOUGH = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const UNPRICED_RECIPE = {
  id: 'MYSTERY', name: 'Mystery', lossPct: 0,
  ingredients: [{ label: 'Something', grams: 500, unit: 'g' }],
};
const TABLES = { ingredients: INGREDIENTS, recipes: { DOUGH, MYSTERY: UNPRICED_RECIPE } };

const product = (over = {}) => ({
  id: 'P1', name: 'Test product',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100,
  sellingPrice: 1.20, vatRate: 20, foodCostTarget: 30,
  ...over,
});

// ── VAT ──────────────────────────────────────────────────────────────────────

test('the food cost is worked out on the price WITHOUT VAT', () => {
  // £1.20 at 20% is £1.00 net. Leaving the VAT in would make every margin look
  // better than it is, by exactly the VAT rate.
  assert.equal(netPrice(1.2, 20), 1);
  assert.equal(netPrice(1.05, 5), 1);
});

test('zero-rated is a real answer, and leaves the price alone', () => {
  // Most takeaway bakery in the UK is zero-rated. Anything treating 0 as "not
  // filled in" would refuse to cost the bakery's main line.
  assert.equal(netPrice(1.2, 0), 1.2);
  assert.equal(zeroOrMore(0), 0);
  assert.equal(zeroOrMore(''), null);
  assert.equal(zeroOrMore(null), null);
  assert.equal(zeroOrMore(-1), null);
  assert.deepEqual([...VAT_RATES], [20, 5, 0]);
});

test('a missing price or rate produces no net price at all', () => {
  assert.equal(netPrice(null, 20), null);
  assert.equal(netPrice(1.2, null), null);
  assert.equal(netPrice(0, 20), null);
  assert.equal(netPrice('nonsense', 20), null);
});

// ── The batch ────────────────────────────────────────────────────────────────

test('a batch costs the sum of its recipes, and weighs what they weigh', () => {
  const out = batchTotals(product(), TABLES);
  assert.equal(out.cost, 32);   // 10 kg of £3.20/kg dough
  assert.equal(out.kg, 10);
  assert.equal(out.partial, false);
});

test('packaging adds cost but NOT weight', () => {
  // A box is not part of what is sold by the kilo. Counting it would make the
  // product look heavier and cheaper per kilo than it is.
  const out = batchTotals(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }] }), TABLES);
  assert.equal(out.cost, 44);   // 32 + 100 × £0.12
  assert.equal(out.kg, 10, 'the boxes must not add weight');
});

test('packaging priced by weight cannot be counted in pieces', () => {
  // "3 bags" of something bought per kilo means nothing, so it is left out and
  // named rather than guessed at.
  const out = batchTotals(product({ packaging: [{ ingredientId: 'BAGS', qtyPcs: 100 }] }), TABLES);
  assert.equal(out.cost, 32);
  assert.equal(out.partial, true);
  assert.equal(out.rows.at(-1).reason, 'no-piece-price');
});

test('an unpriced recipe is left out of the cost and named', () => {
  const out = batchTotals(product({
    components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'MYSTERY', qtyKg: 5 }],
  }), TABLES);
  assert.equal(out.cost, 32);
  assert.equal(out.kg, 10, 'an uncosted recipe must not add weight either');
  assert.equal(out.partial, true);
  assert.equal(out.rows[1].reason, 'no-recipe-cost');
});

test('a recipe that no longer exists is named, not skipped silently', () => {
  const out = batchTotals(product({ components: [{ recipeId: 'GONE', qtyKg: 1 }] }), TABLES);
  assert.equal(out.partial, true);
  assert.equal(out.rows[0].reason, 'missing-recipe');
});

test('a PARTLY priced recipe makes the product partly priced too', () => {
  const half = { id: 'HALF', name: 'Half', lossPct: 0, ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Mystery', grams: 500, unit: 'g' },
  ] };
  const out = batchTotals(product({ components: [{ recipeId: 'HALF', qtyKg: 1 }] }),
    { ingredients: INGREDIENTS, recipes: { HALF: half } });
  assert.ok(out.cost > 0);
  assert.equal(out.partial, true, 'the doubt must not vanish one level up');
});

// ── Sold by the piece ────────────────────────────────────────────────────────

test('sold by the piece: the batch is divided by what comes out of it', () => {
  // £32 over 100 pieces = £0.32 each, against £1.00 net → 32%.
  const out = costProduct(product(), TABLES);
  assert.equal(out.unitCost, 0.32);
  assert.equal(out.netUnitPrice, 1);
  assert.equal(out.foodCostPct, 32);
  assert.equal(out.margin, 0.68);
  assert.deepEqual(out.blockers, []);
});

test('sold by the piece, zero-rated: the gross price IS the net price', () => {
  const out = costProduct(product({ vatRate: 0 }), TABLES);
  assert.equal(out.netUnitPrice, 1.2);
  assert.equal(out.foodCostPct, 26.67);
});

// ── Sold by weight ───────────────────────────────────────────────────────────

test('sold by weight: the answer is the cost per kilo against the price per kilo', () => {
  // £32 over 10 kg = £3.20/kg, against £12.00 gross at 20% = £10.00 net → 32%.
  const out = costProduct(product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }), TABLES);
  assert.equal(out.unitCost, 3.2);
  assert.equal(out.netUnitPrice, 10);
  assert.equal(out.foodCostPct, 32);
});

test('sold by weight, the pieces-per-batch field is irrelevant and not required', () => {
  const out = costProduct(product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }), TABLES);
  assert.equal(out.blockers.includes('no-pieces'), false);
});

test('the weight lost by a recipe is already inside the price it contributes', () => {
  // A dough at 25% loss costs 4/3 as much per kilo of finished product, and the
  // product must inherit that without doing the arithmetic a second time.
  const baked = { ...DOUGH, id: 'BAKED', lossPct: 25 };
  const out = costProduct(product({ components: [{ recipeId: 'BAKED', qtyKg: 10 }] }),
    { ingredients: INGREDIENTS, recipes: { BAKED: baked } });
  assert.equal(out.unitCost, 0.4267);   // £3.20/0.75 = £4.2667/kg × 10 kg / 100
});

// ── What is missing ──────────────────────────────────────────────────────────

test('a product that cannot be costed says what to fill in, and shows no number', () => {
  const bare = costProduct({ id: 'P', name: 'New product' }, TABLES);
  assert.equal(bare.foodCostPct, null, 'never 0 — that reads as costing nothing');
  assert.ok(bare.blockers.includes('no-components'));
  assert.ok(bare.blockers.includes('no-selling-mode'));
  assert.ok(bare.blockers.includes('no-vat'));
  assert.ok(bare.blockers.includes('no-price'));
});

test('each blocker names one thing to go and do', () => {
  const cases = [
    [{ components: [] }, 'no-components'],
    [{ sellingMode: null }, 'no-selling-mode'],
    [{ sellingMode: 'piece', piecesPerBatch: null }, 'no-pieces'],
    [{ vatRate: null }, 'no-vat'],
    [{ sellingPrice: null }, 'no-price'],
  ];
  cases.forEach(([over, expected]) => {
    const out = costProduct(product(over), TABLES);
    assert.ok(out.blockers.includes(expected), `${expected} not raised for ${JSON.stringify(over)}`);
  });
  Object.keys(BLOCKER_TEXT).forEach(key => assert.ok(BLOCKER_TEXT[key].length > 10, key));
});

test('components that exist but cost nothing is its own reason', () => {
  // Not "no components" — they are there, they are simply unpriced, and telling
  // someone to add components they can see would be nonsense.
  const out = costProduct(product({ components: [{ recipeId: 'MYSTERY', qtyKg: 5 }] }), TABLES);
  assert.equal(out.blockers.includes('no-components'), false);
  assert.ok(out.blockers.includes('no-recipe-cost'));
});

test('sold by weight with no weight cannot be divided', () => {
  const out = costProduct(product({
    sellingMode: 'weight', sellingPrice: 12,
    components: [{ recipeId: 'DOUGH', qtyKg: 0 }],
    packaging: [{ ingredientId: 'BOX', qtyPcs: 10 }],
  }), TABLES);
  assert.ok(out.blockers.includes('no-weight'));
  assert.equal(out.foodCostPct, null);
});

// ── The traffic light ────────────────────────────────────────────────────────

test('green at or under the target, amber just over, red beyond', () => {
  assert.equal(statusFor(28, 30), 'green');
  assert.equal(statusFor(30, 30), 'green');
  assert.equal(statusFor(32, 30), 'amber');
  assert.equal(statusFor(33, 30), 'amber');       // exactly 30 × 1.1
  assert.equal(statusFor(33.01, 30), 'red');
  assert.equal(AMBER_MULTIPLIER, 1.1);
});

test('the amber band is proportional, so a low target is not stricter by accident', () => {
  assert.equal(statusFor(12.5, 12), 'amber');     // 12 → amber up to 13.2
  assert.equal(statusFor(36, 35), 'amber');       // 35 → amber up to 38.5
});

test('a product with no target has no colour, because nobody set a standard', () => {
  assert.equal(statusFor(32, null), null);
  assert.equal(statusFor(32, 0), null);
  assert.equal(costProduct(product({ foodCostTarget: null }), TABLES).status, null);
});

// ── The list ─────────────────────────────────────────────────────────────────

test('the worst margin comes first — that is why the screen is opened', () => {
  const products = [
    product({ id: 'A', name: 'Cheap', sellingPrice: 2.4 }),      // 16%
    product({ id: 'B', name: 'Dear', sellingPrice: 0.6 }),       // 64%
    product({ id: 'C', name: 'Middle', sellingPrice: 1.2 }),     // 32%
  ];
  const order = sortByMargin(products, TABLES).map(r => r.product.id);
  assert.deepEqual(order, ['B', 'C', 'A']);
});

test('products that cannot be costed sort LAST, not first', () => {
  // They are a data-entry job, not a margin problem. At the top they would bury
  // the answer the screen exists to give.
  const products = [
    { id: 'X', name: 'Half filled in' },
    product({ id: 'B', name: 'Dear', sellingPrice: 0.6 }),
  ];
  assert.deepEqual(sortByMargin(products, TABLES).map(r => r.product.id), ['B', 'X']);
});

test('sorting never throws on junk', () => {
  assert.deepEqual(sortByMargin(null), []);
  assert.equal(sortByMargin([null, undefined], TABLES).length, 2);
});

// ── Normalisation ────────────────────────────────────────────────────────────

test('missing values stay missing, never become zero', () => {
  // "No VAT rate chosen" and "zero-rated" are different answers, and only one of
  // them can be costed.
  const out = normalizeProduct({ id: 'P', name: ' Cake ' });
  assert.equal(out.name, 'Cake');
  assert.equal(out.vatRate, null);
  assert.equal(out.sellingPrice, null);
  assert.equal(out.sellingMode, null);
  assert.deepEqual(out.components, []);
});

test('a stored zero VAT rate survives normalisation', () => {
  assert.equal(normalizeProduct({ vatRate: 0 }).vatRate, 0);
});

test('junk rows are dropped rather than producing NaN', () => {
  const out = normalizeProduct({
    components: [{ recipeId: 'A', qtyKg: 'x' }, { qtyKg: 1 }, null, 'nonsense'],
    packaging: [{ ingredientId: 'B', qtyPcs: -3 }],
    sellingMode: 'nonsense',
  });
  assert.deepEqual(out.components, [{ recipeId: 'A', qtyKg: 0 }]);
  assert.deepEqual(out.packaging, [{ ingredientId: 'B', qtyPcs: 0 }]);
  assert.equal(out.sellingMode, null);
  assert.deepEqual([...SELLING_MODES], ['piece', 'weight']);
  assert.equal(isSellingMode('piece'), true);
  assert.equal(isSellingMode('pezzo'), false);
});

test('normalising a list drops what is not an object', () => {
  assert.equal(normalizeProducts([{ id: 'A' }, null, 5]).length, 1);
  assert.deepEqual(normalizeProducts('nonsense'), []);
});

test('costing never throws on missing tables', () => {
  assert.equal(costProduct(product()).foodCostPct, null);
  assert.equal(costProduct(null).foodCostPct, null);
  assert.equal(costProduct(product(), {}).foodCostPct, null);
});

// ── Snapshots ────────────────────────────────────────────────────────────────

test('the first save is a point on the series', () => {
  assert.equal(snapshotWorthTaking(null, product()), true);
});

test('a price change, a VAT change and a composition change are all recorded', () => {
  const before = product();
  assert.equal(snapshotWorthTaking(before, product({ sellingPrice: 1.4 })), true);
  assert.equal(snapshotWorthTaking(before, product({ vatRate: 0 })), true);
  assert.equal(snapshotWorthTaking(before, product({ piecesPerBatch: 90 })), true);
  assert.equal(snapshotWorthTaking(before, product({ sellingMode: 'weight' })), true);
  assert.equal(snapshotWorthTaking(before, product({
    components: [{ recipeId: 'DOUGH', qtyKg: 12 }],
  })), true);
  assert.equal(snapshotWorthTaking(before, product({
    packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }],
  })), true);
});

test('renaming a product records nothing', () => {
  // A history full of non-events cannot answer "when did this change?".
  assert.equal(snapshotWorthTaking(product(), product({ name: 'Renamed' })), false);
  assert.equal(snapshotWorthTaking(product(), product({ foodCostTarget: 25 })), false);
});

test('reordering the same components is not a change', () => {
  const a = product({ components: [{ recipeId: 'A', qtyKg: 1 }, { recipeId: 'B', qtyKg: 2 }] });
  const b = product({ components: [{ recipeId: 'B', qtyKg: 2 }, { recipeId: 'A', qtyKg: 1 }] });
  assert.equal(snapshotWorthTaking(a, b), false);
});

test('a snapshot freezes the VAT rate as well as the answer', () => {
  // Rates change by law. Without freezing it, every past margin would silently be
  // recomputed against today's rate and the series would stop being comparable.
  const result = costProduct(product(), TABLES);
  const snap = productSnapshot(product(), result, AT, TABLES);
  assert.equal(snap.vatRate, 20);
  assert.equal(snap.sellingPrice, 1.2);
  assert.equal(snap.foodCostPct, 32);
  assert.equal(snap.unitCost, 0.32);
  assert.equal(snap.recordedAt, AT);
});

test('a snapshot freezes the ingredient prices behind the answer, through the recipes', () => {
  // Two levels down: the product names a recipe, the recipe names the ingredients.
  // Without walking it, a change that came from inside a recipe could not be
  // explained six months later.
  const snap = productSnapshot(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] }),
    costProduct(product(), TABLES), AT, TABLES);
  assert.equal(snap.frozenPrices.FLOUR, 2);
  assert.equal(snap.frozenPrices.BUTTER, 8);
  assert.equal(snap.frozenPrices.BOX, 0.12);
});

test('freezing prices survives a recipe that contains itself', () => {
  const loop = { id: 'LOOP', name: 'Loop', lossPct: 0,
    ingredients: [{ label: 'Itself', grams: 100, unit: 'g', kind: 'recipe', refId: 'LOOP' }] };
  const snap = productSnapshot(product({ components: [{ recipeId: 'LOOP', qtyKg: 1 }] }),
    { unitCost: null, foodCostPct: null }, AT, { ingredients: INGREDIENTS, recipes: { LOOP: loop } });
  assert.deepEqual(snap.frozenPrices, {});
});
