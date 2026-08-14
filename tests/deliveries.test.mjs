// What has been ordered and has not arrived, and what is still to re-order.
//
// ⚠️ THE TESTS THAT MATTER MOST ARE THE ONES ABOUT WHAT MUST NOT DISAPPEAR. An order
// that never turned up is the single most important row this feature draws, and every
// cheap version of this design loses it: a window swallows it, a derived "it must
// have arrived by now" hides it, a tidy-up deletes it. Each of those has a test below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AHEAD_DAYS, isDelivered, shortfall, expectedDeliveryOn,
  pendingDeliveries, stillToReorder, applyReorder, unansweredBefore,
} from '../js/orders/deliveries.js';

// 2026-08-14 is a Friday.
const TODAY = '2026-08-14';

const SUPPLIERS = {
  weekly: { id: 'weekly', name: 'Weekly Co', deliveryDays: ['Monday', 'Thursday'] },
  noDays: { id: 'noDays', name: 'Unset Co', deliveryDays: [] },
};

const order = (over = {}) => ({
  supplierId: 'weekly',
  date: '2026-08-10',
  quantities: { flour: 10, butter: 4 },
  ...over,
});

const ids = list => list.map(e => e.order.date + '/' + e.order.supplierId);

// ── ⚠️ NOTHING THAT NEVER ARRIVED MAY DISAPPEAR ──────────────────────────────

// ⚠️⚠️ THIS TEST USED TO ASSERT THE OPPOSITE, AND THE CHANGE IS THE POINT. It said an
// order three weeks overdue must still be in the list; since 14 Aug the list is the
// CURRENT WEEK, because in the real venue that rule put 34 stale orders on screen, all
// marked late. What replaced it is not "the old one is gone" but "the old one MOVED" —
// out of the daily list and into the debt, which is the half that keeps the promise.
test('⚠️ an order from weeks ago LEAVES the list — and lands in the debt, not in nothing', () => {
  const ancient = order({ date: '2026-07-06' });
  const soon = order({ date: '2026-08-13' });             // Thursday of this week
  const out = pendingDeliveries([soon, ancient], SUPPLIERS, TODAY);

  assert.equal(out.late.length, 0, 'no longer cluttering the daily list');
  assert.deepEqual(ids(out.coming), ['2026-08-13/weekly']);

  assert.deepEqual(unansweredBefore([soon, ancient], TODAY).map(o => o.date), ['2026-07-06'],
    'and it is owed an answer — the week does not expire in silence');
});

// ⚠️ THE HALF THAT KEEPS THE PROMISE. A strict week window on its own makes an order
// that never arrived vanish, unanswered, on the day the week turns — exactly the
// control Federico said he must not lose.
test('⚠️ the debt is oldest first, and a confirmed order is never in it', () => {
  const old1 = order({ date: '2026-07-06' });
  const old2 = order({ date: '2026-07-20' });
  const done = order({ date: '2026-07-13', deliveredAt: '2026-07-15' });
  assert.deepEqual(unansweredBefore([old2, done, old1], TODAY).map(o => o.date),
    ['2026-07-06', '2026-07-20']);
});

test('this week is never in the debt, and neither is a legacy weekly record', () => {
  const thisWeek = order({ date: '2026-08-13' });
  const legacy = { weekStart: '2026-07-06', quantities: { flour: 5 } };
  assert.deepEqual(unansweredBefore([thisWeek, legacy], TODAY), []);
  assert.deepEqual(unansweredBefore(null, TODAY), []);
  assert.deepEqual(unansweredBefore([thisWeek], ''), []);
});

// ⚠️ The setting moves BOTH halves at once, or one would quietly disagree with the
// other about which week an order is in.
test('⚠️ a Monday start moves the window and the debt together', () => {
  const sunday = order({ date: '2026-08-09' });   // this week only if weeks start Sunday
  const asSunday = pendingDeliveries([sunday], SUPPLIERS, TODAY, { weekStartsOn: 'Sunday' });
  const asMonday = pendingDeliveries([sunday], SUPPLIERS, TODAY, { weekStartsOn: 'Monday' });
  const count = o => o.late.length + o.dueToday.length + o.coming.length;

  assert.equal(count(asSunday), 1);
  assert.equal(count(asMonday), 0);
  assert.deepEqual(unansweredBefore([sunday], TODAY, { weekStartsOn: 'Monday' }).map(o => o.date),
    ['2026-08-09'], 'what left the list is owed an answer, never dropped');
  assert.deepEqual(unansweredBefore([sunday], TODAY, { weekStartsOn: 'Sunday' }), []);
});

// ⚠️ AN UNREADABLE STAMP MEANS "NOT DELIVERED", never "delivered". A corrupt value
// must leave the order visible and correctable, not make it vanish.
test('⚠️ only a real stamp counts as delivered; anything odd stays pending', () => {
  assert.equal(isDelivered({ deliveredAt: '2026-08-14' }), true);
  assert.equal(isDelivered({ deliveredAt: '' }), false);
  assert.equal(isDelivered({ deliveredAt: '   ' }), false);
  assert.equal(isDelivered({ deliveredAt: null }), false);
  assert.equal(isDelivered({ deliveredAt: 12345 }), false, 'a number is not a confirmation');
  assert.equal(isDelivered({}), false);
  assert.equal(isDelivered(null), false);
});

test('a confirmed order leaves the list', () => {
  const out = pendingDeliveries([order({ deliveredAt: '2026-08-12' })], SUPPLIERS, TODAY);
  assert.deepEqual([...out.late, ...out.dueToday, ...out.coming], []);
});

// ⚠️ NOT KNOWING WHEN IT COMES IS NOT THE SAME AS IT NOT COMING. A supplier nobody
// has finished setting up must not have its orders quietly hidden.
test('⚠️ a supplier with no delivery days is shown, never hidden, and never "late"', () => {
  const out = pendingDeliveries([order({ supplierId: 'noDays' })], SUPPLIERS, TODAY);
  assert.equal(out.late.length, 0, 'we do not know it is late');
  assert.equal(out.coming.length, 1);
  assert.equal(out.coming[0].expected, '');
});

test('an order whose supplier has been deleted is still shown', () => {
  const out = pendingDeliveries([order({ supplierId: 'gone' })], SUPPLIERS, TODAY);
  assert.equal(out.coming.length, 1);
  assert.equal(out.coming[0].supplier, null);
});

// ⚠️ The pre-v179 weekly records merged every supplier into one document, so they
// cannot name a delivery. They stay readable in History.
test('legacy weekly records are not deliveries', () => {
  const legacy = { weekStart: '2026-07-06', quantities: { flour: 5 } };
  const out = pendingDeliveries([legacy], SUPPLIERS, TODAY);
  assert.deepEqual([...out.late, ...out.dueToday, ...out.coming], []);
});

// ── When a delivery is expected ──────────────────────────────────────────────

// ⚠️ STRICTLY AFTER. What is on today's van was decided before today's order existed.
test('⚠️ ordering on a delivery day means the NEXT one, not today', () => {
  // 2026-08-10 is a Monday, and Monday is a delivery day.
  assert.equal(expectedDeliveryOn(order({ date: '2026-08-10' }), SUPPLIERS.weekly), '2026-08-13');
});

test('the next declared day after the order', () => {
  assert.equal(expectedDeliveryOn(order({ date: '2026-08-11' }), SUPPLIERS.weekly), '2026-08-13');
  assert.equal(expectedDeliveryOn(order({ date: '2026-08-14' }), SUPPLIERS.weekly), '2026-08-17');
});

test('no days declared, no date invented', () => {
  assert.equal(expectedDeliveryOn(order(), SUPPLIERS.noDays), '');
  assert.equal(expectedDeliveryOn(order(), null), '');
  assert.equal(expectedDeliveryOn(null, SUPPLIERS.weekly), '');
});

test('due today lands in its own group', () => {
  // 2026-08-14 is a Friday; expected Monday 17th from an order on the 14th, so use
  // an order on the 10th (Mon) -> Thu 13th... take one that lands exactly on today.
  const s = { deliveryDays: ['Friday'] };
  const out = pendingDeliveries([order({ date: '2026-08-11', supplierId: 'fri' })],
    { fri: s }, TODAY);
  assert.equal(out.dueToday.length, 1);
  assert.equal(out.dueToday[0].expected, TODAY);
});

test('the horizon is a week, and it is exported so the screen cannot disagree', () => {
  assert.equal(AHEAD_DAYS, 7);
});

// ── What did not arrive ──────────────────────────────────────────────────────

// ⚠️ A `missing` entry for something the order never contained is meaningless, and
// would put a row on the re-order list that no amount of ordering could ever clear.
test('⚠️ shortfall counts only what was actually ordered', () => {
  const o = order({ missing: { flour: true, ghost: true, butter: false } });
  assert.deepEqual(shortfall(o), ['flour']);
});

test('no missing map at all is not a shortfall', () => {
  assert.deepEqual(shortfall(order()), []);
  assert.deepEqual(shortfall(null), []);
});

// ── The re-order list, derived ───────────────────────────────────────────────

const missed = over => order({
  date: '2026-08-10',
  quantities: { flour: 10 },
  missing: { flour: true },
  deliveredAt: '2026-08-13',
  ...over,
});

test('an ingredient that did not arrive is still to re-order', () => {
  const out = stillToReorder([missed()], {});
  assert.deepEqual(out, [{ id: 'flour', supplierId: 'weekly', qty: 10, missedOn: '2026-08-10' }]);
});

test('…and drops off once a LATER order to that supplier asks for it again', () => {
  const later = order({ date: '2026-08-12', quantities: { flour: 10 }, deliveredAt: '' });
  assert.deepEqual(stillToReorder([missed(), later], {}), []);
});

// ⚠️ An EARLIER order does not count — it happened before the thing went missing.
test('an earlier order does not clear it', () => {
  const earlier = order({ date: '2026-08-01', quantities: { flour: 10 } });
  assert.equal(stillToReorder([missed(), earlier], {}).length, 1);
});

test('another supplier ordering the same ingredient does not clear it', () => {
  const other = order({ date: '2026-08-12', supplierId: 'noDays', quantities: { flour: 10 } });
  assert.equal(stillToReorder([missed(), other], {}).length, 1);
});

// ⚠️ THIS IS WHY THE BANNER GOES QUIET AS SOON AS THE WORK IS DONE, rather than when
// the order is finally placed. A reminder that survives the action it asked for is
// one people learn to ignore.
test('⚠️ it clears the moment the ingredient is in the order being typed', () => {
  assert.deepEqual(stillToReorder([missed()], { flour: { qty: 6 } }), []);
  assert.equal(stillToReorder([missed()], { flour: { qty: 0 } }).length, 1, '0 is not typed');
});

test('missing twice in a row keeps the newer entry only', () => {
  const first = missed({ date: '2026-08-03' });
  const second = missed({ date: '2026-08-10' });
  const out = stillToReorder([first, second], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].missedOn, '2026-08-10', 'the newer one survives, the older was re-ordered');
});

test('newest first, ties broken so two repaints never swap rows', () => {
  const a = missed({ date: '2026-08-03', quantities: { apple: 1 }, missing: { apple: true } });
  const b = missed({ date: '2026-08-03', quantities: { beet: 1 }, missing: { beet: true },
    supplierId: 'noDays' });
  const c = missed({ date: '2026-08-11', quantities: { cream: 1 }, missing: { cream: true },
    supplierId: 'third' });
  assert.deepEqual(stillToReorder([a, b, c], {}).map(x => x.id), ['cream', 'apple', 'beet']);
});

test('nothing at all is answered with nothing, not a throw', () => {
  assert.deepEqual(stillToReorder(null, null), []);
  assert.deepEqual(stillToReorder([], {}), []);
  const out = pendingDeliveries(null, null, TODAY);
  assert.deepEqual([...out.late, ...out.dueToday, ...out.coming], []);
  assert.deepEqual(pendingDeliveries([order()], SUPPLIERS, '').late, []);
});

// ── ⚠️ PUTTING IT BACK MUST NOT TOUCH SOMEBODY ELSE'S TYPING ─────────────────

// ⚠️ THE ORDER IS SHARED AND LIVE. A number already there was typed by a person,
// possibly seconds ago on another phone. Replacing it changes their order under their
// hands, silently.
test('⚠️ a row that already has a quantity is never overwritten — and the skip is reported', () => {
  const items = [{ id: 'flour', qty: 10 }, { id: 'butter', qty: 4 }];
  const { applied, skipped } = applyReorder(items, { flour: { qty: 3 } });

  assert.deepEqual(applied, [{ id: 'butter', qty: 4 }]);
  assert.deepEqual(skipped, [{ id: 'flour', qty: 10, existing: 3 }],
    'the screen must be able to SAY it skipped one');
});

test('an empty or zero row is filled', () => {
  const { applied, skipped } = applyReorder([{ id: 'flour', qty: 10 }], { flour: { qty: 0 } });
  assert.deepEqual(applied, [{ id: 'flour', qty: 10 }]);
  assert.deepEqual(skipped, []);
});

test('junk in, no throw out', () => {
  assert.deepEqual(applyReorder(null, null), { applied: [], skipped: [] });
  assert.deepEqual(applyReorder([null, {}], {}), { applied: [], skipped: [] });
});

// ── ⚠️ THE GUARANTEE THAT KEEPS THE SUGGESTIONS UNTOUCHED ────────────────────

// ⚠️ `orders-history.quantities` is the map the suggestion engine averages over.
// Nothing in this module may write to the records it is handed — if it did, marking a
// delivery would quietly change what the app suggests for months.
test('⚠️ nothing here mutates the orders it is given', () => {
  const record = missed();
  const before = JSON.stringify(record);
  stillToReorder([record], {});
  shortfall(record);
  pendingDeliveries([record], SUPPLIERS, TODAY);
  expectedDeliveryOn(record, SUPPLIERS.weekly);
  assert.equal(JSON.stringify(record), before, 'the record must come back untouched');
});
