// i18n.js — the INTERFACE language: what the staff read on screen. PURE (no DOM,
// no Firestore), so every rule below is asserted in a unit test rather than read
// back out of rendered markup (P15).
//
// ⚠️⚠️ THIS IS NOT THE LABEL LANGUAGE, AND KEEPING THE TWO APART IS WHY THIS FILE
// AND js/market.js ARE SEPARATE FILES RATHER THAN ONE.
//
//   this file        the INTERFACE language   what the staff READ    a preference
//   js/market.js     the OUTPUT language      what a LABEL says      the LAW
//
// Federico is Italian and his bakeries are in England: he wants the app in
// Italian, and his allergen labels must stay in English because that food is sold
// in the United Kingdom. So an interface set to Italian must not move a single
// word on a label. That is not a promise made in a comment — nothing in this file
// is reachable from the label code, and tests/i18n-label-separation.test.mjs
// fails if anybody imports one into the other.
//
// ⚠️ THE SIGN-IN SCREEN CANNOT USE THIS, and must not try. Nobody is signed in
// yet, so no venue is open, so there is no setting to read — the same reason that
// screen says «Mise» where every other screen says the venue's name. It stays in
// English until somebody is inside.

export const LANGUAGES = Object.freeze(['en', 'it']);

export const DEFAULT_LANGUAGE = 'en';

// ── The words that are DATA, and must never pass through here ────────────────
//
// ⚠️⚠️ TRANSLATING ANY OF THESE BREAKS THE APP, SILENTLY AND IN A WAY NO SCREEN
// EXPLAINS. They are English words, they look exactly like labels, and they are
// identifiers:
//
//   the weekday names ARE Firestore document ids — `pastries/Monday`. Translate
//   them and all seven proving lists become unreachable, with the app cheerfully
//   showing seven empty days;
//   the section keys decide which parts of the app a venue has bought;
//   the role values decide who may do what — and a membership value the code does
//   not recognise is not a demotion, it is a LOCKOUT (learnt three times);
//   the allergen codes are what an ingredient's declaration is stored under. A
//   translated code is a declaration that stops matching, on the one feature in
//   this app that can put somebody in hospital;
//   the unit and country codes are stored on documents and compared by the rules.
//
// This list exists so that translating one turns a test RED and NAMES it — the
// technique from v1.24.1, where a rule that mattered more than a behaviour was
// pinned by its own test rather than left in a comment. A rule that lives only in
// a comment is a rule that comes back.
export const DATA_WORDS = Object.freeze([
  // Firestore document ids for the seven proving lists
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  // which parts of the app a venue has
  'orders', 'calculator', 'catalogue', 'pastries', 'foodcost',
  // who may do what — the membership VALUE itself
  'owner', 'manager', 'staff', 'head-chef',
  // stored on ingredients and products, and compared by firestore.rules
  'kg', 'l', 'pcs',
  // the country, which decides the LABEL language (js/market.js)
  'GB', 'IT',
  // the interface languages themselves
  'en', 'it',
]);

// ── The dictionaries ─────────────────────────────────────────────────────────
//
// One flat map per language, keyed by a dotted name that says where the phrase
// lives: `orders.supplier.delete`, not `deleteBtn`. Flat and dotted so a phrase
// can be found by grepping for the key exactly as it appears at the call site.
//
// ⚠️ A PHRASE IS ONE ENTRY WITH A HOLE IN IT, NEVER TWO HALVES GLUED TOGETHER.
// `'Delete ' + name` cannot be translated: Italian puts the words in a different
// order, and a translator handed two fragments cannot see the sentence. Write
// `'Delete {name}?'` and pass `{ name }`.
//
// ⚠️ AND A COUNT IS NOT AN `if`. English and Italian agree that there are two
// forms here, but they do not agree on which number takes which — so counted
// phrases carry `.one` and `.other` and are picked by Intl.PluralRules, the
// platform's own answer (P19), never by `n === 1 ? … : …` at the call site.
const DICTIONARIES = Object.freeze({
  en: Object.freeze({
    // ── Who can get in ──────────────────────────────────────────────────────
    // ⚠️ THE WORD AND THE STORED VALUE ARE DIFFERENT THINGS, and this block is
    // where that is easiest to get wrong. `role.staff` shows «Employee»; the
    // value in users/{uid} stays 'staff' whatever any language calls it.
    'role.owner': 'Owner',
    'role.manager': 'Manager',
    'role.headChef': 'Head chef',
    'role.staff': 'Employee',

    // ⚠️ THE SAME WORD INSIDE A SENTENCE, ASKED FOR RATHER THAN COMPUTED. The
    // screen used to write `Make ${label.toLowerCase()}`, which is two mistakes
    // at once: it glues a sentence out of fragments, and it TRANSFORMS a
    // translated word. Case is a property of a language, not an operation you
    // may perform on somebody else's — so the form that goes inside a phrase is
    // its own entry, and the translator decides what it looks like.
    'people.make': 'Make {role}',
    'people.add': 'Add {role}',
    'role.owner.inSentence': 'owner',
    'role.manager.inSentence': 'manager',
    'role.headChef.inSentence': 'head chef',
    'role.staff.inSentence': 'employee',

    // ⚠️ THESE FOUR SENTENCES ARE THE ONLY PLACE ANYBODY IS EVER TOLD what a role
    // can do. Nothing else in the app explains it, so a translation that softens
    // one is a wrong decision about a real person's access, made confidently
    // because the screen said so. «Head chef» must keep saying out loud that it
    // is the manager level under another name, or four pills read as four levels.
    'role.means.owner': 'Everything, including adding people and setting their roles.',
    'role.means.manager': 'Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.headChef': 'The same as Manager — it is only the job title that differs. Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.staff': 'Does the daily work — quantities, doughs, orders. Cannot delete things or add people.',

    'people.confirm.owner': 'Make {name} an owner?',
    'people.confirm.manager': 'Make {name} a manager?',
    'people.confirm.headChef': 'Make {name} the head chef?',
    'people.confirm.staff': 'Make {name} an employee?',

    // ⚠️ The quoted button name has to match what auth-gate.js actually shows.
    // It is repeated here rather than composed because that screen's words are
    // not extracted yet; when they are, this becomes a hole. Until then, changing
    // one means changing the other — the drift is real, and small.
    'people.joinsAs': 'Joins as {role} · {expires} · they open the app, tap “I have a code”, create their account and type it.',
  }),
  it: Object.freeze({
    'role.owner': 'Titolare',
    'role.manager': 'Responsabile',
    'role.headChef': 'Chef di cucina',
    'role.staff': 'Dipendente',

    // 📌 Italian puts the word where Italian puts it, which is the entire reason
    // a phrase is one entry with a hole and not two halves joined at the call
    // site. «Rendi responsabile», not «Fai responsabile».
    'people.make': 'Rendi {role}',
    'people.add': 'Aggiungi {role}',
    'role.owner.inSentence': 'titolare',
    'role.manager.inSentence': 'responsabile',
    'role.headChef.inSentence': 'chef di cucina',
    'role.staff.inSentence': 'dipendente',

    'role.means.owner': 'Tutto, compreso aggiungere persone e decidere che ruolo hanno.',
    'role.means.manager': 'Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.headChef': 'Identico a Responsabile — cambia solo il nome del ruolo. Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.staff': 'Fa il lavoro di ogni giorno — quantità, impasti, ordini. Non può cancellare niente né aggiungere persone.',

    // 📌 Italian takes no article here, which is exactly why these are four whole
    // sentences and not one template with a hole for «an» / «a» / «the».
    'people.confirm.owner': 'Rendere {name} titolare?',
    'people.confirm.manager': 'Rendere {name} responsabile?',
    'people.confirm.headChef': 'Rendere {name} chef di cucina?',
    'people.confirm.staff': 'Rendere {name} dipendente?',

    'people.joinsAs': 'Entra come {role} · {expires} · apre l’app, tocca “I have a code”, crea il suo account e digita il codice.',
  }),
});

// ── Which language is showing ────────────────────────────────────────────────

let current = DEFAULT_LANGUAGE;

// ⚠️ AN UNKNOWN LANGUAGE FALLS BACK TO ENGLISH RATHER THAN THROWING, and that is
// the opposite direction from countryOf() in js/market.js — deliberately. There,
// a wrong answer prints a non-compliant label; here, a wrong answer shows the
// wrong words to somebody who can see they are the wrong words. An app that
// refuses to open because a stored setting is odd is worse than an app in the
// wrong language.
export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  return current;
}

export function currentLanguage() {
  return current;
}

// The language a venue's staff read, from the venue document. Separate from
// outputLanguage(location) in js/market.js, which reads `country` — the two
// fields are independent on purpose, because Federico's venues need them to
// disagree.
export function interfaceLanguage(location) {
  const value = location && location.language;
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

// ── Looking a phrase up ──────────────────────────────────────────────────────

function fill(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

function plural(entry, n, lang) {
  // Intl decides the category, so a language whose rules differ from English's
  // gets them right without anything here knowing about it.
  const rules = new Intl.PluralRules(lang === 'it' ? 'it-IT' : 'en-GB');
  const category = rules.select(n);
  return entry[category] !== undefined ? entry[category] : entry.other;
}

// ⚠️ TWO DIFFERENT FAILURES, ANSWERED TWO DIFFERENT WAYS, and telling them apart
// is what keeps a half-translated app usable AND keeps a typo findable:
//
//   the key is missing from THIS language but present in English
//     → the English phrase. A translation that has not been written yet must not
//       leave a blank on a working screen.
//
//   the key is missing from EVERY language
//     → the key itself, on screen. That is a programming mistake, not a
//       translation gap, and it must be LOUD. A silent empty string is a button
//       with no words on it that nobody notices until a customer does.
//
// ⚠️ THE LOOKUP TAKES ITS DICTIONARIES AS AN ARGUMENT, so it can be exercised
// against made-up phrases without the real ones being made writable. They are
// frozen on purpose — a screen that could edit the dictionary would be a screen
// that can change another screen's words — and loosening that to suit a test
// would be the test damaging the thing it is checking.
export function translate(dicts, lang, key, vars) {
  const entry = dicts[lang] && dicts[lang][key];
  const fallback = dicts[DEFAULT_LANGUAGE] && dicts[DEFAULT_LANGUAGE][key];
  const found = entry !== undefined ? entry : fallback;
  if (found === undefined) return key;

  const from = entry !== undefined ? lang : DEFAULT_LANGUAGE;
  const text = (typeof found === 'object' && found !== null)
    ? plural(found, vars && Number(vars.n), from)
    : found;
  return fill(text, vars);
}

export function t(key, vars) {
  return translate(DICTIONARIES, current, key, vars);
}

// Everything the dictionaries hold, for the tests that check the two languages
// carry the same keys and that no data word was translated. Not for the app.
export function _dictionaries() {
  return DICTIONARIES;
}
