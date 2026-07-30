// Unit tests for the tenant path builder (P15).
//
// This is the boundary between two restaurants' data. The tests that matter are
// the REFUSALS: every input that could send a write somewhere other than the
// intended restaurant's folder must throw, because the alternative — quietly
// writing into a shared or wrong location — is invisible until someone sees
// another restaurant's suppliers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RESTAURANT_ID,
  isValidRestaurantId,
  buildPath,
  restaurantDocPath,
  currentRestaurantId,
  setCurrentRestaurantId,
  pathFor,
} from '../js/restaurant.js';

test('a collection name becomes a path inside the restaurant folder', () => {
  assert.equal(buildPath('main', 'suppliers'), 'restaurants/main/suppliers');
  assert.equal(buildPath('trattoria-x', 'orders-history'), 'restaurants/trattoria-x/orders-history');
});

test('the restaurant document has its own path', () => {
  assert.equal(restaurantDocPath('main'), 'restaurants/main');
});

test('a slash in the restaurant id is REFUSED, not sanitised', () => {
  // '../suppliers' or 'main/../other' would re-point the write. Throwing is the
  // whole point: a screen that errors is fixable, a wrong write is not noticed.
  ['a/b', '../x', 'main/', '/main', 'restaurants/main'].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid restaurant id/, `${bad} must throw`);
  });
});

test('an empty or non-string restaurant id is REFUSED', () => {
  [undefined, null, '', ' ', 0, 42, {}, [], true].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid restaurant id/,
      `${JSON.stringify(bad)} must throw`);
  });
});

test('a dotted id is refused (Firestore reserves . and ..)', () => {
  ['.', '..', '.hidden'].forEach(bad => {
    assert.throws(() => buildPath(bad, 'suppliers'), /Invalid restaurant id/);
  });
});

test('an id longer than the limit is refused', () => {
  assert.ok(isValidRestaurantId('a'.repeat(64)));
  assert.equal(isValidRestaurantId('a'.repeat(65)), false);
});

test('a bad collection name is refused too', () => {
  [undefined, null, '', 'a/b', 42].forEach(bad => {
    assert.throws(() => buildPath('main', bad), /Invalid collection name/,
      `${JSON.stringify(bad)} must throw`);
  });
});

test('the session starts on the Italian Club and pathFor follows it', () => {
  assert.equal(DEFAULT_RESTAURANT_ID, 'main');
  assert.equal(currentRestaurantId(), 'main');
  assert.equal(pathFor('ingredients'), 'restaurants/main/ingredients');
});

test('setting the current restaurant moves every path with it', () => {
  try {
    setCurrentRestaurantId('trattoria-x');
    assert.equal(currentRestaurantId(), 'trattoria-x');
    assert.equal(pathFor('suppliers'), 'restaurants/trattoria-x/suppliers');
  } finally {
    setCurrentRestaurantId(DEFAULT_RESTAURANT_ID); // never leak state between tests
  }
});

test('setting an invalid restaurant throws and leaves the current one alone', () => {
  assert.throws(() => setCurrentRestaurantId('bad/id'), /Invalid restaurant id/);
  assert.equal(currentRestaurantId(), 'main');
});
