// ⚠️⚠️ A PHRASE RESOLVED AT MODULE LOAD IS FROZEN IN THE LANGUAGE THE APP STARTED IN.
//
// This is the project's i18n rule 2, and on 21 Aug 2026 it turned out to be broken in
// FOURTEEN module constants at once — which is why the Calculator's empty state, the
// Food Cost traffic light, the price units, the help screens and the release notes all
// stayed English on a phone set to Italian.
//
// WHY IT IS INVISIBLE TO EVERYTHING ELSE:
//   · the dictionary is complete — tests/i18n.test.mjs is green
//   · the keys all exist — tests/i18n-keys-exist.test.mjs is green
//   · no English is hard-coded — tests/no-hardcoded-english.test.mjs is green
//   · the screen still renders, and reads perfectly well… in English
//
// The cause is WHEN, not WHAT. A module is evaluated once, the first time it is
// imported. That happens before any venue is open — and the interface language comes
// from the venue (`locations/{lid}.language`), so at that moment the app can only be
// speaking the default. Anything t()'d there keeps that answer for the life of the
// page, however the venue is set.
//
// THE FIX IS ALWAYS THE SAME: the constant carries KEYS, and the lookup moves to the
// function that draws. See js/calculator-render.js for the worked example.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// ⚠️ THE FIRST VERSION OF THIS SCAN ASKED THE WRONG QUESTION and is worth recording:
// it looked for t( at brace depth 0. An object literal opens a brace, so
// `const X = { a: t('k') }` sits at depth 1 and was indistinguishable from code inside
// a function. It reported 295 hits, almost all false — and MISSED every real one.
//
// The right question is about the DECLARATION: a top-level const/let/var whose value
// calls t() with no function in between runs when the module is evaluated.
function frozenDeclarations(src) {
  const lines = src.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(export\s+)?(const|let|var)\s+[A-Za-z_$]/.test(lines[i])) continue;
    let depth = 0, body = '', j = i;
    do {
      body += lines[j] + '\n';
      for (const ch of lines[j]) {
        if ('{(['.includes(ch)) depth++;
        else if ('})]'.includes(ch)) depth--;
      }
      j++;
    } while (j < lines.length && depth > 0 && j - i < 80);

    if (!/(^|[^A-Za-z0-9_$.])t\(/.test(body)) continue;
    // A function anywhere in the declaration means the t() runs when it is CALLED,
    // which is exactly what we want.
    if (/=>|function\b/.test(body)) continue;
    hits.push({ line: i + 1, name: (lines[i].match(/(const|let|var)\s+([A-Za-z_$][\w$]*)/) || [])[2] });
    i = j - 1;
  }
  return hits;
}

// The one accepted exception, with its reason. It may only ever shrink.
const ALLOWED = new Map([
  ['orders/no-supplier.js:NO_SUPPLIER',
    'handed to code that expects a real supplier document, which carries a plain '
    + '`name` string. Screens use noSupplier(), which rebuilds it in today\'s language; '
    + 'the constant stays for the id, the shape and the tests.'],
]);

test('⚠️ no phrase is resolved at module load, where it would freeze in one language', () => {
  const offenders = [];
  for (const file of jsFiles(JS)) {
    const where = file.split(/[\\/]/).slice(-2).join('/');
    for (const hit of frozenDeclarations(readFileSync(file, 'utf8'))) {
      if (ALLOWED.has(`${where}:${hit.name}`)) continue;
      offenders.push(`${where}:${hit.line}  ${hit.name}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these hold phrases resolved when the module loads — before any venue is open, so '
    + 'before the language is known. They will read in the app\'s STARTING language for '
    + 'ever, whatever the venue is set to. Store the KEY and call t() at draw time:\n  '
    + offenders.join('\n  '));
});

test('the scan finds the shape when it is there', () => {
  // ⚠️ A scan that quietly matches nothing passes for ever and guards nothing.
  const bad = `const LABELS = {\n  a: t('one'),\n  b: t('two'),\n};\n`;
  assert.equal(frozenDeclarations(bad).length, 1, 'a frozen table must be found');
  assert.equal(frozenDeclarations(bad)[0].name, 'LABELS');
});

test('…and leaves the correct shapes alone', () => {
  const viaFunction = `const label = (x) => t(x);\n`;
  const insideFunction = `function draw() {\n  return t('one');\n}\n`;
  const keysOnly = `const LABELS = {\n  a: 'one',\n  b: 'two',\n};\n`;
  for (const [name, src] of [['arrow', viaFunction], ['function', insideFunction], ['keys', keysOnly]]) {
    assert.deepEqual(frozenDeclarations(src), [], `${name} must not be reported`);
  }
});

test('the scan reads the app, not an empty folder', () => {
  const files = jsFiles(JS);
  assert.ok(files.length > 40, `only ${files.length} files scanned — the walk is broken`);
  assert.ok(files.some(f => f.endsWith('calculator-render.js')), 'the worked example must be in scope');
});
