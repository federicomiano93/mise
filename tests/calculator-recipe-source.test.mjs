// Where a Calculator tab's ingredients come from — the old shape and the new one.
//
// ⚠️⚠️ THE TESTS THAT MATTER MOST ARE THE REFUSALS. An empty ingredient list
// calculates perfectly happily and produces a dough of zero; that is the July
// defect — the data moved before the code could read it and the app was left
// with no weights for everybody — wearing a different hat. Every way a linked
// recipe can fail to be read must REFUSE, never bake with nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBLEMS, isWeighable, linkedRecipeIds, isLinked, resolveRecipe, canCalculate,
  leaveningLost,
} from '../js/calculator-recipe-source.js';

const OLD = {
  name: 'Focaccia',
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'yeast', label: 'Yeast', grams: 10 },
  ],
  leaveningKey: 'yeast',
};

const LINKED = { name: 'Focaccia', catalogueId: 'cat-1', leaveningRid: 'r-yeast' };

const CATALOGUE = {
  'cat-1': {
    name: 'Focaccia',
    ingredients: [
      { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'r-yeast', label: 'Yeast', grams: 10, unit: 'g' },
    ],
  },
};

// ── The shape today keeps working, untouched ─────────────────────────────────

// ⚠️ THIS IS WHAT LETS THE CODE SHIP BEFORE ANY DATA MOVES. A tab nobody has
// linked behaves exactly as it does now.
test('a tab with its own ingredients is left exactly as it is', () => {
  const r = resolveRecipe(OLD, CATALOGUE);
  assert.equal(r.linked, false);
  assert.equal(r.problem, null);
  assert.deepEqual(r.ingredients, OLD.ingredients);
  assert.equal(r.leaveningKey, 'yeast');
  assert.equal(canCalculate(r), true);
});

test('…even when the Catalogue is not loaded at all', () => {
  const r = resolveRecipe(OLD, {});
  assert.equal(canCalculate(r), true);
  assert.equal(r.ingredients.length, 2);
});

// ── The linked shape ─────────────────────────────────────────────────────────

test('a linked tab takes its name and rows from the Catalogue', () => {
  const r = resolveRecipe(LINKED, CATALOGUE);
  assert.equal(r.linked, true);
  assert.equal(r.name, 'Focaccia');
  assert.deepEqual(r.ingredients.map(i => i.label), ['Flour', 'Yeast']);
  assert.deepEqual(r.ingredients.map(i => i.grams), [1000, 10]);
  assert.equal(canCalculate(r), true);
});

// ⚠️ BY THE ROW'S OWN id, NEVER ITS NAME. Not hypothetical: the real Sourdough
// calls its leavening "Starter" in the Calculator and "Sourdough starter" in the
// Catalogue TODAY, so a name match would have switched the knob off on day one.
test('the leavening is found by the row id, so a rename cannot silence it', () => {
  const renamed = {
    'cat-1': {
      name: 'Focaccia',
      ingredients: [
        { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
        { rid: 'r-yeast', label: 'Fresh yeast, changed name', grams: 10, unit: 'g' },
      ],
    },
  };
  const r = resolveRecipe(LINKED, renamed);
  assert.equal(r.leaveningKey, 'r-yeast');
  assert.equal(leaveningLost(LINKED, r), false);
});

// ⚠️ AND WHEN THE ROW REALLY IS GONE, THE SCREEN IS TOLD. The dough still
// calculates — every other ingredient is there — but the knob must not go on
// being shown while it scales nothing.
test('a leavening row that no longer exists is reported, not ignored', () => {
  const gone = {
    'cat-1': { name: 'Focaccia', ingredients: [{ rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' }] },
  };
  const r = resolveRecipe(LINKED, gone);
  assert.equal(r.leaveningKey, null);
  assert.equal(canCalculate(r), true, 'the rest of the dough is still fine');
  assert.equal(leaveningLost(LINKED, r), true);
});

// ── ⚠️ THE REFUSALS ──────────────────────────────────────────────────────────

test('⚠️ a linked recipe that cannot be read REFUSES rather than baking nothing', () => {
  const r = resolveRecipe(LINKED, {});
  assert.equal(r.problem, PROBLEMS.missing);
  assert.deepEqual(r.ingredients, []);
  assert.equal(canCalculate(r), false);
});

// ⚠️ NOT A FALLBACK TO THE OLD COPY. A stale copy is exactly what this change
// removes; using one here would mean the app quietly bakes last month's recipe
// whenever the network hiccups.
test('…and does NOT fall back to the tab’s own leftover ingredients', () => {
  const both = { ...OLD, catalogueId: 'cat-1', leaveningRid: 'r-yeast' };
  const r = resolveRecipe(both, {});
  assert.equal(r.problem, PROBLEMS.missing);
  assert.deepEqual(r.ingredients, [], 'the leftover copy must not be used');
});

test('an empty Catalogue recipe refuses too', () => {
  const r = resolveRecipe(LINKED, { 'cat-1': { name: 'Focaccia', ingredients: [] } });
  assert.equal(r.problem, PROBLEMS.empty);
  assert.equal(canCalculate(r), false);
});

// ⚠️ A ROW MEASURED IN PIECES OR "TO TASTE" BLOCKS THE WHOLE RECIPE AND IS NAMED.
// Skipping it would produce a dough quietly light by exactly that ingredient —
// the one direction a recipe must not be wrong in.
test('⚠️ an unweighable row blocks the recipe AND is named', () => {
  const withPinch = {
    'cat-1': {
      name: 'Almond cream',
      ingredients: [
        { rid: 'r1', label: 'Flour', grams: 1000, unit: 'g' },
        { rid: 'r2', label: 'Vanilla', grams: 0, unit: '' },
      ],
    },
  };
  const r = resolveRecipe(LINKED, withPinch);
  assert.equal(r.problem, PROBLEMS.unweighable);
  assert.equal(r.problemRow, 'Vanilla');
  assert.equal(canCalculate(r), false);
});

test('what counts as weighable', () => {
  assert.equal(isWeighable({ grams: 100, unit: 'g' }), true);
  assert.equal(isWeighable({ grams: 1.5, unit: 'kg' }), true);
  assert.equal(isWeighable({ grams: 100 }), true, 'no unit means grams');
  assert.equal(isWeighable({ grams: 0, unit: 'g' }), false);
  assert.equal(isWeighable({ grams: 2, unit: 'pcs' }), false);
  assert.equal(isWeighable({ grams: 1, unit: 'pinch' }), false);
  assert.equal(isWeighable(null), false);
});

// ── ⚠️ THE COST TRAP ─────────────────────────────────────────────────────────

// The Catalogue is built for 500+ recipes and the Calculator needs three. A
// listener on the collection would turn every app open from 3 reads into 500+ —
// the same mistake made and corrected on the Home's order badge (v207).
test('⚠️ only the LINKED recipes are ever asked for', () => {
  const recipes = [
    { catalogueId: 'a' }, { catalogueId: 'b' }, { catalogueId: 'a' },
    { name: 'not linked' }, { catalogueId: '  ' },
  ];
  assert.deepEqual(linkedRecipeIds(recipes).sort(), ['a', 'b']);
  assert.deepEqual(linkedRecipeIds([]), []);
  assert.deepEqual(linkedRecipeIds(null), []);
});

test('isLinked ignores whitespace and junk', () => {
  assert.equal(isLinked({ catalogueId: 'x' }), true);
  assert.equal(isLinked({ catalogueId: '   ' }), false);
  assert.equal(isLinked({}), false);
  assert.equal(isLinked(null), false);
});

test('nothing at all is refused rather than throwing', () => {
  const r = resolveRecipe(null, {});
  assert.equal(canCalculate(r), false);
  assert.deepEqual(r.ingredients, []);
});
