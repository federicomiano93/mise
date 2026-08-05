// Unit tests for the pastry LOCK: is tonight's list already done, and may it
// still be changed?
//
// The thing worth pinning here is not the locking — it is the UNLOCKING. A list
// that stays locked leaves someone at 4am unable to correct it, so every test
// below that proves a release matters more than the one next to it.
//
// ⚠️ AND THE OTHER HALF: unlocking must never CLEAR anything. That property does
// not live in this file (there is nothing here that could delete), and that is
// exactly the point — the roll at 4am is a question about a date, not an action.
//
// Dates are built from numeric components and nowMs is always injected, so
// nothing here depends on when or where it runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDIT_GRANT_PREFIX, grantKeyFor, isDayLocked, msUntilWorkDayEnd, confirmedDaysFrom,
} from '../js/pastries/pastries-lock.js';
import { workDate } from '../js/pastries/pastries-log-model.js';
import { DAY_START_HOUR } from '../js/pastries/pastries-model.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const TONIGHT = '2026-08-05';
const LAST_NIGHT = '2026-08-04';

// ── What locks, and what does not ────────────────────────────────────────────

test('a list nobody has confirmed is never locked', () => {
  assert.equal(isDayLocked({ confirmed: false, grant: null, workDate: TONIGHT }), false);
  assert.equal(isDayLocked({ confirmed: false, grant: TONIGHT, workDate: TONIGHT }), false);
});

test('a list confirmed tonight is locked', () => {
  assert.equal(isDayLocked({ confirmed: true, grant: null, workDate: TONIGHT }), true);
});

test('permission given tonight unlocks it', () => {
  assert.equal(isDayLocked({ confirmed: true, grant: TONIGHT, workDate: TONIGHT }), false);
});

test("last night's permission is spent — it does not carry over", () => {
  // ⚠️ THIS IS WHAT MAKES THE PERMISSION EXPIRE WITHOUT ANYTHING CLEANING IT UP.
  // The stored value is the work date it was given on, so at 4am it simply stops
  // matching. Nothing has to run, and nothing can be left behind.
  assert.equal(isDayLocked({ confirmed: true, grant: LAST_NIGHT, workDate: TONIGHT }), true);
});

test('a clock nobody can read locks NOTHING', () => {
  // The opposite of how the record model answers about deleting, and deliberately
  // so: there, doubt had to mean "keep", because the mistake was irreversible.
  // Here the mistake would be someone standing at 4am unable to correct a list,
  // with nothing on screen explaining why.
  for (const bad of [undefined, null, '', 'tonight', 42, {}, [], '2026-02-31', '05-08-2026']) {
    assert.equal(isDayLocked({ confirmed: true, grant: null, workDate: bad }), false,
      `workDate=${JSON.stringify(bad)}`);
  }
});

test('asked about nothing at all, it locks nothing', () => {
  assert.equal(isDayLocked(), false);
  assert.equal(isDayLocked({}), false);
});

// ── Where the permission is kept ─────────────────────────────────────────────

test('the permission key names the day, and only a real weekday has one', () => {
  assert.equal(grantKeyFor('Thursday'), `${EDIT_GRANT_PREFIX}Thursday`);
  for (const bad of ['thursday', 'Funday', '', null, undefined, 42, {}]) {
    assert.equal(grantKeyFor(bad), null, `day=${JSON.stringify(bad)}`);
  }
});

// ── When it unlocks by itself ────────────────────────────────────────────────

test('the wait runs to the next 4am, never past it', () => {
  // Just before: minutes. Just after: nearly a full day.
  const justBefore = at(2026, 7, 5, 3, 59);
  assert.equal(msUntilWorkDayEnd(justBefore), 60000);

  const justAfter = at(2026, 7, 5, 4, 1);
  assert.equal(msUntilWorkDayEnd(justAfter), 24 * 3600000 - 60000);

  // Midday: 16 hours to 4am.
  assert.equal(msUntilWorkDayEnd(at(2026, 7, 5, 12)), 16 * 3600000);
});

test('exactly 4am waits for the NEXT one, not zero', () => {
  // That roll has just happened. Returning 0 would spin a timer against itself.
  const wait = msUntilWorkDayEnd(at(2026, 7, 5, DAY_START_HOUR, 0));
  assert.equal(wait, 24 * 3600000);
});

test('the moment it fires, the work date really has moved on', () => {
  // ⚠️ THE TEST THAT TIES THE TIMER TO THE THING IT EXISTS FOR. A wait that is
  // right to the millisecond is worthless if the date it wakes up for is the
  // same one. Waiting the returned time (plus the second the app adds) must
  // land on a DIFFERENT work date.
  for (const start of [at(2026, 7, 5, 3, 59), at(2026, 7, 5, 12), at(2026, 7, 5, 23, 30)]) {
    const wait = msUntilWorkDayEnd(start);
    assert.notEqual(workDate(start + wait + 1000), workDate(start),
      `starting at ${new Date(start).toISOString()}`);
  }
});

test('an unreadable clock sets no timer at all', () => {
  for (const bad of [undefined, null, NaN, 0, -1, Infinity, -Infinity, 'now', {}]) {
    assert.equal(msUntilWorkDayEnd(bad), null, `nowMs=${String(bad)}`);
  }
});

// ── Reading which lists are done ─────────────────────────────────────────────

test('the confirmed days come off the records, by id', () => {
  const set = confirmedDaysFrom([
    { id: '2026-08-05_Thursday', date: '2026-08-05', day: 'Thursday' },
    { id: '2026-08-05_Monday', date: '2026-08-05', day: 'Monday' },
  ]);
  assert.deepEqual([...set].sort(), ['Monday', 'Thursday']);
});

test('the id wins over the field, as it does everywhere else in this feature', () => {
  const set = confirmedDaysFrom([{ id: '2026-08-05_Friday', day: 'Monday' }]);
  assert.deepEqual([...set], ['Friday']);
});

test('a record nobody can read locks nothing', () => {
  // It is simply absent from the answer — never a lock on a day it cannot name.
  const set = confirmedDaysFrom([
    { id: 'rubbish', day: 'Nonday' },
    { id: '2026-08-05_Funday' },
    null, undefined, 'a record', 42, {},
    { id: '2026-08-05_Wednesday', day: 'Wednesday' },
  ]);
  assert.deepEqual([...set], ['Wednesday']);
});

test('asked about nothing, nothing is confirmed', () => {
  for (const bad of [null, undefined, 'x', 42, {}, []]) {
    assert.equal(confirmedDaysFrom(bad).size, 0, `logs=${JSON.stringify(bad)}`);
  }
});

// ── The two halves together ──────────────────────────────────────────────────

test('a day confirmed tonight unlocks itself once the date rolls', () => {
  // The whole feature in one assertion: same record, same permission state, one
  // work date later — and it is open again. Nothing was stored, expired or
  // deleted to make that happen.
  const day = 'Thursday';
  const confirmed = confirmedDaysFrom([{ id: `${TONIGHT}_${day}`, day }]);

  assert.equal(
    isDayLocked({ confirmed: confirmed.has(day), grant: null, workDate: TONIGHT }), true);

  // Tomorrow's query returns nothing for the new date: the record still exists,
  // it just is not TONIGHT's any more.
  const tomorrow = confirmedDaysFrom([]);
  assert.equal(
    isDayLocked({ confirmed: tomorrow.has(day), grant: null, workDate: '2026-08-06' }), false);
});
