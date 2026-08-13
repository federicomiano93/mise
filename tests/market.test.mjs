// Which country a venue sells in, and therefore what language its labels must be
// printed in.
//
// ⚠️⚠️ THIS IS THE ONE PART OF THE LANGUAGE WORK THAT CAN HURT SOMEBODY. Getting
// the interface wrong is an annoyance; getting a label wrong is a person in
// hospital and, in both the UK and Italy, an offence. So almost every test below
// is the same assertion from a different direction: an answer this module is not
// sure of must come out as "I do not know", never as English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES,
  countryOf,
  outputLanguage,
  countryName,
  canPrintLabel,
  labelWord,
  allergenWordIt,
  nutrientWordIt,
  labelLanguageNote,
  ingredientNamesNote,
  noCountryReason,
} from '../js/market.js';
import { ALLERGEN_CODES, NUTRIENT_KEYS, allergenLabel } from '../js/allergen-model.js';

// ── The unknown country ─────────────────────────────────────────────────────

// ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Falling back to English is the
// tempting default — every venue in production today is in the UK — and it is
// exactly the wrong direction: in an Italian bakery an English allergen label is
// not "a bit off", it is non-compliant, and it would be produced silently.
test('an unknown country produces NO label, and never quietly an English one', () => {
  for (const bad of [null, undefined, {}, { country: '' }, { country: 'FR' },
    { country: 'gb' }, { country: ' GB' }, { country: 'GB ' }, { country: 42 }, { country: true }]) {
    assert.equal(countryOf(bad), null, JSON.stringify(bad));
    assert.equal(outputLanguage(bad), null, JSON.stringify(bad));
    assert.equal(canPrintLabel(bad), false, JSON.stringify(bad));
  }
});

test('and it says what to do about it rather than what is broken', () => {
  const reason = noCountryReason();
  assert.match(reason, /which country/, 'it names the missing fact');
  assert.match(reason, /owner/, 'and who can supply it');
  assert.doesNotMatch(reason, /error|invalid|failed/i, 'a missing setting is not a fault');
});

test('a location with no country says nothing about a language at all', () => {
  assert.equal(labelLanguageNote({}), '');
  assert.equal(ingredientNamesNote({}), '');
  assert.equal(countryName({}), '');
});

// ── The two countries ───────────────────────────────────────────────────────

test('only the United Kingdom and Italy, for now', () => {
  assert.deepEqual([...COUNTRIES], ['GB', 'IT']);
});

test('the country decides the language, and there is one answer each', () => {
  assert.equal(outputLanguage({ country: 'GB' }), 'en');
  assert.equal(outputLanguage({ country: 'IT' }), 'it');
  assert.equal(canPrintLabel({ country: 'GB' }), true);
  assert.equal(canPrintLabel({ country: 'IT' }), true);
});

// ⚠️ FEDERICO'S OWN CASE, AND THE REASON THE TWO LANGUAGES ARE SEPARATE. He is
// Italian, his bakeries are in England. Nothing in this module takes a person's
// preference — it only ever reads the location — so an Italian interface cannot
// reach an English label.
test('the language comes from the LOCATION and from nothing else', () => {
  const uk = { country: 'GB', language: 'it', name: 'The Italian Club Bakery' };
  assert.equal(outputLanguage(uk), 'en',
    'an Italian interface must not change what the label prints');
  assert.match(labelLanguageNote(uk), /produced in English/);
  assert.match(labelLanguageNote(uk), /United Kingdom/);

  const italy = { country: 'IT', language: 'en' };
  assert.equal(outputLanguage(italy), 'it');
  assert.match(labelLanguageNote(italy), /produced in Italian/);
  assert.match(labelLanguageNote(italy), /Italy/);
});

// ── The words ───────────────────────────────────────────────────────────────

test('the label vocabulary exists in both languages', () => {
  const WORDS = ['contains', 'mayContain', 'ingredients', 'nutrition', 'typicalValues', 'per100g'];
  for (const key of WORDS) {
    assert.ok(labelWord(key, 'en'), `en ${key} is missing`);
    assert.ok(labelWord(key, 'it'), `it ${key} is missing`);
  }
  assert.equal(labelWord('contains', 'it'), 'Contiene');
  assert.equal(labelWord('mayContain', 'it'), 'Può contenere');
  assert.equal(labelWord('nutrition', 'it'), 'Valori nutrizionali');

  // Everything except the unit must actually differ — an untranslated heading is
  // the same silent failure as an untranslated allergen, one line higher up.
  const untranslated = WORDS
    .filter(k => k !== 'per100g')
    .filter(k => labelWord(k, 'en') === labelWord(k, 'it'));
  assert.deepEqual(untranslated, []);
  // ⚠️ And the unit is deliberately identical: "per 100 g" is written the same
  // way in both, so a test demanding a difference would force an invention.
  assert.equal(labelWord('per100g', 'it'), labelWord('per100g', 'en'));
});

test('an unknown language falls back to English rather than to nothing', () => {
  // ⚠️ A DIFFERENT DIRECTION FROM THE COUNTRY, on purpose. The country decides
  // whether a label may be printed AT ALL, so doubt there must stop everything.
  // By the time a word is being looked up the country has already been checked,
  // and an empty heading on an otherwise correct label helps nobody.
  assert.equal(labelWord('contains', 'de'), 'Contains');
  assert.equal(labelWord('contains', undefined), 'Contains');
  assert.equal(labelWord('nonsense', 'en'), '');
});

// ── The fourteen, in Italian ────────────────────────────────────────────────

// ⚠️ EVERY CODE MUST HAVE AN ITALIAN WORD. A missing one prints an empty name in
// a list of allergens — the single most dangerous blank in this app, because the
// line still LOOKS like a complete declaration.
test('every allergen code has an Italian name', () => {
  const missing = ALLERGEN_CODES.filter(code => !allergenWordIt(code));
  assert.deepEqual(missing, [], 'these codes would print blank on an Italian label');
});

// ⚠️ THE EXCEPTION IS NAMED, NOT THE RULE LOOSENED. This check went red on
// 'gluten-kamut' and the code was right: KAMUT is a registered trademark for
// khorasan wheat and is the same word on an Italian label. Widening the test to
// "some may be identical" would have let a genuinely forgotten translation
// through; listing the one word that does not translate keeps every other code
// honest.
const SAME_IN_BOTH = ['gluten-kamut'];

test('the Italian names are not the English ones left untranslated', () => {
  const same = ALLERGEN_CODES
    .filter(code => allergenWordIt(code) === allergenLabel(code))
    .filter(code => !SAME_IN_BOTH.includes(code));
  assert.deepEqual(same, [], 'these look copied rather than translated');
});

// ⚠️ THE SPECIFIC CEREAL AND THE SPECIFIC NUT, in Italian too. A label reading
// "Contiene: frutta a guscio" is not compliant and is useless to somebody who can
// eat mandorle but not nocciole.
test('the cereal and the nut are named, not the category', () => {
  assert.equal(allergenWordIt('gluten-wheat'), 'Grano');
  assert.equal(allergenWordIt('nuts-hazelnut'), 'Nocciole');
  assert.equal(allergenWordIt('nuts-almond'), 'Mandorle');
  // Peanuts are a legume and their own group, in both languages.
  assert.equal(allergenWordIt('peanuts'), 'Arachidi');
});

test('a code nobody recognises has no Italian word, rather than a guessed one', () => {
  for (const bad of ['gluten', 'nuts', 'unknown', '', null, undefined]) {
    assert.equal(allergenWordIt(bad), '', String(bad));
  }
});

// ── The nutrition table, in Italian ─────────────────────────────────────────

test('every nutrient row has an Italian name', () => {
  const missing = NUTRIENT_KEYS.filter(key => !nutrientWordIt(key));
  assert.deepEqual(missing, [], 'these rows would print blank on an Italian label');
});

test('salt is salt, and saturates say what they are of', () => {
  // ⚠️ SALE, NOT SODIO — the regulation asks for salt, and the two differ by 2.5x.
  assert.equal(nutrientWordIt('salt'), 'Sale');
  assert.equal(nutrientWordIt('saturates'), 'di cui acidi grassi saturi');
  assert.equal(nutrientWordIt('sugars'), 'di cui zuccheri');
  // Energy is one word for two rows, as in English: kJ and kcal are both printed.
  assert.equal(nutrientWordIt('kj'), nutrientWordIt('kcal'));
});

// ── What the app admits it cannot do ────────────────────────────────────────

// ⚠️ THE INGREDIENT NAMES ARE TYPED BY HAND AND THE APP DOES NOT TRANSLATE THEM.
// An Italian venue must type Italian ingredient names, or the label reads
// "Contiene: Wheat" — half translated, which is worse than either language alone.
// Saying so on the screen is the only honest option available.
test('the screen admits it cannot translate the ingredient names', () => {
  assert.match(ingredientNamesNote({ country: 'GB' }), /does not translate/);
  assert.match(ingredientNamesNote({ country: 'IT' }), /non li traduce/);
});

test('the note about the language is in English in both cases, because staff read it', () => {
  // The NOTE is interface, not label: it explains the label to whoever is making
  // it. It becomes translatable with the rest of the interface, later.
  assert.match(labelLanguageNote({ country: 'IT' }), /^This label is produced/);
});
