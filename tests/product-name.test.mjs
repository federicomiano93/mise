// Source-level checks (P15) for a rule no behaviour test can reach: the app is a
// PRODUCT sold to several businesses, and no venue's name may be written into it.
//
// ⚠️ THE DEFECT THIS EXISTS TO STOP IS NOT COSMETIC. Two places send text to a
// CUSTOMER'S OWN CUSTOMER — the WhatsApp sentence that hands a wholesale client
// their ordering link, and the client's ordering page itself. A venue name
// hardcoded in either tells one bakery's client they are ordering from a
// different bakery. It was "The Italian Club" for everybody, which was correct
// while there was exactly one venue and became a defect the moment there were two.
//
// These are read as TEXT because the alternative is a browser: both sites build
// their sentence from a live session or a fetched document, and a unit test that
// could see them would have to stand up half the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Strip line comments before looking: this file's whole point is what the CODE
// says, and the history of why is written in prose all over the repo.
const code = p => read(p).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── The two that reach a customer's customer ─────────────────────────────────

test('the ordering-link message names no venue', () => {
  const src = code('js/calculator-settings.js');
  assert.ok(!src.includes('The Italian Club'),
    'a venue name in this file is sent to somebody else’s wholesale client');
  assert.ok(src.includes('currentSession().name'),
    'the sentence must take the name from the open location');
});

test('the client ordering page names no venue', () => {
  const src = code('js/client-orders/order-main.js');
  assert.ok(!src.includes('The Italian Club'), 'hardcoded venue name');
  // ⚠️ The fallback must be NAMELESS. A real venue's name as a default is the
  // same defect wearing a different hat: specific, and false for everybody else.
  assert.ok(src.includes("FALLBACK_NAME = 'your supplier'"),
    'the fallback must be vague and true, not specific and wrong');
});

// ── The product name, where it belongs ───────────────────────────────────────

test('the installed app is called Misé', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'Misé');
  assert.equal(manifest.short_name, 'Misé');
});

// ⚠️ Nobody is signed in on this screen, so the app cannot know whose venue it
// is. A venue name here told every other customer's staff they were signing in
// to somebody else's business.
test('the sign-in screen shows the product, not a venue', () => {
  const src = code('js/auth-gate.js');
  assert.ok(src.includes("'auth-title', 'Misé'"));
  assert.ok(!src.includes('The Italian Club'));
});

test('no page still carries a venue name in its title or install name', () => {
  // ⚠️ DERIVED, NOT LISTED. The list was written out by hand, so a page added later
  // was never checked at all — which is exactly what suppliers.html did to it.
  const pages = [...readdirSync(ROOT).filter((n) => n.endsWith('.html')), 'manifest.json'];
  assert.ok(pages.length >= 9, `only found ${pages.length} files — the scan is not finding them`);
  for (const page of pages) {
    assert.ok(!read(page).includes('The Italian Club'), page);
  }
});

// ⚠️ BOTH COPIES OR NEITHER. functions/push-model.js is a byte-for-byte copy of
// js/push-model.js (pinned by tests/copie-allineate.test.mjs) and they run in
// DIFFERENT PLACES, so no amount of using the app reveals that they have parted.
test('both copies of the push fallback say the same thing', () => {
  for (const p of ['js/push-model.js', 'functions/push-model.js']) {
    assert.ok(code(p).includes("|| 'Misé'"), p);
  }
});
