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
  pathFor,
} from '../js/location.js';

test('a collection name becomes a path inside the location folder', () => {
  assert.equal(buildPath('main', 'suppliers'), 'locations/main/suppliers');
  assert.equal(buildPath('trattoria-x', 'orders-history'), 'locations/trattoria-x/orders-history');
});

test('the location document has its own path', () => {
  assert.equal(locationDocPath('main'), 'locations/main');
});

test('a slash in the location id is REFUSED, not sanitised', () => {
  // '../suppliers' or 'main/../other' would re-point the write. Throwing is the
  // whole point: a screen that errors is fixable, a wrong write is not noticed.
  ['a/b', '../x', 'main/', '/main', 'locations/main'].forEach(bad => {
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

test('the session starts on the bakery and pathFor follows it', () => {
  // 'bakery' is The Italian Club Bakery, the place that has always used the app.
  // The restaurant joining later gets its own id and its own folder.
  assert.equal(DEFAULT_LOCATION_ID, 'bakery');
  assert.equal(currentLocationId(), 'bakery');
  assert.equal(pathFor('ingredients'), 'locations/bakery/ingredients');
});

test('setting the current location moves every path with it', () => {
  try {
    setCurrentLocationId('trattoria-x');
    assert.equal(currentLocationId(), 'trattoria-x');
    assert.equal(pathFor('suppliers'), 'locations/trattoria-x/suppliers');
  } finally {
    setCurrentLocationId(DEFAULT_LOCATION_ID); // never leak state between tests
  }
});

test('setting an invalid location throws and leaves the current one alone', () => {
  assert.throws(() => setCurrentLocationId('bad/id'), /Invalid location id/);
  assert.equal(currentLocationId(), 'bakery');
});
