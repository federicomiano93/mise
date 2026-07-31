// Unit tests for the Orders suggestion engine (P15 — the owner cannot read code,
// so these tests are the safety net). The rule (per Federico):
//   par        = average, over the recent ORDERS of that ingredient, of
//                (stock on hand + quantity ordered)
//   suggestion = round(par − current stock), floored at 0
// Hidden until 4 orders exist for that ingredient; the average uses at most the 8
// most recent. A bug here would suggest the wrong amount to order.
//
// The window counts ORDERS, not weeks: an order is one day and one supplier, and
// Caterite is ordered almost daily while Salvo is ordered on Mondays. Records
// written by the old weekly model (no `date`, only `weekStart`, every supplier
// merged) still count as one order each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSuggestion, isUnusualQuantity, unusualQuantities, UNUSUAL_FACTOR, UNUSUAL_MARGIN,
} from '../js/orders/suggestions.js';

// One order of `id`: ordered `qty`, had `stock` on hand, placed on `date`.
const order = (date, id, qty, stock) => ({
  date,
  supplierId: 'salvo',
  quantities: { [id]: qty },
  stock: { [id]: stock },
});

// A record from the old weekly model: no date, no supplierId.
const legacyWeek = (weekStart, id, qty, stock) => ({
  weekStart,
  quantities: { [id]: qty },
  stock: { [id]: stock },
});

test('stays inactive with fewer than 4 orders, counting down', () => {
  const history = [
    order('2026-07-06', 'flour', 10, 2),
    order('2026-07-07', 'flour', 10, 2),
    order('2026-07-08', 'flour', 10, 2),
  ];
  assert.deepEqual(computeSuggestion('flour', 5, history), { active: false, ordersRemaining: 1 });
});

test('with no history at all it needs the full 4 orders', () => {
  assert.deepEqual(computeSuggestion('flour', 5, []), { active: false, ordersRemaining: 4 });
  assert.deepEqual(computeSuggestion('flour', 5, null), { active: false, ordersRemaining: 4 });
});

test('par is the average of (stock + ordered); suggestion tops up to par', () => {
  // Four orders, each level = 10 ordered + 2 stock = 12 → par 12.
  const history = [
    order('2026-07-06', 'flour', 10, 2),
    order('2026-07-13', 'flour', 10, 2),
    order('2026-07-20', 'flour', 10, 2),
    order('2026-07-27', 'flour', 10, 2),
  ];
  // Current stock 5 → order round(12 − 5) = 7.
  assert.deepEqual(computeSuggestion('flour', 5, history), { active: true, suggestion: 7, par: 12 });
});

test('the average uses only the 8 most recent orders', () => {
  const history = [];
  // The oldest order is a huge outlier that must be ignored once 8 newer ones exist.
  history.push(order('2026-05-01', 'flour', 1000, 0));
  for (let d = 1; d <= 8; d++) {
    history.push(order(`2026-07-${String(d).padStart(2, '0')}`, 'flour', 10, 0));
  }
  assert.deepEqual(computeSuggestion('flour', 0, history), { active: true, suggestion: 10, par: 10 });
});

test('orders that did not include this ingredient are not counted toward the minimum', () => {
  const history = [
    order('2026-07-06', 'flour', 10, 0),
    order('2026-07-07', 'flour', 10, 0),
    order('2026-07-08', 'flour', 10, 0),
    // An order for a different ingredient — invisible to "flour".
    order('2026-07-09', 'yeast', 5, 1),
  ];
  assert.deepEqual(computeSuggestion('flour', 0, history), { active: false, ordersRemaining: 1 });
});

test('a stock reading with nothing ordered does NOT count as an order', () => {
  // The guard rail against the par ratchet: a day the shelf was full records the
  // stock but no quantity, so `quantities` has no entry for it. Counting it would
  // feed back a level of (high stock + 0) with no downward pull, and par would
  // climb every slow week, for ever. See archive.js buildSupplierArchive.
  const history = [
    order('2026-07-06', 'flour', 10, 0),
    order('2026-07-07', 'flour', 10, 0),
    order('2026-07-08', 'flour', 10, 0),
    { date: '2026-07-09', supplierId: 'salvo', quantities: {}, stock: { flour: 40 } },
  ];
  assert.deepEqual(computeSuggestion('flour', 0, history), { active: false, ordersRemaining: 1 });
});

test('suggestion never goes negative: plenty of stock means order nothing', () => {
  const history = [
    order('2026-07-06', 'flour', 10, 2),
    order('2026-07-13', 'flour', 10, 2),
    order('2026-07-20', 'flour', 10, 2),
    order('2026-07-27', 'flour', 10, 2),
  ];
  // par 12 but 100 already in stock → order 0, not −88.
  assert.deepEqual(computeSuggestion('flour', 100, history), { active: true, suggestion: 0, par: 12 });
});

test('a junk current-stock value is treated as zero, never NaN', () => {
  const history = [
    order('2026-07-06', 'flour', 10, 0),
    order('2026-07-13', 'flour', 10, 0),
    order('2026-07-20', 'flour', 10, 0),
    order('2026-07-27', 'flour', 10, 0),
  ];
  const result = computeSuggestion('flour', 'abc', history);
  assert.equal(result.active, true);
  assert.equal(result.suggestion, 10); // round(par 10 − 0)
  assert.ok(Number.isFinite(result.suggestion));
});

test('a missing stock map defaults an order to ordered-only', () => {
  const history = [
    { date: '2026-07-06', supplierId: 's', quantities: { flour: 8 } },
    { date: '2026-07-13', supplierId: 's', quantities: { flour: 8 } },
    { date: '2026-07-20', supplierId: 's', quantities: { flour: 8 } },
    { date: '2026-07-27', supplierId: 's', quantities: { flour: 8 } },
  ];
  assert.deepEqual(computeSuggestion('flour', 0, history), { active: true, suggestion: 8, par: 8 });
});

test('old weekly records and new daily ones mix, and sort together correctly', () => {
  // The real production data: one legacy weekly record from before the change,
  // then daily per-supplier ones. The legacy record is the OLDEST here, so once 8
  // newer orders exist it drops out of the window — but until then it counts.
  const history = [
    legacyWeek('2026-07-06', 'flour', 20, 0),   // legacy: level 20
    order('2026-07-13', 'flour', 10, 0),
    order('2026-07-20', 'flour', 10, 0),
    order('2026-07-27', 'flour', 10, 0),
  ];
  // par = (20 + 10 + 10 + 10) / 4 = 12.5 → 13 after rounding the suggestion.
  assert.deepEqual(computeSuggestion('flour', 0, history), { active: true, suggestion: 13, par: 13 });
});

// ── Corrupt stored data must never reach the screen ──────────────────────────
// Firestore rules cannot check the VALUES inside a map (rules v2 has no way to
// iterate one, and enumerating every allowed number would reject a legitimately
// large order). So the engine is the place that stops trusting what it reads.
// Without the guard, `qty + stock` CONCATENATES a string instead of adding, par
// becomes NaN, and the app offers "Suggested: NaN".

test('a junk string in a stored quantity never produces NaN', () => {
  const history = [
    order('2026-07-01', 'flour', 10, 0),
    order('2026-07-02', 'flour', 10, 0),
    order('2026-07-03', 'flour', 10, 0),
    { date: '2026-07-04', supplierId: 's', quantities: { flour: 'HELLO' }, stock: { flour: 0 } },
  ];
  const result = computeSuggestion('flour', 0, history);
  assert.ok(Number.isFinite(result.suggestion), 'suggestion must be a real number');
  assert.ok(Number.isFinite(result.par), 'par must be a real number');
  // The junk order counts as a level of 0: (10 + 10 + 10 + 0) / 4 = 7.5 → 8.
  assert.deepEqual(result, { active: true, suggestion: 8, par: 8 });
});

test('Infinity, null and a negative quantity are all treated as zero', () => {
  const history = [
    order('2026-07-01', 'flour', 12, 0),
    order('2026-07-02', 'flour', 12, 0),
    { date: '2026-07-03', supplierId: 's', quantities: { flour: Infinity }, stock: { flour: 0 } },
    { date: '2026-07-04', supplierId: 's', quantities: { flour: -50 }, stock: { flour: null } },
  ];
  const result = computeSuggestion('flour', 0, history);
  assert.ok(Number.isFinite(result.suggestion));
  // (12 + 12 + 0 + 0) / 4 = 6.
  assert.deepEqual(result, { active: true, suggestion: 6, par: 6 });
});

test('a junk CURRENT stock reading cannot produce NaN either', () => {
  const history = [
    order('2026-07-01', 'flour', 10, 0),
    order('2026-07-02', 'flour', 10, 0),
    order('2026-07-03', 'flour', 10, 0),
    order('2026-07-04', 'flour', 10, 0),
  ];
  for (const junk of ['abc', NaN, Infinity, -5, null, undefined, {}]) {
    const result = computeSuggestion('flour', junk, history);
    assert.ok(Number.isFinite(result.suggestion), `suggestion must survive ${String(junk)}`);
    assert.equal(result.suggestion, 10, `${String(junk)} must read as zero stock`);
  }
});

// ── Catching a slip of the finger ────────────────────────────────────────────
//
// The mistake is 300 typed where 30 was meant. An upper limit cannot catch it: any
// cap high enough for a real bulk order lets 300 through. So the test is against
// what this ingredient is USUALLY ordered in.
//
// What must never break:
//   * a tenfold typo is always caught (that is the whole point);
//   * an ordinary busy week is NOT flagged — a warning that cries wolf gets tapped
//     through, and then it protects nothing;
//   * an ingredient with no history is silent rather than guessing.

test('a tenfold typo is flagged at every scale', () => {
  [[8, 80], [30, 300], [2, 20], [50, 500]].forEach(([usual, typo]) => {
    assert.equal(isUnusualQuantity(typo, usual), true, `${typo} against a usual ${usual}`);
  });
});

test('ordering the usual amount, or a bit more, is never flagged', () => {
  [[8, 8], [8, 10], [8, 16], [30, 45], [30, 60], [2, 5]].forEach(([usual, qty]) => {
    assert.equal(isUnusualQuantity(qty, usual), false, `${qty} against a usual ${usual}`);
  });
});

test('a small usual amount needs a real jump, not just a multiple', () => {
  // Usually 1: four of them is a Saturday, not a mistake. The absolute margin is
  // what stops this warning from firing constantly on small-volume ingredients.
  assert.equal(isUnusualQuantity(4, 1), false);
  assert.equal(isUnusualQuantity(10, 1), false);
  assert.equal(isUnusualQuantity(11, 1), true);
  assert.equal(UNUSUAL_MARGIN, 10);
  assert.equal(UNUSUAL_FACTOR, 4);
});

test('no usual amount yet means no warning', () => {
  // Fewer than 4 past orders: there is nothing honest to compare against.
  assert.equal(isUnusualQuantity(300, 0), false);
  assert.equal(isUnusualQuantity(300, null), false);
  assert.equal(isUnusualQuantity(300, undefined), false);
});

test('junk in either argument is silent, never a crash or a false alarm', () => {
  ['abc', NaN, Infinity, -5, null, undefined, {}, []].forEach(bad => {
    assert.equal(isUnusualQuantity(bad, 8), false, `qty ${JSON.stringify(bad)}`);
    assert.equal(isUnusualQuantity(80, bad), false, `par ${JSON.stringify(bad)}`);
  });
});

// ── The rows of one order ────────────────────────────────────────────────────

const ING = [
  { id: 'flour', name: 'Flour 25kg' },
  { id: 'milk', name: 'Milk 6x1L' },
  { id: 'new', name: 'New thing' },
];
// The par each ingredient is usually ordered in; `new` has no history yet.
const suggest = id => ({
  flour: { active: true, par: 8 },
  milk: { active: true, par: 30 },
  new: { active: false },
}[id] || { active: false });

test('only the rows that look wrong are reported, worst first', () => {
  const entries = {
    flour: { qty: 80 },   // 10x the usual 8
    milk: { qty: 45 },    // busy week, not a typo
    new: { qty: 999 },    // no history — cannot judge
  };
  const found = unusualQuantities(ING, entries, suggest);
  assert.deepEqual(found.map(r => r.id), ['flour']);
  assert.deepEqual(found[0], { id: 'flour', name: 'Flour 25kg', qty: 80, usual: 8 });
});

test('several suspicious rows come back with the biggest surprise first', () => {
  const entries = { flour: { qty: 40 }, milk: { qty: 900 } };  // 5x and 30x
  assert.deepEqual(
    unusualQuantities(ING, entries, suggest).map(r => r.id),
    ['milk', 'flour'],
  );
});

test('an order with nothing odd in it reports nothing', () => {
  assert.deepEqual(unusualQuantities(ING, { flour: { qty: 8 }, milk: { qty: 30 } }, suggest), []);
  assert.deepEqual(unusualQuantities(ING, {}, suggest), []);
  assert.deepEqual(unusualQuantities([], {}, suggest), []);
  assert.deepEqual(unusualQuantities(null, null, suggest), []);
});

test('a row left at zero is not an order and is never flagged', () => {
  assert.deepEqual(unusualQuantities(ING, { flour: { qty: 0 } }, suggest), []);
});
