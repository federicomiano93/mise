// Unit tests for the two session decisions (P15).
//
// The pair of defaults is the whole point of this file, and they deliberately
// point in opposite directions:
//   - a broken `sections` field must NOT empty a working restaurant's app;
//   - a broken `users/{uid}` document MUST mean no access at all.
// Getting either backwards is invisible in the code and obvious in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS,
  allowedSections,
  isSectionAllowed,
  restaurantsOf,
  pickRestaurant,
} from '../js/sections.js';

// ── Sections: default ALLOWED ────────────────────────────────────────────────

test('no restaurant document: every section stays available', () => {
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

test('no user document means no restaurants — never all of them', () => {
  assert.deepEqual(restaurantsOf(null), []);
  assert.deepEqual(restaurantsOf(undefined), []);
  assert.deepEqual(restaurantsOf({}), []);
  assert.deepEqual(restaurantsOf({ restaurants: null }), []);
});

test('a corrupt restaurants field means no restaurants', () => {
  ['main', 42, ['main'], true].forEach(bad => {
    assert.deepEqual(restaurantsOf({ restaurants: bad }), [],
      `restaurants: ${JSON.stringify(bad)} must grant nothing`);
  });
});

test('only entries explicitly set to true count as access', () => {
  const doc = { restaurants: { main: true, 'trattoria-x': false, ghost: 'yes', other: 1 } };
  assert.deepEqual(restaurantsOf(doc), ['main']);
});

test('several restaurants come back in a stable order', () => {
  assert.deepEqual(restaurantsOf({ restaurants: { zeta: true, alfa: true, main: true } }),
    ['alfa', 'main', 'zeta']);
});

// ── Which restaurant this session opens ──────────────────────────────────────

test('one restaurant: straight in, no question asked', () => {
  const out = pickRestaurant({ restaurants: { main: true } }, null);
  assert.deepEqual(out, { status: 'ready', restaurantId: 'main', options: ['main'] });
});

test('two restaurants and no previous choice: ask', () => {
  const out = pickRestaurant({ restaurants: { main: true, 'trattoria-x': true } }, null);
  assert.equal(out.status, 'choose');
  assert.deepEqual(out.options, ['main', 'trattoria-x']);
  assert.equal(out.restaurantId, undefined);
});

test('two restaurants and a remembered one: go back where you were', () => {
  const out = pickRestaurant({ restaurants: { main: true, 'trattoria-x': true } }, 'trattoria-x');
  assert.equal(out.status, 'ready');
  assert.equal(out.restaurantId, 'trattoria-x');
});

test('a remembered restaurant that is no longer yours is ignored', () => {
  // Access was taken away; a phone must not keep it alive from local storage.
  const out = pickRestaurant({ restaurants: { main: true, 'trattoria-x': true } }, 'sold-last-year');
  assert.equal(out.status, 'choose');

  const single = pickRestaurant({ restaurants: { main: true } }, 'sold-last-year');
  assert.equal(single.status, 'ready');
  assert.equal(single.restaurantId, 'main');
});

test('an account with no restaurant is a named state, not a crash', () => {
  assert.deepEqual(pickRestaurant(null, 'main'), { status: 'none', options: [] });
  assert.deepEqual(pickRestaurant({ restaurants: {} }, null), { status: 'none', options: [] });
});
