// Where the working week starts, and what "this week" means.
//
// ⚠️ THE TEST THAT MATTERS MOST IS THE BOUNDARY DAY ITSELF. Every off-by-one in a week
// calculation lives on the first day: getting it wrong moves an entire week's orders
// into the wrong bucket, silently, and only on one day out of seven — which is exactly
// the kind of defect that ships and is found six weeks later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKDAYS, DEFAULT_WEEK_START, weekStartOf, isValidWeekStart,
  weekStart, inCurrentWeek, beforeCurrentWeek,
} from '../js/orders/work-week.js';

// 2026-08-14 is a Friday. 2026-08-09 is the Sunday before it.
const FRI = '2026-08-14';
const SUN = '2026-08-09';
const SAT = '2026-08-15';

// ── ⚠️ THE BOUNDARY DAY ──────────────────────────────────────────────────────

// ⚠️ THE STARTING DAY BELONGS TO THE WEEK IT OPENS, not the one it closes. Get this
// backwards and every Sunday the whole of the coming week reads as "last week".
test('⚠️ the starting day belongs to the week it OPENS', () => {
  assert.equal(weekStart(SUN, 'Sunday'), SUN, 'Sunday opens its own week');
  assert.equal(inCurrentWeek(SUN, SUN, 'Sunday'), true);
  assert.equal(beforeCurrentWeek(SUN, SUN, 'Sunday'), false);
});

test('the Sunday→Saturday week, from any day inside it', () => {
  assert.equal(weekStart(FRI, 'Sunday'), SUN);
  assert.equal(weekStart(SAT, 'Sunday'), SUN, 'Saturday is the LAST day, not a new week');
  assert.equal(weekStart('2026-08-16', 'Sunday'), '2026-08-16', 'the next Sunday opens the next one');
});

// ⚠️ The whole point of the setting: the same day lands in a different week.
test('⚠️ a Monday start really moves the boundary', () => {
  assert.equal(weekStart(FRI, 'Monday'), '2026-08-10');
  // Sunday the 9th is the END of the Monday-start week, but the START of a Sunday one.
  assert.equal(inCurrentWeek(SUN, FRI, 'Monday'), false, 'Sunday 9th is last week when weeks start Monday');
  assert.equal(inCurrentWeek(SUN, FRI, 'Sunday'), true, 'and this week when they start Sunday');
});

test('the last day of the week is IN it, the day before the first is not', () => {
  assert.equal(inCurrentWeek(SAT, FRI, 'Sunday'), true, 'Saturday closes the week');
  assert.equal(inCurrentWeek('2026-08-08', FRI, 'Sunday'), false, 'the Saturday before does not');
  assert.equal(beforeCurrentWeek('2026-08-08', FRI, 'Sunday'), true);
});

// ── ⚠️ WHAT MUST NOT HAPPEN ──────────────────────────────────────────────────

// ⚠️ AN UNREADABLE SETTING LEAVES A WORKING SCREEN. Falling back to "no week at all"
// would empty the list and look exactly like the feature working.
test('⚠️ anything unrecognised falls back to the default, never to no week', () => {
  [undefined, null, {}, { weekStartsOn: '' }, { weekStartsOn: 'Funday' },
   { weekStartsOn: 42 }, { weekStartsOn: ['Monday'] }].forEach(doc => {
    assert.equal(weekStartOf(doc), DEFAULT_WEEK_START, JSON.stringify(doc));
  });
  assert.equal(DEFAULT_WEEK_START, 'Sunday', 'the UK week Federico named');
});

test('a real setting is honoured, whatever case it was stored in', () => {
  assert.equal(weekStartOf({ weekStartsOn: 'Monday' }), 'Monday');
  assert.equal(weekStartOf({ weekStartsOn: 'monday' }), 'Monday');
  assert.equal(weekStartOf({ weekStartsOn: '  Monday  ' }), 'Monday');
});

test('only a real weekday is valid, and the list is the one day.js uses', () => {
  assert.equal(isValidWeekStart('Sunday'), true);
  assert.equal(isValidWeekStart('Funday'), false);
  assert.equal(isValidWeekStart(''), false);
  assert.equal(isValidWeekStart(null), false);
  assert.deepEqual([...WEEKDAYS],
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
});

test('junk in, no throw out', () => {
  assert.equal(weekStart('', 'Sunday'), '');
  assert.equal(weekStart('not-a-date', 'Sunday'), '');
  assert.equal(inCurrentWeek('2026-08-14', '', 'Sunday'), false);
  assert.equal(inCurrentWeek('', FRI, 'Sunday'), false);
  assert.equal(beforeCurrentWeek('', FRI, 'Sunday'), false);
});

// ⚠️ An unknown start day must not silently shift the boundary by an arbitrary amount:
// indexOf returns -1, and -1 as a day index would move every week by a day.
test('⚠️ an unknown start day does not shift the week by minus one', () => {
  assert.equal(weekStart(FRI, 'Funday'), weekStart(FRI, 'Sunday'));
});

// ── The window is a WINDOW, and the past is what has to be answered for ──────

test('an order from three weeks ago is not in this week, and IS before it', () => {
  const old = '2026-07-20';
  assert.equal(inCurrentWeek(old, FRI, 'Sunday'), false);
  assert.equal(beforeCurrentWeek(old, FRI, 'Sunday'), true,
    'which is what puts it in front of somebody instead of dropping it');
});

// ⚠️ A future-dated order is neither: it has not happened yet, so it is not overdue.
test('a day in the future is not "before this week"', () => {
  assert.equal(beforeCurrentWeek('2026-09-01', FRI, 'Sunday'), false);
  assert.equal(inCurrentWeek('2026-09-01', FRI, 'Sunday'), false);
});
