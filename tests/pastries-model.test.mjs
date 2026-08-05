// Unit tests for the Pastries model (P15 — the owner cannot read code, so these
// tests are the safety net).
//
// This file exists because of ONE behaviour that is almost impossible to check by
// hand: which day the screen opens on at 1am. Getting it wrong is silent and
// expensive — someone arrives for the night shift, reads a list that is a day
// ahead, and proves the wrong pastries for a service that has already been sold.
// Nobody finds out until the morning.
//
// Two traps are pinned here in particular:
//
//   1. THE CLOCK CHANGES. Subtracting four hours as milliseconds instead of with
//      setHours is wrong on both DST Sundays, in opposite directions. Measured:
//      25 Oct 2026 03:30 the ms version says Sunday (Saturday is right), and
//      29 Mar 2026 04:30 it says Saturday (Sunday is right).
//
//   2. THE READ-SIDE CAP. If normalizeDay did not truncate to MAX_ITEMS on the
//      way IN, a day carrying more rows than the rules allow would display fine,
//      accept one more row, and then have every save refused for ever with
//      nothing on screen to explain it.
//
// Every date is built from numeric components (new Date(2026, 7, 4, 1, 0)), never
// parsed from a string, and nowMs is always injected — so every assertion below
// holds in any timezone, including the UTC that CI runs in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKDAYS, WEEKDAY_SHORT, DAY_START_HOUR, MAX_ITEMS, MAX_NAME_LENGTH, MAX_QTY,
  MAX_NOTE_LENGTH,
  isWeekday, nextWeekday, previousWeekday, workWeekday, provingDayFor,
  wholeNumber, normalizeDay, normalizeDays, cleanItems, findInvalidItems,
  cleanNote, setQuantityAt, daysFromCache,
} from '../js/pastries/pastries-model.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();

// Anchors, verified against the calendar before being used below.
// Mon 3 Aug 2026 · Tue 4 Aug 2026 · Sun 9 Aug 2026 · Mon 10 Aug 2026
// Sun 29 Mar 2026 (clocks forward) · Sun 25 Oct 2026 (clocks back)

// ── The vocabulary ───────────────────────────────────────────────────────────

test('the weekday names are exactly the ones supplier orderDays already use', () => {
  // Asserted literally, so a rename here can never quietly split the app into two
  // weekday vocabularies that disagree.
  assert.deepEqual([...WEEKDAYS], [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ]);
  assert.deepEqual([...WEEKDAY_SHORT], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(DAY_START_HOUR, 4);
});

test('a weekday typed with a stray space or a small letter is not a weekday', () => {
  // The same invisible-space trap that cost half an hour on the location documents.
  assert.equal(isWeekday('Monday'), true);
  assert.equal(isWeekday('monday'), false);
  assert.equal(isWeekday('Monday '), false);
  assert.equal(isWeekday(' Monday'), false);
  assert.equal(isWeekday(''), false);
  assert.equal(isWeekday(null), false);
  assert.equal(isWeekday(0), false);
  assert.equal(isWeekday(['Monday']), false);
});

test('the week has no end — Sunday is followed by Monday', () => {
  assert.equal(nextWeekday('Sunday'), 'Monday');
  assert.equal(previousWeekday('Monday'), 'Sunday');
  assert.equal(nextWeekday('Monday'), 'Tuesday');
  assert.equal(previousWeekday('Wednesday'), 'Tuesday');
});

test('an unreadable weekday falls back to Monday instead of returning undefined', () => {
  // A screen showing the wrong day is recoverable; a screen showing "undefined"
  // with no list at all is the app looking broken.
  assert.equal(nextWeekday('Funday'), 'Monday');
  assert.equal(previousWeekday(null), 'Monday');
});

// ── The 4am roll-over ────────────────────────────────────────────────────────

test('at 23:30 on Monday the list to prove is Tuesday', () => {
  assert.equal(workWeekday(at(2026, 7, 3, 23, 30)), 'Monday');
  assert.equal(provingDayFor(at(2026, 7, 3, 23, 30)), 'Tuesday');
});

test('at 00:30 on Tuesday it is STILL Tuesday — the night shift is one day', () => {
  // The whole reason this feature does not use the calendar day. Half an hour past
  // midnight the same person is doing the same night's work.
  assert.equal(workWeekday(at(2026, 7, 4, 0, 30)), 'Monday');
  assert.equal(provingDayFor(at(2026, 7, 4, 0, 30)), 'Tuesday');
});

test('the roll-over happens on the minute, not around it', () => {
  assert.equal(provingDayFor(at(2026, 7, 4, 3, 59)), 'Tuesday');
  assert.equal(provingDayFor(at(2026, 7, 4, 4, 0)), 'Wednesday');
});

test('later on Tuesday the list to prove is Wednesday', () => {
  assert.equal(workWeekday(at(2026, 7, 4, 12, 0)), 'Tuesday');
  assert.equal(provingDayFor(at(2026, 7, 4, 12, 0)), 'Wednesday');
});

test('the wrap and the 4am rule apply at the same time', () => {
  // Sunday night: the work day is Sunday, so the list is Monday's.
  assert.equal(provingDayFor(at(2026, 7, 9, 22, 0)), 'Monday');
  // 1am on Monday morning is still Sunday's shift, so the list is STILL Monday's.
  assert.equal(workWeekday(at(2026, 7, 10, 1, 0)), 'Sunday');
  assert.equal(provingDayFor(at(2026, 7, 10, 1, 0)), 'Monday');
});

test('a garbage timestamp does not throw or produce undefined', () => {
  for (const bad of [undefined, null, NaN, 'yesterday', {}, Infinity]) {
    assert.ok(WEEKDAYS.includes(workWeekday(bad)), `workWeekday(${String(bad)})`);
    assert.ok(WEEKDAYS.includes(provingDayFor(bad)), `provingDayFor(${String(bad)})`);
  }
});

// ── The clock changes ────────────────────────────────────────────────────────

test('clocks going FORWARD (Sun 29 Mar 2026) does not shift the work day', () => {
  // 03:30 is before 4am → still Saturday's shift.
  assert.equal(workWeekday(at(2026, 2, 29, 3, 30)), 'Saturday');
  // 04:30 is past 4am → Sunday has started. Subtracting 4h as milliseconds
  // answers "Saturday" here, which is the bug this line exists to catch.
  assert.equal(workWeekday(at(2026, 2, 29, 4, 30)), 'Sunday');
});

test('clocks going BACK (Sun 25 Oct 2026) does not shift the work day', () => {
  // 03:30 is before 4am → still Saturday's shift. Subtracting 4h as milliseconds
  // answers "Sunday" here — the same bug, in the opposite direction.
  assert.equal(workWeekday(at(2026, 9, 25, 3, 30)), 'Saturday');
  assert.equal(workWeekday(at(2026, 9, 25, 4, 30)), 'Sunday');
});

test('across a whole clock-change week, midday always names its own weekday', () => {
  // A cheap sweep that catches an off-by-one anywhere in the conversion between
  // JS's Sunday-first getDay() and this file's Monday-first list.
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  for (let i = 0; i < 7; i++) {
    const day = 19 + i; // Mon 19 Oct 2026 … Sun 25 Oct 2026
    assert.equal(workWeekday(at(2026, 9, day, 12, 0)), names[i], `19+${i} Oct`);
  }
});

// ── Quantities ───────────────────────────────────────────────────────────────

test('a quantity is always a whole number Firestore can store', () => {
  assert.equal(wholeNumber(24), 24);
  assert.equal(wholeNumber('24'), 24);
  assert.equal(wholeNumber(3.7), 4);
  assert.equal(wholeNumber(-5), 0);
  assert.equal(wholeNumber(''), 0);
  assert.equal(wholeNumber(null), 0);
  assert.equal(wholeNumber(undefined), 0);
  assert.equal(wholeNumber('abc'), 0);
});

test('1e999 is Infinity, and Infinity would break every save that followed', () => {
  // A number field accepts this happily. Firestore refuses a non-finite number,
  // so without this one keystroke would poison the document and every later save.
  // It becomes 0, which the validator then reports as a missing quantity.
  assert.equal(wholeNumber(1e999), 0);
  assert.equal(wholeNumber(Infinity), 0);
  assert.equal(wholeNumber(-Infinity), 0);
  assert.equal(wholeNumber(NaN), 0);
  for (const v of [1e999, Infinity, -Infinity, NaN, 'abc', null]) {
    assert.ok(Number.isFinite(wholeNumber(v)), `wholeNumber(${String(v)}) must be finite`);
  }
});

test('a big number is kept as typed, and refused — never quietly shrunk', () => {
  // Storing a 9999 nobody chose is the same mistake as truncating a name.
  assert.equal(wholeNumber(50000), 50000);
  const bad = findInvalidItems([{ name: 'Cornetti', qty: 50000 }]);
  assert.equal(bad.problem, 'qty-too-big');
  assert.equal(bad.name, 'Cornetti');
  assert.equal(findInvalidItems([{ name: 'Cornetti', qty: MAX_QTY }]), null);
});

// ── Reading what is stored ───────────────────────────────────────────────────

test('a day that was never written reads as an empty list, not a crash', () => {
  assert.deepEqual(normalizeDay(null, 'Monday'), { day: 'Monday', items: [], note: '' });
  assert.deepEqual(normalizeDay(undefined, 'Friday'), { day: 'Friday', items: [], note: '' });
  assert.deepEqual(normalizeDay({}, 'Sunday'), { day: 'Sunday', items: [], note: '' });
});

test('a corrupt items field reads as an empty list', () => {
  for (const bad of ['Cornetti', 42, { a: 1 }, null]) {
    assert.deepEqual(normalizeDay({ items: bad }, 'Monday').items, []);
  }
});

test('rows that are not rows are dropped, the real ones survive', () => {
  const out = normalizeDay({
    items: [1, 'Cornetti', null, { name: 'Bomboloni', qty: 10 }, { qty: 5 }, {}],
  }, 'Monday');
  assert.deepEqual(out.items, [{ name: 'Bomboloni', qty: 10 }]);
});

test('names are trimmed and blank ones dropped', () => {
  const out = normalizeDay({
    items: [{ name: '  Cornetti  ', qty: 24 }, { name: '   ', qty: 3 }],
  }, 'Monday');
  assert.deepEqual(out.items, [{ name: 'Cornetti', qty: 24 }]);
});

test('an over-long stored name is shortened rather than hidden', () => {
  // The data is already there; refusing to show it helps nobody.
  const out = normalizeDay({ items: [{ name: 'x'.repeat(300), qty: 1 }] }, 'Monday');
  assert.equal(out.items[0].name.length, MAX_NAME_LENGTH);
});

test('a day storing more rows than the cap reads back at the cap', () => {
  // ⚠️ So a day can never become permanently unsavable: what is shown is always
  // something the rules will accept back.
  const items = Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
  assert.equal(normalizeDay({ items }, 'Monday').items.length, MAX_ITEMS);
});

test('the whole collection always comes back with all seven days', () => {
  for (const input of [[], null, 'nonsense', undefined, {}]) {
    const days = normalizeDays(input);
    assert.deepEqual(Object.keys(days), [...WEEKDAYS]);
    WEEKDAYS.forEach(d => assert.deepEqual(days[d], { items: [], note: '' }));
  }
});

test('a document whose id is not a weekday is ignored, not rendered', () => {
  const days = normalizeDays([
    { id: 'Monday', items: [{ name: 'Cornetti', qty: 24 }] },
    { id: 'Funday', items: [{ name: 'Nothing', qty: 1 }] },
    { id: '2026-08-05', items: [{ name: 'Nothing', qty: 1 }] },
    { id: 'monday', items: [{ name: 'Nothing', qty: 1 }] },
  ]);
  assert.deepEqual(Object.keys(days), [...WEEKDAYS]);
  assert.deepEqual(days.Monday.items, [{ name: 'Cornetti', qty: 24 }]);
  assert.equal(days.Tuesday.items.length, 0);
});

test('when the id and the stored day field disagree, the id wins', () => {
  // The id is what the rules pin and what decides which list was written.
  const days = normalizeDays([
    { id: 'Monday', day: 'Friday', items: [{ name: 'Cornetti', qty: 24 }] },
  ]);
  assert.deepEqual(days.Monday.items, [{ name: 'Cornetti', qty: 24 }]);
  assert.deepEqual(days.Friday.items, []);
});

// ── Preparing what gets written ──────────────────────────────────────────────

test('an untouched empty row is dropped, not treated as a mistake', () => {
  // Someone tapped "add" and has not typed yet. Refusing to save would make the
  // button feel broken.
  const out = cleanItems([
    { name: 'Cornetti', qty: 24 },
    { name: '', qty: '' },
    { name: 'Bomboloni', qty: 10 },
  ]);
  assert.deepEqual(out, [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
});

test('the order typed is the order stored — it is the order the work is done in', () => {
  const names = ['Danish fruit', 'Cornetti', 'Bomboloni', 'Pain chocolat'];
  const out = cleanItems(names.map((name, i) => ({ name, qty: i + 1 })));
  assert.deepEqual(out.map(i => i.name), names);
});

test('cleaning does not silently merge two rows with the same name', () => {
  // Dropping one would lose a number. findInvalidItems reports it instead, so the
  // person decides.
  assert.equal(cleanItems([{ name: 'Cornetti', qty: 12 }, { name: 'Cornetti', qty: 24 }]).length, 2);
});

test('cleanItems survives being handed something that is not a list', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) assert.deepEqual(cleanItems(bad), []);
});

// ── What blocks a save ───────────────────────────────────────────────────────

test('an empty day is valid — that is how a day gets cleared', () => {
  assert.equal(findInvalidItems([]), null);
  assert.equal(findInvalidItems(null), null);
});

test('a full, ordinary list is valid', () => {
  // The real list from the note this feature replaces.
  assert.equal(findInvalidItems([
    { name: 'Cornetti', qty: 24 },
    { name: 'Savoury croissant', qty: 12 },
    { name: 'Pain chocolat', qty: 5 },
    { name: 'Cinnamon rolls', qty: 5 },
    { name: 'Bomboloni', qty: 10 },
    { name: 'Danish fruit', qty: 4 },
  ]), null);
});

test('the same pastry twice is reported, whatever the capitals', () => {
  const bad = findInvalidItems([{ name: 'Cornetti', qty: 12 }, { name: ' cornetti ', qty: 24 }]);
  assert.equal(bad.problem, 'duplicate');
  assert.equal(bad.index, 1);
  assert.equal(bad.name, 'cornetti');
});

test('two different pastries that start the same are not duplicates', () => {
  assert.equal(findInvalidItems([
    { name: 'Cornetti', qty: 24 },
    { name: 'Cornetti integrali', qty: 6 },
  ]), null);
});

test('a pastry with no number is blocked — the list is unreadable without it', () => {
  for (const qty of [0, '', null, undefined, 'abc', -3]) {
    const bad = findInvalidItems([{ name: 'Cornetti', qty }]);
    assert.equal(bad && bad.problem, 'no-qty', `qty=${String(qty)}`);
    assert.equal(bad.index, 0);
    assert.equal(bad.name, 'Cornetti');
  }
});

test('an over-long name is refused rather than quietly shortened', () => {
  const bad = findInvalidItems([{ name: 'x'.repeat(MAX_NAME_LENGTH + 1), qty: 1 }]);
  assert.equal(bad.problem, 'too-long');
  assert.equal(bad.index, 0);
});

test('a name exactly at the limit is allowed', () => {
  assert.equal(findInvalidItems([{ name: 'x'.repeat(MAX_NAME_LENGTH), qty: 1 }]), null);
});

test('too many rows is reported here, so the database never has to refuse it', () => {
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
  assert.equal(findInvalidItems(many).problem, 'too-many');
  assert.equal(findInvalidItems(many.slice(0, MAX_ITEMS)), null);
});

test('a blank row does not block a save and does not count as a duplicate', () => {
  assert.equal(findInvalidItems([
    { name: 'Cornetti', qty: 24 },
    { name: '', qty: '' },
    { name: '', qty: '' },
  ]), null);
});

// ── The standing note ────────────────────────────────────────────────────────

test('a missing or corrupt note reads as no note at all', () => {
  // A day with no note and a day whose note field is junk look the same on
  // screen, which is the honest answer in both cases.
  for (const bad of [undefined, null, 42, [], {}, true]) {
    assert.equal(cleanNote(bad), '');
    assert.equal(normalizeDay({ note: bad }, 'Monday').note, '');
  }
});

test('a note keeps its line breaks — it is written in lines, not a sentence', () => {
  // Flattening it would change what somebody wrote.
  assert.equal(cleanNote('check the fridge\nbutter is low'), 'check the fridge\nbutter is low');
  assert.equal(cleanNote('  spaced  '), 'spaced');
});

test('an over-long note is cut rather than refused', () => {
  // Unlike a pastry NAME, a note has no second field depending on it and no
  // duplicate to collide with: keeping the first 500 characters loses less than
  // refusing the save would.
  assert.equal(cleanNote('x'.repeat(900)).length, MAX_NOTE_LENGTH);
  assert.equal(normalizeDay({ note: 'x'.repeat(900) }, 'Monday').note.length, MAX_NOTE_LENGTH);
});

test('the note travels with the day, and an empty one is not undefined', () => {
  const day = normalizeDay({ items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof' }, 'Monday');
  assert.deepEqual(day, {
    day: 'Monday', items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof',
  });
  assert.equal(normalizeDays([{ id: 'Monday', items: [], note: 'x' }]).Monday.note, 'x');
  assert.equal(normalizeDays([{ id: 'Monday', items: [] }]).Tuesday.note, '');
});

// ── The cache written by an older version ────────────────────────────────────
//
// This runs once per device, on the first open after an update, BEFORE the
// network answers — so it is never exercised by hand and a mistake here shows up
// as "all seven days were empty for a second", on every phone, once.

test('a cache written before notes existed still paints its lists', () => {
  // ⚠️ The old shape: the value under each weekday IS the items array.
  const old = {
    Monday: [{ name: 'Cornetti', qty: 24 }],
    Tuesday: [{ name: 'Bomboloni', qty: 10 }],
  };
  const days = daysFromCache(old);
  assert.deepEqual(days.Monday, { items: [{ name: 'Cornetti', qty: 24 }], note: '' });
  assert.deepEqual(days.Tuesday.items, [{ name: 'Bomboloni', qty: 10 }]);
  assert.deepEqual(days.Sunday, { items: [], note: '' });
  assert.deepEqual(Object.keys(days), [...WEEKDAYS]);
});

test('a cache written with notes reads back with them', () => {
  const days = daysFromCache({
    Monday: { items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof' },
  });
  assert.equal(days.Monday.note, 'slow proof');
  assert.deepEqual(days.Monday.items, [{ name: 'Cornetti', qty: 24 }]);
});

test('a corrupt or absent cache is an empty week, never a crash', () => {
  for (const bad of [null, undefined, 'nonsense', 42, [], { Monday: 'x' }, { Monday: 7 }]) {
    const days = daysFromCache(bad);
    assert.deepEqual(Object.keys(days), [...WEEKDAYS]);
    WEEKDAYS.forEach(d => assert.deepEqual(days[d], { items: [], note: '' }));
  }
});

test('a cached day is cleaned exactly as a Firestore read would be', () => {
  // The cache is this app's own storage, but it is still storage other code can
  // reach — so the same guarantees have to hold on the offline path.
  const days = daysFromCache({
    Monday: { items: Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 })) },
    Tuesday: { items: [1, null, { name: '  Cornetti  ', qty: '24' }], note: 42 },
  });
  assert.equal(days.Monday.items.length, MAX_ITEMS);
  assert.deepEqual(days.Tuesday.items, [{ name: 'Cornetti', qty: 24 }]);
  assert.equal(days.Tuesday.note, '');
});

// ── Changing one quantity from the day list ──────────────────────────────────

test('a quantity lands on the row it was typed on', () => {
  const items = [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }];
  const next = setQuantityAt(items, 1, 18, 'Bomboloni');
  assert.deepEqual(next, [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 18 }]);
  // and the original is untouched — the store replaces the whole day, so a
  // mutated input would corrupt the copy it is about to compare against.
  assert.deepEqual(items, [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
});

test('a row that moved under your finger is REFUSED, not written to the wrong pastry', () => {
  // ⚠️ The whole reason the name is checked as well as the index. Minutes can
  // pass between drawing a row and tapping its tick, and a snapshot from another
  // phone can reorder the list in between.
  const items = [{ name: 'Bomboloni', qty: 10 }, { name: 'Cornetti', qty: 24 }];
  assert.equal(setQuantityAt(items, 0, 99, 'Cornetti'), null);
  assert.equal(setQuantityAt(items, 5, 99, 'Cornetti'), null);
  assert.equal(setQuantityAt(items, -1, 99, 'Cornetti'), null);
  assert.equal(setQuantityAt(items, 0, 99, undefined), null);
  assert.equal(setQuantityAt([], 0, 99, 'Cornetti'), null);
  assert.equal(setQuantityAt(null, 0, 99, 'Cornetti'), null);
});

test('the name check forgives capitals and spaces, like the duplicate check does', () => {
  const items = [{ name: 'Pain au chocolat', qty: 5 }];
  assert.deepEqual(setQuantityAt(items, 0, 8, '  pain AU chocolat '),
    [{ name: 'Pain au chocolat', qty: 8 }]);
});

test('a quantity set from the list is cleaned like any other', () => {
  const items = [{ name: 'Cornetti', qty: 24 }];
  assert.equal(setQuantityAt(items, 0, '18', 'Cornetti')[0].qty, 18);
  assert.equal(setQuantityAt(items, 0, 18.6, 'Cornetti')[0].qty, 19);
  assert.equal(setQuantityAt(items, 0, 1e999, 'Cornetti')[0].qty, 0);
  assert.equal(setQuantityAt(items, 0, -4, 'Cornetti')[0].qty, 0);
});

test('what survives cleaning is exactly what a save would accept', () => {
  // The round trip the editor relies on: clean, then validate, then store.
  const typed = [
    { name: '  Cornetti  ', qty: '24' },
    { name: '', qty: '' },
    { name: 'Bomboloni', qty: 10.4 },
  ];
  const clean = cleanItems(typed);
  assert.equal(findInvalidItems(clean), null);
  assert.deepEqual(clean, [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
  assert.deepEqual(normalizeDay({ items: clean }, 'Monday').items, clean);
});
