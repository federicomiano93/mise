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
  assert.match(ingredientNamesNote({ country: 'IT' }), /does not translate/);
});

// ⚠️ BOTH NOTES ARE INTERFACE TEXT, AND THE SCREENSHOT IS WHAT PROVED IT. The
// second one returned the OUTPUT language at first, so the explanatory block came
// out half English and half Italian — one paragraph, two languages, which reads
// as a mistake because it is one. Both are addressed to the person MAKING the
// label, never to the consumer reading it.
test('the two notes are in the same language as each other', () => {
  for (const country of ['GB', 'IT']) {
    const location = { country };
    assert.match(labelLanguageNote(location), /^This label is produced/, country);
    assert.match(ingredientNamesNote(location), /^The ingredient names/, country);
  }
});

// ── The two halves have to agree ────────────────────────────────────────────
//
// The lesson of 12 Aug 2026: a server half that is correct and that nothing calls
// is a feature that does not exist, and every test stays green while it does not.
// These are source checks, like tests/create-own-business.test.mjs beside them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, ...p.split('/')), 'utf8');

test('the server refuses to create a business without a country', () => {
  const server = read('functions/onboarding.js');
  const start = server.indexOf('export const createWorkspace');
  const body = server.slice(start, server.indexOf('\n});', start));
  assert.match(body, /\['GB', 'IT'\]\.includes\(country\)/,
    'the country must be validated against the two we support');
  assert.match(body, /throw new HttpsError\('invalid-argument'/,
    'and a missing one must be refused, not defaulted');
  // ⚠️ BOTH writes — a customer's business and one of your own — must store it.
  // One of them forgetting is a business whose labels can never be produced.
  const writes = body.match(/name, sections, country, createdAt: now, createdBy: uid/g) || [];
  assert.equal(writes.length, 2, 'both location writes must carry the country');
});

test('the screen asks for it, and passes it through the data layer', () => {
  const screen = read('js/staff/new-customer.js');
  const client = read('js/staff/firebase-staff.js');
  assert.match(screen, /nc-country/, 'the form must offer the choice');
  assert.match(screen, /if \(!country\) return \[/, 'and refuse before the network');
  assert.match(screen, /createWorkspace\(typed, sections, \{ forSelf, country \}\)/,
    'and pass it at the call site');
  assert.match(client, /country: opts\.country \|\| ''/, 'the data layer must forward it');
});

// ⚠️ NOTHING IS PRE-SELECTED, and this is the sharper version of the sections
// rule. Pre-ticking a section sells part of the app by accident; pre-selecting
// "United Kingdom" would make a business created in a hurry print ENGLISH
// allergen labels — right for every venue that exists today, and silently
// non-compliant for the first Italian customer.
test('no country is pre-selected on the form', () => {
  const screen = read('js/staff/new-customer.js');
  const start = screen.indexOf("name: 'nc-country'");
  const nearby = screen.slice(start - 400, start + 400);
  assert.doesNotMatch(nearby, /radio\.checked = /,
    'a pre-selected country is a label language nobody chose');
});

test('the label screen refuses when the country is unknown, and follows it when known', () => {
  const view = read('js/catalogue/label-view.js');
  assert.match(view, /if \(!canPrintLabel\(location\)\)/,
    'no country, no label — never a quiet fallback to English');
  assert.match(view, /const lang = outputLanguage\(location\)/);
  // Every word that reaches a label goes through market.js.
  for (const call of [/labelWord\('ingredients', lang\)/, /allergenName\(c, lang\)/,
    /nutrientName\(n, lang\)/, /containsLine\(label, lang\)/]) {
    assert.match(view, call, String(call));
  }
});

// ⚠️ THE COPIED TEXT IS THE LABEL. Whatever is printed in the end comes from the
// clipboard, so an English copy pasted onto Italian packaging is the whole defect
// this release prevents, arriving through the one door nobody thought of.
test('the copied text is in the same language as the label on screen', () => {
  const view = read('js/catalogue/label-view.js');
  const start = view.indexOf('const lines = [label.name');
  const copy = view.slice(start, start + 700);
  assert.match(copy, /labelWord\('ingredients', lang\)/);
  assert.match(copy, /containsLine\(label, lang\)/);
  assert.match(copy, /nutrientName\(n, lang\)/);
  assert.doesNotMatch(copy, /'Ingredients: '|'Typical values|'May contain:/,
    'no English left hard-coded in the copied label');
});
