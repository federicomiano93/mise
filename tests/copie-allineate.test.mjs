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
// copied rather than imported so a feature stays extractable; the six copies must
// stay identical, because a fix to the focus trap or the z-index that reaches only
// some of them leaves the others quietly broken.
const REFERENCE_DIALOG = 'js/confirm-dialog.js';
const DIALOG_COPIES = [
  'js/orders/confirm-dialog.js',
  'js/catalogue/confirm-dialog.js',
  'js/pastries/confirm-dialog.js',
  'js/foodcost/confirm-dialog.js',
  'js/client-orders/confirm-dialog.js',
];

test('the six copies of confirm-dialog.js are the same file', () => {
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
          'Apply the change to ALL SIX copies: js/, js/orders/, js/catalogue/, ' +
          'js/pastries/, js/foodcost/, js/client-orders/.',
    );
  }
});

// ---------------------------------------------------------------------------
// 1b. push-model.js — two copies, and the only one that crosses the machine
// ---------------------------------------------------------------------------

// The app SCHEDULES an alarm and the server SENDS it, and both have to agree
// about whether it is still wanted. That agreement is a judgement, not a fact —
// cancelled, too early, too late — so two copies drifting means the phone
// believes it cancelled something the server still believes in, and somebody's
// pocket buzzes for a step finished ten minutes ago.
//
// ⚠️ IT CANNOT SIMPLY BE IMPORTED ACROSS. A Firebase functions deploy uploads only
// the functions/ folder, so `../js/push-model.js` resolves on this machine and is
// missing in the cloud — a failure that appears at deploy time, not here.
//
// ⚠️ AND THIS IS THE MOST DANGEROUS DUPLICATE IN THE PROJECT, because unlike
// confirm-dialog.js the two halves run in different places: nothing on a phone
// ever loads the server's copy, so no amount of driving the app can reveal that
// they have parted. This test is the only thing that can.
test('the server and the app share ONE push model, byte for byte', () => {
  const reference = read('js/push-model.js');
  const copy = read('functions/push-model.js');
  const diff = firstDifference(reference, copy);
  assert.equal(
    diff,
    null,
    diff &&
      `functions/push-model.js has drifted from js/push-model.js at line ${diff.line}.\n` +
        `  js/push-model.js:        ${diff.expected}\n` +
        `  functions/push-model.js: ${diff.actual}\n` +
        'Copy the file across. The phone decides when to SCHEDULE an alarm and the ' +
        'server decides whether to SEND it — if they disagree, a phone buzzes for a ' +
        'step that was finished, or stays silent for one that was not.',
  );
});

// ---------------------------------------------------------------------------
// 2. dom.js — five copies, already different on purpose
// ---------------------------------------------------------------------------

// These were never identical, so demanding equality would fail on day one
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
  {
    file: 'js/foodcost/dom.js',
    sha256: '02aea52bb04819e85b52b8b602b79244d65fa74e5252c0d3e1e7b629c9fa2fd7',
    // Copied from the catalogue's copy, like the Pastries one: same absence of
    // groupBy, same wrapping, and a header naming Food Cost and where it came from.
    why: 'the catalogue copy with a Food Cost header',
  },
  {
    file: 'js/client-orders/dom.js',
    sha256: '8a8fcbe6f293e135ef90422a7a19574b9fc67589e2d58f17ded99e52838716f1',
    // Copied from the catalogue's copy like the two above, with a header naming the
    // client ordering page and saying why the copy matters more there than anywhere
    // else: that folder is the only code served to people outside the business, and
    // importing nothing from the rest is what keeps "what can a client's page reach?"
    // answerable by reading four files.
    why: 'the catalogue copy with a client-ordering header',
  },
];

test('the five copies of dom.js differ only as photographed', () => {
  for (const { file, sha256: expected, why } of DOM_SNAPSHOT) {
    assert.equal(
      sha256(read(file)),
      expected,
      `${file} has changed. It is one of four copies of dom.js, photographed here as: ${why}.\n` +
        'If the change is intended, ask FIRST whether the other three copies need it too ' +
        '(js/orders/dom.js, js/catalogue/dom.js, js/pastries/dom.js, js/foodcost/dom.js), ' +
        'then update the hash above.',
    );
  }
});

// The snapshot above catches "a copy changed", but not the failure it exists for:
// fixing el() in four copies out of five updates four hashes and leaves the last
// behind, looking deliberate. el() is the code all five actually share, so it is
// compared directly.
function elFunction(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith('export function el('));
  assert.notEqual(start, -1, 'el() not found — this test needs updating, not deleting');
  const end = lines.indexOf('}', start);
  assert.notEqual(end, -1, 'el() has no closing brace at column 0 — this test needs updating');
  return lines.slice(start, end + 1).join('\n');
}

test('el() is the same code in all five copies of dom.js', () => {
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
