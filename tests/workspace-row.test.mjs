// Unit tests for what a line of the Businesses list says (P15).
//
// ⚠️ Nearly every test here pushes in ONE direction: an uncertain answer must come
// out as "stranded". That is deliberate. The dangerous answer this module can give
// is telling somebody a business is running when nobody has ever opened it —
// because that is the row whose link never arrived, whose link cannot be shown
// again, and whose only remaining way in is the button this status decides to draw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStranded, statusOf, statusWords, STATUS_WORDS,
  sectionNames, sectionSummary, createdWords,
} from '../js/workspace-row.js';

// ── The one distinction that matters ─────────────────────────────────────────

test('a business somebody has opened is open', () => {
  const row = { id: 'loc-1', claimed: true };
  assert.equal(statusOf(row), 'open');
  assert.equal(isStranded(row), false);
});

test('a business nobody has opened is stranded', () => {
  const row = { id: 'loc-1', claimed: false };
  assert.equal(statusOf(row), 'stranded');
  assert.equal(isStranded(row), true);
});

// ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Anything that is not exactly `true`
// leaves the row stranded and keeps the re-issue button on screen. Being told to
// re-send a link that had already been used costs one message; being told nothing
// about a customer who cannot get in costs the customer.
test('every uncertain answer is stranded, never open', () => {
  for (const claimed of [undefined, null, 0, 1, '', 'true', 'yes', {}, [], NaN]) {
    assert.equal(statusOf({ claimed }), 'stranded', String(claimed));
    assert.equal(isStranded({ claimed }), true, String(claimed));
  }
});

test('no row at all is stranded rather than a crash', () => {
  for (const row of [null, undefined, 'loc-1', 42, []]) {
    assert.equal(statusOf(row), 'stranded', String(row));
  }
  assert.equal(isStranded(null), true);
  assert.equal(isStranded(undefined), true);
});

test('the words say which of the two it is, in a sentence', () => {
  assert.equal(statusWords({ claimed: true }), STATUS_WORDS.open);
  assert.equal(statusWords({ claimed: false }), STATUS_WORDS.stranded);
  assert.match(STATUS_WORDS.stranded, /Nobody/);
  assert.notEqual(STATUS_WORDS.open, STATUS_WORDS.stranded);
});

// ── What they bought ─────────────────────────────────────────────────────────

test('the sections are named in the words the Home uses', () => {
  assert.deepEqual(sectionNames({ calculator: true, orders: true }),
    ['Calculator', 'Orders']);
});

test('the order is the Home\'s order, not the object\'s', () => {
  // Whatever order the server happened to serialise them in, the reader sees one
  // consistent order across every row.
  assert.deepEqual(sectionNames({ foodcost: true, calculator: true, orders: true }),
    ['Calculator', 'Orders', 'Food cost']);
});

// ⚠️ EVERYWHERE ELSE IN THIS APP A MISSING SECTION MEANS ON — a forgotten field
// must not empty a working app. Here that default would be a LIE about what
// somebody bought, so this asks for the word itself.
test('a missing section is NOT counted as bought', () => {
  assert.deepEqual(sectionNames({ calculator: true }), ['Calculator']);
  assert.deepEqual(sectionNames({ calculator: true, orders: false }), ['Calculator']);
  assert.deepEqual(sectionNames({ calculator: true, orders: 'true' }), ['Calculator'],
    'a string is not the boolean true');
});

test('a section nobody recognises is ignored, not printed raw', () => {
  assert.deepEqual(sectionNames({ calculator: true, teleportation: true }), ['Calculator']);
});

test('no sections at all says so rather than showing an empty gap', () => {
  assert.equal(sectionSummary({}), 'No sections');
  assert.equal(sectionSummary(null), 'No sections');
  assert.equal(sectionSummary({ orders: false }), 'No sections');
});

test('several sections read as one line', () => {
  assert.equal(sectionSummary({ calculator: true, orders: true }), 'Calculator · Orders');
});

// ── When ─────────────────────────────────────────────────────────────────────

test('the date is written so a month can never be read as a day', () => {
  const when = Date.UTC(2026, 7, 12, 10, 0, 0);   // 12 August 2026
  assert.equal(createdWords(when, when + 1000), 'Created 12 Aug 2026');
});

test('a missing or broken date says so instead of printing 1970', () => {
  for (const bad of [undefined, null, 0, -1, NaN, 'yesterday', {}]) {
    assert.equal(createdWords(bad, Date.now()), 'Created recently', String(bad));
  }
});

// A phone with a wrong clock, or a server slightly ahead: report today rather
// than a date in the future, which reads as a bug to whoever sees it.
test('a date in the future is reported as today, not as the future', () => {
  const now = Date.UTC(2026, 7, 12, 10, 0, 0);
  const later = now + 5 * 24 * 60 * 60 * 1000;
  assert.equal(createdWords(later, now), 'Created 12 Aug 2026');
});
