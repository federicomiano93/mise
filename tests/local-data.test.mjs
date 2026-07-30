// Unit tests for the local cache wipe (P15).
//
// Two failures matter here and they are opposites:
//   - keeping a restaurant's cached data after a switch → the next restaurant
//     briefly sees the previous one's recipes and settings;
//   - clearing Firebase's own auth storage → signing in immediately signs you
//     back out, and the app looks broken for everyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_PREFIXES, keysToClear, clearLocalData } from '../js/local-data.js';

const RESTAURANT_DATA = [
  'calculator-config',
  'catalogue-recipes',
  'catalogue-usage',
  'catalogue-scaled',
  'logs-cache',
  'logs-migrated-v1',
  'orders-config',
  'orders-reminder-date',
  'qty-ING1', 'total-ING1', 'lock-ING1', 'revealed-ING1', 'extra-ING1', 'extra-unit-ING1',
];

test('every cache holding a restaurant’s data is cleared', () => {
  const doomed = keysToClear(RESTAURANT_DATA);
  assert.deepEqual(doomed.sort(), [...RESTAURANT_DATA].sort());
});

test('Firebase’s own session storage is NEVER cleared', () => {
  const keys = [
    'firebase:authUser:AIzaSyXXXX:[DEFAULT]',
    'firebase:host:bakery-app-ebf90.firebaseio.com',
    'firebaseLocalStorageDb',
  ];
  assert.deepEqual(keysToClear(keys), []);
});

test('what belongs to nobody, or to the app itself, survives', () => {
  const keys = ['uk-bank-holidays', 'whats-new-seen', 'lastHiddenAt', 'active-restaurant'];
  assert.deepEqual(keysToClear(keys), []);
});

test('an unknown key is cleared by default, not kept', () => {
  // The bias that matters: a cache added in six months, by someone who never
  // reads this file, must fail SAFE. Clearing costs one refetch; keeping leaks.
  assert.deepEqual(keysToClear(['some-future-cache', 'orders-something-new']),
    ['some-future-cache', 'orders-something-new']);
});

test('the keep list is prefix-based, so versioned keys stay covered', () => {
  assert.ok(KEEP_PREFIXES.includes('firebase:'));
  assert.deepEqual(keysToClear(['firebase:authUser:another-key:[DEFAULT]']), []);
});

test('clearLocalData removes exactly those keys from real storage', () => {
  const store = {
    'calculator-config': '{}',
    'catalogue-recipes': '[]',
    'firebase:authUser:X:[DEFAULT]': 'token',
    'uk-bank-holidays': '[]',
    removeItem(key) { delete this[key]; },
  };
  // Object.keys picks up removeItem too; a function value is still just a key
  // to the wipe, which is why the test asserts on what SURVIVES.
  clearLocalData(store);
  assert.equal(store['calculator-config'], undefined);
  assert.equal(store['catalogue-recipes'], undefined);
  assert.equal(store['firebase:authUser:X:[DEFAULT]'], 'token');
  assert.equal(store['uk-bank-holidays'], '[]');
});

test('storage being unavailable is survivable, not a crash', () => {
  // Private browsing and blocked storage throw on access; losing the wipe is bad
  // but taking the whole app down with it is worse.
  const hostile = { get length() { throw new Error('blocked'); } };
  Object.defineProperty(hostile, 'anything', { get() { throw new Error('blocked'); } });
  assert.equal(clearLocalData(null), 0);
  assert.doesNotThrow(() => clearLocalData(hostile));
});
