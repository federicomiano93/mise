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
