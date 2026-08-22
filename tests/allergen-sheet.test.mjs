// The allergen sheet — the screen somebody consults when a customer asks what is
// in something.
//
// ⚠️⚠️ SOURCE-LEVEL, AND THAT IS THE HONEST REACH. This file builds DOM, so there
// is no way to run it under `node --test`. What CAN be pinned here are the rules
// that would be invisible in review and expensive in a kitchen: that a recipe with
// no answer never prints an allergen name, that the law card refuses without a
// country, and that the screen's order is the one Federico asked for. The
// behaviour underneath is unit-tested where it lives — rowState() in
// tests/recipe-allergen-model.test.mjs, allergenGroupName() in tests/market.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SHEET = read('js/catalogue/allergen-sheet.js');

// Comments carry the same words as the code here, so a check that scans the whole
// file proves nothing. Strip them first.
const code = SHEET
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── Federico's layout, 22 Aug 2026 ───────────────────────────────────────────
//
// «la scheda allergeni quando la apro mi deve mostrare la lista degli allergeni
//  dichiarati dalla legge in base al luogo di esercizio in cui mi trovo, sotto
//  metti una barra di ricerca dove posso cercare le ricette, sotto la barra di
//  ricerca metti tutte le ricette»

test('the screen is built in the order he asked for: law, then search, then recipes', () => {
  // ⚠️ EXACTLY ONCE EACH, AND indexOf ALONE IS NOT ENOUGH — a mutation adding a
  // SECOND appendChild after the recipes survived a check that only compared first
  // positions. Appending a node twice MOVES it: the card would really end up at
  // the bottom, and the guard would have said the order was fine.
  const once = (needle) => (code.match(new RegExp(needle.replace(/[().]/g, '\\$&'), 'g')) || []).length;
  for (const call of ['root.appendChild(lawHost)', 'root.appendChild(search)',
    'root.appendChild(panel)', 'root.appendChild(workHost)']) {
    assert.equal(once(call), 1, `${call} must appear exactly once — appending twice moves the node`);
  }
  const law = code.indexOf('root.appendChild(lawHost)');
  const search = code.indexOf('root.appendChild(search)');
  const rows = code.indexOf('root.appendChild(panel)');
  const work = code.indexOf('root.appendChild(workHost)');
  assert.ok(law > 0 && search > 0 && rows > 0 && work > 0, 'one of the four is not appended to the root');
  assert.ok(law < search, 'the law card must come before the search');
  assert.ok(search < rows, 'the search must come before the recipes');
  // ⚠️ AND NOTHING MAY COME BETWEEN THE SEARCH AND THE RECIPES. Measured at
  // 390×844: the work box between them is 296px and pushed the first recipe to
  // 650px down, leaving two of four recipes on a screen opened to look one up.
  assert.ok(rows < work,
    'the work lists must sit BELOW the recipes — between them they cost 296px of the phone');
});

// ⚠️⚠️ THE ONE THAT MATTERS. A recipe with two of six rows declared HAS partial
// allergens, and the RECIPE screen shows them — with room for the sentence saying
// it is not the full list. Here, on a screen somebody scrolls while a customer
// waits, a red row that nevertheless prints "Milk, Wheat" is read as the answer,
// and the row that is missing could be the one with the hazelnuts.
test('a row with no answer never prints an allergen name', () => {
  const start = code.indexOf('function recipeRow');
  const end = code.indexOf('paint();', start);
  assert.ok(start > 0 && end > start, 'recipeRow is gone');
  const fn = code.slice(start, end);

  // The allergen names are reached in exactly one branch, and it is the declared one.
  const names = fn.indexOf('result.allergens.map');
  assert.ok(names > 0, 'the declared branch no longer names the allergens');
  const branch = fn.lastIndexOf("=== 'declared-listed'", names);
  assert.ok(branch > 0 && branch < names,
    'allergen names must be produced ONLY inside the declared-listed branch');

  // And there is only one such call in the whole function.
  assert.equal((fn.match(/result\.allergens/g) || []).length, 1,
    'the allergen list is read more than once — one of them is on a blocked row');
});

test('the row states come from the model, never from ifs written here', () => {
  assert.match(code, /rowState\s*\(/, 'the screen must ask the model which state a row is in');
  assert.match(code, /rowIsBlocked\s*\(/, 'and which states count as having no answer');
  // ⚠️ canLabel() is deliberately NOT imported: rowState() asks it, so exactly one
  // place decides whether a recipe has an answer. Two callers side by side is how
  // a row and its pill start disagreeing.
  assert.doesNotMatch(code, /\bcanLabel\s*\(/,
    'canLabel must be asked through rowState, or the row and the pill can disagree');
});

// ⚠️ THE STATE IS A WORD, NOT ONLY A COLOUR (P18). A red edge alone is invisible
// to a colour-blind reader and to a photocopy pinned up in a kitchen.
test('every row carries its state as a word', () => {
  assert.match(code, /cat\.sheet\.rowNotDeclared/, 'the blocked pill has no text');
  assert.match(code, /cat\.sheet\.rowDeclared/, 'the declared pill has no text');
  const css = read('catalogue.css');
  assert.match(css, /\.alg-sheet-pill--blocked/, 'the blocked pill is unstyled');
  assert.match(css, /\.alg-sheet-pill--ok/, 'the declared pill is unstyled');
  // ⚠️⚠️ AND IT MUST BE READABLE. --cat-brand on --cat-brand-2 measured 1.63:1 in a
  // real browser: I had assumed --brand-2 was a light tint the way --warn-bg is,
  // and it is a DARKER green — the hover state of a solid button. Dark on dark at
  // 10.88px is a smear, on the one word that separates "somebody checked this"
  // from "nobody has looked". Ban the pairing by shape; the driver measures the
  // ratio itself.
  assert.doesNotMatch(css, /\.alg-sheet-pill--ok\s*\{[^}]*background:\s*var\(--cat-brand-2\)/,
    '--cat-brand-2 is a darker green, not a tint — that pairing measures 1.63:1');
  assert.match(css, /\.alg-sheet-pill--ok\s*\{[^}]*color:\s*var\(--cat-brand-ink\)/,
    'the declared pill must use the on-brand ink, as every solid brand element does');
});

// ── The law card ─────────────────────────────────────────────────────────────

test('no country means no list at all, never a quiet fall back to the UK', () => {
  const start = code.indexOf('function lawCard');
  assert.ok(start > 0, 'lawCard is gone');
  const fn = code.slice(start);
  const refuse = fn.indexOf('canPrintLabel');
  const groups = fn.indexOf('ALLERGEN_GROUPS');
  assert.ok(refuse > 0, 'the card must ask whether the country is known');
  assert.ok(refuse < groups, 'the refusal must come BEFORE any list is built');
  assert.match(fn.slice(refuse, groups), /cat\.sheet\.noCountry/,
    'the refusal must say what to do about it');
  // ⚠️ Every venue in production today is British, which is exactly what would
  // make an English fallback invisible for the first Italian one.
  assert.doesNotMatch(fn, /'GB'|"GB"/, 'the card must never name a country itself');
});

test('the fourteen are derived from the model, never listed here', () => {
  assert.match(code, /ALLERGEN_GROUPS\.map/, 'the groups must come from allergen-model.js');
  // A second copy of the fourteen is the copy that drifts, and what the two would
  // disagree about is what is in somebody's food.
  for (const word of ['Celery', 'Molluscs', 'Sulphites', 'Sedano', 'Molluschi']) {
    assert.ok(!code.includes(word), `${word} is written into the screen — it must be derived`);
  }
});

// ⚠️ A FOOD-LABEL WORD FOLLOWS THE VENUE'S COUNTRY, NEVER THE READER'S LANGUAGE.
// "Wheat", not "Grano", in a UK bakery with the app in Italian — and it is the law
// (retained Reg. 1169/2011 Art. 15), not an oversight.
test('the allergen words are chosen by the country, not by the interface', () => {
  assert.match(code, /outputLanguage\s*\(/, 'the language must come from the location');
  assert.doesNotMatch(code, /currentLanguage|interfaceLanguage|setLanguage/,
    'the interface language must never reach a food-label word');
  // Both places that print an allergen name ask in that language.
  assert.match(code, /allergenName\(code, lang\)/);
  assert.match(code, /allergenGroupName\(g, lang\)/);
});

// ⚠️⚠️ THE v1.60.1 TRAP, WHICH SHIPPED AND STOOD FOR ELEVEN DAYS ON A CARD LIKE
// THIS ONE. el() ends in setAttribute, and setAttribute('hidden', false) writes
// the STRING "false" — the attribute is PRESENT and [hidden] matches on presence.
// The fold must be created with the string.
test('the fold is created hidden with a string, not with a boolean', () => {
  assert.match(code, /hidden:\s*'hidden'/, "the fold body must use hidden: 'hidden'");
  assert.doesNotMatch(code, /hidden:\s*(true|false)\b/,
    'a boolean handed to el() becomes the string "false" and hides the element');
});

// ⚠️ THE SCREEN IS DRAWN BEFORE THE SESSION IS GUARANTEED READY. The catalogue's
// list had exactly this defect and nobody saw it for weeks. Captured once, a null
// location prints "nobody has said which country" for ever — on the card whose
// whole job is naming what the law requires HERE.
test('the location is read at paint time, not captured once', () => {
  assert.match(code, /getLocation/, 'the sheet must take a getter');
  assert.doesNotMatch(code, /renderAllergenSheet\([^)]*\blocation\b\s*[,}]/,
    'a captured location value would freeze the law card at whatever was known on open');
  const paint = code.slice(code.indexOf('function paint()'), code.indexOf('function paintWork'));
  assert.match(paint, /readLocation\(\)/, 'paint must re-read the location');
});

// ⚠️ AND REBUILDING THE CARD ON EVERY REFRESH WOULD SLAM THE FOLD SHUT under
// whoever had just opened it — the defect v1.60.1 shipped as a hotfix.
test('the law card is rebuilt only when the country actually changes', () => {
  const fn = code.slice(code.indexOf('function paintLaw'), code.indexOf('function paint()'));
  assert.ok(fn.length > 80, 'paintLaw is gone');
  assert.match(fn, /if\s*\(lawCountry !== undefined && country === lawCountry\) return;/,
    'an unchanged country must leave the card, and its open fold, alone');
  assert.match(fn, /openBefore/, 'the open state must survive a genuine rebuild');
});

// ── The work lists ───────────────────────────────────────────────────────────

test('the work lists are capped at six and step aside while searching', () => {
  assert.match(code, /const WORK_LIMIT = 6;/, 'the cap is not six');
  const fn = code.slice(code.indexOf('function paintWork'), code.indexOf('function paintRows'));
  assert.match(fn, /if \(query\.trim\(\)\) return;/,
    'the work lists describe the whole catalogue, so they must hide while a search is on');
  // ⚠️ KEPT, NOT REMOVED — Federico's decision. With nothing linked yet they are
  // the only thing this screen can tell him, and dropping them would undo v1.38.1.
  assert.match(fn, /unlinkedRowNames/, 'the linking list is gone');
  assert.match(fn, /blockingIngredients/, 'the declaring list is gone');
  // Linking comes first: a declaration cannot reach a recipe that does not point
  // at the ingredient.
  assert.ok(fn.indexOf('unlinkedRowNames') < fn.indexOf('blockingIngredients'),
    'linking must be offered before declaring');
});

// ── Two defects this release closes ──────────────────────────────────────────

// ⚠️ IT WAS BUILT BY HAND, ENGLISH PLURAL INCLUDED, and printed under every
// blocked recipe on an Italian screen for as long as the sheet existed. No i18n
// check saw it: they all read t() call sites, and this was a template literal.
test('the counts are dictionary plurals, not English grammar in the code', () => {
  assert.match(code, /cat\.sheet\.blockedCount/, 'the blocked count must be a key');
  assert.doesNotMatch(code, /cannot be labelled yet/,
    'the English sentence is still built here');
  assert.doesNotMatch(code, /to sort out/, 'the per-row English sentence is still built here');
  assert.doesNotMatch(code, /\? 'ingredient' : 'ingredients'/,
    'English grammar written into the code cannot be translated');
});

// ⚠️ IT WAS DRAWN ONCE AND NEVER AGAIN, so a declaration made on another phone —
// or data still arriving on a cold open — never reached it.
test('the sheet can be refreshed, and the search survives it', () => {
  assert.match(code, /refresh\(newRecipes, newIngredients, newRecipesById\)/,
    'the sheet must expose a refresh');
  // ⚠️ TWO CALL SITES, AND BOTH ARE NEEDED — a mutation deleting one survived a
  // check that only counted "at least one". They answer different questions:
  //   the data callback   a declaration made on another phone, or a cold open
  //   the session hook    the venue's COUNTRY, which the law card cannot draw
  //                       without and which lands after the first paint
  const main = read('js/catalogue/catalogue-main.js');
  const calls = main.match(/view === 'allergens' && activeSheet/g) || [];
  assert.equal(calls.length, 2,
    'the sheet must be refreshed both when data arrives AND when the session lands');
  assert.match(main, /onSession\(\(s\) => \{[\s\S]*?view === 'allergens'/,
    'the session hook no longer reaches the sheet — the law card would stay countryless');
  // The field is built once, outside paint, so a repaint cannot wipe the text or
  // the keyboard out from under somebody typing.
  const paint = code.slice(code.indexOf('function paint()'));
  assert.doesNotMatch(paint.slice(0, paint.indexOf('function recipeRow')), /buildCatalogueSearch/,
    'the search box must be built once, never inside a repaint');
});

// ── The shared search field ──────────────────────────────────────────────────

test('both catalogue screens use the same search builder', () => {
  for (const file of ['js/catalogue/catalogue-list.js', 'js/catalogue/allergen-sheet.js']) {
    assert.match(read(file), /buildCatalogueSearch/, `${file} builds its own search field`);
  }
  const box = read('js/catalogue/search-box.js');
  // ⚠️ A FEATURE MAY NEVER IMPORT FROM ANOTHER FEATURE'S FOLDER. Orders has the
  // same component and it is off limits; this one mirrors its contract instead.
  assert.doesNotMatch(box, /from\s+['"]\.\.\/orders\//,
    'the catalogue must not import Orders code');
  // ⚠️ THE CALL, NOT THE WORD. A first version asserted /onInput/ and stayed green
  // when the call was deleted — the name still appeared in the destructured
  // parameters. The split is load-bearing: the query must be stored on every
  // keystroke so a Firestore snapshot landing mid-word finds the CURRENT text, and
  // only the repaint waits.
  assert.match(box, /if \(onInput\) onInput\(text\);/,
    'the query must be stored on every keystroke, before any debounce');
  assert.ok(box.indexOf('onInput(text)') < box.indexOf('setTimeout'),
    'storing the text must happen before the debounce is armed, not inside it');
  assert.match(box, /setTimeout\(\(\) => \{ if \(onChange\) onChange\(text\); \}, debounceMs\)/,
    'only the repaint may be debounced');
  assert.match(box, /debounceMs = 140/, 'the repaint delay must match the rest of the app');
  // A new file is the one failure that does not self-heal for an offline install.
  assert.match(read('sw.js'), /'\.\/js\/catalogue\/search-box\.js'/,
    'the new file is not precached — install() is all-or-nothing');
});
