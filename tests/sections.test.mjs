// Unit tests for the two session decisions (P15).
//
// The pair of defaults is the whole point of this file, and they deliberately
// point in opposite directions:
//   - a broken `sections` field must NOT empty a working location's app;
//   - a broken `users/{uid}` document MUST mean no access at all.
// Getting either backwards is invisible in the code and obvious in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS,
  allowedSections,
  isSectionAllowed,
  locationsOf,
  pickLocation,
} from '../js/sections.js';

// ── Sections: default ALLOWED ────────────────────────────────────────────────

test('no location document: every section stays available', () => {
  assert.deepEqual(allowedSections(null), { orders: true, calculator: true, catalogue: true });
  assert.deepEqual(allowedSections(undefined), { orders: true, calculator: true, catalogue: true });
});

test('a document without the field: every section stays available', () => {
  assert.deepEqual(allowedSections({ name: 'The Italian Club' }),
    { orders: true, calculator: true, catalogue: true });
});

test('only an explicit false hides a section', () => {
  const doc = { sections: { orders: true, calculator: false, catalogue: false } };
  assert.deepEqual(allowedSections(doc), { orders: true, calculator: false, catalogue: false });
  assert.equal(isSectionAllowed(doc, 'orders'), true);
  assert.equal(isSectionAllowed(doc, 'calculator'), false);
});

test('a corrupt sections field leaves the app whole rather than emptying it', () => {
  ['nonsense', 42, [], true, null].forEach(bad => {
    assert.deepEqual(allowedSections({ sections: bad }),
      { orders: true, calculator: true, catalogue: true },
      `sections: ${JSON.stringify(bad)} must not hide anything`);
  });
  // A value that is merely not `false` is not a hide instruction either.
  assert.equal(allowedSections({ sections: { orders: 'no' } }).orders, true);
});

test('an unknown section name in the document is ignored, not rendered', () => {
  const out = allowedSections({ sections: { orders: true, invoices: true } });
  assert.deepEqual(Object.keys(out), [...SECTIONS]);
});

// ── Sections: a name typed with stray spaces still counts ────────────────────
//
// Straight from production (30 July 2026): the restaurant's document was saved
// with `sections ` and `calculator `, spaces that are invisible in the Firebase
// console. The app found no field, defaulted every section ON, and showed three
// cards to a location set up for one — with nothing anywhere saying why.

test('a trailing space in the sections field name does not silently void it', () => {
  const out = allowedSections({ 'sections ': { orders: true, calculator: false, catalogue: false } });
  assert.deepEqual(out, { orders: true, calculator: false, catalogue: false });
});

test('a trailing space in a section name does not silently void it', () => {
  const out = allowedSections({ sections: { orders: true, 'calculator ': false, ' catalogue': false } });
  assert.deepEqual(out, { orders: true, calculator: false, catalogue: false });
});

test('the exact name always wins over a spaced one, so it is never ambiguous', () => {
  const doc = { sections: { calculator: false }, 'sections ': { calculator: true } };
  assert.equal(allowedSections(doc).calculator, false);

  const inner = { sections: { 'calculator ': true, calculator: false } };
  assert.equal(allowedSections(inner).calculator, false);
});

// ── Membership: default NONE ─────────────────────────────────────────────────

test('no user document means no locations — never all of them', () => {
  assert.deepEqual(locationsOf(null), []);
  assert.deepEqual(locationsOf(undefined), []);
  assert.deepEqual(locationsOf({}), []);
  assert.deepEqual(locationsOf({ locations: null }), []);
});

test('a corrupt locations field means no locations', () => {
  ['main', 42, ['main'], true].forEach(bad => {
    assert.deepEqual(locationsOf({ locations: bad }), [],
      `locations: ${JSON.stringify(bad)} must grant nothing`);
  });
});

test('only entries explicitly set to true count as access', () => {
  const doc = { locations: { main: true, 'trattoria-x': false, ghost: 'yes', other: 1 } };
  assert.deepEqual(locationsOf(doc), ['main']);
});

// The asymmetry with allowedSections is deliberate, and this test is what stops
// somebody "fixing" it later: firestore.rules reads this same map and does NOT
// forgive a stray space. Forgiving one here would open the app on a location the
// database then refuses on every read — permission errors everywhere instead of
// one honest "no access".
test('a location id typed with a space grants nothing — unlike sections', () => {
  assert.deepEqual(locationsOf({ locations: { 'restaurant ': true } }), []);
  assert.deepEqual(locationsOf({ 'locations ': { restaurant: true } }), []);
});

test('an unusable id is dropped, so sign-in says "no access" instead of throwing', () => {
  const doc = { locations: { 'bakery/../secret': true, '': true, 'a b': true, bakery: true } };
  assert.deepEqual(locationsOf(doc), ['bakery']);
});

test('several locations come back in a stable order', () => {
  assert.deepEqual(locationsOf({ locations: { zeta: true, alfa: true, main: true } }),
    ['alfa', 'main', 'zeta']);
});

// ── Which location this session opens ──────────────────────────────────────

test('one location: straight in, no question asked', () => {
  const out = pickLocation({ locations: { main: true } }, null);
  assert.deepEqual(out, { status: 'ready', locationId: 'main', options: ['main'] });
});

test('two locations and no previous choice: ask', () => {
  const out = pickLocation({ locations: { main: true, 'trattoria-x': true } }, null);
  assert.equal(out.status, 'choose');
  assert.deepEqual(out.options, ['main', 'trattoria-x']);
  assert.equal(out.locationId, undefined);
});

test('two locations and a remembered one: go back where you were', () => {
  const out = pickLocation({ locations: { main: true, 'trattoria-x': true } }, 'trattoria-x');
  assert.equal(out.status, 'ready');
  assert.equal(out.locationId, 'trattoria-x');
});

test('a remembered location that is no longer yours is ignored', () => {
  // Access was taken away; a phone must not keep it alive from local storage.
  const out = pickLocation({ locations: { main: true, 'trattoria-x': true } }, 'sold-last-year');
  assert.equal(out.status, 'choose');

  const single = pickLocation({ locations: { main: true } }, 'sold-last-year');
  assert.equal(single.status, 'ready');
  assert.equal(single.locationId, 'main');
});

test('an account with no location is a named state, not a crash', () => {
  assert.deepEqual(pickLocation(null, 'main'), { status: 'none', options: [] });
  assert.deepEqual(pickLocation({ locations: {} }, null), { status: 'none', options: [] });
});
