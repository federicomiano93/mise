// The English the app speaks, checked as a whole.
//
// Federico asked for a grammar pass over the app (13 Aug 2026) before the ~250
// user-facing sentences are lifted into a translation dictionary — because a
// sentence corrected AFTER extraction has to be corrected twice, in the key and
// in every translation.
//
// ⚠️ THIS FILE FIXES THE CLASS, NOT THE OCCURRENCES. Nineteen strings were wrong
// on the day it was written; correcting only those leaves the next one to be
// written wrong, and punctuation is invisible in review. What is pinned here is
// the RULE.
//
// 📌 What the pass found, and did NOT find: the app is consistent British English
// with no American spellings, no `...` where `…` belongs, and no double spaces.
// The two real classes were both punctuation, and both had the same cause — see
// below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'js');

// ⚠️ VENDORED CODE IS NOT OURS TO PUNCTUATE. sortable.esm.js is a third-party
// library kept in the repo on purpose (P19); rewriting its strings would be a
// change we could not defend at the next upgrade.
const SKIP = ['vendor'];

function everyJsFile(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyJsFile(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const FILES = everyJsFile(JS).map(f => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

// ⚠️ THE RULES APPLY TO STRINGS, NOT TO LINES, and the difference is what makes
// this test usable. A first version tested whole lines and reported nineteen
// hits, twelve of which were a developer's trailing comment — «// the client's
// detail» — which no baker will ever read. A test that cries wolf twelve times
// out of nineteen is a test somebody switches off.
//
// Extracting the string literals also handles the comment case for free: a
// comment contains no string literal, so it simply has nothing to check.
// ⚠️ AND IT HAS TO STOP AT A COMMENT, which a regex over the line cannot do. The
// second version extracted string literals and still reported fourteen hits —
// every one of them a phrase QUOTED INSIDE a comment («// Per-recipe "show this
// recipe's logs" flags»). Explaining the app in prose is exactly where an
// apostrophe belongs; the rule is about what reaches a screen.
//
// So this walks the line once, yields the text inside each string literal, and
// stops dead at // or /*. Small enough to read, and exact where a regex guesses.
function stringsIn(line) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];   // a whole comment line
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) break;
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let j = i + 1;
      let text = '';
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') { text += line[j + 1] || ''; j += 2; continue; }
        text += line[j];
        j += 1;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

// ⚠️ THE CONSOLE IS THE DEVELOPER'S CHANNEL, NEVER A SCREEN. `console.warn('Could
// not watch tonight's confirmations:')` is a sentence written for whoever is
// debugging, and holding it to the app's typography would be tidying something
// nobody reads at the cost of the signal here meaning something.
const isDeveloperChannel = line => /console\.(warn|error|log|info|debug)/.test(line);

function offendingLines(pattern, { skip = () => false } = {}) {
  const found = [];
  for (const { path, text } of FILES) {
    text.split('\n').forEach((line, i) => {
      if (skip(line)) return;
      for (const literal of stringsIn(line)) {
        // ⚠️ A CSS SELECTOR IS NOT A SENTENCE. '[id$="-overlay"].visible' in
        // js/update-gate.js must keep its straight quotes — a curly one simply
        // stops matching, and the update gate would stop waiting for open
        // dialogs. Skipped by SHAPE rather than by filename, so the next
        // selector written anywhere is covered too.
        if (/^\s*[.#[]/.test(literal)) continue;
        if (pattern.test(literal)) {
          found.push(`${path}:${i + 1}  ${literal.trim().slice(0, 90)}`);
          break;
        }
      }
    });
  }
  return found;
}

// ── The apostrophe ──────────────────────────────────────────────────────────

// ⚠️ NINE STRINGS USED THE TYPEWRITER APOSTROPHE while the rest of the app used
// the typographic one — and every single one of them was an ERROR OR CONFIRMATION
// message: "Couldn't save", "Couldn't delete", "Tonight's record". The sentences
// somebody reads when something has already gone wrong were the scruffy ones.
//
// 📌 THE CAUSE WAS TECHNICAL, NOT CARELESSNESS, which is exactly why a test is
// the right answer: inside single quotes an apostrophe must be escaped, so
// whoever wrote those reached for `’`; inside a backtick template it needs no
// escaping, so they typed `'` and it read fine to them.
test('no typewriter apostrophe in anything the app says', () => {
  // A letter — or a closing brace, for `${client.name}'s current link` — then an
  // apostrophe, then a lower-case letter: don't, Tonight's. That shape cannot
  // occur in code: a string delimiter is never preceded by a letter AND followed
  // by one.
  //
  // ⚠️ THE BRACE WAS MISSING AT FIRST, and it hid a real one. `${client.name}'s`
  // is the commonest possessive in this app — a person's own name followed by 's
  // — and the pattern walked straight past every instance of it.
  const found = offendingLines(/[A-Za-z}]'[a-z]/, { skip: isDeveloperChannel });
  assert.deepEqual(found, [],
    'use the typographic apostrophe ’ in text the app shows:\n' + found.join('\n'));
});

// ── The quotation marks ─────────────────────────────────────────────────────

// ⚠️ THE SECOND CLASS, AND IT WAS BIGGER — ten sentences quoted a recipe, product
// or supplier name with straight "..." while the app elsewhere writes “...”.
// Found only because fixing the apostrophes put the two side by side.
test('no straight quotes around a name in anything the app says', () => {
  const found = offendingLines(/"[^"]*"/, {
    // ⚠️ THREE LEGITIMATE USES, and none of them is a sentence:
    //   · console.* — the developer's channel, never a screen;
    //   · a CSS attribute selector, [data-os-btn="${x}"], where a curly quote
    //     would simply stop matching;
    //   · inline SVG path markup, which is full of width="24" and viewBox="…".
    skip: line => isDeveloperChannel(line)
      || /querySelector|\[data-/.test(line)
      || /<svg|<path|xmlns/.test(line),
  });
  assert.deepEqual(found, [],
    'use “ ” around a name in text the app shows:\n' + found.join('\n'));
});

// ── The classes the pass looked for and did not find ────────────────────────
//
// Kept as tests rather than as a note, because "we checked once" decays and a
// test does not.

test('the ellipsis is the single character, never three dots', () => {
  const found = offendingLines(/['"`][^'"`]*\.\.\.[^'"`]*['"`]/);
  assert.deepEqual(found, [], 'use … :\n' + found.join('\n'));
});

test('British spelling, not American', () => {
  // Deliberately narrow: only words this app would plausibly use, and only in
  // prose. `color` is excluded by the CSS-property guard because it appears in
  // colour-mix(), getComputedStyle().color and inline style strings.
  const found = offendingLines(/\b(organiz|realiz|analyz|customiz)[a-z]*\b/i);
  assert.deepEqual(found, [], 'this app is written in British English:\n' + found.join('\n'));
});

test('no double space inside a sentence', () => {
  const found = offendingLines(/['"`][^'"`]*[a-z]  [A-Za-z][^'"`]*['"`]/);
  assert.deepEqual(found, [], found.join('\n'));
});

// ── One phrase, one capitalisation ──────────────────────────────────────────

// ⚠️ "Per 100 g" and "per 100 g" both existed. Both are correct English — one
// heads a table column, the other sits inside a sentence — so this does not
// forbid either. It pins that the LABEL form is the capitalised one, so the next
// person writing a nutrition screen does not have to guess which is which.
//
// ⚠️ THE WORDS MOVED, THE RULE DID NOT. Since the label follows the venue's
// country (js/market.js), the inline form lives in the per-language table and
// the capitalised heading stayed on the ingredient form. This test followed them
// rather than being dropped — and it got STRONGER on the way, because it can now
// ask the same question of Italian, where the lower-case form happens to be
// identical and is just as easy to capitalise by accident.
test('the nutrition column heading is capitalised, the inline mention is not', () => {
  const market = readFileSync(join(ROOT, 'js', 'market.js'), 'utf8');
  const forms = [...market.matchAll(/per100g: '([^']*)'/g)].map(m => m[1]);
  assert.ok(forms.length >= 2,
    'every label language must state the unit — a missing one falls back to English silently');
  for (const form of forms) {
    assert.equal(form, 'per 100 g',
      'inside the table the unit follows the numbers and stays lower case');
  }

  const form = readFileSync(join(ROOT, 'js', 'orders', 'management.js'), 'utf8');
  assert.match(form, /text: 'Per 100 g'/,
    'heading its own column, the same phrase is capitalised');
});
