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

test('no label file imports the interface language', () => {
  for (const file of LABEL_FILES) {
    assert.doesNotMatch(read(file), /from\s+['"][^'"]*i18n\.js['"]/,
      `${file} decides what goes ON A LABEL — its words come from the country, never from a person's setting`);
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
      const asksForLabelWords =
        /\b(labelWord|allergenName|nutrientName|canPrintLabel|outputLanguage)\s*\(/
          .test(codeOf(readFileSync(full, 'utf8')));
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
