// Every phrase the app ASKS for must be a phrase the dictionary HOLDS.
//
// ⚠️⚠️ THIS IS THE CHECK THAT WAS MISSING, AND IT HAS COST THIS PROJECT THREE
// TIMES IN THREE DAYS. The class is always the same and always silent:
//
//   • 16 replacements were lost when a `git checkout --` during mutation testing
//     took uncommitted work with it. Invisible, because the ENGLISH was
//     unchanged — the screens still read correctly in English and only Italian
//     was missing, which nobody was looking at.
//   • The New customer screen printed «section.calculator» in both languages: the
//     keys were correct and nothing looked them up.
//   • Three spacing tokens were used by twenty CSS declarations and defined
//     nowhere, so the browser dropped all twenty in silence.
//
// A missing key does not throw. translate() returns the key itself, deliberately
// and correctly — a screen showing «people.title» is louder than a blank one. But
// nothing was ASKING, so the loudness only reached whoever happened to open the
// screen, and for the admin screens that was nobody for a day.
//
// ⚠️ IT CHECKS THE ENGLISH DICTIONARY ONLY, on purpose. English is the fallback,
// so a key absent from Italian still shows a real phrase (tests/i18n.test.mjs
// pins that, and separately pins that the two dictionaries match). A key absent
// from English shows nothing but itself, in every language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _dictionaries, DEFAULT_LANGUAGE } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN = _dictionaries()[DEFAULT_LANGUAGE];

// ⚠️ NOT `\bt\(`: `.test(` would slip through a naive word boundary in some
// engines, and `t` is also a common local variable. Anchored on what a call
// actually looks like — start of line, or after a character that cannot be part
// of an identifier — and only ever with a LITERAL first argument.
const CALL = /(^|[^A-Za-z0-9_$.])t\(\s*(?:'([^'\\]+)'|`([^`$\\]+)`)/gm;

// A key built at run time — `role.${choice}` — cannot be checked from here, and
// the tables that hold those keys are checked by the screens' own tests.
function keysAskedIn(src) {
  const found = new Set();
  for (const m of src.matchAll(CALL)) found.add(m[2] || m[3]);
  return found;
}

// The markup asks for phrases too, through i18n-dom.js.
const ATTR = /data-i18n\s*=\s*"([^"]+)"/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(js|html)$/.test(name)) out.push(full);
  }
  return out;
}

test('every phrase the code asks for is one the dictionary holds', () => {
  const missing = [];
  for (const file of walk(join(ROOT, 'js')).concat(
    readdirSync(ROOT).filter(n => n.endsWith('.html')).map(n => join(ROOT, n)))) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    // js/i18n.js is the dictionary itself; its own examples are not call sites.
    if (rel === 'js/i18n.js') continue;

    for (const key of keysAskedIn(src)) {
      if (!(key in KNOWN)) missing.push(`${rel} asks for “${key}”`);
    }
    for (const m of src.matchAll(ATTR)) {
      if (!(m[1] in KNOWN)) missing.push(`${rel} marks up “${m[1]}”`);
    }
  }
  assert.deepEqual(missing, [],
    'these would show their own key on screen — the phrase is missing, or the key is a typo');
});

// ⚠️ AND THE CHECK ABOVE IS WORTHLESS IF IT MATCHES NOTHING. A regex that
// silently stops finding call sites — one refactor away — would report a clean
// app for ever. This is the same lesson as the probe that was constant-folded
// away and measured nothing: prove the instrument works before trusting it.
test('the scan actually finds the app’s phrases', () => {
  const people = readFileSync(join(ROOT, 'js/staff/people.js'), 'utf8');
  const asked = keysAskedIn(people);
  assert.ok(asked.size > 15, `only found ${asked.size} phrases in people.js`);
  assert.ok(asked.has('people.title'), 'the screen title is asked for by name');
  // A real dynamic key must NOT be mistaken for a literal one.
  assert.ok(![...asked].some(k => k.includes('${')), 'a template hole is not a key');
});
