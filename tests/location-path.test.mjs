// Unit tests for the tenant path builder (P15).
//
// This is the boundary between two locations' data. The tests that matter are
// the REFUSALS: every input that could send a write somewhere other than the
// intended location's folder must throw, because the alternative — quietly
// writing into a shared or wrong location — is invisible until someone sees
// another location's suppliers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCATION_ID,
  isValidLocationId,
  buildPath,
  locationDocPath,
  currentLocationId,
  setCurrentLocationId,
  clearCurrentLocationId,
  isLocationSet,
  pathFor,
} from '../js/location.js';

test('a collection name becomes a path inside the location folder', () => {
  assert.equal(buildPath('bakery', 'suppliers'), 'locations/bakery/suppliers');
  assert.equal(buildPath('trattoria-x', 'orders-history'), 'locations/trattoria-x/orders-history');
});

test('the location document has its own path', () => {
  assert.equal(locationDocPath('bakery'), 'locations/bakery');
});

test('a slash in the location id is REFUSED, not sanitised', () => {
  // '../suppliers' or 'main/../other' would re-point the write. Throwing is the
  // whole point: a screen that errors is fixable, a wrong write is not noticed.
  ['a/b', '../x', 'main/', '/main', 'locations/bakery'].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid location id/, `${bad} must throw`);
  });
});

test('an empty or non-string location id is REFUSED', () => {
  [undefined, null, '', ' ', 0, 42, {}, [], true].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid location id/,
      `${JSON.stringify(bad)} must throw`);
  });
});

test('a dotted id is refused (Firestore reserves . and ..)', () => {
  ['.', '..', '.hidden'].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid location id/);
  });
});

test('an id longer than the limit is refused', () => {
  assert.ok(isValidLocationId('a'.repeat(64)));
  assert.equal(isValidLocationId('a'.repeat(65)), false);
});

test('a bad collection name is refused too', () => {
  [undefined, null, '', 'a/b', 42].forEach(bad => {
    assert.throws(() => buildPath('main', bad), /Invalid collection name/,
      `${JSON.stringify(bad)} must throw`);
  });
});

test('before sign-in there is NO location, and asking for a path throws', () => {
  // The single most important behaviour in this file. A default here would mean
  // a read that fires before sign-in silently uses another location's folder,
  // and the screen would look completely normal.
  clearCurrentLocationId();
  assert.equal(isLocationSet(), false);
  assert.equal(currentLocationId(), null);
  assert.throws(() => pathFor('ingredients'), /No location is open yet/);
});

test('once the session opens a location, pathFor follows it', () => {
  try {
    setCurrentLocationId(DEFAULT_LOCATION_ID);
    assert.equal(isLocationSet(), true);
    assert.equal(pathFor('ingredients'), 'locations/bakery/ingredients');
  } finally {
    clearCurrentLocationId();
  }
});

test('setting the current location moves every path with it', () => {
  try {
    setCurrentLocationId('trattoria-x');
    assert.equal(currentLocationId(), 'trattoria-x');
    assert.equal(pathFor('suppliers'), 'locations/trattoria-x/suppliers');
  } finally {
    clearCurrentLocationId(); // never leak state between tests
  }
});

test('setting an invalid location throws and leaves the current one alone', () => {
  try {
    setCurrentLocationId('main');
    assert.throws(() => setCurrentLocationId('bad/id'), /Invalid location id/);
    assert.equal(currentLocationId(), 'main');
  } finally {
    clearCurrentLocationId();
  }
});
