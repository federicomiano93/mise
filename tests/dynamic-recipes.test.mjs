// Unit tests for the recipes-in-config model (Stage 4) and the generic, data-driven
// dough math (P15 — the owner cannot read code, so this is the safety net for the
// app's CORE: the dough quantities). The headline guarantee: scaling a recipe from
// its config data (recipeSpec → scaleRecipe) produces the SAME numbers as today's
// hand-written scaleFocaccia / scaleBrioche / scaleSourdough.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, pairId,
  getRecipes, getRecipeById, getVisibleRecipes, getIngredients,
  recipeSpec, showsLeaveningKnob, computeRecipeTarget, LOGICS, MAX_VISIBLE_RECIPES,
} from '../js/calculator-config.js';
import { scaleRecipe, scaleFocaccia, scaleBrioche, scaleSourdough } from '../js/calculator-dough-math.js';

// ⚠️ THE BAKERY'S DATA IS A FIXTURE NOW, NOT THE APP'S DEFAULT (13 Aug 2026).
// These assertions run through The Italian Club Bakery's own clients, products
// and formulas — including the ones proving the config-driven scaler is
// byte-identical to the three hand-written scalers it replaced. Every number is
// unchanged; only where it is kept has moved, out of js/ and into tests/, so that
// a customer who buys the app no longer opens it holding somebody else's recipes.
import { BAKERY_CONFIG } from './fixtures/bakery-config.mjs';

// The recipe amount objects the legacy scale functions expect (mirror RECIPE_DEFAULTS
// in js/recipes.js — recipes.js can't load under Node, it reads localStorage).
const FOCACCIA = { flourBlu: 278, flourT65: 278, malt: 3, sugar: 8, salt: 11, yeast: 3.6, oil: 56, water1: 334, water2: 24 };
const BRIOCHE = { flour: 3185, yeast: 127.4, water: 1575 };
const SOURDOUGH = { flourBlu: 2560, flourT65: 2560, flourWhole: 570, water1: 3800, starter: 1024, malt: 30, salt: 124, water2: 300 };

const scaleViaConfig = (config, id, target, pct) => scaleRecipe(recipeSpec(getRecipeById(config, id)), target, pct);

// ── The default recipes ────────────────────────────────────────────────────────

test('the default config ships three recipes, all visible, in order', () => {
  assert.deepEqual(getRecipes(BAKERY_CONFIG).map(r => r.id), ['focaccia', 'brioche', 'sourdough']);
  assert.deepEqual(getVisibleRecipes(BAKERY_CONFIG).map(r => r.id), ['focaccia', 'brioche', 'sourdough']);
  for (const r of getRecipes(BAKERY_CONFIG)) assert.equal(r.logic, 'orders');
});

test('the ingredient registry is seeded with the recipes’ distinct names', () => {
  const names = getIngredients(BAKERY_CONFIG).map(i => i.name);
  for (const n of ['Flour uniqua blue', 'Yeast', 'Starter', 'Mella brioche pof', '2° Water']) {
    assert.ok(names.includes(n), 'registry has ' + n);
  }
});

// ── Generic math equals the legacy per-recipe math (BYTE-IDENTICAL) ─────────────

test('focaccia: config-driven scaling equals scaleFocaccia across the knob range', () => {
  for (const target of [1000, 3217, 5000, 12345]) {
    for (const pct of [0.5, 0.65, 1, 1.5]) {
      assert.deepEqual(scaleViaConfig(BAKERY_CONFIG, 'focaccia', target, pct),
        scaleFocaccia(FOCACCIA, target, pct), `focaccia ${target}g @ ${pct}%`);
    }
  }
});

test('brioche: config-driven scaling equals scaleBrioche EXACTLY across the knob range', () => {
  for (const target of [2000, 4887.4, 9000, 18000]) {
    for (const pct of [2, 4, 6, 8]) {
      assert.deepEqual(scaleViaConfig(BAKERY_CONFIG, 'brioche', target, pct),
        scaleBrioche(BRIOCHE, target, pct), `brioche ${target}g @ ${pct}%`);
    }
  }
});

test('sourdough: config-driven scaling equals scaleSourdough EXACTLY across the knob range', () => {
  for (const target of [5000, 9000, 18100]) {
    for (const pct of [12, 18, 25, 30]) {
      assert.deepEqual(scaleViaConfig(BAKERY_CONFIG, 'sourdough', target, pct),
        scaleSourdough(SOURDOUGH, target, pct), `sourdough ${target}g @ ${pct}%`);
    }
  }
});

test('the displayed integers always sum to Math.round(target)', () => {
  for (const id of ['focaccia', 'brioche', 'sourdough']) {
    for (const target of [1234, 5000, 9999]) {
      const out = scaleViaConfig(BAKERY_CONFIG, id, target, getRecipeById(BAKERY_CONFIG, id).leaveningDefaultPct);
      assert.equal(out.reduce((a, b) => a + b, 0), Math.round(target), `${id} sums to ${target}`);
    }
  }
});

// ── recipeSpec ──────────────────────────────────────────────────────────────────

test('recipeSpec builds ordered amounts, the leavening key and the stored baseline', () => {
  const spec = recipeSpec(getRecipeById(BAKERY_CONFIG, 'focaccia'));
  assert.deepEqual(Object.keys(spec.amounts), ['flourBlu', 'flourT65', 'malt', 'sugar', 'salt', 'yeast', 'oil', 'water1', 'water2']);
  assert.equal(spec.amounts.yeast, 3.6);
  assert.equal(spec.leaveningKey, 'yeast');
  assert.ok(Math.abs(spec.baselinePct - 0.6474820143884892) < 1e-9);
});

test('recipeSpec on a leavening-less recipe scales pro-rata (no leavening key)', () => {
  const recipe = {
    id: 'r1', name: 'Bread', logic: 'total',
    ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }],
    leaveningKey: null, baselinePct: null,
  };
  const spec = recipeSpec(recipe);
  assert.equal(spec.leaveningKey, null);
  const out = scaleRecipe(spec, 800, 0); // half size, pro-rata
  assert.deepEqual(out, [500, 300]);
});

// ── Leavening-knob visibility ───────────────────────────────────────────────────

test('showsLeaveningKnob: only orders/both with a designated, shown leavening', () => {
  const base = { leaveningKey: 'yeast', showLeavening: true };
  assert.equal(showsLeaveningKnob({ ...base, logic: 'orders' }), true);
  assert.equal(showsLeaveningKnob({ ...base, logic: 'both' }), true);
  assert.equal(showsLeaveningKnob({ ...base, logic: 'total' }), false);     // total → never
  assert.equal(showsLeaveningKnob({ logic: 'orders', leaveningKey: null }), false); // no leavening
  assert.equal(showsLeaveningKnob({ logic: 'orders', leaveningKey: 'yeast', showLeavening: false }), false);
});

// ── Normalisation ───────────────────────────────────────────────────────────────

// ⚠️ REVERSED 13 Aug 2026, ON PURPOSE. This used to assert that a document with no
// recipes GAINED three — The Italian Club Bakery's three. It was reasonable while
// the app had one user and became two defects the moment it had customers: a new
// customer opened the Calculator holding one bakery's formulas, and a customer who
// deleted all their own recipes had those formulas appear from nowhere.
//
// No recipes is now a real answer, and the screen says so instead of filling the
// silence with somebody else's work.
test('a config without recipes STAYS without recipes', () => {
  const nested = { clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', dough: 'focaccia', weight: 100, kind: 'number' }] }] };
  const norm = normalizeConfig(nested);
  assert.deepEqual(getRecipes(norm).map(r => r.id), [],
    'an empty recipe list must never be refilled with the bakery’s own recipes');
});

// And deleting the last recipe must not bring them back either — the same defect
// seen from the other side, and the one a customer would actually hit.
test('deleting every recipe leaves none, not three', () => {
  const emptied = normalizeConfig({ ...BAKERY_CONFIG, recipes: [] });
  assert.deepEqual(getRecipes(emptied).map(r => r.id), []);
});

test('normalizeRecipe: repairs logic, validates the leavening key, keeps unique keys', () => {
  const raw = {
    products: [], clients: [],
    recipes: [{
      id: 'r1', name: 'Custom', logic: 'weird',
      ingredients: [
        { key: 'a', label: 'Flour', grams: 1000 },
        { key: 'a', label: 'Water', grams: 500 }, // duplicate key -> made unique
        { label: 'Yeast', grams: 20 },            // no key -> derived from label
      ],
      leaveningKey: 'ghost', leaveningDefaultPct: 2,
    }],
  };
  const r = getRecipeById(normalizeConfig(raw), 'r1');
  assert.equal(r.logic, 'orders');                 // 'weird' -> default
  assert.equal(r.leaveningKey, null);              // 'ghost' is not an ingredient key
  const keys = r.ingredients.map(i => i.key);
  assert.equal(new Set(keys).size, keys.length);   // keys are unique
  assert.equal(r.ingredients[2].key, 'yeast');     // derived from the label slug
});

test('normalizeRecipe: baseline falls back to the default leavening % when unset', () => {
  const raw = {
    products: [], clients: [],
    recipes: [{
      id: 'r1', name: 'Custom', logic: 'orders',
      ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast', label: 'Yeast', grams: 20 }],
      leaveningKey: 'yeast', leaveningDefaultPct: 2, // no baselinePct given
    }],
  };
  const r = getRecipeById(normalizeConfig(raw), 'r1');
  assert.equal(r.baselinePct, 2); // falls back to the default leavening %
});

test('normalizeRecipes: de-duplicates by id (first wins)', () => {
  const raw = {
    products: [], clients: [],
    recipes: [
      { id: 'r1', name: 'First', logic: 'orders', ingredients: [{ key: 'a', label: 'A', grams: 1 }] },
      { id: 'r1', name: 'Dup', logic: 'total', ingredients: [{ key: 'b', label: 'B', grams: 2 }] },
    ],
  };
  const recipes = getRecipes(normalizeConfig(raw));
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'First');
});

test('normalizeIngredients: registry is the union of saved names and recipe labels', () => {
  const raw = {
    products: [], clients: [],
    recipes: [{ id: 'r1', name: 'R', logic: 'total', ingredients: [{ key: 'flour', label: 'Special Flour', grams: 1000 }] }],
    ingredients: [{ id: 'i1', name: 'Olives' }, { id: 'i2', name: 'olives' }], // case-dup collapsed
  };
  const names = getIngredients(normalizeConfig(raw)).map(i => i.name);
  assert.ok(names.includes('Olives'));
  assert.ok(names.includes('Special Flour')); // recipe label seeded into the registry
  assert.equal(names.filter(n => n.toLowerCase() === 'olives').length, 1); // de-duped
});

test('getVisibleRecipes caps at MAX_VISIBLE_RECIPES and honours order + visible', () => {
  const mk = (id, order, visible) => ({ id, name: id, logic: 'orders', ingredients: [{ key: 'a', label: 'A', grams: 1 }], order, visible });
  const raw = { products: [], clients: [], recipes: [
    mk('e', 4, true), mk('a', 0, true), mk('hidden', 1, false), mk('b', 1, true), mk('c', 2, true), mk('d', 3, true),
  ] };
  const visible = getVisibleRecipes(normalizeConfig(raw)).map(r => r.id);
  assert.equal(visible.length, MAX_VISIBLE_RECIPES);
  assert.deepEqual(visible, ['a', 'b', 'c', 'd']); // hidden excluded, sorted by order, capped at 4
});

test('LOGICS lists the three calc logics', () => {
  assert.deepEqual(LOGICS, ['orders', 'total', 'both']);
});

// ── computeRecipeTarget (per-logic target, the dangerous math) ──────────────────

test('computeRecipeTarget: orders = Σ(qty×weight) + extra; ignores any typed total', () => {
  const recipe = getRecipeById(BAKERY_CONFIG, 'focaccia'); // logic 'orders'
  const getQty = (id) => ({ [pairId('c-bakery', 'f-pizze')]: 10 }[id] || 0); // 10×201
  const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 9999 });
  assert.equal(t, 10 * 201 + 500); // typed total ignored for 'orders'
});

test('computeRecipeTarget: total = the typed total only (no orders, no extra)', () => {
  const recipe = { id: 'r1', logic: 'total', ingredients: [] };
  const getQty = () => 5; // would-be orders ignored
  assert.equal(computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 8000 }), 8000);
});

test('computeRecipeTarget: both = orders + typed total + extra', () => {
  const recipe = { ...getRecipeById(BAKERY_CONFIG, 'focaccia'), logic: 'both' };
  const getQty = (id) => ({ [pairId('c-bakery', 'f-pizze')]: 10 }[id] || 0);
  const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 2000 });
  assert.equal(t, 10 * 201 + 2000 + 500);
});

test('computeRecipeTarget never produces NaN/negative from junk inputs', () => {
  const recipe = { id: 'r1', logic: 'both', ingredients: [] };
  const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty: () => 0, extraGrams: 'oops', totalInput: -50 });
  assert.ok(Number.isFinite(t) && t >= 0);
});
