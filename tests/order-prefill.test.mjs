// The WhatsApp order form fills itself from what was already calculated and logged.
// These numbers end up in a message sent to a client, so they get the same safety net
// as the dough math (P15 — the owner cannot read code).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillFromLogs, prefillNote, PREFILL_WORK_DAYS } from '../js/calculator-order-prefill.js';
// The REAL reader the app passes in, so these tests exercise the same pairing the
// screen does — a simplified stand-in would only prove the stand-in works.
import { latestVersion as latestOf } from '../js/log-model.js';

// Local wall-clock times, built the way a person reads them. The work day rolls at
// 4am, so the hour matters as much as the date and a UTC timestamp would not say
// which work day it lands in.
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();

const NOW = at(2026, 8, 10, 9, 51);        // Monday morning, mid-shift
const TODAY = at(2026, 8, 10, 8, 30);
const YESTERDAY = at(2026, 8, 9, 13, 46);
const THREE_DAYS_AGO = at(2026, 8, 7, 10, 0);

// A log, newest-first order being the caller's job (log-store already sorts that way).
const mkLog = (items, createdAtMs = TODAY) => ({ createdAtMs, versions: [{ items }] });
const item = (clientName, id, qty) => ({ clientName, id, qty, name: id });

// Placeholder client names on purpose: this repo is public, so no real customer of
// the business appears in it.
const ENTRIES = [
  { client: { name: 'CLIENT A' }, products: [{ id: 'p1', name: 'Pizzas' }, { id: 'p2', name: 'Focaccias' }] },
  { client: { name: 'CLIENT B' }, products: [{ id: 'p1', name: 'Pizzas' }] },
];

const fill = (logs, opts = {}) => prefillFromLogs(ENTRIES, logs, latestOf, { nowMs: NOW, ...opts });

// ── Pairing a log line to a row ──────────────────────────────────────────────

test('a quantity from the log lands on the matching row', () => {
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 40)])]), { '0|p1': 40 });
});

test('the most RECENT log wins when two recorded the same row', () => {
  const logs = [mkLog([item('CLIENT A', 'p1', 12)]), mkLog([item('CLIENT A', 'p1', 99)])];
  assert.deepEqual(fill(logs), { '0|p1': 12 });
});

test('a ZERO in the newest log is an answer — it stops an older number outliving it', () => {
  // ⚠️ THE DEFECT THIS PINS, reported from the bakery on 10 Aug 2026. A dough log
  // lists EVERY product of its recipe for every client, zeros included, so a zero in
  // today's log means "none of these today". The code used to skip it and keep
  // searching backwards, and offered yesterday's 10 for a row today's log plainly
  // showed as 0 — in a message about to be sent to that client.
  const logs = [
    mkLog([item('CLIENT A', 'p1', 0)], TODAY),
    mkLog([item('CLIENT A', 'p1', 10)], YESTERDAY),
  ];
  assert.deepEqual(fill(logs), {});
});

test('the newest log decides a row even when an older one has a bigger number', () => {
  const logs = [
    mkLog([item('CLIENT A', 'p1', 3)], TODAY),
    mkLog([item('CLIENT A', 'p1', 99)], YESTERDAY),
  ];
  assert.deepEqual(fill(logs), { '0|p1': 3 });
});

test('a row the newest log does NOT mention still falls through to an older one', () => {
  // A focaccia log cannot answer for a brioche row: it never names it. That is what
  // makes "yesterday's dough, made for today" still work.
  const logs = [
    mkLog([item('CLIENT A', 'p1', 5)], TODAY),          // says nothing about p2
    mkLog([item('CLIENT A', 'p2', 48)], YESTERDAY),
  ];
  assert.deepEqual(fill(logs), { '0|p1': 5, '0|p2': 48 });
});

test('the real shape it went wrong on: two doughs, one row zeroed today', () => {
  // Today's brioche: one client's first product ordered, the second at zero.
  // Yesterday's focaccia: a different product entirely. Nothing may leak across.
  const entries = [
    { client: { name: 'CLIENT A' }, products: [
      { id: 'buns', name: 'Buns' }, { id: 'rolls', name: 'Rolls' }, { id: 'trays', name: 'Trays' }] },
  ];
  const logs = [
    mkLog([item('CLIENT A', 'buns', 0), item('CLIENT A', 'rolls', 20)], TODAY),
    mkLog([item('CLIENT A', 'buns', 10), item('CLIENT A', 'rolls', 20)], YESTERDAY),
    mkLog([item('CLIENT A', 'trays', 4)], YESTERDAY),
  ];
  assert.deepEqual(prefillFromLogs(entries, logs, latestOf, { nowMs: NOW }),
    { '0|rolls': 20, '0|trays': 4 });
});

test('the same product for two clients does not bleed across', () => {
  const logs = [mkLog([item('CLIENT A', 'p1', 40), item('CLIENT B', 'p1', 5)])];
  assert.deepEqual(fill(logs), { '0|p1': 40, '1|p1': 5 });
});

test('a client in the log but not in this WhatsApp list is ignored', () => {
  // The log holds every client that was calculated; the order being sent holds only
  // the ones on the chosen list. Only the second set is answered for.
  assert.deepEqual(fill([mkLog([item('SOMEONE ELSE', 'p1', 40)])]), {});
});

test('a row with nothing recorded is simply absent, so the form leaves it at 0', () => {
  assert.equal('0|p2' in fill([mkLog([item('CLIENT A', 'p1', 40)])]), false);
});

test('a renamed client stops matching — the honest limit, not a silent wrong number', () => {
  // The log freezes the client name as it was that day (that is the point of the
  // freeze). After a rename the row is simply not filled, rather than filled wrongly.
  assert.deepEqual(fill([mkLog([item('CLIENT A LTD', 'p1', 40)])]), {});
});

// ── The window: yesterday and today, and nothing older ───────────────────────
// Today's order is assembled from two days' work — some products are made the day
// BEFORE it goes out, some the same morning — so both days count and neither alone
// is the answer.

test('a dough made TODAY is offered', () => {
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 30)], TODAY)]), { '0|p1': 30 });
});

test('a dough made YESTERDAY for today is offered — it is already baked', () => {
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 48)], YESTERDAY)]), { '0|p1': 48 });
});

test('a dough from three days ago is NOT offered', () => {
  // The logs are never deleted, so without this the form would reach back for ever
  // and present a stale quantity as if it were this order's.
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)]), {});
});

test('today beats yesterday for the same row, and yesterday still fills a row today missed', () => {
  const logs = [
    mkLog([item('CLIENT A', 'p1', 30)], TODAY),
    mkLog([item('CLIENT A', 'p1', 12), item('CLIENT A', 'p2', 48)], YESTERDAY),
  ];
  assert.deepEqual(fill(logs), { '0|p1': 30, '0|p2': 48 });
});

test('the window is TWO work days, and the constant says so', () => {
  assert.equal(PREFILL_WORK_DAYS, 2);
});

// ── The setting: yesterday and today, yesterday only, today only ─────────────
// Which days count is the bakery's own rhythm, not something the app can derive, so
// it is chosen in Settings → WhatsApp.

const BOTH_DAYS = [
  mkLog([item('CLIENT A', 'p1', 30)], TODAY),
  mkLog([item('CLIENT A', 'p2', 48)], YESTERDAY),
];

test('"both" offers each day\'s work', () => {
  assert.deepEqual(fill(BOTH_DAYS, { window: 'both' }), { '0|p1': 30, '0|p2': 48 });
});

test('"today" leaves yesterday\'s work out', () => {
  assert.deepEqual(fill(BOTH_DAYS, { window: 'today' }), { '0|p1': 30 });
});

test('"yesterday" means yesterday ONLY, not yesterday onwards', () => {
  // The point of the option: somebody who bakes everything the day before wants
  // today's half-finished calculations kept OUT of the message. An option that
  // quietly included today would just be "both" under another name.
  assert.deepEqual(fill(BOTH_DAYS, { window: 'yesterday' }), { '0|p2': 48 });
});

test('no window, or one nobody recognises, widens to both rather than narrowing', () => {
  // A corrupt setting must never quietly hide a day's work from an order.
  for (const bad of [undefined, null, '', 'ieri', 'BOTH', 42, {}]) {
    assert.deepEqual(fill(BOTH_DAYS, { window: bad }), { '0|p1': 30, '0|p2': 48 }, String(bad));
  }
});

test('every window still refuses anything older than yesterday', () => {
  const old = [mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)];
  for (const w of ['both', 'today', 'yesterday']) {
    assert.deepEqual(fill(old, { window: w }), {}, w);
  }
});

// ── The 4am boundary ─────────────────────────────────────────────────────────

test('a log written after midnight belongs to the night before, and is still offered', () => {
  // 00:30 on Monday is Sunday night's shift. A midnight cut would push it a day back
  // and drop the baker's own log out of the window they are standing in.
  const lateNight = at(2026, 8, 10, 0, 30);
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 20)], lateNight)]), { '0|p1': 20 });
});

test('a log written before 4am YESTERDAY belongs to the day before that, and is not offered', () => {
  // 02:00 on Sunday is Saturday night's work — two work days back, outside the window.
  const sundayNight = at(2026, 8, 9, 2, 0);
  assert.deepEqual(fill([mkLog([item('CLIENT A', 'p1', 20)], sundayNight)]), {});
});

// ── Nothing is guessed when the clock cannot be read ─────────────────────────

test('no clock offers nothing, rather than silently offering everything', () => {
  // Falling back to "no window" would restore the unbounded old behaviour, and the
  // failure would look exactly like the feature working.
  const logs = [mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)];
  for (const bad of [undefined, null, 0, -1, NaN, 'abc', {}]) {
    assert.deepEqual(prefillFromLogs(ENTRIES, logs, latestOf, { nowMs: bad }), {}, String(bad));
  }
});

test('a log with no timestamp is not offered — there is no honest way to place it', () => {
  assert.deepEqual(fill([{ versions: [{ items: [item('CLIENT A', 'p1', 40)] }] }]), {});
});

test('junk in, nothing out — never a crash and never a NaN', () => {
  assert.deepEqual(prefillFromLogs(null, null, latestOf, { nowMs: NOW }), {});
  assert.deepEqual(fill([null, {}, { versions: [] }]), {});
  assert.deepEqual(fill([mkLog([null, item('CLIENT A', 'p1', 'abc')])]), {});
  assert.deepEqual(prefillFromLogs([null, { client: null }], [mkLog([item('CLIENT A', 'p1', 1)])], latestOf, { nowMs: NOW }), {});
});

// ── The sentence above the form ──────────────────────────────────────────────

test('the note says where the numbers came from, or that there were none', () => {
  assert.match(prefillNote(0, 'both'), /Nothing logged for these clients yesterday or today/);
  assert.match(prefillNote(1, 'both'), /^One quantity filled in from what you logged yesterday or today/);
  assert.match(prefillNote(4, 'both'), /^4 quantities filled in from what you logged yesterday or today/);
});

test('the note follows the SETTING — a fixed sentence would start lying', () => {
  // The window is chosen in Settings. If the sentence did not follow it, the screen
  // would claim numbers came from days it never looked at, which is worse than
  // saying nothing at all.
  assert.match(prefillNote(2, 'today'), /from what you logged today —/);
  assert.match(prefillNote(2, 'yesterday'), /from what you logged yesterday —/);
  assert.match(prefillNote(0, 'today'), /Nothing logged for these clients today —/);
  assert.match(prefillNote(0, 'yesterday'), /Nothing logged for these clients yesterday —/);
  // "today only" must not be described as "yesterday or today".
  assert.equal(/yesterday/.test(prefillNote(2, 'today')), false);
});

test('an unknown window falls back to the widest wording, matching what it offers', () => {
  for (const bad of [undefined, null, '', 'ieri', 42]) {
    assert.match(prefillNote(2, bad), /yesterday or today/, String(bad));
  }
});

test('whatever the count, the note names the window it drew from', () => {
  // That sentence is the condition under which pre-filling real-looking values is
  // acceptable at all (P20), and naming the AGE is what makes it checkable.
  for (const n of [1, 2, 9]) assert.match(prefillNote(n, 'both'), /yesterday or today/);
});
