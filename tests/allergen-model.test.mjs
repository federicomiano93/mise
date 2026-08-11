// The allergen and nutrition data an ingredient carries.
//
// ⚠️ THESE ARE THE HIGHEST-STAKES TESTS IN THE PROJECT. Everything else this app
// does gets money, doses or times wrong; this gets somebody hospitalised. Federico
// cannot read code, so these are the safety net (P15) — and the one that matters
// most is marked where it sits: an ingredient nobody has checked must NEVER read
// as allergen-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLERGENS, ALLERGEN_CODES, ALLERGEN_STATES, ALLERGEN_GROUPS,
  NUTRIENTS, NUTRIENT_KEYS,
  allergenLabel, isAllergenCode, normalizeAllergens, normalizeMayContain,
  allergenState, checkedAt, isDeclared,
  normalizeNutrition, hasFullNutrition, missingNutrients,
  buildAllergenFields,
} from '../js/allergen-model.js';

// ── THE ONE THAT MATTERS MOST ────────────────────────────────────────────────

test('AN INGREDIENT NOBODY HAS CHECKED IS NEVER "ALLERGEN-FREE"', () => {
  // The fatal ambiguity: an empty list looks identical whether it means "checked,
  // contains none" or "nobody has said anything". Only the stamp tells them apart,
  // and everything that builds a label asks isDeclared() before trusting a list.
  const untouched = { name: 'Flour' };
  assert.equal(allergenState(untouched), 'unknown');
  assert.equal(isDeclared(untouched), false);

  const emptyListNoStamp = { name: 'Flour', allergens: [] };
  assert.equal(allergenState(emptyListNoStamp), 'unknown',
    'an empty list with no stamp must NOT read as "contains none"');
  assert.equal(isDeclared(emptyListNoStamp), false);

  const checkedContainsNone = { name: 'Water', allergens: [], allergensCheckedAt: '2026-08-11' };
  assert.equal(allergenState(checkedContainsNone), 'none');
  assert.equal(isDeclared(checkedContainsNone), true);
});

test('a checked ingredient that contains something reads as listed', () => {
  const flour = { allergens: ['gluten-wheat'], allergensCheckedAt: '2026-08-11' };
  assert.equal(allergenState(flour), 'listed');
  assert.equal(isDeclared(flour), true);
});

test('a blank or junk stamp is not a check', () => {
  for (const stamp of ['', '   ', null, undefined]) {
    assert.equal(allergenState({ allergens: ['milk'], allergensCheckedAt: stamp }), 'unknown',
      `a stamp of ${JSON.stringify(stamp)} was accepted as a check`);
  }
  assert.equal(allergenState(null), 'unknown');
  assert.equal(allergenState('nope'), 'unknown');
});

test('the three states are a closed list', () => {
  assert.deepEqual([...ALLERGEN_STATES], ['unknown', 'none', 'listed']);
});

// ── The 14, named as the law requires ────────────────────────────────────────

test('the specific cereal and the specific nut are named, not the category', () => {
  // "Contains nuts" is not compliant, and is useless to somebody who can eat
  // almonds but not hazelnuts. There must be no bare 'gluten' or 'nuts' code.
  assert.equal(isAllergenCode('gluten'), false);
  assert.equal(isAllergenCode('nuts'), false);
  assert.equal(isAllergenCode('gluten-wheat'), true);
  assert.equal(isAllergenCode('nuts-hazelnut'), true);
  assert.equal(allergenLabel('gluten-wheat'), 'Wheat');
  assert.equal(allergenLabel('nuts-hazelnut'), 'Hazelnut');
});

test('all 14 regulated groups are present, none missing', () => {
  // The list a UK food business must declare. A group missing here is a group
  // that can never be ticked, and therefore never appears on a label.
  const expected = [
    'gluten', 'nuts', 'celery', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk',
    'molluscs', 'mustard', 'peanuts', 'sesame', 'soybeans', 'sulphites',
  ].sort();
  assert.deepEqual([...ALLERGEN_GROUPS].sort(), expected);
  assert.equal(ALLERGEN_GROUPS.length, 14);
});

test('peanuts are their own group, separate from tree nuts', () => {
  // A legal and a medical distinction: peanuts are a legume, and somebody
  // allergic to peanuts is not necessarily allergic to almonds. Filing them
  // under "nuts" would be wrong in both directions.
  const peanut = ALLERGENS.find(a => a.code === 'peanuts');
  assert.equal(peanut.group, 'peanuts');
  assert.equal(ALLERGENS.some(a => a.group === 'nuts' && a.code === 'peanuts'), false);
});

test('every entry has a code, a group and a printable label', () => {
  for (const a of ALLERGENS) {
    assert.ok(a.code && a.group && a.label, `incomplete entry: ${JSON.stringify(a)}`);
  }
  assert.equal(new Set(ALLERGEN_CODES).size, ALLERGEN_CODES.length, 'a code is duplicated');
});

// ── Normalising ──────────────────────────────────────────────────────────────

test('an unknown code is DROPPED, never passed through', () => {
  // Anything reaching a label has to be printable. An unknown code would show as
  // a blank or as raw text on a legal declaration; dropping it cannot invent an
  // allergen, which is the only direction that matters.
  assert.deepEqual(normalizeAllergens(['milk', 'unicorn', 'gluten-wheat']), ['gluten-wheat', 'milk']);
  assert.deepEqual(normalizeAllergens(['nonsense']), []);
});

test('the same allergen ticked twice is listed once', () => {
  assert.deepEqual(normalizeAllergens(['milk', 'milk', ' milk ']), ['milk']);
});

test('the order is canonical, so two identical ingredients produce identical lists', () => {
  // Which is what lets a label be compared with the one printed last month.
  const a = normalizeAllergens(['milk', 'eggs', 'gluten-wheat']);
  const b = normalizeAllergens(['gluten-wheat', 'milk', 'eggs']);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['gluten-wheat', 'eggs', 'milk']);
});

test('junk never throws and never invents an allergen', () => {
  for (const bad of [null, undefined, 'milk', 42, {}, [null], [{}]]) {
    assert.deepEqual(normalizeAllergens(bad), [], `${JSON.stringify(bad)} produced something`);
  }
});

// ── "May contain" stays a separate fact ──────────────────────────────────────

test('"may contain" is never merged into "contains"', () => {
  // Two different statements with two different consequences. Merging them would
  // make every product near a nut declare nuts outright, which is how a label
  // stops being read at all.
  const fields = buildAllergenFields({
    allergens: ['milk'], mayContain: ['nuts-hazelnut'], checkedAt: '2026-08-11',
  });
  assert.deepEqual(fields.allergens, ['milk']);
  assert.deepEqual(fields.mayContain, ['nuts-hazelnut']);
});

test('"may contain X" is dropped when the thing already CONTAINS X', () => {
  // It is already declared, more strongly, one line above — printing both is
  // noise on a label that has very little room.
  const fields = buildAllergenFields({
    allergens: ['milk'], mayContain: ['milk', 'sesame'], checkedAt: '2026-08-11',
  });
  assert.deepEqual(fields.mayContain, ['sesame']);
});

test('normalizeMayContain refuses unknown codes too', () => {
  assert.deepEqual(normalizeMayContain(['sesame', 'unicorn']), ['sesame']);
});

// ── Nutrition ────────────────────────────────────────────────────────────────

test('ZERO IS A REAL VALUE AND null IS NOT', () => {
  // Water really is 0 kcal. Treating that as missing would make water block every
  // label it appears in; treating missing as 0 would under-declare everything.
  const n = normalizeNutrition({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0 });
  for (const key of NUTRIENT_KEYS) assert.equal(n[key], 0, `${key} was not kept as 0`);
  assert.equal(hasFullNutrition({ nutrition: n }), true, 'an all-zero table is COMPLETE');
});

test('a missing or unreadable value stays null, never 0', () => {
  const n = normalizeNutrition({ kcal: 250, fat: '', carbs: null, sugars: 'abc', protein: -5 });
  assert.equal(n.kcal, 250);
  assert.equal(n.fat, null);
  assert.equal(n.carbs, null);
  assert.equal(n.sugars, null, 'text must not become 0');
  assert.equal(n.protein, null, 'a negative must not become 0');
  assert.equal(n.kj, null);
});

test('a decimal point survives — 0.01 g of salt is a real declaration', () => {
  assert.equal(normalizeNutrition({ salt: 0.01 }).salt, 0.01);
  assert.equal(normalizeNutrition({ salt: '1.2' }).salt, 1.2);
});

test('an absurd value is capped rather than printed', () => {
  // Nothing can be more than 100 g per 100 g, and pure fat is about 900 kcal.
  assert.equal(normalizeNutrition({ fat: 500 }).fat, 100);
  assert.equal(normalizeNutrition({ kcal: 99999 }).kcal, 1000);
  assert.equal(normalizeNutrition({ kj: 99999 }).kj, 4000);
});

test('a table is complete only when ALL SEVEN are there', () => {
  // The declaration is defined as a whole; there is no "mostly filled in".
  const full = { kj: 1400, kcal: 330, fat: 1.2, saturates: 0.2, carbs: 70, sugars: 1.5, protein: 11, salt: 0.01 };
  assert.equal(hasFullNutrition({ nutrition: full }), true);
  for (const key of NUTRIENT_KEYS) {
    const short = { ...full, [key]: null };
    assert.equal(hasFullNutrition({ nutrition: short }), false, `missing ${key} still read as complete`);
    assert.deepEqual(missingNutrients({ nutrition: short }), [key]);
  }
  assert.equal(hasFullNutrition({}), false);
  assert.equal(hasFullNutrition(null), false);
});

test('the declaration carries SALT, not sodium, and BOTH energy units', () => {
  // Salt and sodium differ by a factor of 2.5 — printing one in the other's row
  // understates it badly. Both kJ and kcal are mandatory.
  const keys = NUTRIENTS.map(n => n.key);
  assert.ok(keys.includes('salt'));
  assert.equal(keys.includes('sodium'), false);
  assert.ok(keys.includes('kj') && keys.includes('kcal'));
});

test('the nutrients are in the order a declaration must print them', () => {
  assert.deepEqual([...NUTRIENT_KEYS],
    ['kj', 'kcal', 'fat', 'saturates', 'carbs', 'sugars', 'protein', 'salt']);
});

// ── The document the app writes ──────────────────────────────────────────────

test('the fields written are exactly the ones the rules whitelist', () => {
  // ⚠️ A field invented here that the rules do not know makes every save of that
  // ingredient FAIL; a field the rules allow that this forgets is dropped in
  // silence on the next save. This pins the set in one place.
  const fields = buildAllergenFields({
    allergens: ['gluten-wheat'], mayContain: [], checkedAt: '2026-08-11', nutrition: { kcal: 330 },
  });
  assert.deepEqual(Object.keys(fields).sort(),
    ['allergens', 'allergensCheckedAt', 'mayContain', 'nutrition']);
  assert.deepEqual(Object.keys(fields.nutrition).sort(), [...NUTRIENT_KEYS].sort());
});

test('building from nothing gives blanks, never undefined', () => {
  // Firestore refuses undefined, and a half-built object would be refused by the
  // rules rather than saved — loudly, but at the worst moment.
  const fields = buildAllergenFields({});
  assert.deepEqual(fields.allergens, []);
  assert.deepEqual(fields.mayContain, []);
  assert.equal(fields.allergensCheckedAt, '');
  for (const key of NUTRIENT_KEYS) assert.equal(fields.nutrition[key], null);
  // …and a document built from nothing is NOT declared.
  assert.equal(isDeclared(fields), false);
});

test('checkedAt is read back as trimmed text', () => {
  assert.equal(checkedAt({ allergensCheckedAt: '  2026-08-11T09:00:00.000Z  ' }), '2026-08-11T09:00:00.000Z');
  assert.equal(checkedAt({}), '');
  assert.equal(checkedAt(null), '');
});
