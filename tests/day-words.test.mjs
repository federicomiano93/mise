// The days, in two languages — and the one list of days that must NEVER be
// translated.
//
// ⚠️⚠️ THE WHOLE POINT OF THIS FILE IS THE FIRST TEST. `weekdayOf()` returns
// 'Monday', and that string is DATA: it is stored on every supplier
// (orderDays/deliveryDays) and it is the document id of a proving list
// (pastries/Monday). Translating it would not change a label — it would make a
// Monday supplier never match a Monday, and all seven proving lists unreachable,
// with the app cheerfully showing seven empty days. The short forms beside it look
// identical and ARE words. Same shape, opposite nature.
//
// The technique is the one from v1.24.1: a rule that matters more than a
// behaviour gets pinned by a test that turns red and NAMES it, because a rule that
// lives only in a comment is a rule that comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdayOf, spellDay, dayLabel, daySpoken, dayWhen, dayPhrase } from '../js/orders/day.js';
import { setLanguage, DEFAULT_LANGUAGE } from '../js/i18n.js';

const NOW = new Date('2026-08-14T09:00:00');
const TODAY = '2026-08-14';
const YESTERDAY = '2026-08-13';
const A_SATURDAY = '2026-07-11';

function inLanguage(lang, fn) {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

// ── The one that must never move ─────────────────────────────────────────────

test('⚠️ weekdayOf stays ENGLISH in every language — it is an identifier, not a word', () => {
  const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
    '2026-08-14', '2026-08-15', '2026-08-16'];
  const english = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  assert.deepEqual(days.map(weekdayOf), english);
  // The same call, with the app in Italian, must answer identically. A supplier
  // ordered on Monday is stored as 'Monday'.
  assert.deepEqual(inLanguage('it', () => days.map(weekdayOf)), english,
    'weekdayOf was translated — every supplier’s ordering day would stop matching');
});

// ── The words ────────────────────────────────────────────────────────────────

test('today and yesterday follow the language', () => {
  assert.equal(dayLabel(TODAY, NOW), 'Today');
  assert.equal(dayLabel(YESTERDAY, NOW), 'Yesterday');
  assert.equal(inLanguage('it', () => dayLabel(TODAY, NOW)), 'Oggi');
  assert.equal(inLanguage('it', () => dayLabel(YESTERDAY, NOW)), 'Ieri');
});

test('a spelled-out date follows the language, and keeps its own shape', () => {
  assert.equal(spellDay(A_SATURDAY), 'Sat 11 Jul 2026');
  assert.equal(inLanguage('it', () => spellDay(A_SATURDAY)), 'sab 11 lug 2026');
});

// ⚠️ THE FORM INSIDE A SENTENCE IS ASKED FOR, NEVER COMPUTED. The old code called
// .toLowerCase() on the label — a language-specific operation performed on
// somebody else's language.
test('the mid-sentence form comes from the dictionary, not from toLowerCase()', () => {
  assert.equal(daySpoken(TODAY, NOW), 'today');
  assert.equal(inLanguage('it', () => daySpoken(TODAY, NOW)), 'oggi');
  // A date is a NAME and keeps its own capital — lowercasing the lot would give
  // "sat 11 jul 2026", which reads like a typo.
  assert.equal(daySpoken(A_SATURDAY, NOW), 'Sat 11 Jul 2026');
});

// ⚠️ WHOLE PHRASES. English puts nothing before "today" and "on" before a date;
// Italian puts "il" before the date. Gluing a preposition in code decides that
// for every language at once.
test('the preposition belongs to the language, not to the code', () => {
  assert.equal(dayWhen(TODAY, NOW), 'today');
  assert.equal(dayWhen(A_SATURDAY, NOW), 'on Sat 11 Jul 2026');
  assert.equal(inLanguage('it', () => dayWhen(TODAY, NOW)), 'oggi');
  assert.equal(inLanguage('it', () => dayWhen(A_SATURDAY, NOW)), 'il sab 11 lug 2026');
});

test('"for that day" is one phrase in each language', () => {
  assert.equal(dayPhrase(TODAY, NOW), 'for today');
  assert.equal(dayPhrase(A_SATURDAY, NOW), 'for Sat 11 Jul 2026');
  assert.equal(inLanguage('it', () => dayPhrase(TODAY, NOW)), 'per oggi');
  assert.equal(inLanguage('it', () => dayPhrase(A_SATURDAY, NOW)), 'per sab 11 lug 2026');
});

// ⚠️ THE DECISION IS MADE ON THE DAY, NOT ON THE PRINTED WORD. dayWhen used to ask
// whether the spoken form equalled the string 'today' — which stopped being true
// the moment it could be «oggi», and would have quietly produced "on oggi".
test('«oggi» is still recognised as a named day, so no preposition is glued to it', () => {
  const it = inLanguage('it', () => dayWhen(TODAY, NOW));
  assert.equal(it, 'oggi');
  assert.equal(/^il /.test(it), false, 'a preposition was glued to a named day');
});

test('nothing at all still produces nothing, in either language', () => {
  for (const lang of ['en', 'it']) {
    inLanguage(lang, () => {
      assert.equal(dayLabel('', NOW), '');
      assert.equal(daySpoken('', NOW), '');
      assert.equal(dayWhen('', NOW), '');
      assert.equal(dayPhrase('', NOW), '');
      assert.equal(spellDay(''), '');
    });
  }
});

test('an unparseable date is handed back rather than printed as 1970', () => {
  assert.equal(spellDay('not-a-date'), 'not-a-date');
});
