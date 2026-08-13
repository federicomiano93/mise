// Unit tests for the order list one person sends to another (P15 — the owner
// cannot read code, so these tests are the safety net).
//
// What must never break:
//   - a row somebody left at 0 must NOT reach the manager's screen: it is a row
//     they decided not to order, and it could never be ticked off as bought;
//   - an EMPTY list must not be creatable — the whole feature is "somebody has
//     work to do", and a list with no work in it can only mislead;
//   - a list is finished when every line is ticked, and by NOTHING else: there is
//     no stored flag that could ever disagree with the ticks;
//   - the divergence warning must go quiet on a line that has been ticked, or
//     recording an order (which clears the rows) lights up every line with
//     "now 0" — an alarm that fires on success is one people stop reading;
//   - the window HIDES old lists and never drops them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LINES, REQUEST_WINDOW_DAYS,
  senderName, buildOrderRequest, isRequestDone, remainingIds, waitingRequests,
  groupRequest, supplierIdsOf, liveDifference, splitRequestsByAge,
} from '../js/orders/order-request-model.js';

const NOW = new Date('2026-08-14T09:00:00Z');

const SUPPLIERS = [
  { id: 's1', name: 'Caterite' },
  { id: 's2', name: 'Salvo' },
];

const INGREDIENTS = [
  { id: 'i1', name: 'Flour 00', weight: '25kg', supplierId: 's1', active: true },
  { id: 'i2', name: 'Butter', weight: '5kg', supplierId: 's1', active: true },
  { id: 'i3', name: 'Tinned tomato', weight: '', supplierId: 's2', active: true },
];

const FROM = { uid: 'u-emp', name: 'Marco Rossi' };

function build(entries, suppliers = SUPPLIERS, extra = {}) {
  return buildOrderRequest({
    suppliers, ingredients: INGREDIENTS, entries, date: '2026-08-14',
    from: FROM, now: NOW, ...extra,
  });
}

// ── Who sent it ──────────────────────────────────────────────────────────────

test('the sender is named, and NEVER by their raw uid', () => {
  assert.equal(senderName({ firstName: 'Marco', lastName: 'Rossi' }), 'Marco Rossi');
  assert.equal(senderName({ firstName: 'Marco' }), 'Marco');
  // Rows created before names existed have none — the address is better than nothing.
  assert.equal(senderName({}, 'marco@example.test'), 'marco@example.test');
  assert.equal(senderName(null, ''), 'Someone');
  // Whitespace is not a name.
  assert.equal(senderName({ firstName: '  ', lastName: ' ' }, 'a@b.test'), 'a@b.test');
});

// ── Freezing the list ────────────────────────────────────────────────────────

test('a row left at 0 does not reach the manager', () => {
  const req = build({ i1: { qty: 4 }, i2: { qty: 0, stock: 9 }, i3: { qty: 2 } });
  assert.deepEqual(Object.keys(req.quantities).sort(), ['i1', 'i3']);
  assert.equal(req.quantities.i2, undefined);
});

test('there is no such thing as an empty order list', () => {
  assert.equal(build({}), null);
  assert.equal(build({ i1: { qty: 0 } }), null);
  // Stock counted but nothing ordered is still nothing to order.
  assert.equal(build({ i1: { qty: 0, stock: 12 } }), null);
});

test('the names and the supplier are frozen onto the list', () => {
  const req = build({ i1: { qty: 4 }, i3: { qty: 2 } });
  assert.equal(req.names.i1, 'Flour 00 25kg');
  assert.equal(req.supplierOf.i1, 's1');
  assert.equal(req.supplierNames.s1, 'Caterite');
  assert.equal(req.supplierNames.s2, 'Salvo');
});

test('a supplier that contributed nothing is not named at all', () => {
  // Salvo was ticked, but its only row is at 0 — an empty heading on the
  // manager's screen would be a supplier to chase for nothing.
  const req = build({ i1: { qty: 4 }, i3: { qty: 0 } });
  assert.deepEqual(Object.keys(req.supplierNames), ['s1']);
  assert.equal(supplierIdsOf(req).length, 1);
});

test('the ticks start empty, and the stamps are the same instant', () => {
  const req = build({ i1: { qty: 4 } });
  assert.deepEqual(req.done, {});
  assert.equal(req.createdAt, req.updatedAt);
  assert.equal(req.fromUid, 'u-emp');
  assert.equal(req.fromName, 'Marco Rossi');
});

test('a quantity is made whole and safe, exactly as the archive does', () => {
  const req = build({ i1: { qty: '4.6' }, i2: { qty: 1e999 }, i3: { qty: -3 } });
  assert.equal(req.quantities.i1, 5);
  // Infinity is refused rather than stored — Firestore cannot hold it, and every
  // later save would fail while the row still looked perfectly normal on screen.
  assert.equal(Object.prototype.hasOwnProperty.call(req.quantities, 'i2'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(req.quantities, 'i3'), false);
});

test('a list longer than the cap is refused here, not by a bare permission error', () => {
  const many = [];
  const entries = {};
  for (let n = 0; n <= MAX_LINES; n += 1) {
    many.push({ id: `x${n}`, name: `Item ${n}`, supplierId: 's1', active: true });
    entries[`x${n}`] = { qty: 1 };
  }
  const req = buildOrderRequest({
    suppliers: [SUPPLIERS[0]], ingredients: many, entries,
    date: '2026-08-14', from: FROM, now: NOW,
  });
  assert.equal(req, null);
});

test('the ingredients ordered without a supplier are not lost', () => {
  const ings = [{ id: 'n1', name: 'Cling film', supplierId: 'no-supplier', active: true }];
  const req = buildOrderRequest({
    suppliers: [{ id: 'no-supplier', name: 'No supplier' }], ingredients: ings,
    entries: { n1: { qty: 2 } }, date: '2026-08-14', from: FROM, now: NOW,
  });
  assert.equal(req.quantities.n1, 2);
  assert.equal(req.supplierOf.n1, 'no-supplier');
});

test('a note is trimmed and capped; no note is an empty string', () => {
  assert.equal(build({ i1: { qty: 1 } }).note, '');
  assert.equal(build({ i1: { qty: 1 } }, SUPPLIERS, { note: '  urgent  ' }).note, 'urgent');
  assert.equal(build({ i1: { qty: 1 } }, SUPPLIERS, { note: 'x'.repeat(900) }).note.length, 500);
});

// ── Finished, and nothing else decides it ────────────────────────────────────

test('a list is finished only when every line is ticked', () => {
  const req = build({ i1: { qty: 4 }, i3: { qty: 2 } });
  assert.equal(isRequestDone(req), false);
  assert.equal(isRequestDone({ ...req, done: { i1: true } }), false);
  assert.equal(isRequestDone({ ...req, done: { i1: true, i3: true } }), true);
});

test('a tick that is not exactly true does not count', () => {
  const req = build({ i1: { qty: 4 } });
  assert.equal(isRequestDone({ ...req, done: { i1: 'yes' } }), false);
  assert.equal(isRequestDone({ ...req, done: { i1: 1 } }), false);
  assert.equal(isRequestDone({ ...req, done: { i1: false } }), false);
});

test('a tick left behind on a line that is gone cannot finish a list', () => {
  const req = build({ i1: { qty: 4 }, i3: { qty: 2 } });
  assert.equal(isRequestDone({ ...req, done: { i1: true, ghost: true } }), false);
});

test('an impossible empty list reads as finished rather than jamming the banner', () => {
  // Nothing can create one (buildOrderRequest refuses, and so do the rules). If one
  // ever existed, "unfinished" would be a banner with no line to tick and no way
  // out; "finished" merely means it stays quiet.
  assert.equal(isRequestDone({ quantities: {}, done: {} }), true);
});

test('what is left is what Finish would tick', () => {
  const req = { quantities: { a: 1, b: 2, c: 3 }, done: { b: true } };
  assert.deepEqual(remainingIds(req).sort(), ['a', 'c']);
  assert.deepEqual(remainingIds({ quantities: { a: 1 }, done: { a: true } }), []);
});

test('only unfinished lists are waiting, newest first', () => {
  const list = [
    { createdAt: '2026-08-12T08:00:00Z', quantities: { a: 1 }, done: {} },
    { createdAt: '2026-08-14T08:00:00Z', quantities: { b: 1 }, done: {} },
    { createdAt: '2026-08-13T08:00:00Z', quantities: { c: 1 }, done: { c: true } },
  ];
  const waiting = waitingRequests(list);
  assert.equal(waiting.length, 2);
  assert.equal(waiting[0].createdAt, '2026-08-14T08:00:00Z');
  assert.deepEqual(waitingRequests([]), []);
});

// ── What the screen draws ────────────────────────────────────────────────────

test('the list is regrouped under its suppliers, with a count each', () => {
  const req = { ...build({ i1: { qty: 4 }, i2: { qty: 1 }, i3: { qty: 2 } }), done: { i1: true } };
  const groups = groupRequest(req, {});
  const caterite = groups.find(g => g.supplierId === 's1');
  assert.equal(caterite.supplierName, 'Caterite');
  assert.equal(caterite.total, 2);
  assert.equal(caterite.doneCount, 1);
  assert.equal(groups.find(g => g.supplierId === 's2').total, 1);
});

test('a renamed ingredient shows its NEW name; a deleted one keeps the frozen one', () => {
  const req = build({ i1: { qty: 4 }, i2: { qty: 1 } });
  const live = { i1: { id: 'i1', name: 'Strong flour', weight: '25kg' } };
  const items = groupRequest(req, live).find(g => g.supplierId === 's1').items;
  assert.equal(items.find(i => i.id === 'i1').name, 'Strong flour 25kg');
  // i2 is gone from the live list — the frozen label is all that stands between
  // the manager and a row of raw document ids.
  assert.equal(items.find(i => i.id === 'i2').name, 'Butter 5kg');
});

test('a line whose supplier was never named is still drawn', () => {
  const req = {
    quantities: { orphan: 3 }, names: { orphan: 'Yeast 500g' },
    supplierOf: {}, supplierNames: {}, done: {},
  };
  const groups = groupRequest(req, {});
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items[0].name, 'Yeast 500g');
});

// ── The photograph, against the list that moved on ───────────────────────────

test('a quantity changed since the list was sent is reported', () => {
  const req = build({ i1: { qty: 4 }, i3: { qty: 2 } });
  const diff = liveDifference(req, { i1: { qty: 6 }, i3: { qty: 2 } });
  assert.deepEqual(diff, { i1: 6 });
});

test('a row cleared out of the shared order reads as 0, not as absent', () => {
  const req = build({ i1: { qty: 4 } });
  assert.deepEqual(liveDifference(req, {}), { i1: 0 });
});

test('a TICKED line never warns — recording an order clears its row', () => {
  const req = { ...build({ i1: { qty: 4 }, i3: { qty: 2 } }), done: { i1: true } };
  // i1 was ordered and its row cleared: live is 0, and saying so would be an
  // alarm that fires the moment somebody does the right thing.
  assert.deepEqual(liveDifference(req, { i3: { qty: 2 } }), {});
});

// ── The window ───────────────────────────────────────────────────────────────

test('the window hides old lists and hands them back, never drops them', () => {
  const now = new Date('2026-08-14T09:00:00Z');
  // 15 days back from the 14th makes the 31st of July the oldest day still drawn.
  const list = [
    { date: '2026-08-14' }, { date: '2026-07-01' }, { date: '2026-07-31' },
    { date: '2026-07-30' },
  ];
  const { recent, older } = splitRequestsByAge(list, REQUEST_WINDOW_DAYS, now);
  assert.equal(recent.length + older.length, list.length, 'nothing may be dropped');
  assert.deepEqual(recent.map(r => r.date), ['2026-08-14', '2026-07-31']);
  assert.deepEqual(older.map(r => r.date), ['2026-07-01', '2026-07-30']);
});

test('a nonsense window shows everything rather than hiding everything', () => {
  const list = [{ date: '2020-01-01' }];
  assert.deepEqual(splitRequestsByAge(list, 0).recent, list);
  assert.deepEqual(splitRequestsByAge(list, NaN).recent, list);
  assert.deepEqual(splitRequestsByAge(list, undefined, new Date('2026-08-14')).older, list);
});
