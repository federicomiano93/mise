// market.js — which country a venue sells in, and therefore what language the app
// must PRODUCE in. PURE: no DOM, no Firestore, so every rule below is asserted in
// a unit test rather than read back out of rendered markup (P15).
//
// ⚠️⚠️ THIS IS NOT THE INTERFACE LANGUAGE, AND CONFUSING THE TWO IS THE WHOLE
// REASON THIS FILE EXISTS. There are two languages in this app and they answer
// different questions:
//
//   the INTERFACE language   what the staff READ on screen   a preference
//   the OUTPUT language      what the app PRINTS on a label  the LAW
//
// Federico is Italian and his bakeries are in England. He wants the app in
// Italian for himself and the people who work with him — and his allergen labels
// MUST stay in English, because that food is sold in the United Kingdom.
// Retained Reg. (EU) 1169/2011 Art. 15 requires food information to be in a
// language easily understood by consumers in the country where the food is
// marketed. So the output language is not a setting anybody may pick: it follows
// the country, and this file is the only place that decides it.
//
// ⚠️ NOBODY HERE IS A LAWYER. The design makes the compliant thing the thing that
// happens by itself; it is not legal advice, and it wants a professional's eye
// before the first Italian customer.
//
// 📌 UK AND ITALY ONLY, and that is a deliberate limit (Federico, 13 Aug 2026).
// The two share the SAME fourteen allergens and the SAME nutrition declaration —
// Italy applies Reg. 1169/2011 and the UK the retained version of the same text —
// so between them only the WORDS change, never the rules. ⚠️ Outside the UK and
// the EU the list of allergens itself is different (the United States names nine
// and treats sesame separately; Canada differs again), so adding a third country
// is not a translation job. It is a new piece of work, and this file should
// refuse rather than guess when it arrives.

// ⚠️ IMPORTED FOR THE ENGLISH WORDS, WHICH STAY WHERE THEY ARE. js/allergen-model.js
// remains the one place the fourteen are defined — their codes, their groups and
// their English names. This file adds a second COLUMN beside that, never a second
// list: a copy of the fourteen would be the copy that quietly drifts, and the
// thing it would disagree about is what is in somebody's food.
import { ALLERGENS, allergenLabel } from './allergen-model.js';

export const COUNTRIES = Object.freeze(['GB', 'IT']);

const COUNTRY_NAMES = Object.freeze({
  GB: 'the United Kingdom',
  IT: 'Italy',
});

// The language a label is printed in, per country. One entry per country, so a
// country cannot be added without somebody deciding this.
const OUTPUT_LANGUAGE = Object.freeze({ GB: 'en', IT: 'it' });

// ⚠️ AN UNKNOWN COUNTRY ANSWERS null, NEVER 'GB'. Falling back to English is
// tempting — every venue in production today is in the UK — and it is exactly the
// wrong direction: in an Italian bakery an English allergen label is not "a bit
// off", it is non-compliant, and it would be produced silently and confidently.
// The same reasoning as canLabel() refusing an undeclared recipe: this app would
// rather say "I do not know" than print something that LOOKS complete.
export function countryOf(location) {
  const value = location && location.country;
  return COUNTRIES.includes(value) ? value : null;
}

export function outputLanguage(location) {
  const country = countryOf(location);
  return country ? OUTPUT_LANGUAGE[country] : null;
}

export function countryName(location) {
  const country = countryOf(location);
  return country ? COUNTRY_NAMES[country] : '';
}

// The one question every label screen must ask before it draws anything.
export function canPrintLabel(location) {
  return countryOf(location) !== null;
}

// ── The label's own vocabulary ───────────────────────────────────────────────
//
// ⚠️ ONLY WHAT GOES ON A LABEL LIVES HERE. This is not the app's translation
// dictionary — that is a separate piece of work with a separate setting. These
// words are chosen by the country and can never be switched by a person, so
// keeping them apart is what stops somebody's screen preference reaching a label.

const LABEL_WORDS = Object.freeze({
  en: {
    contains: 'Contains',
    mayContain: 'May contain',
    ingredients: 'Ingredients',
    nutrition: 'Nutrition',
    typicalValues: 'Typical values',
    per100g: 'per 100 g',
    noneOfThe14: 'None of the 14',
  },
  it: {
    contains: 'Contiene',
    mayContain: 'Può contenere',
    ingredients: 'Ingredienti',
    nutrition: 'Valori nutrizionali',
    typicalValues: 'Valori medi',
    per100g: 'per 100 g',
    noneOfThe14: 'Nessuno dei 14',
  },
});

export function labelWord(key, lang) {
  const table = LABEL_WORDS[lang] || LABEL_WORDS.en;
  return table[key] !== undefined ? table[key] : (LABEL_WORDS.en[key] || '');
}

// ⚠️ THE ALLERGEN NAMES, AND THE SPECIFIC CEREAL AND NUT ARE STILL NAMED. The
// regulation asks for "grano", not "cereali contenenti glutine"; "nocciole", not
// "frutta a guscio". The codes are unchanged — they are data, and they are what
// every ingredient document stores — so this is a second column beside them,
// never a second list. js/allergen-model.js keeps the English.
const ALLERGEN_IT = Object.freeze({
  'gluten-wheat': 'Grano',
  'gluten-rye': 'Segale',
  'gluten-barley': 'Orzo',
  'gluten-oats': 'Avena',
  'gluten-spelt': 'Farro',
  'gluten-kamut': 'Kamut',
  'nuts-almond': 'Mandorle',
  'nuts-hazelnut': 'Nocciole',
  'nuts-walnut': 'Noci',
  'nuts-cashew': 'Anacardi',
  'nuts-pecan': 'Noci pecan',
  'nuts-brazil': 'Noci del Brasile',
  'nuts-pistachio': 'Pistacchi',
  'nuts-macadamia': 'Noci macadamia',
  celery: 'Sedano',
  crustaceans: 'Crostacei',
  eggs: 'Uova',
  fish: 'Pesce',
  lupin: 'Lupini',
  milk: 'Latte',
  molluscs: 'Molluschi',
  mustard: 'Senape',
  peanuts: 'Arachidi',
  sesame: 'Sesamo',
  soybeans: 'Soia',
  sulphites: 'Solfiti',
});

// The nutrient rows, in the order the regulation prints them. Keyed by the same
// keys as NUTRIENTS in js/allergen-model.js — a name missing here would print an
// empty row, so a test pins that every key has one.
const NUTRIENT_IT = Object.freeze({
  kj: 'Energia',
  kcal: 'Energia',
  fat: 'Grassi',
  saturates: 'di cui acidi grassi saturi',
  carbs: 'Carboidrati',
  sugars: 'di cui zuccheri',
  protein: 'Proteine',
  salt: 'Sale',
});

// The Italian word for an allergen code, or '' when the language is not Italian —
// the caller then keeps the English from js/allergen-model.js. Returning '' rather
// than the English avoids this file holding a second copy of the English names,
// which is the copy that would drift.
export function allergenWordIt(code) {
  return ALLERGEN_IT[code] || '';
}

export function nutrientWordIt(key) {
  return NUTRIENT_IT[key] || '';
}

// ── The one place a label word is chosen ─────────────────────────────────────
//
// ⚠️ THE BRANCH LIVES HERE AND NOWHERE ELSE. Every screen that prints an
// allergen would otherwise carry its own `lang === 'it' ? … : …`, and the day a
// third language arrives one of them is forgotten — printing an English allergen
// on an Italian label, silently, on the one screen nobody re-read.
//
// ⚠️ AND THE FALLBACK IS THE ENGLISH WORD, NOT A BLANK. A test pins that every
// one of the fourteen has an Italian name, so this cannot be reached — but if it
// ever were, "Hazelnut" on an Italian label still tells somebody with a nut
// allergy what is in the food. An empty name in a list of allergens is the most
// dangerous blank this app could print, because the line still LOOKS complete.
export function allergenName(code, lang) {
  if (lang === 'it') return allergenWordIt(code) || allergenLabel(code);
  return allergenLabel(code);
}

// ── The fourteen, as the law groups them ─────────────────────────────────────
//
// ⚠️ TWO ENTRIES, NOT FOURTEEN, AND THAT IS THE POINT. Only `gluten` and `nuts`
// are collections the law names as a category; the other twelve ARE their single
// code, so their heading is simply that code's own word. Writing all fourteen out
// here would be the second list this file exists to avoid — and the thing the two
// copies would disagree about is what is in somebody's food.
//
// ⚠️ THESE HEADINGS ARE FOR READING, NEVER FOR A LABEL. A label must name the
// specific cereal and the specific nut ("Wheat", not "cereals containing
// gluten"); this pair is only ever used to tell somebody which fourteen groups
// the law asks about. Nothing in recipe-label-model.js may call it.
const GROUP_HEADING = Object.freeze({
  en: { gluten: 'Cereals containing gluten', nuts: 'Nuts' },
  it: { gluten: 'Cereali contenenti glutine', nuts: 'Frutta a guscio' },
});

export function allergenGroupName(group, lang) {
  const table = GROUP_HEADING[lang] || GROUP_HEADING.en;
  if (table[group] !== undefined) return table[group];
  // Not a named collection: the group is one allergen, so it is named by its own
  // word — derived, so a code added to allergen-model.js needs nothing here.
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length === 1 ? allergenName(codes[0].code, lang) : '';
}

// Every code the law names inside one group, in the country's language. Used for
// the "the specific cereals and nuts" detail — empty for the twelve that have no
// subdivision, so a caller can simply skip them.
export function allergenGroupCodes(group, lang) {
  const codes = ALLERGENS.filter(a => a.group === group);
  return codes.length > 1 ? codes.map(a => allergenName(a.code, lang)) : [];
}

// The same, for a row of the nutrition table. `nutrient` is an entry of NUTRIENTS.
export function nutrientName(nutrient, lang) {
  if (!nutrient) return '';
  if (lang === 'it') return nutrientWordIt(nutrient.key) || nutrient.label;
  return nutrient.label;
}

// ── What the label screen has to say about itself ────────────────────────────

// ⚠️ THE SCREEN DECLARES WHAT IT IS PRODUCING AND WHY, and it is not a footnote.
// Somebody printing a label in an English bakery while reading an Italian
// interface has to be able to see, without asking, that the label is in English
// on purpose.
export function labelLanguageNote(location) {
  const country = countryOf(location);
  if (!country) return '';
  const language = country === 'IT' ? 'Italian' : 'English';
  return `This label is produced in ${language} because this business sells in ${COUNTRY_NAMES[country]}.`;
}

// ⚠️ AND WHAT THE APP CANNOT DO, SAID IN THE SAME BREATH. The ingredient names on
// a label are typed by hand, in Orders. The app does not translate them and must
// not pretend to: an Italian venue has to type Italian ingredient names, or the
// label reads "Contiene: Wheat" — half translated, which is worse than either
// language on its own.
//
// ⚠️ IT IS INTERFACE TEXT, SO IT DOES NOT FOLLOW THE COUNTRY. This returned the
// OUTPUT language at first, and the screenshot showed why that was wrong: the
// explanatory block came out with its first line in English and its second in
// Italian, because labelLanguageNote() beside it is interface text and this one
// was not. Both are addressed to the person MAKING the label, never to the
// consumer reading it — so both are in the language the staff read, which today
// is English everywhere and becomes the interface setting when that ships.
export const INGREDIENT_NAMES_NOTE =
  'The ingredient names are the ones you typed — the app does not translate them.';

export function ingredientNamesNote(location) {
  return canPrintLabel(location) ? INGREDIENT_NAMES_NOTE : '';
}

// What to say INSTEAD of a label when the country is not known. It names the fix
// rather than the fault: somebody reading this can do nothing about a missing
// field, and everything about telling whoever set the business up.
export function noCountryReason() {
  return 'No label can be made yet: nobody has said which country this business sells in, '
    + 'and that decides the language the label must be printed in. The owner can set it '
    + 'when the business is created.';
}
