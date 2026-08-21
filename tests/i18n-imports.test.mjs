// A file that ASKS for a phrase must be able to ask. `t` has to be imported.
//
// ⚠️⚠️ THIS SHIPPED. `js/whats-new-boot.js` was translated in v1.57.0 and the import
// was never added, so line 133 threw `ReferenceError: t is not defined` the moment a
// notice was due. Nobody saw a thing:
//
//   · the throw happens INSIDE an async run() that nothing awaits, so it is an
//     unhandled rejection — a console line, and no screen changes;
//   · the release id is written one line EARLIER, so the note was marked as read and
//     then lost for ever rather than merely delayed;
//   · every other i18n suite stayed green. `i18n-keys-exist` even READ that exact
//     line, confirmed both keys were in the dictionary, and passed — it was asking
//     whether the phrase existed, never whether the file could reach it.
//
// ⚠️ AND THE FIRST VERSION OF THIS CHECK REPORTED «none» ABOUT THE FILE IT WAS
// LOOKING AT. It blanked strings with a regex, and an apostrophe inside a trailing
// comment («the app's start_url») opened a string that swallowed the rest of the
// file — the same corruption as the `\d` eaten by a template literal in v1.55.0.
// A regex cannot find the end of a string in JavaScript. The scanner below walks the
// characters, and the two tests underneath prove it works before it is believed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Replace every comment and every string BODY with spaces, keeping the file's shape
// (and its line numbers) so a match can still be reported at a useful place.
function stripCommentsAndStrings(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += ' '; i++; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += c; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

// A call to `t`, never a property (`x.t(`), never part of a longer name (`.test(`).
const CALL = /(?:^|[^A-Za-z0-9_$.])t\s*\(/gm;
// Some files legitimately define their own local `t` instead.
const LOCAL = /(?:function|const|let|var)\s+t\s*[=(]/;

// ⚠️ READ THE BRACES, DO NOT PATTERN-MATCH THEM. The first attempt tried to spot `t`
// inside the braces with one expression and matched almost every file in the app —
// which is how it came to report 40 healthy files as broken. Splitting the named
// imports and comparing each one exactly leaves nothing to get subtly wrong.
function importsT(code) {
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    const named = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    if (named.includes('t')) return true;
  }
  return false;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function unreachableCallsIn(src) {
  const code = stripCommentsAndStrings(src);
  const calls = [...code.matchAll(CALL)];
  if (!calls.length) return [];
  if (importsT(code) || LOCAL.test(code)) return [];
  return calls.map(m => code.slice(0, m.index).split('\n').length);
}

test('every file that calls t() can actually reach it', () => {
  const broken = [];
  for (const file of walk(join(ROOT, 'js'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (rel === 'js/i18n.js') continue;          // it IS t
    const lines = unreachableCallsIn(readFileSync(file, 'utf8'));
    if (lines.length) broken.push(`${rel} line ${lines.join(', ')}`);
  }
  assert.deepEqual(broken, [],
    'these throw ReferenceError the moment the line runs, and an async one throws in '
    + 'silence — no screen changes and nothing says why');
});

// ⚠️ A CHECK THAT MATCHES NOTHING REPORTS A CLEAN APP FOR EVER. Both directions are
// proved here, because this instrument has already been wrong once in each of them.
test('the scanner finds a real call, and a real import', () => {
  const withImport = "import { t } from './i18n.js';\nconst a = t('x.y');\n";
  assert.deepEqual(unreachableCallsIn(withImport), [], 'an imported t is fine');

  const without = "import { alertDialog } from './confirm-dialog.js';\nconst a = t('x.y');\n";
  assert.deepEqual(unreachableCallsIn(without), [2], 'a missing import must be found, with its line');
});

test('the scanner is not fooled by prose, properties, or longer names', () => {
  // ⚠️ THE APOSTROPHE CASE IS THE ONE THAT BROKE THE FIRST VERSION. Left unhandled it
  // does not produce a false alarm — it produces SILENCE, which is far worse.
  const prose = "// the installed app's start_url is read at install time\nconst a = t('x.y');\n";
  assert.deepEqual(unreachableCallsIn(prose), [2],
    'an apostrophe in a comment must not swallow the code that follows it');

  assert.deepEqual(unreachableCallsIn("const s = \"call t('x') like this\";\n"), [],
    'a call quoted inside a string is not a call');
  assert.deepEqual(unreachableCallsIn('const r = /x/.test(s);\n'), [],
    '.test( is not a call to t');
  assert.deepEqual(unreachableCallsIn('obj.t(1);\n'), [],
    'a property named t is not this t');
  assert.deepEqual(unreachableCallsIn('function t(k) { return k; }\nconst a = t("x");\n'), [],
    'a file that defines its own t is fine');
});

// ⚠️ The file this whole suite exists for. Pinned by name so that deleting the import
// again fails a test that SAYS what happened, rather than one that merely goes red.
test('js/whats-new-boot.js imports t — it is the file this check was written for', () => {
  const src = readFileSync(join(ROOT, 'js/whats-new-boot.js'), 'utf8');
  assert.match(src, /import\s*\{\s*t\s*\}\s*from\s*'\.\/i18n\.js'/,
    'without it the What’s new notice throws, marks the release as read, and is lost');
});
