// Unit tests for the local cache wipe (P15).
//
// Two failures matter here and they are opposites:
//   - keeping a location's cached data after a switch → the next location
//     briefly sees the previous one's recipes and settings;
//   - clearing Firebase's own auth storage → signing in immediately signs you
//     back out, and the app looks broken for everyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEP_PREFIXES, keysToClear, clearLocalData, shouldClearLocalData,
} from '../js/local-data.js';

const LOCATION_DATA = [
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

test('every cache holding a location’s data is cleared', () => {
  const doomed = keysToClear(LOCATION_DATA);
  assert.deepEqual(doomed.sort(), [...LOCATION_DATA].sort());
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
  const keys = ['uk-bank-holidays', 'whats-new-seen', 'lastHiddenAt', 'active-location'];
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

// ── Clearing on the way IN, not only on the way out ──────────────────────────
//
// Signing out and switching location both wipe the cache, but a phone can reach the
// sign-in form without passing through either: a session that expires or is revoked,
// and the leftover anonymous session the app discards on sight. Whoever signs in next
// would open their own location with the previous one's data on screen. This is the
// check that catches those — and the one that must NOT fire when nothing changed.

test('opening a DIFFERENT location clears this device first', () => {
  assert.equal(shouldClearLocalData('bakery', 'restaurant'), true);
  assert.equal(shouldClearLocalData('restaurant', 'bakery'), true);
});

test('opening the SAME location keeps the cache', () => {
  // The cache belongs to the LOCATION, not to the person. Two people from the same
  // venue sharing a phone must find the app ready, not emptied — and clearing here
  // would slow every single sign-in for no gain.
  assert.equal(shouldClearLocalData('bakery', 'bakery'), false);
});

test('nothing remembered clears: a fresh install, or a phone from the pre-login app', () => {
  // The old single-venue app never wrote this key, so `null` is exactly the phone
  // whose cache could otherwise leak into a venue it never belonged to.
  assert.equal(shouldClearLocalData(null, 'restaurant'), true);
  assert.equal(shouldClearLocalData(undefined, 'bakery'), true);
  assert.equal(shouldClearLocalData('', 'bakery'), true);
});

test('nothing being opened decides nothing', () => {
  // Guard against a caller with no location: clearing on a non-event would wipe a
  // working phone for free.
  assert.equal(shouldClearLocalData('bakery', null), false);
  assert.equal(shouldClearLocalData('bakery', undefined), false);
  assert.equal(shouldClearLocalData('bakery', ''), false);
  assert.equal(shouldClearLocalData(null, null), false);
});

test('the wipe that follows never touches the sign-in itself', () => {
  // Belt and braces with the KEEP_PREFIXES tests above: if entering a location
  // cleared Firebase's own storage, the sign-in that just happened would be undone.
  const storage = {
    'firebase:authUser:abc': 'session',
    'firebaseLocalStorageDb': 'session',
    'active-location': 'restaurant',
    'calculator-config': '{}',
  };
  const gone = keysToClear(Object.keys(storage));
  assert.deepEqual(gone, ['calculator-config']);
});
