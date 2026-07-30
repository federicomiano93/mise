// Unit tests for the Orders screen's settings (P15 — the owner cannot read code, so
// these tests are the safety net).
//
// The failure that matters here is the direction of the default. This setting decides
// whether a column people type into is on the screen at all, so a missing document, a
// half-written one or a corrupt value must leave the screen as it has always been —
// never silently remove the Stock box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrdersConfig } from '../js/orders/orders-config.js';

test('no document yet: Stock is shown', () => {
  // config/orders does not exist until someone changes the setting for the first time.
  assert.deepEqual(normalizeOrdersConfig(null), { showStock: true });
  assert.deepEqual(normalizeOrdersConfig(undefined), { showStock: true });
});

test('a document without the field: Stock is shown', () => {
  assert.deepEqual(normalizeOrdersConfig({}), { showStock: true });
  assert.deepEqual(normalizeOrdersConfig({ bakery: 'main' }), { showStock: true });
});

test('only an explicit false hides it', () => {
  assert.deepEqual(normalizeOrdersConfig({ showStock: false }), { showStock: false });
  assert.deepEqual(normalizeOrdersConfig({ showStock: true }), { showStock: true });
});

test('a corrupt value leaves the screen alone rather than emptying it', () => {
  // Anything that is not exactly `false` keeps the box: losing a column you are typing
  // into is a much worse outcome than an ignored setting.
  ['false', 0, '', null, undefined, 'no', [], {}].forEach(bad => {
    assert.equal(normalizeOrdersConfig({ showStock: bad }).showStock, true,
      `showStock: ${JSON.stringify(bad)} must not hide the box`);
  });
});

test('it returns only the keys the screen uses, whatever else the document carries', () => {
  const out = normalizeOrdersConfig({ bakery: 'main', showStock: false, somethingElse: 42 });
  assert.deepEqual(Object.keys(out), ['showStock']);
});
