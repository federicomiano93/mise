// Unit tests for the forced-update decision (P15 — the owner cannot read code, so
// these tests are the safety net).
//
// Two opposite failures matter here:
//   - never blocking → phones stay months behind, which is how one device ends up
//     with an app that disagrees with the database about what is allowed;
//   - blocking at the wrong moment, or with no way out → a kitchen mid-service with
//     an app it cannot use, or five minutes of typing thrown away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  updateGateState, isBusy, readAttempts, bumpAttempts, resetAttempts,
  BUSY_SELECTORS, MAX_ATTEMPTS,
} from '../js/update-gate.js';

// A stand-in for `document`: querySelector answers from a list of "open" selectors.
const screenWith = (...open) => ({
  querySelector: selector => (open.includes(selector) ? {} : null),
});

// ── When to block ────────────────────────────────────────────────────────────

test('no update waiting: nothing happens', () => {
  assert.equal(updateGateState({ waiting: false }), 'hidden');
  assert.equal(updateGateState({}), 'hidden');
  assert.equal(updateGateState(), 'hidden');
});

test('an update is waiting and the operator is free: block', () => {
  assert.equal(updateGateState({ waiting: true, busy: false, attempts: 0 }), 'blocking');
});

test('an update is waiting but something is half-done: WAIT', () => {
  // The whole point of Federico's choice: never take the screen away mid-form.
  assert.equal(updateGateState({ waiting: true, busy: true, attempts: 0 }), 'hidden');
  assert.equal(updateGateState({ waiting: true, busy: true, attempts: 9 }), 'hidden');
});

test('after two failed attempts the operator can carry on', () => {
  assert.equal(updateGateState({ waiting: true, attempts: 1 }), 'blocking');
  assert.equal(updateGateState({ waiting: true, attempts: 2 }), 'blocking-with-escape');
  assert.equal(updateGateState({ waiting: true, attempts: 7 }), 'blocking-with-escape');
  assert.equal(MAX_ATTEMPTS, 2);
});

test('a nonsense attempt count never traps anyone, and never lets go too early', () => {
  ['abc', null, undefined, NaN, -3].forEach(bad => {
    assert.equal(updateGateState({ waiting: true, attempts: bad }), 'blocking',
      `attempts: ${JSON.stringify(bad)}`);
  });
  assert.equal(updateGateState({ waiting: true, attempts: '2' }), 'blocking-with-escape');
});

// ── What counts as "busy" ────────────────────────────────────────────────────

test('every interruption-worthy screen is recognised', () => {
  BUSY_SELECTORS.forEach(selector => {
    assert.equal(isBusy(screenWith(selector)), true, selector);
  });
});

test('an ordinary screen is not busy', () => {
  assert.equal(isBusy(screenWith()), false);
  assert.equal(isBusy(screenWith('.something-else')), false);
});

test('typing a quantity is NOT busy', () => {
  // Deliberate: the order draft autosaves every 800ms, so a reload loses nothing.
  // Treating number fields as busy would mean the gate never appeared on the one
  // screen people spend the most time in.
  assert.ok(!BUSY_SELECTORS.includes('.ing-row'));
  assert.ok(!BUSY_SELECTORS.includes('input'));
  assert.equal(isBusy(screenWith('.ing-row')), false);
});

test('no screen at all is not busy, and never throws', () => {
  assert.equal(isBusy(null), false);
  assert.equal(isBusy(undefined), false);
  assert.equal(isBusy({}), false);
});

// ── Counting attempts ────────────────────────────────────────────────────────

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

test('attempts start at zero and count up', () => {
  const s = fakeStorage();
  assert.equal(readAttempts(s), 0);
  assert.equal(bumpAttempts(s), 1);
  assert.equal(bumpAttempts(s), 2);
  assert.equal(readAttempts(s), 2);
});

test('a successful update wipes the slate', () => {
  const s = fakeStorage();
  bumpAttempts(s); bumpAttempts(s);
  resetAttempts(s);
  assert.equal(readAttempts(s), 0);
});

test('a corrupt or missing count reads as a first attempt', () => {
  assert.equal(readAttempts(fakeStorage({ 'sw-update-attempts': 'lots' })), 0);
  assert.equal(readAttempts(fakeStorage({ 'sw-update-attempts': '-4' })), 0);
  assert.equal(readAttempts(fakeStorage()), 0);
});

test('storage being unavailable never blocks the app or throws', () => {
  // Private browsing, or storage disabled: behave as a first attempt and carry on.
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(readAttempts(broken), 0);
  assert.equal(bumpAttempts(broken), 1);
  assert.doesNotThrow(() => resetAttempts(broken));
  assert.equal(readAttempts(undefined), 0);
});
