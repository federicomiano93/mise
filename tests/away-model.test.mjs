// "I am on holiday" — and the much bigger danger it introduces.
//
// ⚠️⚠️ THE TESTS THAT MATTER MOST ARE THE ONES ABOUT REACHING NOBODY. Silencing a
// phone is easy; the failure this feature can cause is an order list that arrives
// at no one, with the sender told it went. Every rule below exists to make that
// impossible to do silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AWAY_DAYS, isAway, awayUids, buildAwayDoc, daysBetween, maxAwayDate,
  whoWillBeTold, nobodyWillBeTold, awayNames, personName, toISODate,
} from '../js/away-model.js';

// A fixed local noon, so no test depends on when it is run.
const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime();   // 14 Aug 2026
const TODAY = '2026-08-14';

const roster = [
  { uid: 'u-own', role: 'owner', firstName: 'Anna', lastName: 'Rossi' },
  { uid: 'u-mgr', role: 'manager', firstName: 'Marco', lastName: 'Bianchi' },
  { uid: 'u-staff', role: 'staff', firstName: 'Sam', lastName: 'Baker' },
];

// ── Away, and ending by itself ───────────────────────────────────────────────

test('the LAST day is included — "away until Friday" means Friday too', () => {
  assert.equal(isAway({ until: TODAY }, NOW), true, 'the last day must still count');
  assert.equal(isAway({ until: '2026-08-15' }, NOW), true);
  assert.equal(isAway({ until: '2026-08-13' }, NOW), false, 'yesterday is over');
});

// ⚠️ NOTHING COUNTS DOWN AND NOTHING RUNS AT MIDNIGHT. The answer is derived from
// the clock every time it is asked, exactly like the 4am pastry lock — so there is
// no flag that can get stuck on.
test('it ends BY ITSELF when the date passes, with nothing having to run', () => {
  const doc = { until: '2026-08-16' };
  assert.equal(isAway(doc, new Date(2026, 7, 16, 23, 59).getTime()), true);
  assert.equal(isAway(doc, new Date(2026, 7, 17, 0, 1).getTime()), false);
});

// ⚠️ EVERY UNCERTAIN ANSWER IS "NOT AWAY". One unnecessary notification is
// recoverable; a list that reaches nobody because a corrupt record read as a
// holiday is not.
test('anything unreadable means the phone RINGS', () => {
  for (const bad of [null, undefined, {}, { until: '' }, { until: 'friday' },
    { until: '2026-13-01' }, { until: '2026-02-31' }, { until: 42 }]) {
    assert.equal(isAway(bad, NOW), false, `${JSON.stringify(bad)} silenced a phone`);
  }
});

test('awayUids collects only the people really away', () => {
  const set = awayUids([
    { uid: 'a', until: '2026-08-20' },
    { uid: 'b', until: '2026-08-01' },
    { uid: 'c', until: 'nonsense' },
    { uid: '', until: '2026-08-20' },
  ], NOW);
  assert.deepEqual([...set], ['a']);
});

// ── Setting it ───────────────────────────────────────────────────────────────

test('a sensible date is stored', () => {
  const doc = buildAwayDoc({ uid: 'u1', until: '2026-08-20', now: NOW });
  assert.deepEqual(doc, { uid: 'u1', until: '2026-08-20', updatedAt: NOW });
});

// ⚠️ "I am back" is a real answer and is written as an EMPTY STRING, not by
// deleting: a delete that fails leaves somebody silenced with nothing on record
// to explain why.
test('coming back is a real answer, written rather than deleted', () => {
  assert.deepEqual(buildAwayDoc({ uid: 'u1', until: '', now: NOW }),
    { uid: 'u1', until: '', updatedAt: NOW });
  assert.equal(isAway({ uid: 'u1', until: '' }, NOW), false);
});

test('a date already gone is refused, not stored as a holiday that never happens', () => {
  assert.equal(buildAwayDoc({ uid: 'u1', until: '2026-08-13', now: NOW }), null);
  // Today itself is fine — a one-day holiday is a real thing.
  assert.ok(buildAwayDoc({ uid: 'u1', until: TODAY, now: NOW }));
});

// ⚠️ Somebody typing 2027 by mistake would switch their notifications off for a
// year and never think about it again.
test('an absurdly distant date is refused', () => {
  assert.equal(buildAwayDoc({ uid: 'u1', until: '2028-01-01', now: NOW }), null);
  assert.ok(buildAwayDoc({ uid: 'u1', until: maxAwayDate(NOW), now: NOW }));
  assert.equal(daysBetween(TODAY, maxAwayDate(NOW)), MAX_AWAY_DAYS);
});

test('junk never reaches the database', () => {
  assert.equal(buildAwayDoc({ uid: '', until: '2026-08-20', now: NOW }), null);
  assert.equal(buildAwayDoc({ uid: 'u1', until: 'soon', now: NOW }), null);
  assert.equal(buildAwayDoc({ uid: 'u1', until: '20/08/2026', now: NOW }), null);
});

test('the local calendar day is read locally, never through UTC', () => {
  // 00:30 local on the 14th is still the 14th, whatever UTC thinks.
  assert.equal(toISODate(new Date(2026, 7, 14, 0, 30).getTime()), '2026-08-14');
  assert.equal(toISODate(new Date(2026, 7, 14, 23, 30).getTime()), '2026-08-14');
});

// ── ⚠️ THE PART THAT KEEPS A LIST FROM REACHING NOBODY ───────────────────────

test('only the people who run the place are counted, never the sender', () => {
  const told = whoWillBeTold(roster, new Set(), 'u-own');
  assert.deepEqual(told.map(m => m.uid), ['u-mgr'], 'the owner sending it is not told');
  assert.deepEqual(whoWillBeTold(roster, new Set(), 'u-staff').map(m => m.uid),
    ['u-own', 'u-mgr'], 'an employee sending it tells both');
});

test('somebody away is not counted as somebody who will hear it', () => {
  const told = whoWillBeTold(roster, new Set(['u-mgr']), 'u-staff');
  assert.deepEqual(told.map(m => m.uid), ['u-own']);
});

test('⚠️ when EVERY manager is away, the sender is warned', () => {
  assert.equal(nobodyWillBeTold(roster, new Set(['u-own', 'u-mgr']), 'u-staff'), true);
  assert.equal(nobodyWillBeTold(roster, new Set(['u-mgr']), 'u-staff'), false,
    'one is still there — no warning');
});

// ⚠️ AN EMPTY ROSTER MEANS "the app does not know", NOT "nobody is there". Warning
// then would fire on every send in a venue whose roster has never been filled in,
// and a warning that always fires is one nobody reads.
test('an unknown roster does NOT produce a false "nobody will hear this"', () => {
  assert.equal(nobodyWillBeTold([], new Set(), 'u-staff'), false);
  assert.equal(nobodyWillBeTold(null, new Set(), 'u-staff'), false);
  // A venue with only employees: nobody runs it, so there is nothing to warn about
  // that this feature caused.
  assert.equal(nobodyWillBeTold([{ uid: 'x', role: 'staff' }], new Set(), 'u-staff'), false);
});

test('the warning can name who is away', () => {
  assert.deepEqual(awayNames(roster, new Set(['u-mgr']), 'u-staff'), ['Marco Bianchi']);
  assert.deepEqual(awayNames(roster, new Set(), 'u-staff'), []);
});

// ⚠️ IT NEVER RETURNS THE uid, and it returns '' rather than a word: this file
// has no imports so it can be copied byte-for-byte onto the server, so the word
// for "somebody" belongs to the screen. The property that matters is the same
// either way — a raw uid must never reach a person's eyes.
test('a person with no name is never printed as a raw uid', () => {
  assert.equal(personName({ uid: 'Fdx92kQ1nT', email: 'a@b.test' }), 'a@b.test');
  assert.equal(personName({ uid: 'Fdx92kQ1nT' }), '',
    'the model hands the screen nothing rather than a uid');
  assert.equal(personName(null), '');
});
