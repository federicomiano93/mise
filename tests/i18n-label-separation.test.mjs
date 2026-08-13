// The interface language must never reach a label.
//
// ⚠️⚠️ THIS IS THE ONE THAT PROTECTS SOMEBODY, and it is worth stating plainly why
// a whole test file exists for a rule that could have been a comment.
//
// An allergen label is a legal document. Retained Reg. (EU) 1169/2011 requires it
// to be in a language understood where the food is SOLD — so the words on it are
// decided by the venue's country (js/market.js) and by nothing else. The
// interface language is a preference: what the staff read on screen.
//
// Federico's own venues are the case that makes this real. They are in England
// and he is Italian: he wants the app in Italian and his labels MUST stay in
// English. The moment somebody wires t() into the label code, setting the
// interface to Italian starts printing Italian allergen labels for food sold in
// the United Kingdom — and it would look like the feature working.
//
// ⚠️ A COMMENT SAYING "DO NOT DO THIS" IS NOT A GUARD. This is the technique from
// v1.24.1: a rule that matters more than a behaviour gets pinned by a test that
// NAMES it when broken, because a rule that lives only in a comment comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

// Everything that decides what a label SAYS. Adding a file to the label feature
// means adding it here — and if that is forgotten, the third test below is what
// says so, by asking the app instead of trusting this list.
const LABEL_FILES = [
  'js/market.js',
  'js/catalogue/recipe-label-model.js',
  'js/catalogue/label-view.js',
];

// ⚠️⚠️ ASKING FOR A LABEL'S WORDS AND ASKING ABOUT A LABEL ARE NOT THE SAME
// THING, and the first version of this file treated them as one.
//
//   labelWord / allergenName / nutrientName  build what a label SAYS
//   canPrintLabel / outputLanguage / countryName  answer questions ABOUT it
//
// Only the first group makes a file a label file. The second is safe to ask from
// anywhere, and one screen has to: js/staff/language.js exists to TELL somebody
// that setting the app to Italian does not move their English labels, and it
// cannot say which language those labels are in without asking. A file holding
// both `t` and `outputLanguage` can talk about the label; a file holding both
// `t` and `labelWord` can build one out of interface words, and that is the
// wire this guard exists to cut.
//
// ⚠️ THIS IS A SHARPENING, NOT A LOOSENING, and the difference matters: the
// guard fired on my own screen and the answer was to say precisely what is
// forbidden, never to make the check quieter so the code could pass.
const LABEL_WORD_CALLS = /\b(labelWord|allergenName|nutrientName)\s*\(/;

// ⚠️⚠️ THE BAN IS TOTAL WHERE IT COSTS NOTHING, AND SHARPER WHERE IT DOES NOT.
//
// js/market.js and recipe-label-model.js are model code: they build what a label
// SAYS and nothing else, so they may not touch the dictionary at all. label-view.js
// also draws the screen AROUND the label — a Copy button, a caveat, the sentence
// explaining why no label can be made — and those are ordinary interface. Leaving
// them English gave an Italian bakery one screen in the wrong language.
//
// So for that one file the import ban is replaced by the invariant it was
// standing in for, which is stricter about the thing that matters:
//
//   the label's words are chosen by outputLanguage(location) — the country
//   currentLanguage() and setLanguage() are the two ways the INTERFACE could get
//   into a label, and neither may appear in any label file at all.
const MODEL_ONLY = ['js/market.js', 'js/catalogue/recipe-label-model.js'];

test('the label MODEL files do not import the interface language at all', () => {
  for (const file of MODEL_ONLY) {
    assert.doesNotMatch(read(file), /from\s+['"][^'"]*i18n\.js['"]/,
      `${file} builds what a label SAYS and nothing else — it has no reason to know what is on screen`);
  }
});

test('no label file can reach the interface language', () => {
  for (const file of LABEL_FILES) {
    const src = codeOf(read(file));
    assert.doesNotMatch(src, /\bcurrentLanguage\b/,
      `${file} must never ask what language the SCREEN is in — a label follows the country`);
    assert.doesNotMatch(src, /\bsetLanguage\b/,
      `${file} must never change the interface language`);
    assert.doesNotMatch(src, /\blanguageFromTag\b/,
      `${file} must never take a language from the device`);
    assert.doesNotMatch(src, /\binterfaceLanguage\b/,
      `${file} must never read the venue's interface setting`);
  }
});

// ⚠️ AND THE POSITIVE HALF: the language a label is built in is assigned from
// outputLanguage(), once, and that variable is what every label word is asked
// for. Without this the file could import t() and quietly pass currentLanguage()
// under another name.
test('the label language comes from the country, and every label word is asked in it', () => {
  const src = codeOf(read('js/catalogue/label-view.js'));
  assert.match(src, /const lang = outputLanguage\(location\);/,
    'the label language is derived from the venue’s country, once');

  const calls = [...src.matchAll(/\b(labelWord|allergenName|nutrientName)\s*\(([^)]*)\)/g)];
  assert.ok(calls.length >= 5, 'the label is built from label words');
  for (const call of calls) {
    const args = call[2].split(',').map(a => a.trim());
    assert.equal(args[args.length - 1], 'lang',
      `${call[1]}(${call[2]}) must be asked in the LABEL's language, not the screen's`);
  }
});

// The other direction. i18n.js reaching into market.js would be the same wire
// with the same consequence, run backwards.
test('the interface language does not import the label words', () => {
  assert.doesNotMatch(read('js/i18n.js'), /from\s+['"]\.\/market\.js['"]/,
    'the two languages must be decided independently, or one can move the other');
});

// ⚠️ THE LIST ABOVE IS THE WEAK POINT OF THIS FILE: a new label file nobody adds
// to it is unguarded, and the first test still passes. So the list is checked
// against the app — anything that CALLS market.js for label words is a label file
// and must be named here.
test('every file that asks for a label word is on the list', () => {
  const unguarded = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === 'vendor') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (rel === 'js/market.js') continue;
      const asksForLabelWords = LABEL_WORD_CALLS.test(codeOf(readFileSync(full, 'utf8')));
      if (asksForLabelWords && !LABEL_FILES.includes(rel)) unguarded.push(rel);
    }
  };
  walk(join(ROOT, 'js'));
  assert.deepEqual(unguarded, [],
    'these build label text and are not guarded — add them to LABEL_FILES');
});

// The label words themselves must stay in market.js, keyed by country. If they
// ever moved into the interface dictionary they would follow the setting by
// construction, whatever any import guard said.
test('the label words are still keyed by country, not by preference', () => {
  const market = read('js/market.js');
  assert.match(market, /const LABEL_WORDS = Object\.freeze\(\{/,
    'the words a label is built from live here');
  assert.match(market, /const OUTPUT_LANGUAGE = Object\.freeze\(\{ GB: 'en', IT: 'it' \}\)/,
    'and the country is what picks between them');
});

// ⚠️ COMMENTS ARE NOT CODE, and reading them as code made the third test report
// js/i18n.js as a label file — because its header EXPLAINS the separation and
// names the very function it must never call. A guard that fires on prose is a
// guard people widen, and widening is how a real guard gets weakened.
//
// Naive about `//` inside a string literal, deliberately: these are identifiers
// in call position, and none of them appears inside a string anywhere in the app.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}
