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
  blockingIngredients, unlinkedRowNames,
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

// ── Where to start ───────────────────────────────────────────────────────────
//
// ⚠️ THE ANSWER TO "DO I REALLY HAVE TO FILL IN 65 INGREDIENTS?" A handful appear
// in almost everything; handed a flat list somebody starts at A and gives up at F
// having unblocked nothing.

test('the busiest undeclared ingredient comes first', () => {
  const ings = ingredients();
  ings.YEAST = { id: 'YEAST', name: 'Yeast' };        // undeclared, in three recipes
  ings.SEEDS = { id: 'SEEDS', name: 'Seeds' };        // undeclared, in one
  const recipes = [
    recipe('A', [row('Flour', 'FLOUR'), row('Yeast', 'YEAST')]),
    recipe('B', [row('Flour', 'FLOUR'), row('Yeast', 'YEAST')]),
    recipe('C', [row('Yeast', 'YEAST'), row('Seeds', 'SEEDS')]),
  ];
  const out = blockingIngredients(recipes, { ingredients: ings });
  assert.deepEqual(out.map(x => [x.name, x.blocks]), [['Yeast', 3], ['Seeds', 1]]);
});

test('a declared ingredient is not on the work list at all', () => {
  const out = blockingIngredients([recipe('A', [row('Flour', 'FLOUR')])], { ingredients: ingredients() });
  assert.deepEqual(out, []);
});

test('an ingredient blocking one recipe TWICE is counted once', () => {
  // Two rows of the same undeclared thing is still one job.
  const ings = ingredients();
  ings.YEAST = { id: 'YEAST', name: 'Yeast' };
  const out = blockingIngredients([recipe('A', [row('Yeast', 'YEAST'), row('More yeast', 'YEAST')])],
    { ingredients: ings });
  assert.deepEqual(out.map(x => x.blocks), [1]);
});

test('it reaches through a sub-recipe', () => {
  const ings = ingredients();
  ings.YEAST = { id: 'YEAST', name: 'Yeast' };
  const sub = recipe('SUB', [row('Yeast', 'YEAST')]);
  const out = blockingIngredients([recipe('A', [row('Filling', 'SUB', 100, 'recipe')])],
    { ingredients: ings, recipes: { SUB: sub } });
  assert.deepEqual(out.map(x => [x.name, x.blocks]), [['Yeast', 1]]);
});

test('A DELETED INGREDIENT IS NOT PUT ON THE WORK LIST', () => {
  // It cannot be declared — it does not exist — so it would sit at the top for
  // ever. The recipe's own gaps still report it, which is where it can be acted on.
  const out = blockingIngredients([recipe('A', [row('Gone', 'DELETED')])], { ingredients: ingredients() });
  assert.deepEqual(out, []);
});

test('an unlinked row is not on this list either — it is a different job', () => {
  // "Link it" and "declare it" are two different actions; this list is the second.
  const out = blockingIngredients([recipe('A', [{ label: 'Something', grams: 10, unit: 'g' }])],
    { ingredients: ingredients() });
  assert.deepEqual(out, []);
});

test('a cycle does not hang the work list', () => {
  const self = recipe('A', [row('Itself', 'A', 100, 'recipe')]);
  assert.deepEqual(blockingIngredients([self], { ingredients: ingredients(), recipes: { A: self } }), []);
});

test('the order is stable between two runs', () => {
  const ings = ingredients();
  ings.AAA = { id: 'AAA', name: 'Aaa' };
  ings.BBB = { id: 'BBB', name: 'Bbb' };
  const recipes = [recipe('A', [row('a', 'AAA'), row('b', 'BBB')])];
  const first = blockingIngredients(recipes, { ingredients: ings }).map(x => x.name);
  const second = blockingIngredients(recipes, { ingredients: ings }).map(x => x.name);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['Aaa', 'Bbb'], 'ties break by name, not by insertion order');
});

test('junk never throws', () => {
  assert.deepEqual(blockingIngredients(null, {}), []);
  assert.deepEqual(blockingIngredients([null, {}], {}), []);
});

// ── The job BEFORE declaring ─────────────────────────────────────────────────
//
// ⚠️ THIS EXISTS BECAUSE THE WORK LIST WAS EMPTY ON THE REAL DATA. On 11 August
// 2026 the bakery had 77 recipe rows and NONE of them linked, so
// blockingIngredients() had nothing to count and the screen whose whole point is
// "start here" showed nothing at all. Linking comes first, strictly: a
// declaration cannot reach a recipe that does not point at the ingredient.

test('THE ROWS THAT ARE NOT LINKED ARE THEIR OWN JOB, counted by name', () => {
  const recipes = [
    recipe('A', [{ label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Salt', grams: 20, unit: 'g' }]),
    recipe('B', [{ label: 'Flour', grams: 500, unit: 'g' }]),
    recipe('C', [{ label: 'Flour', grams: 500, unit: 'g' }]),
  ];
  assert.deepEqual(unlinkedRowNames(recipes).map(x => [x.name, x.rows]), [['Flour', 3], ['Salt', 1]]);
});

test('a LINKED row is not on the linking list', () => {
  assert.deepEqual(unlinkedRowNames([recipe('A', [row('Flour', 'FLOUR')])]), []);
});

test('the same name in one recipe twice is TWO links to make', () => {
  // Unlike declaring, which is one job per ingredient however often it appears,
  // linking is one action per ROW.
  const r = recipe('A', [{ label: 'Flour', grams: 100, unit: 'g' }, { label: 'Flour', grams: 50, unit: 'g' }]);
  assert.deepEqual(unlinkedRowNames([r]).map(x => x.rows), [2]);
});

test('a blank line is not a job here either', () => {
  assert.deepEqual(unlinkedRowNames([recipe('A', [{ label: '  ', grams: 0 }])]), []);
});

test('the order is busiest first, ties by name, and stable', () => {
  const recipes = [recipe('A', [{ label: 'Bbb', grams: 1 }, { label: 'Aaa', grams: 1 }])];
  assert.deepEqual(unlinkedRowNames(recipes).map(x => x.name), ['Aaa', 'Bbb']);
});

test('junk never throws', () => {
  assert.deepEqual(unlinkedRowNames(null), []);
  assert.deepEqual(unlinkedRowNames([null, {}]), []);
});
