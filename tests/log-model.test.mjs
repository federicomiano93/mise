// Unit tests for the log data model (P15 — the owner cannot read code, so these are
// the safety net for the irreversible parts: the append-only version chain, the
// no-loss migration, and the now-generic sheet math driven by the config recipe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOR_DAYS,
  buildSheet, buildLogText,
  createLog, latestVersion, addVersion, restoreVersion,
  migrateOldRecord, migrateOldLogs, sortLogs, filterVisibleLogs, dayLabel,
} from '../js/log-model.js';
import { computeTarget, getRecipeById, pairId } from '../js/calculator-config.js';

// ⚠️ THE BAKERY'S DATA IS A FIXTURE NOW, NOT THE APP'S DEFAULT (13 Aug 2026).
// These assertions run through The Italian Club Bakery's own clients, products
// and formulas — including the ones proving the config-driven scaler is
// byte-identical to the three hand-written scalers it replaced. Every number is
// unchanged; only where it is kept has moved, out of js/ and into tests/, so that
// a customer who buys the app no longer opens it holding somebody else's recipes.
import { BAKERY_CONFIG } from './fixtures/bakery-config.mjs';

// Config-shaped recipes for buildSheet (mirror the default config recipes).
const FOCACCIA = getRecipeById(BAKERY_CONFIG, 'focaccia');
const BRIOCHE = getRecipeById(BAKERY_CONFIG, 'brioche');

function mkVersion(over = {}) {
  return {
    calculatedBy: 'Mario', at: { date: 'Monday 09 June', time: '2:05 PM' },
    kind: 'create', items: [], occasional: [], sheet: null, text: '', ...over,
  };
}

// ── buildSheet (generic, recipe-driven) ─────────────────────────────────────────
test('buildSheet: orders total = Σ qty×weightG + extra; names the recipe + param', () => {
  const sheet = buildSheet({
    recipe: FOCACCIA, leaveningPct: 0.65, extraGrams: 100,
    items: [
      { id: 'a', name: 'Pizzas', qty: 2, weightG: 200 },    // 400
      { id: 'b', name: 'Focaccias', qty: 3, weightG: 100 }, // 300
    ],
  });
  assert.equal(sheet.total_g, 800); // 400 + 300 + 100
  assert.equal(sheet.extra_g, 100);
  assert.equal(sheet.dough, 'Focaccia');
  assert.equal(sheet.recipeId, 'focaccia');
  assert.equal(sheet.param.label, 'Yeast %');
});

test('buildSheet: ingredient grams sum exactly to the rounded total', () => {
  const sheet = buildSheet({ recipe: FOCACCIA, leaveningPct: 0.65, items: [{ id: 'a', name: 'X', qty: 10, weightG: 151 }] });
  assert.equal(sheet.ingredients.reduce((s, r) => s + r.grams, 0), sheet.total_g);
  assert.equal(sheet.ingredients.length, 9);
  assert.equal(sheet.ingredients[0].name, 'Flour uniqua blue');
});

test('buildSheet: zero total produces zero ingredients, no NaN', () => {
  const sheet = buildSheet({ recipe: BRIOCHE, leaveningPct: 4, items: [] });
  assert.equal(sheet.total_g, 0);
  assert.ok(sheet.ingredients.every(r => r.grams === 0));
});

test("buildSheet: 'total' logic uses the typed total, no products, pro-rata, no param", () => {
  const recipe = {
    id: 'r1', name: 'Bread', logic: 'total',
    ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }],
    leaveningKey: null, baselinePct: null,
  };
  const sheet = buildSheet({ recipe, totalInput: 800, items: [] });
  assert.equal(sheet.total_g, 800);
  assert.equal(sheet.param, null);                 // no leavening line for a total recipe
  assert.deepEqual(sheet.ingredients.map(i => i.grams), [500, 300]); // pro-rata
});

test('buildSheet: matches the live computeTarget for the same quantities', () => {
  const getQty = (id) => ({ [pairId('c-bakery', 'f-pizze')]: 4, [pairId('c-bakery', 'f-focacce')]: 2 }[id] || 0);
  const target = computeTarget(BAKERY_CONFIG, 'focaccia', getQty);
  const sheet = buildSheet({
    recipe: FOCACCIA, leaveningPct: 0.65,
    items: [
      { id: 'f-pizze', name: 'Pizzas', qty: 4, weightG: 201 },
      { id: 'f-focacce', name: 'Focaccias', qty: 2, weightG: 181 },
    ],
  });
  assert.equal(sheet.total_g, Math.round(target));
});

test('buildSheet: divisor splits only included lines with a quantity', () => {
  const sheet = buildSheet({
    recipe: FOCACCIA, leaveningPct: 0.65,
    items: [
      { id: 'a', name: 'Ciabatta', qty: 40, weightG: 150 }, // 6000
      { id: 'b', name: 'Pizzas', qty: 1, weightG: 200 },
    ],
    divisor: { includedIds: ['a'], n: 3 },
  });
  assert.deepEqual(sheet.divisor.names, ['Ciabatta']);
  assert.equal(sheet.divisor.total, 6000);
  assert.equal(sheet.divisor.n, 3);
  assert.equal(sheet.divisor.result, 2000);
});

test('buildSheet: crate boxes only for opted-in lines with a quantity', () => {
  const sheet = buildSheet({
    recipe: FOCACCIA, leaveningPct: 0.65,
    items: [
      { id: 'a', name: 'Ciabatta', qty: 40, weightG: 150, crate: { show: true, perBox: 20 } },
      { id: 'b', name: 'Pizzas', qty: 0, weightG: 200, crate: { show: true, perBox: 10 } },
      { id: 'c', name: 'Plain', qty: 5, weightG: 100 },
    ],
  });
  assert.equal(sheet.crates.length, 1);
  assert.equal(sheet.crates[0].name, 'Ciabatta');
  assert.equal(sheet.crates[0].count, 2);       // 40 / 20
  assert.equal(sheet.crates[0].eachBoxG, 3000); // 20 × 150
});

// ── buildLogText ──────────────────────────────────────────────────────────────
test('buildLogText: groups by client, adds occasional and extra', () => {
  const text = buildLogText(
    [
      { name: 'Pizzas', clientName: 'Bakery', qty: 2, kind: 'number' },
      { name: 'Focaccias', clientName: 'Bakery', qty: 0, kind: 'number' }, // skipped (0)
      { name: 'Ciabatta', clientName: 'Client 1', qty: 40, kind: 'dropdown' },
    ],
    [{ name: 'Walk-in', products: [{ name: 'Special', qty: 3, unit: 'pz' }] }],
    { grams: 1000, value: 1, unit: 'kg' },
  );
  assert.ok(text.includes('Bakery:'));
  assert.ok(text.includes('  Pizzas: 2 pz'));
  assert.ok(!text.includes('Focaccias'));
  assert.ok(text.includes('Client 1:'));
  assert.ok(text.includes('  Ciabatta: 40 pz'));
  assert.ok(text.includes('Walk-in:'));
  assert.ok(text.includes('  Special: 3 pz'));
  assert.ok(text.includes('Extra dough: 1 kg'));
});

// ── lifecycle / append-only ───────────────────────────────────────────────────
test('createLog: one version, keeps the recipe name + id, clamps the day', () => {
  const log = createLog({ id: 'L1', dough: 'My Recipe', recipeId: 'r-x', forDay: 'whenever', version: mkVersion(), createdAtMs: 5 });
  assert.equal(log.dough, 'My Recipe');   // any name kept (recipes are arbitrary now)
  assert.equal(log.recipeId, 'r-x');
  assert.equal(log.forDay, 'today');      // invalid forDay → default
  assert.equal(log.bakery, 'main');
  assert.equal(log.versions.length, 1);
  assert.equal(latestVersion(log).calculatedBy, 'Mario');
});

test('addVersion: append-only, previous versions preserved, original not mutated', () => {
  const log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion({ text: 'v1' }), createdAtMs: 1 });
  const log2 = addVersion(log, mkVersion({ text: 'v2', kind: 'edit' }));
  assert.equal(log.versions.length, 1);
  assert.equal(log2.versions.length, 2);
  assert.equal(log2.versions[0].text, 'v1');
  assert.equal(latestVersion(log2).text, 'v2');
  log2.versions[0].text = 'HACKED';
  assert.equal(log.versions[0].text, 'v1');
});

test('restoreVersion: appends a copy on top, never truncates history', () => {
  let log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion({ text: 'v1' }), createdAtMs: 1 });
  log = addVersion(log, mkVersion({ text: 'v2', kind: 'edit' }));
  log = addVersion(log, mkVersion({ text: 'v3', kind: 'edit' }));
  const restored = restoreVersion(log, 0, { calculatedBy: 'Restorer', at: { date: 'Tue', time: '9:00 AM' } });
  assert.equal(restored.versions.length, 4);
  assert.equal(latestVersion(restored).text, 'v1');
  assert.equal(latestVersion(restored).kind, 'restore');
  assert.equal(latestVersion(restored).restoredFrom, 0);
  assert.deepEqual(restored.versions.map(v => v.text), ['v1', 'v2', 'v3', 'v1']);
});

test('restoreVersion: out-of-range index is a no-op (clone returned)', () => {
  const log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion(), createdAtMs: 1 });
  assert.equal(restoreVersion(log, 9, { calculatedBy: 'x', at: {} }).versions.length, 1);
});

// ── migration (no loss) ───────────────────────────────────────────────────────
test('migrateOldRecord: preserves text, marks legacy, keeps timestamp', () => {
  const rec = { dough: 'Brioche', date: 'Monday 09 June', time: '2:05 PM', text: 'Bakery:\n  Buns: 10 pz' };
  const log = migrateOldRecord(rec, { id: 'm1', createdAtMs: 42 });
  assert.equal(log.dough, 'Brioche');
  const v = latestVersion(log);
  assert.equal(v.legacy, true);
  assert.equal(v.text, 'Bakery:\n  Buns: 10 pz');
  assert.equal(v.at.date, 'Monday 09 June');
});

test('migrateOldLogs: every old record becomes exactly one log (no loss)', () => {
  const recs = [
    { dough: 'Focaccia', date: 'd1', time: 't1', text: 'a' },
    { dough: 'Brioche', date: 'd2', time: 't2', text: 'b' },
    { dough: 'Sourdough', date: 'd3', time: 't3', text: 'c' },
  ];
  const logs = migrateOldLogs(recs, (r, i) => 'mig-' + i, 1000);
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map(l => l.dough), ['Focaccia', 'Brioche', 'Sourdough']);
  assert.deepEqual(logs.map(l => latestVersion(l).text), ['a', 'b', 'c']);
  assert.ok(logs.every(l => latestVersion(l).legacy === true));
});

test('sortLogs: newest first by createdAtMs', () => {
  const mk = (id, ms) => createLog({ id, dough: 'Focaccia', forDay: 'today', version: mkVersion(), createdAtMs: ms });
  assert.deepEqual(sortLogs([mk('a', 1), mk('c', 3), mk('b', 2)]).map(l => l.id), ['c', 'b', 'a']);
});

test('filterVisibleLogs: keyed by recipeId, falling back to the dough name', () => {
  const recent = (id, recipeId, dough) => ({ id, recipeId, dough, createdAtMs: 1000 });
  const logs = [recent('a', 'focaccia', 'Focaccia'), recent('b', 'r-new', 'My Recipe'), recent('c', '', 'Brioche')];
  const out = filterVisibleLogs(logs, {
    visibility: { focaccia: false, 'r-new': true, brioche: true },
    retentionHours: 0, nowMs: 1000,
  });
  // focaccia hidden by recipeId; r-new shown; the third (no recipeId) keyed by 'brioche'.
  assert.deepEqual(out.map(l => l.id), ['b', 'c']);
});

test('exports: the day constants', () => {
  assert.deepEqual(FOR_DAYS, ['today', 'tomorrow']);
});

// ── dayLabel: the badge is relative to the day the log is READ ────────────────
// The bug this fixes: the badge was rendered straight from the stored forDay, so a
// log made for today still said "Today" days later. The label must age with the
// calendar — a log made FOR today reads "Yesterday" tomorrow.

// Local wall-clock timestamp, so these tests read as calendar days in any timezone.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const madeOn = (ms, forDay) => createLog({ id: 'x', dough: 'Focaccia', forDay, version: mkVersion(), createdAtMs: ms });

test('dayLabel: a log made FOR today reads Today on the day it was made', () => {
  const log = madeOn(at(2026, 7, 12), 'today');
  assert.deepEqual(dayLabel(log, at(2026, 7, 12, 18)), { text: 'Today', tone: 'today' });
});

test('dayLabel: THE BUG — the same "today" log reads Yesterday the next day', () => {
  const log = madeOn(at(2026, 7, 12), 'today');
  assert.deepEqual(dayLabel(log, at(2026, 7, 13, 9)), { text: 'Yesterday', tone: 'past' });
});

test('dayLabel: a "tomorrow" log says what it is FOR, and later when it was MADE', () => {
  const log = madeOn(at(2026, 7, 12), 'tomorrow');
  // On the day it was made, both facts are shown.
  assert.equal(dayLabel(log, at(2026, 7, 12, 20)).text, 'Today for tomorrow');
  // The next day it is needed NOW, and it was made yesterday. Saying only "Today"
  // was the whole problem: whoever read it believed it had just been made.
  assert.deepEqual(dayLabel(log, at(2026, 7, 13, 8)), { text: 'Yesterday for today', tone: 'today' });
  assert.equal(dayLabel(log, at(2026, 7, 14, 8)).text, '2 days ago for yesterday');
});

test('dayLabel: when made and needed fall on the same day, one word is enough', () => {
  const log = madeOn(at(2026, 7, 12), 'today');
  assert.equal(dayLabel(log, at(2026, 7, 12, 20)).text, 'Today');
  assert.equal(dayLabel(log, at(2026, 7, 13, 8)).text, 'Yesterday');
});

test('dayLabel: the colour follows the day it is FOR, not the day it was made', () => {
  // Made yesterday, needed today: still green, because the colour answers "do I need
  // this now?" while the words tell the story.
  const forToday = madeOn(at(2026, 7, 12), 'tomorrow');
  assert.equal(dayLabel(forToday, at(2026, 7, 13, 8)).tone, 'today');
  const forTomorrow = madeOn(at(2026, 7, 12), 'tomorrow');
  assert.equal(dayLabel(forTomorrow, at(2026, 7, 12, 8)).tone, 'tomorrow');
  const past = madeOn(at(2026, 7, 12), 'today');
  assert.equal(dayLabel(past, at(2026, 7, 14, 8)).tone, 'past');
});

test('dayLabel: further in the past it says how many days ago, never a wrong "Today"', () => {
  const log = madeOn(at(2026, 7, 12), 'today');
  assert.deepEqual(dayLabel(log, at(2026, 7, 15, 9)), { text: '3 days ago', tone: 'past' });
});

test('dayLabel: it counts WORK days, so the night shift stays one day', () => {
  // Made at 23:30, read an hour later. The calendar has turned over, but the bakery's
  // day has not: it is the same night's work, so it must still read "Today".
  const late = madeOn(at(2026, 7, 12, 23, 30), 'today');
  assert.equal(dayLabel(late, at(2026, 7, 13, 0, 30)).text, 'Today');
  // Past 4am it belongs to the previous work day.
  assert.equal(dayLabel(late, at(2026, 7, 13, 6, 0)).text, 'Yesterday');
  // Made at 00:30 — that is still the night of the 11th, so by lunchtime on the 12th
  // it already reads Yesterday.
  const early = madeOn(at(2026, 7, 12, 0, 30), 'today');
  assert.equal(dayLabel(early, at(2026, 7, 12, 3, 0)).text, 'Today');
  assert.equal(dayLabel(early, at(2026, 7, 12, 12, 0)).text, 'Yesterday');
});

test('dayLabel: a log with no usable creation time falls back to the stored choice', () => {
  const broken = { forDay: 'tomorrow', createdAtMs: 0 };
  assert.deepEqual(dayLabel(broken, at(2026, 7, 12)), { text: 'Tomorrow', tone: 'tomorrow' });
  assert.deepEqual(dayLabel({}, at(2026, 7, 12)), { text: 'Today', tone: 'today' });
});
