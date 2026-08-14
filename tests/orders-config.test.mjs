// Unit tests for the Orders screen's settings (P15 — the owner cannot read code, so
// these tests are the safety net).
//
// The failure that matters here is the direction of the default. This setting decides
// whether a column people type into is on the screen at all, so a missing document, a
// half-written one or a corrupt value must leave the screen as it has always been —
// never silently remove the Stock box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrdersConfig, DEFAULT_HISTORY_DAYS } from '../js/orders/orders-config.js';

test('no document yet: Stock is shown', () => {
  // config/orders does not exist until someone changes the setting for the first time.
  assert.equal(normalizeOrdersConfig(null).showStock, true);
  assert.equal(normalizeOrdersConfig(undefined).showStock, true);
});

test('a document without the field: Stock is shown', () => {
  assert.equal(normalizeOrdersConfig({}).showStock, true);
  assert.equal(normalizeOrdersConfig({ bakery: 'main' }).showStock, true);
});

test('only an explicit false hides it', () => {
  assert.equal(normalizeOrdersConfig({ showStock: false }).showStock, false);
  assert.equal(normalizeOrdersConfig({ showStock: true }).showStock, true);
});

test('a corrupt value leaves the screen alone rather than emptying it', () => {
  // Anything that is not exactly `false` keeps the box: losing a column you are typing
  // into is a much worse outcome than an ignored setting.
  ['false', 0, '', null, undefined, 'no', [], {}].forEach(bad => {
    assert.equal(normalizeOrdersConfig({ showStock: bad }).showStock, true,
      `showStock: ${JSON.stringify(bad)} must not hide the box`);
  });
});

// ⚠️ THE LIST IS PINNED ON PURPOSE, and it caught the send-routes work the moment
// it landed. Every key here is something a screen reads, so adding one is a decision
// and not a side effect - `sendSettings` was added deliberately, and anything that
// appears without a line in this test has arrived by accident.
test('it returns only the keys the screen uses, whatever else the document carries', () => {
  const out = normalizeOrdersConfig({ bakery: 'main', showStock: false, somethingElse: 42 });
  assert.deepEqual(Object.keys(out), ['showStock', 'historyDays', 'sendSettings', 'weekStartsOn']);
});

// ⚠️ AND IT IS ALWAYS USABLE, whatever the document says. An order that cannot leave
// the app at all is the one failure this whole feature must not be able to produce,
// so a missing, empty or corrupt config still comes back with a road open.
// ⚠️ AND THE WEEK IS ALWAYS USABLE TOO. An unreadable setting must not empty Incoming:
// a screen showing nothing looks exactly like the feature working.
test('a config with no week setting still has a week', () => {
  [undefined, null, {}, { weekStartsOn: '' }, { weekStartsOn: ['Monday'] }].forEach(doc => {
    assert.equal(normalizeOrdersConfig(doc).weekStartsOn, 'Sunday', JSON.stringify(doc));
  });
  assert.equal(normalizeOrdersConfig({ weekStartsOn: 'Monday' }).weekStartsOn, 'Monday');
});

test('a config with no send settings still leaves a road open', () => {
  [undefined, null, {}, { sendRoutes: null }, { sendRoutes: 'x' }].forEach(doc => {
    const s = normalizeOrdersConfig(doc);
    const open = Object.values(s.sendSettings.routes).filter(Boolean);
    assert.ok(open.length > 0, `${JSON.stringify(doc)} left no way to send`);
    assert.ok(s.sendSettings.preferred, 'and one of them is offered first');
  });
});

// ── How many days of past orders History shows ───────────────────────────────
//
// The failure that matters here is the opposite of the Stock one: this setting can
// only ever HIDE orders behind a button, so the danger is a value that hides them
// ALL. An empty History reads as "our orders have been deleted" — and the promise of
// this feature is precisely that nothing is deleted.

test('no document yet, or no field: the default window', () => {
  assert.equal(normalizeOrdersConfig(null).historyDays, DEFAULT_HISTORY_DAYS);
  assert.equal(normalizeOrdersConfig({}).historyDays, DEFAULT_HISTORY_DAYS);
  assert.equal(normalizeOrdersConfig({ showStock: false }).historyDays, DEFAULT_HISTORY_DAYS);
});

test('the default is 15 days', () => {
  // Pinned: this is the number Federico asked for, and the note under the field in
  // Settings quotes it. Changing it is a product decision, not a refactor.
  assert.equal(DEFAULT_HISTORY_DAYS, 15);
});

test('a stored number is used as given', () => {
  assert.equal(normalizeOrdersConfig({ historyDays: 7 }).historyDays, 7);
  assert.equal(normalizeOrdersConfig({ historyDays: 1 }).historyDays, 1);
  assert.equal(normalizeOrdersConfig({ historyDays: 90 }).historyDays, 90);
});

test('a number typed into an input arrives as a string, and still works', () => {
  assert.equal(normalizeOrdersConfig({ historyDays: '30' }).historyDays, 30);
  assert.equal(normalizeOrdersConfig({ historyDays: 15.8 }).historyDays, 15);
});

test('nothing usable can produce an empty History', () => {
  // Every one of these must fall back to the default rather than to 0 days.
  [0, -1, -99, NaN, Infinity, '', ' ', 'abc', null, undefined, {}, [], true, false]
    .forEach(bad => {
      assert.equal(normalizeOrdersConfig({ historyDays: bad }).historyDays, DEFAULT_HISTORY_DAYS,
        `historyDays: ${JSON.stringify(bad)} must fall back to the default`);
    });
});

test('an absurd window is capped rather than trusted', () => {
  assert.equal(normalizeOrdersConfig({ historyDays: 100000 }).historyDays, 365);
});
