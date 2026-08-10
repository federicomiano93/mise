// Every screen explains itself, and keeps doing so.
//
// These are text tests, which sounds trivial and is not: an explanation is only worth
// having while it is short enough to be read and true enough to be trusted. The checks
// below hold the first of those; the second is a matter of writing, and the test that
// every page HAS one is what stops a new screen shipping without any.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HELP, SECTIONS, helpFor, helpText, helpTitle } from '../js/help-content.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// ⚠️ SHORT ENOUGH TO BE READ. A screen-by-screen manual is a thing nobody reads and
// nobody keeps up to date, and an out-of-date explanation is worse than none: it is
// believed. Three to five lines, and a line that reads like a paragraph is too long.
const MIN_LINES = 3;
const MAX_LINES = 5;
const MAX_LINE = 130;

test('every section has an explanation, and it is short', () => {
  assert.ok(SECTIONS.length >= 6, `expected the whole app to be covered, got ${SECTIONS.length}`);
  for (const id of SECTIONS) {
    const entry = helpFor(id);
    assert.ok(entry.title && entry.title.length <= 40, `${id}: bad title ${JSON.stringify(entry.title)}`);
    assert.ok(entry.lines.length >= MIN_LINES && entry.lines.length <= MAX_LINES,
      `${id}: ${entry.lines.length} lines — keep it between ${MIN_LINES} and ${MAX_LINES}`);
    entry.lines.forEach((line, i) => {
      assert.ok(line.trim().length > 0, `${id}: line ${i + 1} is empty`);
      assert.ok(line.length <= MAX_LINE, `${id}: line ${i + 1} is ${line.length} chars — over ${MAX_LINE}`);
      assert.equal(line, line.trim(), `${id}: line ${i + 1} has stray spaces at an end`);
    });
  }
});

test('an unknown screen asks for nothing rather than showing an empty box', () => {
  assert.equal(helpFor('nope'), null);
  assert.equal(helpText('nope'), '');
  assert.equal(helpTitle('nope'), '');
  assert.equal(helpFor(undefined), null);
  assert.equal(helpText(null), '');
});

test('the text arrives as paragraphs the dialog can show', () => {
  // .app-dialog-msg is `white-space: pre-line`, so blank lines survive with no markup.
  const text = helpText('calculator');
  assert.match(text, /\n\n/);
  assert.equal(text.includes('\n\n\n'), false, 'no empty paragraph');
  assert.equal(text, text.trim());
});

// ── The half that catches a NEW screen shipping with no explanation ───────────

// Every page of the app, found from disk rather than listed here: a list would be the
// thing somebody forgets to add to, which is exactly the failure this test is for.
function appPages() {
  return readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    // home.html is a redirect stub for old installed PWAs; install-guide.html is
    // itself an explanation; order.html is the CLIENT's page, which is one screen
    // long and explains itself by being that short.
    .filter(f => !['home.html', 'install-guide.html', 'order.html'].includes(f));
}

test('every page of the app carries a help button', () => {
  for (const page of appPages()) {
    const html = read(page);
    assert.match(html, /data-help="[a-z-]+"/,
      `${page} has no data-help host — every screen must be able to explain itself`);
    assert.match(html, /js\/help-button\.js/, `${page} does not load js/help-button.js`);
  }
});

test('every host names a screen that actually has text', () => {
  for (const page of appPages()) {
    for (const [, id] of read(page).matchAll(/data-help="([a-z-]+)"/g)) {
      assert.ok(helpFor(id), `${page} points at "${id}", which has no entry in help-content.js`);
    }
  }
});

test('the two files that must both know about a section agree', () => {
  // A section with text nobody can reach is as useless as a button with no text.
  const hosted = new Set();
  for (const page of appPages()) {
    for (const [, id] of read(page).matchAll(/data-help="([a-z-]+)"/g)) hosted.add(id);
  }
  const unreachable = SECTIONS.filter(id => !hosted.has(id));
  assert.deepEqual(unreachable, [],
    `written but reachable from no page: ${unreachable.join(', ')} — add a data-help host, or remove the text`);
});

test('the help is precached, or an offline phone loses it', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/help-content\.js'/);
  assert.match(sw, /'\.\/js\/help-button\.js'/);
});

test('nothing in the explanations names a real client or supplier', () => {
  // This repo is public. The texts describe the app, never the business.
  const all = Object.values(HELP).flatMap(e => [e.title, ...e.lines]).join(' ');
  assert.equal(/\b(club fish|bakery ltd|salvo|brakes|caterite|continental|bako|almonds)\b/i.test(all), false);
});
