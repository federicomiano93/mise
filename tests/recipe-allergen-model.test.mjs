// Rolling allergens up from ingredients to a recipe.
//
// ⚠️ THE RULE EVERY TEST HERE ORBITS: a gap anywhere makes the whole recipe
// incomplete, and an incomplete recipe may not be turned into a label. The cost
// model answers the same gaps with an honest partial number; here a partial
// answer is the dangerous one, because the row nobody linked could be the one
// with the hazelnuts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeAllergens, canLabel, incompleteText, ALLERGEN_REASON_TEXT,
} from '../js/catalogue/recipe-allergen-model.js';
import { MAX_RECIPE_DEPTH } from '../js/catalogue/recipe-cost-model.js';

const STAMP = '2026-08-11T09:00:00.000Z';

// Ingredients as Firestore holds them, keyed by id.
const ingredients = () => ({
  FLOUR: { id: 'FLOUR', name: 'Flour', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP },
  BUTTER: { id: 'BUTTER', name: 'Butter', allergens: ['milk'], allergensCheckedAt: STAMP },
  WATER: { id: 'WATER', name: 'Water', allergens: [], allergensCheckedAt: STAMP },
  SUGAR: { id: 'SUGAR', name: 'Sugar', allergens: [], mayContain: ['nuts-hazelnut'], allergensCheckedAt: STAMP },
  MYSTERY: { id: 'MYSTERY', name: 'Mystery mix' },   // nobody has checked it
});

const row = (label, refId, grams = 100, kind = 'ingredient') =>
  ({ label, grams, unit: 'g', kind, refId });

const recipe = (id, rows, extra = {}) => ({ id, name: id, ingredients: rows, ...extra });

// ── The happy case ───────────────────────────────────────────────────────────

test('a fully linked, fully declared recipe is complete and gathers its allergens', () => {
  const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Butter', 'BUTTER', 500), row('Water', 'WATER', 600)]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.deepEqual(out.allergens, ['gluten-wheat', 'milk']);
  assert.equal(out.complete, true);
  assert.equal(canLabel(out), true);
  assert.deepEqual(out.gaps, []);
  assert.equal(incompleteText(out), '');
});

test('an ingredient checked as containing none contributes nothing but does not block', () => {
  // Water is the case: really 0 allergens, and it must not make a recipe unlabelable.
  const out = recipeAllergens(recipe('R1', [row('Water', 'WATER')]), { ingredients: ingredients() });
  assert.deepEqual(out.allergens, []);
  assert.equal(out.complete, true, 'a checked "contains none" must not block');
  assert.equal(canLabel(out), true);
});

// ── THE ONES THAT MATTER ─────────────────────────────────────────────────────

test('AN UNDECLARED INGREDIENT MAKES THE WHOLE RECIPE UNLABELABLE', () => {
  // Mystery mix has never been checked. It might contain anything.
  const r = recipe('R1', [row('Flour', 'FLOUR'), row('Mystery', 'MYSTERY')]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.equal(out.complete, false);
  assert.equal(canLabel(out), false);
  assert.equal(out.gaps.length, 1);
  assert.equal(out.gaps[0].label, 'Mystery');
  assert.equal(out.gaps[0].reason, 'not-declared');
  // …and what IS known is still returned, for the working sheet.
  assert.deepEqual(out.allergens, ['gluten-wheat']);
});

test('A ROW LINKED TO NOTHING MAKES THE WHOLE RECIPE UNLABELABLE', () => {
  // The commonest gap by far: recipes written before links existed.
  const r = recipe('R1', [row('Flour', 'FLOUR'), { label: 'Something', grams: 50, unit: 'g' }]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.equal(canLabel(out), false);
  assert.equal(out.gaps[0].reason, 'not-linked');
});

test('AN UNWEIGHABLE ROW IS NOT AN EXCUSE — a pinch of mustard is still mustard', () => {
  // ⚠️ THE SHARPEST DIFFERENCE FROM THE COST MODEL, which skips these because a
  // pinch costs nothing worth counting. An allergen declaration cannot skip them.
  const r = recipe('R1', [
    row('Flour', 'FLOUR'),
    { label: 'Mustard', unit: 'pinch' },
  ]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.equal(canLabel(out), false, 'an unlinked pinch must still block');
  assert.equal(out.gaps.length, 1);
});

test('a row linked to an ingredient that has been deleted blocks, and says which', () => {
  const r = recipe('R1', [row('Gone', 'DELETED')]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.equal(canLabel(out), false);
  assert.equal(out.gaps[0].reason, 'missing-ingredient');
});

test('a recipe with NO ROWS AT ALL is not "contains none"', () => {
  // Saying "contains none of the 14" about an empty recipe is a statement nobody
  // made. It is unknown, not clean.
  const out = recipeAllergens(recipe('R1', []), { ingredients: ingredients() });
  assert.equal(out.complete, false);
  assert.equal(canLabel(out), false);
});

test('a blank half-typed line is not counted as a gap', () => {
  // Somebody mid-edit must not make the recipe permanently unlabelable for a
  // reason nobody can act on — there is nothing to go and fix.
  const r = recipe('R1', [row('Flour', 'FLOUR'), { label: '   ', grams: 0 }]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.equal(canLabel(out), true);
  assert.deepEqual(out.gaps, []);
});

// ── Through sub-recipes ──────────────────────────────────────────────────────

test('allergens travel up from a sub-recipe', () => {
  const filling = recipe('SUB', [row('Butter', 'BUTTER')]);
  const cake = recipe('R1', [row('Flour', 'FLOUR'), row('Filling', 'SUB', 200, 'recipe')]);
  const out = recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.deepEqual(out.allergens, ['gluten-wheat', 'milk']);
  assert.equal(canLabel(out), true);
});

test('AN INCOMPLETE SUB-RECIPE POISONS THE WHOLE THING', () => {
  // ⚠️ Taking a sub-recipe's KNOWN allergens while ignoring its gaps is how doubt
  // disappears one level up and a half-known answer starts looking complete.
  const filling = recipe('SUB', [row('Butter', 'BUTTER'), row('Mystery', 'MYSTERY')]);
  const cake = recipe('R1', [row('Flour', 'FLOUR'), row('Filling', 'SUB', 200, 'recipe')]);
  const out = recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.equal(canLabel(out), false);
  assert.equal(out.gaps[0].reason, 'sub-incomplete');
  // The milk from the sub-recipe must NOT have leaked up as if it were the answer.
  assert.deepEqual(out.allergens, ['gluten-wheat']);
});

test('a recipe that contains itself is reported as a cycle, not a hung screen', () => {
  const self = recipe('R1', [row('Itself', 'R1', 100, 'recipe')]);
  const out = recipeAllergens(self, { ingredients: ingredients(), recipes: { R1: self } });
  assert.equal(canLabel(out), false);
  assert.equal(out.gaps[0].reason, 'cycle');
});

test('two rows using the SAME sub-recipe are not mistaken for a cycle', () => {
  const filling = recipe('SUB', [row('Butter', 'BUTTER')]);
  const cake = recipe('R1', [row('A', 'SUB', 100, 'recipe'), row('B', 'SUB', 100, 'recipe')]);
  const out = recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
  assert.equal(canLabel(out), true, 'a shared sub-recipe is legitimate, not a cycle');
  assert.deepEqual(out.allergens, ['milk']);
});

test('nesting too deep ends in a message rather than a stack overflow', () => {
  const recipes = {};
  for (let i = 0; i <= MAX_RECIPE_DEPTH + 2; i += 1) {
    recipes['L' + i] = recipe('L' + i, [row('down', 'L' + (i + 1), 100, 'recipe')]);
  }
  const out = recipeAllergens(recipes.L0, { ingredients: ingredients(), recipes });
  assert.equal(canLabel(out), false);
  assert.ok(['too-deep', 'sub-incomplete'].includes(out.gaps[0].reason), out.gaps[0].reason);
});

// ── "May contain" ────────────────────────────────────────────────────────────

test('"may contain" travels up but stays separate from "contains"', () => {
  const out = recipeAllergens(recipe('R1', [row('Sugar', 'SUGAR')]), { ingredients: ingredients() });
  assert.deepEqual(out.allergens, []);
  assert.deepEqual(out.mayContain, ['nuts-hazelnut']);
  assert.equal(canLabel(out), true);
});

test('"may contain X" is dropped when the recipe already CONTAINS X', () => {
  // Butter puts milk in outright; another row saying "may contain traces of milk"
  // adds nothing but noise to a label with very little room.
  const ings = ingredients();
  ings.SUGAR = { id: 'SUGAR', allergens: [], mayContain: ['milk'], allergensCheckedAt: STAMP };
  const out = recipeAllergens(recipe('R1', [row('Butter', 'BUTTER'), row('Sugar', 'SUGAR')]), { ingredients: ings });
  assert.deepEqual(out.allergens, ['milk']);
  assert.deepEqual(out.mayContain, []);
});

// ── What the screen says ─────────────────────────────────────────────────────

test('the reason for every gap has plain words to show', () => {
  for (const reason of Object.keys(ALLERGEN_REASON_TEXT)) {
    assert.ok(ALLERGEN_REASON_TEXT[reason].length > 0, `${reason} has no text`);
  }
});

test('the incomplete line counts the gaps and says a label cannot be made', () => {
  const r = recipe('R1', [row('Flour', 'FLOUR'), row('Mystery', 'MYSTERY')]);
  const out = recipeAllergens(r, { ingredients: ingredients() });
  assert.match(incompleteText(out), /1 ingredient is not declared/);
  assert.match(incompleteText(out), /no label can be made/);
  assert.equal(incompleteText({ complete: true }), '');
});

test('junk never throws', () => {
  for (const bad of [null, undefined, {}, { ingredients: 'nope' }]) {
    const out = recipeAllergens(bad, {});
    assert.equal(canLabel(out), false, `${JSON.stringify(bad)} produced a labelable result`);
  }
  assert.equal(canLabel(null), false);
  assert.equal(canLabel(undefined), false);
  assert.equal(canLabel({ complete: 'yes' }), false, 'only a real boolean counts');
});
