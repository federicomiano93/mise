// Unit tests for the pastry RECORD model.
//
// ⚠️ THIS FILE USED TO TEST A DELETION. It does not any more, because there is
// no longer one: nothing in The Italian Club removes anything from the database
// on its own. The Calculator's retention is a display filter over data kept for
// ever ("DISPLAY-only — the database keeps every log"), the Orders history
// window says "This HIDES, it never deletes", and the pastry records are now the
// same shape. A record leaves the SCREEN after fifteen days and stays in the
// database.
//
// The first test below is what keeps it that way: it pins the module's whole
// list of exports, so adding a function that deletes turns a test red instead of
// slipping past unnoticed.
//
// Dates are built from numeric components and nowMs is always injected, so
// nothing here depends on when or where it runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/pastries/pastries-log-model.js';
import {
  LOG_VISIBLE_DAYS, MAX_LOG_ITEMS,
  workDate, logIdFor, isRealISODate, daysBetween,
  isLogVisible,
  normalizeLog, normalizeLogs, sortLogs, buildLog,
} from '../js/pastries/pastries-log-model.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 7, 20, 12);            // Thu 20 Aug 2026, midday
const rec = (date, extra = {}) => ({ id: `${date}_Monday`, date, day: 'Monday', items: [], ...extra });

// ── Nothing here may delete ──────────────────────────────────────────────────

test('this module exports nothing that decides what to delete', () => {
  // ⚠️ THE POINT OF THIS TEST. The rule is "nothing deletes from the database by
  // itself", and a rule that lives only in a comment is a rule that comes back.
  // An earlier version of this file exported isLogExpired() and expiredLogs();
  // both were removed rather than switched off. Re-adding anything of the kind
  // fails HERE, in one line, before it can be wired up to a delete.
  //
  // If a genuinely new export belongs in this module, add it to this list on
  // purpose — and if it has anything to do with removing a record, don't.
  assert.deepEqual(Object.keys(model).sort(), [
    'LOG_VISIBLE_DAYS', 'MAX_LOG_ITEMS',
    'buildLog', 'daysBetween', 'isLogVisible', 'isRealISODate', 'logIdFor',
    'normalizeLog', 'normalizeLogs', 'sortLogs', 'workDate',
  ].sort());
});

test('the screen window is fifteen days, and it is the only window there is', () => {
  assert.equal(LOG_VISIBLE_DAYS, 15);
});

// ── The work date ────────────────────────────────────────────────────────────

test('a record accepted after midnight belongs to the night before', () => {
  assert.equal(workDate(at(2026, 7, 4, 23, 30)), '2026-08-04');
  assert.equal(workDate(at(2026, 7, 5, 0, 30)), '2026-08-04');   // still that night
  assert.equal(workDate(at(2026, 7, 5, 3, 59)), '2026-08-04');
  assert.equal(workDate(at(2026, 7, 5, 4, 0)), '2026-08-05');    // the new work day
});

test('the work date survives both clock changes', () => {
  assert.equal(workDate(at(2026, 9, 25, 3, 30)), '2026-10-24');
  assert.equal(workDate(at(2026, 9, 25, 4, 30)), '2026-10-25');
  assert.equal(workDate(at(2026, 2, 29, 3, 30)), '2026-03-28');
  assert.equal(workDate(at(2026, 2, 29, 4, 30)), '2026-03-29');
});

test('an id is the date and the weekday, in that order', () => {
  assert.equal(logIdFor('2026-08-05', 'Wednesday'), '2026-08-05_Wednesday');
});

// ── Reading a date ───────────────────────────────────────────────────────────

test('a date that looks right but is not a real day is refused', () => {
  assert.equal(isRealISODate('2026-08-05'), true);
  assert.equal(isRealISODate('2026-02-31'), false);   // passes the shape, is not a day
  assert.equal(isRealISODate('2026-13-01'), false);
  assert.equal(isRealISODate('2026-00-10'), false);
  assert.equal(isRealISODate('05-08-2026'), false);
  assert.equal(isRealISODate('2026-8-5'), false);
  assert.equal(isRealISODate(''), false);
  assert.equal(isRealISODate(null), false);
  assert.equal(isRealISODate(20260805), false);
});

test('a leap day is a real day', () => {
  assert.equal(isRealISODate('2028-02-29'), true);
  assert.equal(isRealISODate('2026-02-29'), false);
});

test('days between two dates ignores the clock changes', () => {
  assert.equal(daysBetween('2026-08-05', '2026-08-20'), 15);
  assert.equal(daysBetween('2026-08-20', '2026-08-05'), -15);
  assert.equal(daysBetween('2026-08-05', '2026-08-05'), 0);
  // BST ends inside this span; read as UTC midnights it is still exactly 7.
  assert.equal(daysBetween('2026-10-22', '2026-10-29'), 7);
  assert.equal(daysBetween('nonsense', '2026-08-05'), null);
  assert.equal(daysBetween('2026-08-05', null), null);
});

// ── What is on screen ────────────────────────────────────────────────────────

test('a record drops off the screen after 15 days', () => {
  assert.equal(isLogVisible(rec('2026-08-20'), NOW), true);   // today
  assert.equal(isLogVisible(rec('2026-08-05'), NOW), true);   // exactly 15
  assert.equal(isLogVisible(rec('2026-08-04'), NOW), false);  // 16
});

test('a record leaving the screen is hidden and NOTHING else', () => {
  // The whole surviving contract, in one line: this function answers a question
  // about a screen. The record it hides is untouched, and there is no longer any
  // function in the app that could remove it.
  const hidden = rec('2026-01-01');                             // months old
  assert.equal(isLogVisible(hidden, NOW), false);
  assert.deepEqual(normalizeLogs([hidden]).map(l => l.id), [hidden.id],
    'it must still read back as a perfectly good record');
});

test('a record nobody can date is SHOWN, not hidden', () => {
  // The screen is where a person would notice something wrong. Hiding it would
  // make the only visible symptom disappear.
  assert.equal(isLogVisible(rec('nonsense'), NOW), true);
  assert.equal(isLogVisible({ id: 'x' }, NOW), true);
  assert.equal(isLogVisible(rec('2026-09-01'), NOW), true);   // dated ahead
});

test('an unreadable clock hides nothing', () => {
  // A phone whose clock cannot be believed shows everything rather than deciding
  // anything. Cheap now that the answer only governs a screen.
  const old = rec('2026-01-01');
  for (const bad of [undefined, null, NaN, 0, -1, Infinity, -Infinity, 'now', {}]) {
    assert.equal(isLogVisible(old, bad), true, `nowMs=${String(bad)}`);
  }
});

// ── Reading records ──────────────────────────────────────────────────────────

test('the id wins over the fields, as it does everywhere else', () => {
  const l = normalizeLog({ date: '2026-01-01', day: 'Friday', items: [] }, '2026-08-05_Wednesday');
  assert.equal(l.date, '2026-08-05');
  assert.equal(l.day, 'Wednesday');
});

test('a record that cannot be placed on a timeline is dropped from the screen', () => {
  // Dropped from the LIST, not from the database — there is nowhere to draw it on
  // a timeline, but it is still there to be looked at.
  const list = normalizeLogs([
    { id: '2026-08-05_Wednesday', date: '2026-08-05', day: 'Wednesday', items: [] },
    { id: 'rubbish', date: 'rubbish', day: 'Nonday', items: [] },
    { id: '2026-02-31_Monday', items: [] },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, '2026-08-05_Wednesday');
});

test('a record is cleaned exactly like a day is', () => {
  const l = normalizeLog({
    items: [1, null, { name: '  Cornetti  ', qty: '24' }, { qty: 5 }],
    note: 'slow proof',
  }, '2026-08-05_Wednesday');
  assert.deepEqual(l.items, [{ name: 'Cornetti', qty: 24 }]);
  assert.equal(l.note, 'slow proof');
});

test('a record carrying more rows than the cap reads back at the cap', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
  assert.equal(normalizeLog({ items }, '2026-08-05_Monday').items.length, MAX_LOG_ITEMS);
});

test('records are newest first, and two on one date never swap places', () => {
  const list = sortLogs([
    { date: '2026-08-04', day: 'Wednesday' },
    { date: '2026-08-05', day: 'Friday' },
    { date: '2026-08-05', day: 'Tuesday' },
  ]);
  assert.deepEqual(list.map(l => `${l.date} ${l.day}`),
    ['2026-08-05 Tuesday', '2026-08-05 Friday', '2026-08-04 Wednesday']);
});

// ── What Accept writes ───────────────────────────────────────────────────────

test('a record is stamped with the work date, not the calendar date', () => {
  const l = buildLog({ day: 'Wednesday', items: [], note: '', nowMs: at(2026, 7, 5, 1, 0) });
  assert.equal(l.date, '2026-08-04');                 // 1am, so the night before
  assert.equal(l.day, 'Wednesday');                   // …of the Wednesday list
  assert.equal(l.id, '2026-08-04_Wednesday');
});

test('accepting twice in one night keeps the first createdAt', () => {
  // The second Accept is a CORRECTION, not a second night's work.
  const first = buildLog({ day: 'Monday', items: [], note: '', nowMs: at(2026, 7, 20, 22) });
  const again = buildLog({
    day: 'Monday', items: [], note: '', nowMs: at(2026, 7, 20, 23), existing: first,
  });
  assert.equal(again.id, first.id);
  assert.equal(again.createdAt, first.createdAt);
  assert.notEqual(again.updatedAt, first.updatedAt);
});

test('the note is frozen into the record', () => {
  // It was part of the instruction in force that night; a record showing
  // today's note would misdescribe it.
  const l = buildLog({ day: 'Monday', items: [], note: 'butter is low', nowMs: NOW });
  assert.equal(l.note, 'butter is low');
  assert.equal(buildLog({ day: 'Monday', items: [], note: 42, nowMs: NOW }).note, '');
});

test('a record carries the real list, cleaned, in order', () => {
  const l = buildLog({
    day: 'Monday',
    items: [{ name: 'Cornetti', qty: 24 }, { name: '', qty: 3 }, { name: 'Bomboloni', qty: '10' }],
    note: '', nowMs: NOW,
  });
  assert.deepEqual(l.items, [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
});

test('what buildLog writes is what normalizeLog reads back', () => {
  const built = buildLog({
    day: 'Wednesday', items: [{ name: 'Cornetti', qty: 24 }], note: 'x', nowMs: NOW,
  });
  const read = normalizeLog(built, built.id);
  assert.equal(read.date, built.date);
  assert.equal(read.day, built.day);
  assert.deepEqual(read.items, built.items);
  assert.equal(read.note, built.note);
  assert.equal(isLogVisible(read, NOW), true);
});
