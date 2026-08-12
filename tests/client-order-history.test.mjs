// Unit tests for the client-order history (P15).
//
// ⚠️ THE MOST IMPORTANT TEST IN THIS FILE IS THE LAST ONE, and it is not about
// behaviour at all: it pins the module's whole EXPORT LIST, so that re-adding
// anything which decides what to delete turns a test red and NAMES it.
//
// This app shipped an automatic deletion exactly once (pastry records, v1.24.0) and
// removed it the next day on Federico's instruction: «niente si deve cancellare in
// automatico dal database». It was not disabled but deleted, because a delete sitting
// there switched off is one somebody reconnects in six months without knowing why.
// The same guard was written for that module and is written again here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../js/client-order-history.js';
import {
  HISTORY_WINDOW_DAYS, MAX_HISTORY_READ, pastWindow, isPast, groupByDay,
  lineCount, linesLabel, emptyWords,
} from '../js/client-order-history.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

// ── The window ──────────────────────────────────────────────────────────────

test('the window is the fifteen days before today', () => {
  const w = pastWindow(at(2026, 8, 12));
  assert.equal(w.before, '2026-08-12');
  assert.equal(w.since, '2026-07-28');       // 15 days back
  assert.equal(w.days, 15);
});

test('"show older" widens it a window at a time, and never shrinks it', () => {
  assert.equal(pastWindow(at(2026, 8, 12), 2).since, '2026-07-13');
  assert.equal(pastWindow(at(2026, 8, 12), 2).days, 30);
  // Nonsense must not produce a window smaller than the first one.
  for (const bad of [0, -3, null, undefined, 'two', NaN]) {
    assert.equal(pastWindow(at(2026, 8, 12), bad).since, '2026-07-28', String(bad));
  }
});

test('the window is built in the LOCAL calendar, across a month end', () => {
  assert.equal(pastWindow(at(2026, 3, 5)).since, '2026-02-18');
});

// ⚠️ 00:30 is the hour this gets wrong if anybody reaches for toISOString(), which
// converts to UTC first and names yesterday for everyone east of Greenwich.
test('just after midnight the window still starts from TODAY', () => {
  assert.equal(pastWindow(at(2026, 8, 12, 0)).before, '2026-08-12');
});

// ── Which screen owns an order ──────────────────────────────────────────────

// ⚠️ TODAY IS NOT HISTORY. It is still to be delivered, so it belongs to the other
// screen — and an order on both would be read as two orders.
test('today belongs to what is still coming, not to the history', () => {
  assert.equal(isPast({ date: '2026-08-12' }, '2026-08-12'), false);
  assert.equal(isPast({ date: '2026-08-13' }, '2026-08-12'), false);
  assert.equal(isPast({ date: '2026-08-11' }, '2026-08-12'), true);
});

test('an unusable date is never called past', () => {
  for (const date of [undefined, null, '', 'yesterday', '2026-13-01', '2026-02-31', 42]) {
    assert.equal(isPast({ date }, '2026-08-12'), false, String(date));
  }
  assert.equal(isPast(null, '2026-08-12'), false);
  assert.equal(isPast({ date: '2026-08-11' }, 'nonsense'), false);
});

// ── Grouping ────────────────────────────────────────────────────────────────

const ORDERS = [
  { id: 'a', date: '2026-08-10', clientName: 'B', updatedAt: '2026-08-09T09:00:00Z', quantities: { p1: 2 } },
  { id: 'b', date: '2026-08-11', clientName: 'A', updatedAt: '2026-08-10T08:00:00Z', quantities: { p1: 1, p2: 3 } },
  { id: 'c', date: '2026-08-11', clientName: 'C', updatedAt: '2026-08-10T07:00:00Z', quantities: {} },
];

test('one entry per day, newest day first', () => {
  const days = groupByDay(ORDERS);
  assert.deepEqual(days.map(d => d.date), ['2026-08-11', '2026-08-10']);
  assert.equal(days[0].orders.length, 2);
  assert.equal(days[1].orders.length, 1);
});

test('inside a day, the order that came in first is first', () => {
  const [first] = groupByDay(ORDERS);
  assert.deepEqual(first.orders.map(o => o.id), ['c', 'b']);
});

// ⚠️ A client who sent an order asking for NOTHING is a fact about that day — very
// possibly the fact somebody is looking the day up to check. Dropping it would say
// they never ordered, which is a different and wrong statement.
test('an order with no lines is kept, not silently dropped', () => {
  const days = groupByDay(ORDERS);
  const empty = days[0].orders.find(o => o.id === 'c');
  assert.ok(empty, 'the empty order must still appear');
  assert.equal(linesLabel(empty), 'nothing ordered');
});

test('an unreadable date is dropped rather than given a nonsense heading', () => {
  const days = groupByDay([...ORDERS, { id: 'x', date: 'whenever' }, { id: 'y' }, null]);
  assert.deepEqual(days.map(d => d.date), ['2026-08-11', '2026-08-10']);
  assert.equal(days.reduce((n, d) => n + d.orders.length, 0), 3);
});

test('nothing at all is an empty list, not a crash', () => {
  for (const input of [[], null, undefined, 'orders', 42]) {
    assert.deepEqual(groupByDay(input), [], String(input));
  }
});

// ── Counting the lines ──────────────────────────────────────────────────────

test('only quantities above zero count as a line', () => {
  assert.equal(lineCount({ quantities: { a: 2, b: 0, c: 5 } }), 2);
  assert.equal(lineCount({ quantities: { a: '3', b: '0' } }), 1);
  assert.equal(lineCount({ quantities: {} }), 0);
  assert.equal(lineCount({}), 0);
  assert.equal(lineCount(null), 0);
  assert.equal(lineCount({ quantities: 'lots' }), 0);
});

test('one line is singular, several are plural', () => {
  assert.equal(linesLabel({ quantities: { a: 1 } }), '1 line');
  assert.equal(linesLabel({ quantities: { a: 1, b: 2 } }), '2 lines');
});

// ── The empty screen ────────────────────────────────────────────────────────

// ⚠️ "Nothing here" has two meanings and only ONE of them is a reason to widen the
// window. Told apart, somebody knows whether to tap "show older" or to stop looking.
test('an empty window says WHICH kind of empty it is', () => {
  const never = emptyWords(15, false);
  const none = emptyWords(15, true);
  assert.notEqual(never, none);
  assert.match(none, /15 days/);
  // The reassurance is the load-bearing half: an empty screen must not read as
  // "your old orders are gone", which is what a bare "no orders" would say.
  assert.match(none, /kept/);
  assert.match(none, /deleted/);
  assert.ok(!/15 days/.test(never), 'a bakery with no clients yet is not told about a window');
});

// ── ⚠️ THE GUARD THAT MATTERS ───────────────────────────────────────────────

// This module may group, count and describe. It may not decide what to remove — from
// the screen it is a window, and from the database nothing at all. If a future change
// adds a prune, an expiry or a delete, this fails and says its name.
test('the module exports exactly these, and nothing that deletes', () => {
  assert.deepEqual(Object.keys(history).sort(), [
    'HISTORY_WINDOW_DAYS',
    'MAX_HISTORY_READ',
    'emptyWords',
    'groupByDay',
    'isPast',
    'lineCount',
    'linesLabel',
    'pastWindow',
  ]);
});

test('no export is named for deleting, expiring or pruning', () => {
  const suspicious = Object.keys(history)
    .filter(name => /delete|remove|prune|expire|purge|drop|clean/i.test(name));
  assert.deepEqual(suspicious, [],
    'nothing in this app deletes a client order automatically — see the file header');
});

test('the fifteen days are the SCREEN window, and are the app\'s usual number', () => {
  assert.equal(HISTORY_WINDOW_DAYS, 15);
  assert.ok(MAX_HISTORY_READ >= 100, 'the read cap must not be so low it hides a normal window');
});
