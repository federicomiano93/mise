// The «Fornitori» screen — the supplier and ingredient records, lifted out from
// behind the Orders gear onto a page of their own.
//
// ⚠️⚠️ WHAT THESE GUARD IS THE ACCESS STORY, not the layout. The move looks like a
// navigation tidy-up and is not: the ingredient form behind this screen is where
// the fourteen allergens are declared, and it is the one screen in this app that
// can send somebody to hospital. Two things must stay true, and neither is visible
// by using the app:
//
//   1. NO NEW SECTION NAME. `suppliers` must never appear in js/sections.js
//      SECTIONS. A name added there defaults to ALLOWED for every location
//      document written before today — so inventing one would silently switch a
//      screen on for every existing venue AND let them write its collections.
//   2. NO ROLE GATE ON THE WAY IN. The records were open to everybody in the
//      location when they lived behind the gear, deliberately. v1.62.0 cost this
//      project exactly once already: a bar gated for one reason walled off
//      everything later put inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS } from '../js/sections.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// Comments are where this project explains itself, and they name the very words
// these tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = read('suppliers.html');
const REGISTRY = read('js/orders/registry.js');
const FORM = read('js/orders/ingredient-form.js');
const MGMT = read('js/orders/management.js');
const SW = read('sw.js');

// ── 1. The access story ──────────────────────────────────────────────────────

test('⚠️ the page rides the `orders` section — no new section name was invented', () => {
  assert.match(PAGE, /<body[^>]*\bdata-section="orders"/,
    'suppliers.html must declare data-section="orders": same collections, same gate');
  assert.ok(!SECTIONS.includes('suppliers'),
    'adding `suppliers` to SECTIONS would switch it ON for every venue that already '
    + 'exists — allowedSections defaults a missing key to allowed, and so do the rules');
});

test('⚠️ the Home card rides the same section, so the two cards live and die together', () => {
  const home = read('index.html');
  const card = home.match(/<a class="home-card" href="suppliers\.html"[^>]*>/);
  assert.ok(card, 'index.html must carry a card pointing at suppliers.html');
  assert.match(card[0], /data-section="orders"/,
    'a venue without Orders must lose this card with the Orders card, not keep an empty screen');
});

test('⚠️⚠️ nothing on the way IN reads a role — only Delete is gated, inside', () => {
  // The two doors, in the markup.
  for (const [name, src] of [['index.html', read('index.html')], ['orders.html', read('orders.html')]]) {
    const door = src.match(/<a[^>]*href="suppliers\.html"[^>]*>/);
    assert.ok(door, `${name} must carry a door to suppliers.html`);
    assert.doesNotMatch(door[0], /hidden/,
      `${name}: the door must not start hidden — the allergen form is behind it`);
  }
  // And the screen itself. It may ask canManageHere() nowhere: the ONE gate lives in
  // mgmtRow (Delete) and in the ingredient form (the price), and a second place to
  // ask is a second place to get it wrong.
  assert.doesNotMatch(codeOf(REGISTRY), /\bcanManageHere\b|\bisOwner\b|\bcanManage\b/,
    'registry.js must not gate anything itself');
});

test('the one Delete gate, and the one price gate, are still where they were', () => {
  assert.match(codeOf(read('js/orders/mgmt-ui.js')), /if\s*\(\s*canManageHere\(\)\s*\)/,
    'mgmtRow must still draw Delete only for a manager or owner');
  assert.match(codeOf(FORM), /const mayPrice = canManageHere\(\);/,
    'the ingredient form must still draw the price only for somebody who may see money');
  assert.match(codeOf(FORM), /mayPrice \? priceBlock\(/,
    'an employee gets NO price block at all — not a disabled one');
});

// ── 2. The safety rule the whole allergen feature rests on ───────────────────

test('⚠️⚠️ the form still never writes the verification stamp', () => {
  // ⚠️ THE CODE, NOT THE FILE. The phrase appears in this file's comments saying it
  // is never written, and a naive grep over the whole source came back red for
  // exactly that reason on 22 Aug — the check was wrong, not the code.
  const code = codeOf(FORM);
  assert.doesNotMatch(code, /allergensCheckedAt/,
    'nothing in the ingredient form may set the stamp: a suggestion must stay inert '
    + 'until a person ticks «I have checked this»');
  assert.match(code, /checked\.checked \? \(checkedAt\(item\) \|\| new Date\(\)/,
    'the stamp comes from the tick box, and an existing one is kept rather than moved');
});

test('the pack reader still only ever ADDS a tick', () => {
  const code = codeOf(FORM);
  assert.match(code, /!pair\.contains\.checked\)\s*\{\s*pair\.contains\.checked = true/,
    'a box already ticked by a person must never be untouched by the matcher');
  assert.doesNotMatch(code, /\.checked = false/,
    'nothing in this form may UNtick an allergen box');
});

// ── 3. The move actually happened, and left nothing behind ───────────────────

test('the settings panel kept the settings and gave up the records', () => {
  const code = codeOf(MGMT);
  for (const gone of ['supplierForm', 'ingredientForm', 'renderSearchableList', 'allergenBlock', 'priceBlock']) {
    assert.doesNotMatch(code, new RegExp(`\\b${gone}\\b`),
      `${gone} moved out of management.js — a second copy is a second thing to fix`);
  }
  assert.doesNotMatch(code, /tabBar|tabButton/,
    'with the two lists gone, a tab bar of one tab is a control that appears to do nothing');
  // …and it kept what it is for.
  for (const kept of ['buildStockToggle', 'buildWeekStart', 'buildSendRoutes', 'buildHistoryDaysField']) {
    assert.match(code, new RegExp(`\\b${kept}\\b`), `${kept} is a real setting and stays`);
  }
});

test('each moved piece has exactly one home, and one importer', () => {
  const importers = (needle) => ['js/orders/registry.js', 'js/orders/registry-main.js',
    'js/orders/management.js', 'js/orders/orders-main.js', 'js/orders/ingredient-form.js']
    .filter(f => new RegExp(`from '\\./${needle}'`).test(read(f)));
  assert.deepEqual(importers('ingredient-form.js'), ['js/orders/registry.js'],
    'the ingredient form is reached from the records screen and nowhere else');
  assert.deepEqual(importers('registry.js'), ['js/orders/registry-main.js']);
});

test('⚠️ the page and its four modules are precached, or an offline install gets nothing', () => {
  // install() is all-or-nothing: one missing entry and NOTHING is cached for this
  // version. This is the single failure in this project that does not self-heal.
  for (const asset of ['./suppliers.html', './js/orders/registry.js', './js/orders/registry-main.js',
    './js/orders/ingredient-form.js', './js/orders/mgmt-ui.js']) {
    assert.ok(SW.includes(`'${asset}'`), `sw.js must precache ${asset}`);
  }
  // Every script the page loads has to be in there too — a new one added later would
  // otherwise be fetched from the network on a phone that has none.
  for (const m of PAGE.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    assert.ok(SW.includes(`'./${m[1]}'`), `suppliers.html loads ${m[1]}, which sw.js does not precache`);
  }
});

test('the cache version moved, or no phone will ever fetch the new page', () => {
  const version = SW.match(/CACHE_NAME = 'theitalianclub-v(\d+)'/);
  assert.ok(version, 'sw.js must name a numbered cache');
  assert.ok(Number(version[1]) >= 327, `CACHE_NAME is still v${version[1]} — bump it`);
});

// ── 4. The screen says what it knows, in words ───────────────────────────────

test('⚠️ an undeclared ingredient is flagged with a WORD, not a colour', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /allergenState\(item\) === 'unknown'/,
    'the flag is driven by the three-state model, never by an empty allergens array');
  assert.match(code, /t\('orders\.notDeclaredShort'\)/,
    'and it is a phrase from the dictionary — a colour alone is invisible to a '
    + 'colour-blind reader and to a screen reader (P18)');
});

test('the plural of «product» comes from the dictionary, not from an if', () => {
  assert.match(codeOf(REGISTRY), /t\('orders\.productsCount', \{ n:/);
  assert.doesNotMatch(codeOf(REGISTRY), /=== 1 \?/,
    'Italian and English do not agree about when one form becomes the other');
});

// ⚠️⚠️ THE EIGHTH SHAPE OF THE FROZEN-PHRASE DEFECT, and it shipped in the first
// draft of this screen: the two switch labels read «Suppliers · All ingredients» on
// an Italian phone, for the life of the page.
//
// tests/frozen-phrases.test.mjs asks whether a top-level CONST calls t(). These
// calls sat inside a function, which is normally the fix — except registry-main.js
// calls that function at MODULE LOAD, before a venue is open and therefore before
// the app knows what language it speaks. A t() there answers in the starting
// language and never answers again. Found by driving the app in Italian; every
// suite was green.
test('⚠️ the chrome takes its words at PAINT time, not when the module loads', () => {
  const code = codeOf(REGISTRY);
  const build = code.slice(0, code.indexOf('function paintChrome'));
  for (const key of ['orders.tab.suppliers', 'ui.allIngredients', 'orders.searchASupplier']) {
    assert.ok(!build.includes(key),
      `${key} is resolved while buildRegistry() runs — and registry-main.js runs it at `
      + 'module load, so the word freezes in the app\'s starting language');
  }
  assert.match(code, /function paintList\(\) \{\s*paintChrome\(\);/,
    'paintChrome must run on every repaint, which is the only thing that happens '
    + 'again after the venue\'s language arrives');
  assert.match(code, /search\.input\.setAttribute\('aria-label'/,
    'buildSearchBox copies the placeholder into aria-label at build time, when there '
    + 'was none — so the field would be announced unlabelled (P18)');
});

// ⚠️ TWO MORE THAT 34 DRIVEN CHECKS PASSED AND A SCREENSHOT CAUGHT.
test('a product on its own supplier\'s screen names no supplier at all', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /supplierName === undefined \? null :/,
    'omitting the supplier must mean "do not print it", never fall through to '
    + '«No supplier» — on the one screen that exists to say whose product it is');
  assert.match(code, /ingredientRow\(i\)\)/,
    'the supplier screen calls it with the name omitted, not with null');
});

test('the delivery days are the same words the Orders list prints', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /import \{ dayShort \}/,
    'the mapping is imported, not copied: two screens printing one supplier’s days '
    + 'must not be able to disagree');
  assert.doesNotMatch(code, /\.slice\(0, 3\)/,
    'slicing the stored English key prints «Tue, Fri» under an Italian heading');
});

test('the two lists share ONE search box, mounted once', () => {
  const code = codeOf(REGISTRY);
  assert.equal((code.match(/buildSearchBox\(/g) || []).length, 1,
    'a second box would be a second place for the debounce and the wiping bug to live');
  assert.match(code, /onInput: text => \{ query = text; \}/,
    'the text is stored on every keystroke: a live snapshot must find the CURRENT text');
});
