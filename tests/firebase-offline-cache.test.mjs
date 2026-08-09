// The offline cache is configured in exactly one place and depends on an ordering
// rule the SDK enforces at RUNTIME, in the browser, with no test able to see it:
// Firestore settles its settings the first time anything asks for it. Whoever gets
// there first wins — initializeFirestore() after a getFirestore() throws, and a
// getFirestore() that runs first quietly creates the memory-only client and keeps
// it. The app would still work. It would simply be back to losing offline writes,
// with nothing to show for it.
//
// So these are source checks, not behaviour checks. They cannot run the SDK (it is
// fetched from gstatic by a browser), but they can pin the two facts the ordering
// rests on: firebase.js configures the cache, and every other file that asks for a
// Firestore instance imports firebase.js first — an ES module's imports run before
// its own body, which is what makes firebase.js always win the race.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'js');

const read = (abs) => readFileSync(abs, 'utf8');
const asPosix = (abs) => relative(ROOT, abs).split(sep).join('/');

function everyJsFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return everyJsFile(abs);
    return entry.endsWith('.js') ? [abs] : [];
  });
}

// The two files allowed to configure Firestore themselves: the real one, and the
// template that has to teach the same thing (P7 — the .example stays in sync).
const CONFIGURES_FIRESTORE = ['js/firebase.js', 'js/firebase.example.js'];

test('firebase.js turns the offline cache on, sharing it between tabs', () => {
  for (const file of CONFIGURES_FIRESTORE) {
    const source = read(join(ROOT, file));
    assert.match(source, /initializeFirestore\(/,
      `${file} must configure Firestore with initializeFirestore(), not getFirestore()`);
    assert.match(source, /persistentLocalCache\(/,
      `${file} lost persistentLocalCache — offline writes would go back to being lost on reload`);
    assert.match(source, /persistentMultipleTabManager\(/,
      `${file} lost persistentMultipleTabManager — a second tab would get no cache at all`);
  }
});

test('nothing else in the app configures Firestore', () => {
  const offenders = everyJsFile(JS)
    .filter((abs) => !CONFIGURES_FIRESTORE.includes(asPosix(abs)))
    .filter((abs) => /initializeFirestore\(/.test(read(abs)))
    .map(asPosix);

  assert.deepEqual(offenders, [],
    'Firestore settings are settled by whoever asks first, so a second initializeFirestore() ' +
    'either throws or silently loses to firebase.js. Import db from the feature data layer instead.');
});

test('every file that asks for a Firestore instance imports firebase.js first', () => {
  // An ES module's imports are evaluated before its own body, so importing
  // firebase.js — at any position, for anything — guarantees the cache is
  // configured before this file's getFirestore() runs.
  const offenders = everyJsFile(JS)
    .filter((abs) => !CONFIGURES_FIRESTORE.includes(asPosix(abs)))
    .filter((abs) => /getFirestore\(/.test(read(abs)))
    .filter((abs) => !/from '\.\.?\/firebase\.js'/.test(read(abs)))
    .map(asPosix);

  assert.deepEqual(offenders, [],
    'These call getFirestore() without importing js/firebase.js, so they can run FIRST and ' +
    'create the memory-only client. Add `import { firebaseConfig } from \'../firebase.js\';`.');
});
