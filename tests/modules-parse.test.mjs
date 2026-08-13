// Every module in the app must actually parse.
//
// ⚠️⚠️ THIS EXISTS BECAUSE 1247 TESTS STAYED GREEN WHILE A SCREEN WAS BROKEN.
// The extraction pass of 13 Aug 2026 added `import { t } from '../i18n.js'` to
// js/pastries/pastries-day.js twice, which is a SyntaxError — the module never
// loaded and the Pastries day was simply not drawn.
//
// Nothing caught it: no unit test imports that file (it is DOM code), the page
// still rendered its header, and a browser reports the failure only in the
// console. It was found by driving the app and READING what the console said —
// which is not something that happens on every push.
//
// A parse is cheap and it is the floor under everything else: a file that cannot
// be read cannot be wrong in any interesting way, because it never runs at all.
//
// ⚠️ IT IMPORTS RATHER THAN PARSING BY HAND. A hand-written check for "the same
// import twice" would have caught this one case and nothing else; the engine
// catches every syntax error there is, including the next one nobody predicted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ⚠️ MOST OF THESE FILES CANNOT BE IMPORTED UNDER NODE: they touch `document`,
// or they pull the Firebase SDK from gstatic over the network. So the check is a
// PARSE, not a load — new Function(...) with the module goal is not available, so
// the next best thing that is both cheap and total is the compiler itself, via
// dynamic import of a data: URL that only re-exports nothing.
//
// In practice the simplest reliable form is to hand the source to the parser
// through `import()` of the real file and accept that a runtime error (a missing
// `document`) is NOT a parse failure. A SyntaxError is; anything else is not.
function isSyntaxError(err) {
  return err instanceof SyntaxError
    || (err && typeof err.message === 'string'
      && /has already been declared|Unexpected token|Identifier .* has already|Missing|Invalid or unexpected/
        .test(err.message) && err.name === 'SyntaxError');
}

const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (name.endsWith('.js')) files.push(full);
  }
};
walk(join(ROOT, 'js'));

test('every module parses', async () => {
  const broken = [];
  for (const full of files) {
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
    try {
      await import(pathToFileURL(full).href);
    } catch (err) {
      if (isSyntaxError(err)) broken.push(`${rel}: ${err.message}`);
      // Anything else — a missing `document`, a network import — is this file
      // needing a browser, not this file being malformed.
    }
  }
  assert.deepEqual(broken, [], 'these files cannot be read by the engine at all');
});

// The specific shape that caused it, named so a reader knows what to look for.
test('no module imports the same binding twice', () => {
  const offenders = [];
  for (const full of files) {
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
    const seen = new Set();
    for (const m of readFileSync(full, 'utf8').matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (!name) continue;
        if (seen.has(name)) offenders.push(`${rel}: ${name} imported twice`);
        seen.add(name);
      }
    }
  }
  assert.deepEqual(offenders, [], 'a duplicate import is a SyntaxError — the module never loads');
});
