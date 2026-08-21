// English written straight into the code, where the dictionary should be.
//
// ⚠️⚠️ THIS FIXES THE CLASS, NOT THE OCCURRENCES — the same reasoning
// tests/english-text.test.mjs states about itself. Seven strings were hard-coded on the
// day this was written; correcting only those leaves the eighth to be written wrong, and
// a literal is invisible in review because it looks exactly like every other string.
//
// WHAT IT COST BEFORE IT EXISTED. Four i18n suites already guard this app — the HTML's
// `data-i18n`, the keys existing, the label/interface separation, the English grammar —
// and **not one of them looks at a literal passed to `text:`**. So on an Italian phone:
//
//   Order · Stock   the labels on EVERY row of EVERY order, the two words read most
//   Management      the title of the Settings screen itself
//   Alerts · Price  two headings inside it
//
// None of that is a style slip. It is the screen somebody works on all day, in the wrong
// language, on the app's own account.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_WORDS } from '../js/i18n.js';

const ROOT = new URL('../js/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ⚠️ DATA WORDS ARE NOT PHRASES. 'Monday' is a Firestore document id and a stored
// supplier field; translating one is a lockout, not a rename. The list is imported
// rather than copied, so the two can never disagree about what is data.
const SAFE = new Set(DATA_WORDS.map(w => w.toLowerCase()));

// Files that legitimately hold English because they ARE the English: the dictionary
// itself, and the model that builds push text (it carries its own small table because
// the server cannot import the app's).
const EXEMPT = new Set(['i18n.js', 'i18n-dom.js', 'push-model.js']);

// ⚠️⚠️ THE DEBT THIS TEST INHERITED, AND WHY IT IS A LIST RATHER THAN A CLEAN PASS.
// Turning the scan on found 22 more strings beyond the seven it was written for, across
// FIVE features — the Catalogue, Staff, Food Cost, Pastries and the Log. Every one is a
// screen that stays English on an Italian phone.
//
// They are NOT fixed here, and the reason is not laziness:
//   * each needs an Italian translation somebody should actually read, and 22 written in
//     one sitting by the person who also wrote the code is how a half-translated app
//     happens;
//   * at least one is constrained — js/log-model.js is a PURE model, and this project
//     already has a test forbidding label models from importing the interface language,
//     so "wrap it in t()" may be the wrong answer there and needs its own thought.
//
// ⚠️ THE LIST MAY ONLY EVER SHRINK. A new literal is not on it, so it fails. That is the
// whole job: this test exists to stop the twenty-third, not to pretend the twenty-two
// are not there. Delete a line as you fix it; never add one.
const KNOWN_DEBT = new Set([
  'catalogue/catalogue-detail.js', 'catalogue/catalogue-editor.js',
  'catalogue/ingredient-picker.js', 'catalogue/guided-editor.js',
  'staff/new-customer.js', 'foodcost/foodcost-editor.js',
  'pastries/pastries-editor.js', 'pastries/pastries-day.js',
  'js/log-model.js',
]);

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsFiles(full);
    return name.endsWith('.js') && !EXEMPT.has(name) ? [full] : [];
  });
}

// A capitalised word inside a string handed to `text:` — the shape every one of the
// seven had — or handed as the LABEL argument of a helper that builds one.
//
// ⚠️⚠️ THE SECOND SHAPE WAS ADDED AFTER LOOKING AT A SCREENSHOT, and it is the honest
// limit of this test. The first version caught only `text:`, so it passed while the
// Settings panel's own three tabs still read «Suppliers · Ingredients · General» on an
// Italian phone — they are `tabButton('Suppliers', …)`, a literal in an ARGUMENT, which
// the first pattern could not see. Measuring found nothing; looking found it in a second.
//
// 📌 It cannot catch every shape a string can be passed in, and pretending otherwise
// would be worse than saying so: it catches the two that this app actually uses. A third
// shape will be found the same way this one was — by opening the screen in Italian.
const LITERAL = /(?:text:\s*|tabButton\(\s*|okLabel:\s*|cancelLabel:\s*)'([A-Z][a-z][^']*)'/g;

// ⚠️⚠️ THE THIRD AND FOURTH SHAPES, ADDED 21 Aug 2026 — and found exactly the way the
// note above predicted: by opening the screen in Italian and looking at it.
//
//   okLabel: 'Discard'          46 of these, across 22 files. The dialog asked its
//                               question in Italian and offered its answer in English.
//   `All (${n})`                the two filter buttons above every Orders list, and the
//                               hint under every quantity box, assigned to .textContent.
//   text: `Heads up: ${s.name} delivers on ${wd}, but…`   the whole bank-holiday warning.
//
// A template literal needs its interpolations REMOVED before it is judged, or every
// `${result.foodCostPct}%` reads as English because a variable name is capitalised.
// What is left after that is real prose, or nothing.
const TEMPLATE = /(?:text:\s*|textContent\s*=\s*)`([^`]*)`/g;
const prose = (tpl) => tpl.replace(/\$\{[^}]*\}/g, '').trim();

test('⚠️ no English is written straight into a screen — it all goes through the dictionary', () => {
  const found = [];

  for (const file of jsFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      const where = file.split(/[\\/]/).slice(-2).join('/');
      for (const m of line.matchAll(LITERAL)) {
        const phrase = m[1];
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  '${phrase}'`);
      }
      for (const m of line.matchAll(TEMPLATE)) {
        const phrase = prose(m[1]);
        if (!/[A-Z][a-z]/.test(phrase)) continue;      // nothing but values and symbols
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  \`${phrase}\``);
      }
    });
  }

  assert.deepEqual(found, [],
    'these are shown to a person and never translated — put them in js/i18n.js, in BOTH '
    + 'languages, and pass them through t(). A literal here is a screen that stays English '
    + 'on an Italian phone, and no other i18n test in this project looks for it.');
});

// ⚠️ THE SCAN MUST BE PROVED TO FIND ANYTHING AT ALL. A regex that quietly matches
// nothing — a renamed prop, a reformatted call — passes for ever and guards nothing. It
// is the same trap as a mutation that comes back green.
test('the scan actually finds this shape when it is there', () => {
  const sample = `el('h3', { class: 'x', text: 'Alerts' })`;
  const hits = [...sample.matchAll(LITERAL)].map(m => m[1]);
  assert.deepEqual(hits, ['Alerts']);
});

test('…and leaves a data word alone', () => {
  const sample = `el('span', { text: 'Monday' })`;
  const hits = [...sample.matchAll(LITERAL)].map(m => m[1]).filter(p => !SAFE.has(p.toLowerCase()));
  assert.deepEqual(hits, [], 'Monday is a document id, not a phrase');
});

// ⚠️ And it must be looking at real files, or "nothing found" means "nothing read".
test('the scan reads the app, not an empty folder', () => {
  const files = jsFiles(ROOT);
  assert.ok(files.length > 40, `only ${files.length} files scanned — the walk is broken`);
  assert.ok(files.some(f => f.endsWith('management.js')), 'the Settings screen must be in scope');
});
