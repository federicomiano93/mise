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
  pickStart,
} from '../js/sections.js';

// ── Sections: default ALLOWED ────────────────────────────────────────────────

const ALL_ON = { orders: true, calculator: true, catalogue: true, pastries: true, foodcost: true };

test('no location document: every section stays available', () => {
  assert.deepEqual(allowedSections(null), ALL_ON);
  assert.deepEqual(allowedSections(undefined), ALL_ON);
});

test('a document without the field: every section stays available', () => {
  assert.deepEqual(allowedSections({ name: 'The Italian Club' }), ALL_ON);
});

test('only an explicit false hides a section', () => {
  const doc = { sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false } };
  assert.deepEqual(allowedSections(doc),
    { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
  assert.equal(isSectionAllowed(doc, 'orders'), true);
  assert.equal(isSectionAllowed(doc, 'calculator'), false);
});

test('a corrupt sections field leaves the app whole rather than emptying it', () => {
  ['nonsense', 42, [], true, null].forEach(bad => {
    assert.deepEqual(allowedSections({ sections: bad }), ALL_ON,
      `sections: ${JSON.stringify(bad)} must not hide anything`);
  });
  // A value that is merely not `false` is not a hide instruction either.
  assert.equal(allowedSections({ sections: { orders: 'no' } }).orders, true);
});

// ⚠️ THE COST OF THAT DEFAULT, WRITTEN DOWN ONCE.
//
// Every location document in production was written before Pastries existed, so
// none of them mentions it — and a missing key means ON. Adding a section to
// SECTIONS therefore switches it on for EVERY existing venue until someone types
// `sections.<name>: false` into the ones that should not have it.
//
// That is not merely cosmetic: firestore.rules carries the same default, so a
// venue showing a section it does not want can also WRITE that collection. The
// console edit is part of shipping a section, not a tidy-up afterwards.
test('a venue set up before a section existed still gets it — a missing key means on', () => {
  const beforePastries = { sections: { orders: true, calculator: false, catalogue: false } };
  assert.equal(allowedSections(beforePastries).pastries, true);
  assert.equal(isSectionAllowed(beforePastries, 'pastries'), true);

  const afterTheConsoleEdit = {
    sections: { orders: true, calculator: false, catalogue: false, pastries: false },
  };
  assert.equal(isSectionAllowed(afterTheConsoleEdit, 'pastries'), false);

  // Food Cost is the newest one, and the same thing is true of it: every location
  // document in production predates it, so every venue gets it until somebody
  // types the false in. The restaurant is the one that must not have it.
  assert.equal(allowedSections(afterTheConsoleEdit).foodcost, true);
  assert.equal(isSectionAllowed({
    sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false },
  }, 'foodcost'), false);
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
  const out = allowedSections({
    'sections ': { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false },
  });
  assert.deepEqual(out, { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
});

test('a trailing space in a section name does not silently void it', () => {
  const out = allowedSections({
    sections: { orders: true, 'calculator ': false, ' catalogue': false, 'pastries ': false, 'foodcost ': false },
  });
  assert.deepEqual(out, { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
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

// ── Where opening the app LANDS ────────────────────────────────────────────
//
// One step above pickLocation. Everything here pushes in one direction: the hub
// is the app administrator's screen and nobody else's, because for everybody
// else it is a door they must open every morning to reach the only room behind it.

const TWO = { locations: { main: 'owner', 'trattoria-x': 'owner' } };

test('an ordinary account never sees the hub, whatever it holds', () => {
  for (const doc of [TWO, { locations: { main: true } }, { locations: {} }, null]) {
    assert.notEqual(pickStart(doc, { remembered: 'main' }).status, 'hub');
  }
});

test('an ordinary account lands exactly where pickLocation says', () => {
  assert.deepEqual(pickStart(TWO, { remembered: 'main' }), pickLocation(TWO, 'main'));
  assert.deepEqual(pickStart(TWO, {}), pickLocation(TWO, ''));
  assert.deepEqual(pickStart(null, {}), pickLocation(null, ''));
});

test('the app administrator opens on the hub', () => {
  const out = pickStart(TWO, { isAppAdmin: true, remembered: 'main' });
  assert.equal(out.status, 'hub');
  assert.deepEqual(out.options, ['main', 'trattoria-x']);
});

// ⚠️ A remembered venue must NOT skip the hub. It is what "open the app and you
// are in Misé" means; skipping it would make the hub reachable only on the very
// first open of a device and never again.
test('a remembered venue does not skip the hub', () => {
  assert.equal(pickStart(TWO, { isAppAdmin: true, remembered: 'trattoria-x' }).status, 'hub');
});

// ⚠️ THE TEST THIS FEATURE LIVES OR DIES BY. Once past the hub the app is being
// used — every page change re-asks this question, and answering "hub" again
// would throw somebody out of the Calculator on the way to Orders.
test('past the hub, a page change goes straight back to the venue', () => {
  const out = pickStart(TWO, { isAppAdmin: true, hubPassed: true, remembered: 'trattoria-x' });
  assert.equal(out.status, 'ready');
  assert.equal(out.locationId, 'trattoria-x');
});

test('past the hub with nothing remembered, the picker still asks', () => {
  assert.equal(pickStart(TWO, { isAppAdmin: true, hubPassed: true }).status, 'choose');
});

// ⚠️ The one case that would otherwise hide the whole back office behind a
// message about a problem: an administrator who sells the app and runs no venue
// of their own. "No location yet" would be the only screen they ever saw.
test('an administrator with no venue of their own still gets the hub', () => {
  const out = pickStart({ locations: {} }, { isAppAdmin: true });
  assert.equal(out.status, 'hub');
  assert.deepEqual(out.options, []);
  assert.equal(pickStart(null, { isAppAdmin: true }).status, 'hub');
});

// Same bias as every other guard in this app: a value nobody understands is the
// LEAST power, never the most. Only the boolean true is an administrator.
test('anything that is not exactly true is not an administrator', () => {
  for (const value of ['true', 1, {}, [], 'owner', 'yes']) {
    assert.notEqual(pickStart(TWO, { isAppAdmin: value }).status, 'hub', String(value));
  }
});

test('anything that is not exactly true has not passed the hub', () => {
  for (const value of ['true', 1, {}, [], 'yes']) {
    assert.equal(pickStart(TWO, { isAppAdmin: true, hubPassed: value }).status, 'hub', String(value));
  }
});

test('no options at all is not a crash', () => {
  assert.equal(pickStart(null, {}).status, 'none');
  assert.equal(pickStart(undefined, undefined).status, 'none');
});
