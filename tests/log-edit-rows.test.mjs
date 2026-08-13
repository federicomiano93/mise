// A saved log must keep what it saved. These cover the two pure pieces that make that
// true (P15 — the owner cannot read code, and this is the part that silently rewrote
// history: editing a log used to rebuild its rows from TODAY's products and recompute
// its grams with TODAY's recipe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editRows, recipeSnapshot, buildSheet } from '../js/log-model.js';
import { getRecipeById } from '../js/calculator-config.js';

// ⚠️ THE BAKERY'S DATA IS A FIXTURE NOW, NOT THE APP'S DEFAULT (13 Aug 2026).
// These assertions run through The Italian Club Bakery's own clients, products
// and formulas — including the ones proving the config-driven scaler is
// byte-identical to the three hand-written scalers it replaced. Every number is
// unchanged; only where it is kept has moved, out of js/ and into tests/, so that
// a customer who buys the app no longer opens it holding somebody else's recipes.
import { BAKERY_CONFIG } from './fixtures/bakery-config.mjs';

const FOCACCIA = getRecipeById(BAKERY_CONFIG, 'focaccia');

// A line as a log stores it.
function saved(over = {}) {
  return {
    id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery',
    qty: 40, weightG: 201, kind: 'number', crate: { show: false, perBox: 20 },
    ...over,
  };
}

// A row as the calculator offers it today.
function current(over = {}) {
  return {
    id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery',
    weightG: 201, kind: 'number', crate: { show: false, perBox: 20 },
    ...over,
  };
}

// ── editRows ──────────────────────────────────────────────────────────────────

test('a saved row survives when the product no longer exists today', () => {
  const rows = editRows([saved()], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'f-pizze');
  assert.equal(rows[0].qty, 40);
});

test('a saved row keeps the name it had, not the renamed one', () => {
  const rows = editRows([saved()], [current({ name: 'Pizza bases' })]);
  assert.equal(rows.length, 1, 'the renamed product is the same row, not a second one');
  assert.equal(rows[0].name, 'Pizzas');
});

test('a saved row keeps the weight it had, not a changed one', () => {
  const rows = editRows([saved()], [current({ weightG: 250 })]);
  assert.equal(rows[0].weightG, 201);
});

test('a product added since the log appears at zero, after the saved rows', () => {
  const rows = editRows([saved()], [current(), current({ id: 'f-focacce', name: 'Focaccias' })]);
  assert.deepEqual(rows.map(r => r.id), ['f-pizze', 'f-focacce']);
  assert.equal(rows[1].qty, 0);
});

test('a row present in both is not duplicated and keeps the SAVED quantity', () => {
  const rows = editRows([saved({ qty: 12 })], [current()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 12);
});

test('the same product for two clients stays two independent rows', () => {
  const rows = editRows(
    [saved({ clientName: 'Bakery', qty: 10 })],
    [current({ clientName: 'Bakery' }), current({ clientName: 'Market', name: 'Pizzas' })],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.clientName, r.qty]), [['Bakery', 10], ['Market', 0]]);
});

test('a saved row with no crate falls back instead of yielding undefined', () => {
  const { crate, ...noCrate } = saved();
  const rows = editRows([noCrate], []);
  assert.deepEqual(rows[0].crate, { show: false, perBox: 20 });
});

test('a corrupt quantity becomes 0 rather than NaN', () => {
  const rows = editRows([saved({ qty: 'abc' })], []);
  assert.equal(rows[0].qty, 0);
});

test('junk input never throws and never invents rows', () => {
  assert.deepEqual(editRows(null, null), []);
  assert.deepEqual(editRows(undefined, undefined), []);
  assert.deepEqual(editRows([null, undefined], [null]), []);
});

// ── recipeSnapshot ────────────────────────────────────────────────────────────

test('the snapshot carries every field buildSheet reads', () => {
  const snap = recipeSnapshot(FOCACCIA);
  for (const key of ['id', 'name', 'logic', 'ingredients', 'leaveningKey', 'leaveningDefaultPct', 'baselinePct']) {
    assert.ok(key in snap, 'missing ' + key);
  }
  assert.deepEqual(snap.ingredients.map(i => i.key), FOCACCIA.ingredients.map(i => i.key));
});

test('a sheet built from the snapshot is identical to one built from the recipe', () => {
  const items = [{ id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery', qty: 40, weightG: 201, kind: 'number' }];
  const fromRecipe = buildSheet({ recipe: FOCACCIA, items, leaveningPct: 0.8 });
  const fromSnapshot = buildSheet({ recipe: recipeSnapshot(FOCACCIA), items, leaveningPct: 0.8 });
  assert.deepEqual(fromSnapshot, fromRecipe);
});

test('the snapshot is frozen: changing the recipe afterwards does not change it', () => {
  const recipe = JSON.parse(JSON.stringify(FOCACCIA));
  const snap = recipeSnapshot(recipe);
  recipe.ingredients[0].grams = 9999;
  recipe.name = 'Something else';
  assert.notEqual(snap.ingredients[0].grams, 9999);
  assert.equal(snap.name, FOCACCIA.name);
});

test('re-snapshotting a snapshot changes nothing (a log carries its recipe forward)', () => {
  const once = recipeSnapshot(FOCACCIA);
  assert.deepEqual(recipeSnapshot(once), once);
});

test('a missing recipe yields null, so the caller can fall back to today\'s', () => {
  assert.equal(recipeSnapshot(null), null);
  assert.equal(recipeSnapshot(undefined), null);
});

test('a recipe with a corrupt baseline stores null, never NaN', () => {
  const snap = recipeSnapshot({ ...FOCACCIA, baselinePct: 'oops' });
  assert.equal(snap.baselinePct, null);
});
