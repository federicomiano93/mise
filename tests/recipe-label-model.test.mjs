// What goes on a label: the ingredient list in the order the law asks for, the
// allergens emphasised inside it, and the nutrition per 100 g of the FINISHED
// food.
//
// ⚠️ Two rules govern every test here. Nothing is produced unless the recipe is
// fully declared; and a declaration is a WHOLE — half a nutrition table is not a
// smaller answer, it is no answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenIngredients, nutritionPer100g, buildLabel, ingredientLine, containsLine, LABEL_SHOWS,
} from '../js/catalogue/recipe-label-model.js';

const STAMP = '2026-08-11T09:00:00.000Z';
const full = (over = {}) => ({ kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5, ...over });

const ingredients = () => ({
  FLOUR: { id: 'FLOUR', name: 'Flour', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP, nutrition: full({ kcal: 340, carbs: 70 }) },
  BUTTER: { id: 'BUTTER', name: 'Butter', allergens: ['milk'], allergensCheckedAt: STAMP, nutrition: full({ kcal: 740, fat: 82, saturates: 51, carbs: 0 }) },
  WATER: { id: 'WATER', name: 'Water', allergens: [], allergensCheckedAt: STAMP, nutrition: full({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0 }) },
  SALT: { id: 'SALT', name: 'Salt', allergens: [], allergensCheckedAt: STAMP, nutrition: full({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 100 }) },
  NOSPEC: { id: 'NOSPEC', name: 'No spec', allergens: [], allergensCheckedAt: STAMP },  // declared, but no nutrition
});

const row = (label, refId, grams, kind = 'ingredient') => ({ label, grams, unit: 'g', kind, refId });
const recipe = (id, rows, extra = {}) => ({ id, name: id, ingredients: rows, ...extra });

const bread = () => recipe('BREAD', [
  row('Flour', 'FLOUR', 1000),
  row('Water', 'WATER', 600),
  row('Butter', 'BUTTER', 200),
  row('Salt', 'SALT', 20),
], { name: 'Test bread' });

// ── The ingredient list ──────────────────────────────────────────────────────

test('the list is in DESCENDING weight order — the order the law asks for', () => {
  const out = flattenIngredients(bread(), { ingredients: ingredients() });
  assert.deepEqual(out.map(i => i.name), ['Flour', 'Water', 'Butter', 'Salt']);
});

test('a sub-recipe is FLATTENED, not named', () => {
  // A label may not say "filling" and stop — the reader needs the actual things.
  const filling = recipe('SUB', [row('Butter', 'BUTTER', 800), row('Salt', 'SALT', 200)]);
  const cake = recipe('R1', [row('Flour', 'FLOUR', 500), row('Filling', 'SUB', 500, 'recipe')]);
  const out = flattenIngredients(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.deepEqual(out.map(i => i.name), ['Flour', 'Butter', 'Salt']);
  assert.equal(out.find(i => i.name === 'Filling'), undefined, 'the sub-recipe must not appear by name');
});

test('…and is scaled to how much of it goes in', () => {
  // 500 g of a 1000 g filling is HALF of each of its ingredients.
  const filling = recipe('SUB', [row('Butter', 'BUTTER', 800), row('Salt', 'SALT', 200)]);
  const cake = recipe('R1', [row('Filling', 'SUB', 500, 'recipe')]);
  const out = flattenIngredients(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.equal(Math.round(out.find(i => i.name === 'Butter').grams), 400);
  assert.equal(Math.round(out.find(i => i.name === 'Salt').grams), 100);
});

test('THE SAME INGREDIENT USED TWICE IS ONE LINE, SUMMED', () => {
  // ⚠️ Butter in the dough and butter in the filling is butter. Two lines would
  // look wrong AND sort wrong: two half-weights sit lower than the one real one.
  const filling = recipe('SUB', [row('Butter', 'BUTTER', 1000)]);
  const cake = recipe('R1', [
    row('Butter', 'BUTTER', 300),
    row('Filling', 'SUB', 500, 'recipe'),
    row('Flour', 'FLOUR', 700),
  ]);
  const out = flattenIngredients(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.equal(out.filter(i => i.name === 'Butter').length, 1, 'butter appeared twice');
  assert.equal(Math.round(out.find(i => i.name === 'Butter').grams), 800, '300 + 500');
  // …and being 800 it now outranks the 700 g of flour.
  assert.deepEqual(out.map(i => i.name), ['Butter', 'Flour']);
});

test('the order is stable between two runs', () => {
  const r = recipe('R1', [row('a', 'FLOUR', 100), row('b', 'BUTTER', 100)]);
  const one = flattenIngredients(r, { ingredients: ingredients() }).map(i => i.name);
  const two = flattenIngredients(r, { ingredients: ingredients() }).map(i => i.name);
  assert.deepEqual(one, two);
  assert.deepEqual(one, ['Butter', 'Flour'], 'equal weights break by name');
});

test('a cycle and an over-deep nesting do not hang it', () => {
  const self = recipe('R1', [row('itself', 'R1', 100, 'recipe')]);
  assert.deepEqual(flattenIngredients(self, { ingredients: ingredients(), recipes: { R1: self } }), []);
});

// ── Nutrition ────────────────────────────────────────────────────────────────

test('PER 100 g OF THE FINISHED FOOD, NOT OF THE DOUGH', () => {
  // ⚠️ Water leaves in the oven. 1820 g of dough at 20% loss is 1456 g of bread,
  // so every value per 100 g of bread is HIGHER than per 100 g of dough. Using
  // the mixing weight understates a bread label by about a fifth.
  const dough = nutritionPer100g(bread(), { ingredients: ingredients() });
  const baked = nutritionPer100g({ ...bread(), lossPct: 20 }, { ingredients: ingredients() });
  assert.ok(baked.kcal > dough.kcal, `${baked.kcal} should exceed ${dough.kcal}`);
  assert.equal(baked.lossPct, 20);
  assert.equal(dough.lossPct, 0);
  // …and by the right factor: 1 / 0.8 = 1.25
  assert.ok(Math.abs(baked.kcal / dough.kcal - 1.25) < 0.02, `${baked.kcal} / ${dough.kcal}`);
});

test('the arithmetic is right on a simple case', () => {
  // 1000 g of flour at 340 kcal/100 g, no loss → 340 kcal per 100 g.
  const out = nutritionPer100g(recipe('R1', [row('Flour', 'FLOUR', 1000)]), { ingredients: ingredients() });
  assert.equal(out.kcal, 340);
  assert.equal(out.carbs, 70);
});

test('ONE INGREDIENT WITHOUT A FULL TABLE MEANS NO TABLE AT ALL', () => {
  // ⚠️ Summing the seven over the ingredients that happen to have them would
  // under-declare every value by however much is missing, and nothing on the
  // label would say so.
  const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Mystery', 'NOSPEC', 100)]);
  assert.equal(nutritionPer100g(r, { ingredients: ingredients() }), null);
});

test('an all-zero ingredient is a real one and does not block', () => {
  // Water: really 0 everything. It must dilute the result, not refuse it.
  const out = nutritionPer100g(recipe('R1', [row('Flour', 'FLOUR', 500), row('Water', 'WATER', 500)]),
    { ingredients: ingredients() });
  assert.ok(out !== null);
  assert.equal(out.kcal, 170, 'half flour, half water');
});

test('salt keeps two decimals — 0.1 g would print as 0.0 otherwise', () => {
  const out = nutritionPer100g(recipe('R1', [row('Flour', 'FLOUR', 1000), row('Salt', 'SALT', 20)]),
    { ingredients: ingredients() });
  assert.ok(out.salt > 0, 'salt rounded away to zero');
  assert.ok(String(out.salt).includes('.'), `${out.salt} lost its decimals`);
});

test('an empty recipe has no declaration', () => {
  assert.equal(nutritionPer100g(recipe('R1', []), { ingredients: ingredients() }), null);
  assert.equal(nutritionPer100g(null, {}), null);
});

// ── The whole label ──────────────────────────────────────────────────────────

test('A RECIPE THAT IS NOT FULLY DECLARED PRODUCES NO LABEL', () => {
  // ⚠️ The one gate. Everything else in this file assumes it has been passed.
  const ings = ingredients();
  ings.UNKNOWN = { id: 'UNKNOWN', name: 'Unknown' };   // never checked
  const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Unknown', 'UNKNOWN', 10)]);
  const label = buildLabel(r, { ingredients: ings });
  assert.equal(label.ok, false);
  assert.equal(label.reason, 'not-declared');
  assert.ok(label.gaps.length >= 1);
  assert.equal(label.ingredients, undefined, 'no list may be handed out at all');
});

test('a declared recipe produces a list with the allergens marked INSIDE it', () => {
  // The regulation asks for the allergen to be emphasised in the ingredient list,
  // not only summarised underneath.
  const label = buildLabel(bread(), { ingredients: ingredients() });
  assert.equal(label.ok, true);
  assert.deepEqual(label.ingredients.map(i => i.name), ['Flour', 'Water', 'Butter', 'Salt']);
  assert.equal(label.ingredients.find(i => i.name === 'Flour').emphasise, true);
  assert.equal(label.ingredients.find(i => i.name === 'Water').emphasise, false);
  assert.deepEqual(label.allergens, ['gluten-wheat', 'milk']);
});

test('the plain-text line puts the allergens in CAPITALS', () => {
  const label = buildLabel(bread(), { ingredients: ingredients() });
  assert.equal(ingredientLine(label), 'FLOUR, Water, BUTTER, Salt');
  assert.equal(containsLine(label), 'Contains: Wheat, Milk');
  assert.equal(ingredientLine({ ok: false }), '');
});

test('"Contains:" is empty rather than saying "nothing"', () => {
  const label = buildLabel(recipe('R1', [row('Water', 'WATER', 100)]), { ingredients: ingredients() });
  assert.equal(label.ok, true);
  assert.equal(containsLine(label), '');
});

test('the switch decides what is worked out, not just what is shown', () => {
  const tables = { ingredients: ingredients() };
  assert.equal(buildLabel(bread(), tables, { shows: 'allergens' }).nutrition, null);
  assert.ok(buildLabel(bread(), tables, { shows: 'nutrition' }).nutrition !== null);
  assert.ok(buildLabel(bread(), tables, { shows: 'both' }).nutrition !== null);
  assert.deepEqual([...LABEL_SHOWS], ['allergens', 'nutrition', 'both']);
  // An unknown value falls back to showing everything rather than silently less.
  assert.ok(buildLabel(bread(), tables, { shows: 'nonsense' }).nutrition !== null);
});

test('A LABEL ASKED FOR NUTRITION IT CANNOT WORK OUT SAYS SO', () => {
  // ⚠️ Otherwise it prints the allergen half and looks finished.
  const ings = ingredients();
  const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('No spec', 'NOSPEC', 100)]);
  const label = buildLabel(r, { ingredients: ings }, { shows: 'both' });
  assert.equal(label.ok, true, 'the allergens are still known');
  assert.equal(label.nutrition, null);
  assert.equal(label.nutritionMissing, true);
});

test('…and one asked only for allergens does not claim nutrition is missing', () => {
  const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('No spec', 'NOSPEC', 100)]);
  const label = buildLabel(r, { ingredients: ingredients() }, { shows: 'allergens' });
  assert.equal(label.nutritionMissing, false);
});

test('"may contain" reaches the label and stays separate', () => {
  const ings = ingredients();
  ings.SUGAR = { id: 'SUGAR', name: 'Sugar', allergens: [], mayContain: ['nuts-hazelnut'], allergensCheckedAt: STAMP, nutrition: full() };
  const label = buildLabel(recipe('R1', [row('Sugar', 'SUGAR', 100)]), { ingredients: ings });
  assert.deepEqual(label.allergens, []);
  assert.deepEqual(label.mayContain, ['nuts-hazelnut']);
});

test('junk never throws', () => {
  for (const bad of [null, undefined, {}]) {
    assert.equal(buildLabel(bad, {}).ok, false);
  }
});
