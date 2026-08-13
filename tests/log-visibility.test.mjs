// Unit tests for the Log display filters (P15): the per-dough visibility + retention
// window that decide what the app's Log LIST shows. These never delete data — they
// only filter the list — so the safety net here is "the right logs are shown/hidden".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterVisibleLogs } from '../js/log-model.js';
import {
  isLogVisible, getLogRetentionHours, getLogRetentionForDough, normalizeConfig,
  LOG_RETENTION_OPTIONS, LOG_RETENTION_DEFAULT,
} from '../js/calculator-config.js';

// The per-recipe log switches are keyed BY RECIPE, so these cases need recipes to
// exist. They used to come from the app's default; they now come from the fixture,
// because the default no longer carries one bakery's recipes.
import { BAKERY_CONFIG } from './fixtures/bakery-config.mjs';

const HOUR = 3600 * 1000;
const NOW = 1_000_000_000_000; // fixed "now" so the tests are deterministic

function log(dough, ageHours) {
  return { id: dough + '-' + ageHours, dough, createdAtMs: NOW - ageHours * HOUR };
}

// ── filterVisibleLogs: visibility ─────────────────────────────────────────────
test('filterVisibleLogs: a dough turned off is hidden, others stay', () => {
  const logs = [log('Focaccia', 1), log('Brioche', 1), log('Sourdough', 1)];
  const out = filterVisibleLogs(logs, {
    visibility: { focaccia: false, brioche: true, sourdough: true },
    retentionHours: 24, nowMs: NOW,
  });
  assert.deepEqual(out.map(l => l.dough), ['Brioche', 'Sourdough']);
});

test('filterVisibleLogs: a missing visibility key defaults to visible', () => {
  const out = filterVisibleLogs([log('Focaccia', 1)], { visibility: {}, retentionHours: 24, nowMs: NOW });
  assert.equal(out.length, 1);
});

test('filterVisibleLogs: dough match is case-insensitive', () => {
  const out = filterVisibleLogs([log('Sourdough', 1)], {
    visibility: { sourdough: false }, retentionHours: 24, nowMs: NOW,
  });
  assert.equal(out.length, 0);
});

// ── filterVisibleLogs: retention ──────────────────────────────────────────────
// The window runs from the END of the work day the dough is FOR (work days roll over at
// 4am), not from the moment the log was written. Times below are LOCAL and explicit,
// because "N hours ago" cannot express "the day it is for".
const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
const made = (whenMs, forDay = 'today', dough = 'Focaccia') =>
  ({ id: dough + '-' + whenMs, dough, forDay, createdAtMs: whenMs });
const shown = (logs, hours, nowMs) => filterVisibleLogs(logs, { visibility: {}, retentionHours: hours, nowMs }).length;

test('a dough made for TOMORROW is still listed all through tomorrow', () => {
  const l = [made(at(2026, 8, 1, 9, 0), 'tomorrow')];
  // The old rule counted 24h from writing, so it vanished at 09:00 on the 2nd —
  // the morning of the very day it was needed.
  assert.equal(shown(l, 24, at(2026, 8, 2, 9, 30)), 1, 'still there mid-morning');
  assert.equal(shown(l, 24, at(2026, 8, 2, 22, 0)), 1, 'still there that evening');
});

test('...and goes once that day is over plus the window', () => {
  const l = [made(at(2026, 8, 1, 9, 0), 'tomorrow')];
  // work day 2 Aug ends at 04:00 on the 3rd; +24h = 04:00 on the 4th
  assert.equal(shown(l, 24, at(2026, 8, 4, 3, 59)), 1);
  assert.equal(shown(l, 24, at(2026, 8, 4, 4, 1)), 0);
});

test('a dough made at 22:00 for today does NOT vanish at midnight', () => {
  const l = [made(at(2026, 8, 1, 22, 0), 'today')];
  assert.equal(shown(l, 24, at(2026, 8, 2, 0, 30)), 1, 'half past midnight, same night shift');
  assert.equal(shown(l, 24, at(2026, 8, 2, 3, 30)), 1, 'still before the 4am rollover');
});

test('a dough made for today is gone the day after, once the window runs out', () => {
  const l = [made(at(2026, 8, 1, 9, 0), 'today')];
  // work day 1 Aug ends at 04:00 on the 2nd; +24h = 04:00 on the 3rd
  assert.equal(shown(l, 24, at(2026, 8, 3, 3, 59)), 1);
  assert.equal(shown(l, 24, at(2026, 8, 3, 4, 1)), 0);
});

test('48 hours keeps what 24 hours hides', () => {
  const l = [made(at(2026, 8, 1, 9, 0), 'today')];
  const when = at(2026, 8, 3, 12, 0);
  assert.equal(shown(l, 24, when), 0);
  assert.equal(shown(l, 48, when), 1);
});

test('no log lives SHORTER than it used to', () => {
  // The old rule was createdAt + window. The new anchor (end of the target work day)
  // is never earlier than the moment of writing, so every log lives at least as long.
  const hours = 24;
  for (const [h, forDay] of [[0, 'today'], [3, 'today'], [9, 'today'], [22, 'today'], [9, 'tomorrow']]) {
    const createdAtMs = at(2026, 8, 1, h, 0);
    const oldExpiry = createdAtMs + hours * HOUR;
    assert.equal(
      shown([made(createdAtMs, forDay)], hours, oldExpiry),
      1,
      `a log made at ${h}:00 for ${forDay} was still visible under the old rule and must remain so`,
    );
  }
});

test('the clock change does not shift the day', () => {
  // BST ends 25 Oct 2026: that Sunday is 25 hours long. A dough made on the Saturday
  // for the Sunday must behave exactly like any other pair of days.
  const l = [made(at(2026, 10, 24, 9, 0), 'tomorrow')];
  assert.equal(shown(l, 24, at(2026, 10, 25, 20, 0)), 1, 'visible all through the long day');
  assert.equal(shown(l, 24, at(2026, 10, 26, 3, 59)), 1);
  assert.equal(shown(l, 24, at(2026, 10, 27, 4, 1)), 0);
});

test('a log with no usable creation time is hidden, as before', () => {
  assert.equal(shown([{ id: 'x', dough: 'Focaccia', createdAtMs: 0 }], 24, NOW), 0);
});

test('a zero/absent window means no expiry at all', () => {
  assert.equal(shown([made(at(2020, 1, 1, 9, 0))], 0, at(2026, 8, 1, 9, 0)), 1);
});

test('filterVisibleLogs: tolerates a missing/garbage list', () => {
  assert.deepEqual(filterVisibleLogs(null, {}), []);
  assert.deepEqual(filterVisibleLogs(undefined, {}), []);
});

// ── config read helpers ───────────────────────────────────────────────────────
test('isLogVisible: defaults to true, false only when explicitly off', () => {
  assert.equal(isLogVisible({}, 'focaccia'), true);
  assert.equal(isLogVisible({ logVisibility: { focaccia: false } }, 'focaccia'), false);
  assert.equal(isLogVisible({ logVisibility: { focaccia: true } }, 'focaccia'), true);
});

test('getLogRetentionHours: defaults to 24, accepts only 24/48', () => {
  assert.equal(getLogRetentionHours({}), LOG_RETENTION_DEFAULT);
  assert.equal(getLogRetentionHours({ logRetentionHours: 48 }), 48);
  assert.equal(getLogRetentionHours({ logRetentionHours: 99 }), 24); // invalid → default
  assert.equal(getLogRetentionHours({ logRetentionHours: 'x' }), 24);
  assert.deepEqual(LOG_RETENTION_OPTIONS, [24, 48]);
});

// ── normalizeConfig fills the new fields with safe defaults ───────────────────
test('normalizeConfig: adds logVisibility (all shown) and logRetentionHours (24)', () => {
  const cfg = normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [] });
  assert.deepEqual(cfg.logVisibility, { focaccia: true, brioche: true, sourdough: true });
  assert.equal(cfg.logRetentionHours, 24);
});

test('normalizeConfig: preserves stored log settings', () => {
  const cfg = normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], logVisibility: { focaccia: false }, logRetentionHours: 48 });
  assert.equal(cfg.logVisibility.focaccia, false);
  assert.equal(cfg.logVisibility.brioche, true); // unspecified → default shown
  assert.equal(cfg.logRetentionHours, 48);
});

// ── Per-dough retention (each dough chooses its own 24/48h) ───────────────────
test('getLogRetentionForDough: reads the per-dough value', () => {
  const cfg = { logRetentionByDough: { focaccia: 48, brioche: 24, sourdough: 48 } };
  assert.equal(getLogRetentionForDough(cfg, 'focaccia'), 48);
  assert.equal(getLogRetentionForDough(cfg, 'brioche'), 24);
});

test('getLogRetentionForDough: falls back to the legacy global, then the default', () => {
  assert.equal(getLogRetentionForDough({ logRetentionHours: 48 }, 'focaccia'), 48); // legacy global
  assert.equal(getLogRetentionForDough({}, 'focaccia'), LOG_RETENTION_DEFAULT);     // nothing set
  assert.equal(getLogRetentionForDough({ logRetentionByDough: { focaccia: 99 } }, 'focaccia'), 24); // invalid → default
});

test('filterVisibleLogs: a per-dough retention map applies the right window to each dough', () => {
  // Both made on 1 Aug for that day, so both anchor on 04:00 of the 2nd: brioche's 24h
  // runs out at 04:00 on the 3rd, focaccia's 48h only at 04:00 on the 4th.
  const logs = [
    made(at(2026, 8, 1, 9, 0), 'today', 'Focaccia'),
    made(at(2026, 8, 1, 9, 0), 'today', 'Brioche'),
  ];
  const out = filterVisibleLogs(logs, {
    visibility: {},
    retentionHours: { focaccia: 48, brioche: 24 },
    nowMs: at(2026, 8, 3, 12, 0),
  });
  assert.deepEqual(out.map(l => l.dough), ['Focaccia']);
});

test('normalizeConfig: adds per-dough retention, migrating from the legacy global', () => {
  const cfg = normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], logRetentionHours: 48 });
  assert.deepEqual(cfg.logRetentionByDough, { focaccia: 48, brioche: 48, sourdough: 48 });
});

test('normalizeConfig: keeps explicit per-dough retention over the legacy global', () => {
  const cfg = normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], logRetentionHours: 24, logRetentionByDough: { focaccia: 48 } });
  assert.equal(cfg.logRetentionByDough.focaccia, 48);
  assert.equal(cfg.logRetentionByDough.brioche, 24); // unspecified → legacy global fallback
});
