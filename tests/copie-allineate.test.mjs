// The sentinel over the files that exist in more than one copy.
//
// The project rule "a feature folder never imports from another feature's folder"
// (CLAUDE.md, "Modular by feature") is deliberate: it keeps each feature liftable
// into its own app. The price is duplicated files, and until now nothing noticed
// when one copy drifted — a fix to confirm-dialog.js applied to three folders out
// of four passed CI without a word. That is what this file exists to stop.
//
// Two things are pinned:
//   1. the four confirm-dialog.js copies are the same file, full stop;
//   2. the three dom.js copies are ALREADY different, on purpose, so their current
//      difference is photographed and only a NEW difference fails.
//
// ⚠️ Line endings are normalised to LF before anything is compared. This repo is
// edited on Windows with core.autocrlf=true, so the working tree holds CRLF while
// GitHub's Linux runner checks the same commit out with LF. Comparing raw bytes
// would make these tests pass on one machine and fail on the other — a false
// alarm that teaches people to ignore the sentinel, which is worse than no
// sentinel at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// The first line where two texts part company, for a message that says WHERE
// rather than dumping two whole files at the reader.
function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return { line: i + 1, expected: left[i] ?? '(end of file)', actual: right[i] ?? '(end of file)' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. confirm-dialog.js — four copies, one file
// ---------------------------------------------------------------------------

// THE styled confirm/alert dialog (CLAUDE.md, "Confirmations: ONE dialog"). It is
// copied rather than imported so a feature stays extractable; the four copies must
// stay identical, because a fix to the focus trap or the z-index that reaches only
// some of them leaves the others quietly broken.
const REFERENCE_DIALOG = 'js/confirm-dialog.js';
const DIALOG_COPIES = [
  'js/orders/confirm-dialog.js',
  'js/catalogue/confirm-dialog.js',
  'js/pastries/confirm-dialog.js',
];

test('the four copies of confirm-dialog.js are the same file', () => {
  const reference = read(REFERENCE_DIALOG);

  for (const copy of DIALOG_COPIES) {
    const text = read(copy);
    const diff = firstDifference(reference, text);
    assert.equal(
      diff,
      null,
      diff &&
        `${copy} has drifted from ${REFERENCE_DIALOG} at line ${diff.line}.\n` +
          `  ${REFERENCE_DIALOG}: ${diff.expected}\n` +
          `  ${copy}: ${diff.actual}\n` +
          'Apply the change to ALL FOUR copies: js/, js/orders/, js/catalogue/, js/pastries/.',
    );
  }
});

// ---------------------------------------------------------------------------
// 2. dom.js — three copies, already different on purpose
// ---------------------------------------------------------------------------

// These three were never identical, so demanding equality would fail on day one
// and be deleted by the next person. Instead each copy's content is photographed
// here with the reason it differs. A change to any of them fails this test and
// forces the question the duplication makes easy to skip: does the SAME change
// belong in the other two?
const DOM_SNAPSHOT = [
  {
    file: 'js/orders/dom.js',
    sha256: '99c731d8aa890a208905528ecf85055b2d3c437f41a1d425933ee227b192a46f',
    // The original. Alone in carrying groupBy(): only Orders groups rows by a key
    // (ingredients by category). Its header names the Orders system.
    why: 'the original — the only copy with groupBy()',
  },
  {
    file: 'js/catalogue/dom.js',
    sha256: 'ccb295509b508828f6869c1dff96e2bc8c29756358117385501e73401faf66d4',
    // Copied from Orders WITHOUT groupBy (the catalogue never groups anything, and
    // an unused export is one more thing to keep in sync for nothing), plus its own
    // header explaining why the file is copied instead of imported. One comment
    // line is wrapped differently — cosmetic, and not worth a commit to align.
    why: 'no groupBy(), own header, one comment line wrapped differently',
  },
  {
    file: 'js/pastries/dom.js',
    sha256: '247525e429f4ec4a66247fe88ac86c6c8a6fb3c7141069d092688aadc2f92ca0',
    // Copied from the catalogue's copy: same absence of groupBy, same wrapping, and
    // a header naming Pastries and the copy it came from.
    why: 'the catalogue copy with a Pastries header',
  },
];

test('the three copies of dom.js differ only as photographed', () => {
  for (const { file, sha256: expected, why } of DOM_SNAPSHOT) {
    assert.equal(
      sha256(read(file)),
      expected,
      `${file} has changed. It is one of three copies of dom.js, photographed here as: ${why}.\n` +
        'If the change is intended, ask FIRST whether the other two copies need it too ' +
        '(js/orders/dom.js, js/catalogue/dom.js, js/pastries/dom.js), then update the hash above.',
    );
  }
});

// The snapshot above catches "a copy changed", but not the failure it exists for:
// fixing el() in two copies out of three updates two hashes and leaves the third
// behind, looking deliberate. el() is the code all three actually share, so it is
// compared directly.
function elFunction(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith('export function el('));
  assert.notEqual(start, -1, 'el() not found — this test needs updating, not deleting');
  const end = lines.indexOf('}', start);
  assert.notEqual(end, -1, 'el() has no closing brace at column 0 — this test needs updating');
  return lines.slice(start, end + 1).join('\n');
}

test('el() is the same code in all three copies of dom.js', () => {
  const [reference, ...rest] = DOM_SNAPSHOT.map(({ file }) => ({ file, el: elFunction(read(file)) }));

  for (const copy of rest) {
    const diff = firstDifference(reference.el, copy.el);
    assert.equal(
      diff,
      null,
      diff &&
        `el() in ${copy.file} no longer matches el() in ${reference.file} (line ${diff.line} of the function).\n` +
          `  ${reference.file}: ${diff.expected}\n` +
          `  ${copy.file}: ${diff.actual}\n` +
          'The headers and groupBy() are allowed to differ; el() is not.',
    );
  }
});
