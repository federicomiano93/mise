// The WhatsApp order form fills itself from what was already calculated and logged.
// These numbers end up in a message sent to a client, so they get the same safety net
// as the dough math (P15 — the owner cannot read code).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillFromLogs, prefillNote } from '../js/calculator-order-prefill.js';
// The REAL reader the app passes in, so these tests exercise the same pairing the
// screen does — a simplified stand-in would only prove the stand-in works.
import { latestVersion as latestOf } from '../js/log-model.js';

// A log, newest-first order being the caller's job (log-store already sorts that way).
const mkLog = (items) => ({ versions: [{ items }] });
const item = (clientName, id, qty) => ({ clientName, id, qty, name: id });

const ENTRIES = [
  { client: { name: 'BAKERY' }, products: [{ id: 'p1', name: 'Pizzas' }, { id: 'p2', name: 'Focaccias' }] },
  { client: { name: 'CLUB FISH' }, products: [{ id: 'p1', name: 'Pizzas' }] },
];

test('a quantity from the log lands on the matching row', () => {
  const out = prefillFromLogs(ENTRIES, [mkLog([item('BAKERY', 'p1', 40)])], latestOf);
  assert.deepEqual(out, { '0|p1': 40 });
});

test('the most RECENT log wins when two recorded the same row', () => {
  const logs = [mkLog([item('BAKERY', 'p1', 12)]), mkLog([item('BAKERY', 'p1', 99)])];
  assert.deepEqual(prefillFromLogs(ENTRIES, logs, latestOf), { '0|p1': 12 });
});

test('a zero in the log is not an answer — that row stays for you to type', () => {
  const logs = [mkLog([item('BAKERY', 'p1', 0)]), mkLog([item('BAKERY', 'p1', 7)])];
  assert.deepEqual(prefillFromLogs(ENTRIES, logs, latestOf), { '0|p1': 7 });
});

test('the same product for two clients does not bleed across', () => {
  const logs = [mkLog([item('BAKERY', 'p1', 40), item('CLUB FISH', 'p1', 5)])];
  assert.deepEqual(prefillFromLogs(ENTRIES, logs, latestOf), { '0|p1': 40, '1|p1': 5 });
});

test('a client in the log but not in this order is ignored', () => {
  const out = prefillFromLogs(ENTRIES, [mkLog([item('SOMEONE ELSE', 'p1', 40)])], latestOf);
  assert.deepEqual(out, {});
});

test('a row with nothing recorded is simply absent, so the form leaves it at 0', () => {
  const out = prefillFromLogs(ENTRIES, [mkLog([item('BAKERY', 'p1', 40)])], latestOf);
  assert.equal('0|p2' in out, false);
});

test('a renamed client stops matching — the honest limit, not a silent wrong number', () => {
  // The log freezes the client name as it was that day (that is the point of the
  // freeze). After a rename the row is simply not filled, rather than filled wrongly.
  const out = prefillFromLogs(ENTRIES, [mkLog([item('BAKERY LTD', 'p1', 40)])], latestOf);
  assert.deepEqual(out, {});
});

test('junk in, nothing out — never a crash and never a NaN', () => {
  assert.deepEqual(prefillFromLogs(null, null, latestOf), {});
  assert.deepEqual(prefillFromLogs(ENTRIES, [null, {}, { versions: [] }], latestOf), {});
  assert.deepEqual(prefillFromLogs(ENTRIES, [mkLog([null, item('BAKERY', 'p1', 'abc')])], latestOf), {});
  assert.deepEqual(prefillFromLogs([null, { client: null }], [mkLog([item('BAKERY', 'p1', 1)])], latestOf), {});
});

test('the note says where the numbers came from, or that there were none', () => {
  assert.match(prefillNote(0), /Nothing calculated yet/);
  assert.match(prefillNote(1), /^One quantity filled in from your saved logs/);
  assert.match(prefillNote(4), /^4 quantities filled in from your saved logs/);
  // Whatever the count, it must always name the source: that sentence is the condition
  // under which pre-filling real-looking values is acceptable at all.
  for (const n of [1, 2, 9]) assert.match(prefillNote(n), /saved logs/);
});
