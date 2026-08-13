// The interface language machinery, and the two guards that make it safe to use.
//
// ⚠️ THE POINT OF THIS SUITE IS NOT THAT LOOKUP WORKS. It is that the two ways
// this feature can do real damage are pinned:
//   1. an English word that is an IDENTIFIER gets translated, and something
//      stored under it becomes unreachable in silence;
//   2. the interface setting reaches a LABEL, which is a legal document.
// Both are invisible to a passing glance and obvious to a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LANGUAGES, DEFAULT_LANGUAGE, DATA_WORDS,
  setLanguage, currentLanguage, interfaceLanguage, languageFromTag, t, translate, _dictionaries,
} from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every test that changes the language puts it back, or the order tests run in
// would decide what the next one sees.
function withLanguage(lang, fn) {
  const before = currentLanguage();
  try { setLanguage(lang); fn(); } finally { setLanguage(before); }
}

// ── The guard that matters most: identifiers are not phrases ─────────────────

// ⚠️⚠️ `pastries/Monday` IS A FIRESTORE DOCUMENT ID. Translate that word and all
// seven proving lists become unreachable — the app would show seven empty days
// and nothing anywhere would say why. The same shape holds for the section keys,
// the role values and the allergen codes.
//
// ⚠️ THE RULE IS NOT "NEVER SHOW THE WORD MONDAY IN ITALIAN". Of course a screen
// may say «Lunedì». The rule is that the DISPLAY and the IDENTIFIER are two
// different things, so a display phrase gets a key that says where it lives
// (`pastries.weekday.monday`) and the identifier stays the untranslated constant
// it always was. A bare data word used as a key is exactly the ambiguity that
// lets somebody translate the id by accident.
test('no dictionary key is a bare data word', () => {
  const words = new Set(DATA_WORDS.map(w => w.toLowerCase()));
  for (const lang of LANGUAGES) {
    for (const key of Object.keys(_dictionaries()[lang])) {
      assert.equal(words.has(key.toLowerCase()), false,
        `"${key}" is an identifier, not a phrase — give the phrase a key that says where it lives`);
    }
  }
});

// The other half of the same guard, and the one that catches it at the call
// site: nothing may ask for a translation OF a data word.
test('no call site passes a data word to t()', () => {
  const files = sourceFiles();
  const asked = [];
  for (const [name, src] of files) {
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
      if (DATA_WORDS.some(w => w.toLowerCase() === m[1].toLowerCase())) {
        asked.push(`${name}: t('${m[1]}')`);
      }
    }
  }
  assert.deepEqual(asked, [],
    'translating an identifier makes whatever is stored under it unreachable');
});

test('the data words include the ones that have already cost this project a day', () => {
  for (const word of ['Monday', 'Sunday', 'owner', 'manager', 'staff', 'head-chef',
    'foodcost', 'calculator', 'GB', 'IT']) {
    assert.ok(DATA_WORDS.includes(word), `${word} must be protected`);
  }
});

// ── The two languages must stay in step ──────────────────────────────────────

// A missing translation falls back to English so a screen still works, which
// means an incomplete dictionary is INVISIBLE at runtime. This is the only thing
// that makes it visible.
test('every English phrase has an Italian one', () => {
  const { en, it } = _dictionaries();
  const missing = Object.keys(en).filter(k => it[k] === undefined);
  assert.deepEqual(missing, [], 'these phrases would silently show in English');
});

test('Italian carries no phrase English does not have', () => {
  const { en, it } = _dictionaries();
  const orphans = Object.keys(it).filter(k => en[k] === undefined);
  assert.deepEqual(orphans, [], 'an Italian-only key can never be reached');
});

// ⚠️ A counted phrase must be counted in BOTH languages or the fallback quietly
// hands a plural object to a screen expecting a string.
test('a counted phrase is counted in every language', () => {
  const { en, it } = _dictionaries();
  for (const key of Object.keys(en)) {
    if (typeof en[key] === 'object' && it[key] !== undefined) {
      assert.equal(typeof it[key], 'object',
        `${key} counts in English and does not in Italian`);
    }
  }
});

// ── Before anybody is signed in ──────────────────────────────────

// The sign-in, join, picker and Misé home screens sit ABOVE every venue, so there
// is no setting for them to read. The device's language is the only signal there
// is — and for the case it exists for it is a good one.
test('the device tag picks a language, and an unknown one is English', () => {
  assert.equal(languageFromTag('it'), 'it');
  assert.equal(languageFromTag('it-IT'), 'it');
  assert.equal(languageFromTag('IT-it'), 'it');
  assert.equal(languageFromTag('en-GB'), 'en');
  assert.equal(languageFromTag('fr-FR'), 'en', 'a language we do not have falls back');
  assert.equal(languageFromTag(''), 'en');
  assert.equal(languageFromTag(undefined), 'en');
  assert.equal(languageFromTag(null), 'en');
});

// ⚠️⚠️ THE DEVICE IS A GUESS AND IT MUST LOSE. It applies only until a location
// opens; after that the venue's own setting decides, EVEN WHEN THE TWO DISAGREE.
// This is Federico's case with the sides swapped: an English venue opened on an
// Italian phone stays English for everybody who works there, because the language
// belongs to the workplace and not to whoever is holding the phone.
test('the venue beats the device once a location is open', () => {
  assert.equal(languageFromTag('it-IT'), 'it', 'the phone is Italian');
  assert.equal(interfaceLanguage({ language: 'en' }), 'en', 'the venue is English, and wins');
  assert.equal(interfaceLanguage({ language: 'it' }), 'it');
});

// ⚠️ AND NEITHER OF THEM EVER REACHES A LABEL. An Italian phone, an Italian
// interface, a venue selling in the UK — the label is still English, because that
// follows the COUNTRY. tests/i18n-label-separation.test.mjs pins the wiring; this
// pins the answer.
test('neither the device nor the venue can move a label', async () => {
  const { outputLanguage } = await import('../js/market.js');
  assert.equal(languageFromTag('it-IT'), 'it');
  const venue = { country: 'GB', language: 'it' };
  assert.equal(interfaceLanguage(venue), 'it');
  assert.equal(outputLanguage(venue), 'en', 'the food is sold in the UK');
});

// ── Looking a phrase up ──────────────────────────────────────────────────────

test('an unknown language shows English rather than refusing to open', () => {
  withLanguage('en', () => {
    assert.equal(setLanguage('klingon'), 'en');
    assert.equal(setLanguage(undefined), 'en');
    assert.equal(setLanguage('it'), 'it');
  });
});

test('a venue with no language set reads as English', () => {
  assert.equal(interfaceLanguage(null), DEFAULT_LANGUAGE);
  assert.equal(interfaceLanguage({}), DEFAULT_LANGUAGE);
  assert.equal(interfaceLanguage({ language: 'sv' }), DEFAULT_LANGUAGE);
  assert.equal(interfaceLanguage({ language: 'it' }), 'it');
});

// ⚠️ THE VENUE'S LANGUAGE AND ITS COUNTRY ARE READ FROM DIFFERENT FIELDS, and
// this is the case the whole design exists for: Federico's English venue with an
// Italian interface.
test('the interface language and the label language are read independently', async () => {
  const { outputLanguage } = await import('../js/market.js');
  const venue = { country: 'GB', language: 'it' };
  assert.equal(interfaceLanguage(venue), 'it', 'the staff read Italian');
  assert.equal(outputLanguage(venue), 'en', 'the label stays English — the food is sold in the UK');
});

// ⚠️ A KEY NOBODY DEFINED COMES BACK AS ITSELF, LOUDLY. An empty string would be
// a button with no words on it, which nobody notices until a customer does.
test('a phrase that exists nowhere shows its own key', () => {
  assert.equal(t('nothing.defined.here'), 'nothing.defined.here');
});

test('a hole in a phrase is filled, and an unfilled hole stays visible', () => {
  const dicts = { en: { 'x.hole': 'Delete {name}?' } };
  assert.equal(translate(dicts, 'en', 'x.hole', { name: 'Focaccia' }), 'Delete Focaccia?');
  assert.equal(translate(dicts, 'en', 'x.hole', {}), 'Delete {name}?',
    'a missing value must be visible, not blank');
});

test('a counted phrase picks its form from the number', () => {
  const dicts = { en: { 'x.n': { one: '{n} order has changed', other: '{n} orders have changed' } } };
  assert.equal(translate(dicts, 'en', 'x.n', { n: 1 }), '1 order has changed');
  assert.equal(translate(dicts, 'en', 'x.n', { n: 3 }), '3 orders have changed');
  assert.equal(translate(dicts, 'en', 'x.n', { n: 0 }), '0 orders have changed');
});

// ⚠️ AN UNWRITTEN TRANSLATION SHOWS ENGLISH; A MISTYPED KEY SHOWS ITSELF.
// Two different failures, and answering them the same way would either blank a
// working screen or hide a typo until a customer found it.
test('a phrase missing from Italian falls back to English, not to nothing', () => {
  const dicts = { en: { 'x.only': 'Save' }, it: {} };
  assert.equal(translate(dicts, 'it', 'x.only'), 'Save');
});

// ⚠️ Italian and English happen to agree on one/other, so a plural bug is
// invisible between them. This proves Intl is doing the work, not a hardcoded
// `n === 1`: Italian selects `other` for a fraction where English does too, and
// the category comes from the LANGUAGE the phrase was found in.
test('the plural form is chosen by Intl, in the language the phrase came from', () => {
  const dicts = {
    en: { 'x.n': { one: 'one', other: 'many' } },
    it: { 'x.n': { one: 'uno', other: 'molti' } },
  };
  assert.equal(translate(dicts, 'it', 'x.n', { n: 1 }), 'uno');
  assert.equal(translate(dicts, 'it', 'x.n', { n: 2 }), 'molti');
  // Found in English because Italian lacks it → counted by English's rules.
  assert.equal(translate({ en: dicts.en, it: {} }, 'it', 'x.n', { n: 1 }), 'one');
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function sourceFiles() {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === 'vendor') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push([full.slice(ROOT.length + 1), readFileSync(full, 'utf8')]);
    }
  };
  walk(join(ROOT, 'js'));
  return out;
}
