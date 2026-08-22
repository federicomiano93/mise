// Source-level check (P15) for the class of defect that made this change necessary,
// and that nothing else in this project can catch.
//
// ⚠️ THE APP HAD EXACTLY ONE WIDTH MEDIA QUERY IN ITS ENTIRE CSS — `max-width: 360px`,
// an adjustment for SMALL screens. Nothing anywhere said what a BIG screen should do,
// so a wide screen did not rearrange the layout: it stretched it. Measured on the real
// app before the fix, the gap between an ingredient's Order box and its Stock box ran:
//
//     390 phone          166px   (43% of the screen)
//     430 phone Max      206px   (48%)
//     844 phone LANDSCAPE 620px  (73%)   ← hidden by the manifest's portrait lock
//     820 tablet         596px   (73%)
//    1180 tablet         956px   (81%)
//    1366 iPad Pro      1142px   (84%)
//
// No unit test could see any of that, and no code review would: every rule was
// individually correct. What was missing was a rule about the WHOLE.
//
// So this test asks the question once, for every stylesheet at once: does every
// container that carries content at full width have a cap on how wide that content
// may get? A screen added next year cannot quietly answer "no" — it will land in
// neither list below and turn this test red, naming itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const sheets = readdirSync(root).filter((n) => n.endsWith('.css'));
const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every rule in every stylesheet, as { sheet, selector, body }.
function allRules() {
  const out = [];
  for (const sheet of sheets) {
    const css = stripComments(read(sheet));
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = sel.trim().replace(/\s+/g, ' ');
      if (!selector || selector.startsWith('@')) continue;
      out.push({ sheet, selector, body });
    }
  }
  return out;
}

const carriesContent = ({ body }) =>
  /overflow-y:\s*auto|overflow:\s*auto/.test(body)
  || (/(padding:|padding-inline:|padding-left:)/.test(body) && /position:\s*fixed/.test(body));

const isCapped = ({ body }) => /--app-gutter|--app-max-width/.test(body);

// Containers that must carry the cap themselves.
const MUST_BE_CAPPED = [
  '.scroll-area',            // Calculator + Orders + Home all use it
  'header',                  // the green bar on those same three pages
  '.tab-bar',                // recipe tabs, directly above .scroll-area
  '.recipe-footer',          // the bottom bar of the Calculator
  '.recipe-content',         // the recipe sheet, read standing up
  '.recipe-overlay-header',
  '.supplier-detail-body',   // THE screen this change exists for
  '.supplier-items-body',
  '.preview-scroll',
  '.preview-footer',
  '.mgmt-scroll',
  '.cat-header',
  // ⚠ Added 22 Aug 2026 because catalogue.css:967 SAID this test enforced the cap on
  // it and the test did not: .cat-footer was in neither this list nor the sweep below,
  // which only catches a padded container that is also `position: fixed`. A comment
  // naming a guard that does not exist is how a real guard gets deleted later.
  '.cat-footer',
  '.cat-pick-body',
  '.cat-ing-list--zoom',
  '.pas-header',
  '.pas-footer',
  '.fc-header',
  '.people-scroll',
  // Toasts: shrink-to-fit, so a short one is small anyway — but a long message was
  // free to run to 90vw, i.e. 1229px on an iPad Pro.
  '.cat-toast',
  '.fc-toast',
  '.pas-toast',
];

// Containers that do NOT carry the cap, each with the reason it does not need to.
// A reason is required: "it looked fine" is how the original defect survived.
const EXEMPT = new Map([
  ['.cat-screen', 'wraps .cat-view, which is capped'],
  ['.pas-screen', 'wraps .pas-view, which is capped'],
  ['.fc-screen', 'wraps .fc-view, which is capped'],
  ['.recipe-scroll', 'wraps .recipe-content, which is capped'],
  ['.auth-gate', 'wraps .auth-card, capped at 360px'],
  ['.app-dialog-backdrop', 'wraps .app-dialog, capped at 480px'],
  ['.app-dialog-msg', 'inside .app-dialog, capped at 480px'],
  ['#loaf-modal-box, #list-select-box, #day-modal-box, #send-who-box', 'capped at 480px'],
  ['#loaf-modal, #list-select-modal, #day-modal, #send-who-modal', 'backdrops; the boxes inside are capped'],
  ['.co-header', 'order.html is the CLIENT page: its body is capped at 560px'],
  ['.co-footer', 'order.html is the CLIENT page: its body is capped at 560px'],
  ['.co-body', 'order.html is the CLIENT page: its body is capped at 560px'],
  ['.recipe-footer-btn', 'a button inside a capped bar, not a container'],
  ['#header-wa-btn', 'a button, not a container'],
  ['.preview-footer-stacked .picker-second', 'a button inside a capped bar'],
  ['body[data-section="orders"] .recipe-footer', 'inside @media (max-width:360px), where the cap is inactive anyway'],
  ['body[data-section="orders"] .recipe-footer-btn', 'inside @media (max-width:360px)'],
  ['.result-header', 'no padding of its own; sits inside .scroll-area'],
  ['.splash', 'a full-screen colour wash with a centred logo, no content column'],
  ['.supplier-detail', 'a positioning shell; .supplier-detail-body carries the cap'],
  ['.supplier-items', 'a positioning shell; .supplier-items-body carries the cap'],
  ['.preview-overlay', 'a positioning shell; .preview-scroll carries the cap'],
  ['.mgmt-overlay', 'a positioning shell; .mgmt-scroll carries the cap'],
  ['.history-overlay', 'a positioning shell; it uses .scroll-area inside'],
  ['.missing-overlay', 'a positioning shell; it uses .scroll-area inside'],
  ['.cat-pick-overlay', 'a positioning shell; .cat-pick-body carries the cap'],
  ['.people-overlay', 'a positioning shell; .people-scroll carries the cap'],
  ['.log-overlay', 'a positioning shell; it uses .scroll-area inside'],
  ['#settings-overlay, #cp-overlay', 'positioning shells; they use .scroll-area inside'],
  ['#recipe-overlay', 'a positioning shell; .recipe-content carries the cap'],
  ['#extra-overlay, #divisor-overlay, #wa-overlay, #logsettings-overlay, #products-overlay, #ingredients-overlay, #cosettings-overlay, #clientorders-overlay',
    'positioning shells; they use .scroll-area inside'],
  ['body', 'the app shell itself is full-bleed on purpose; the column is set inside it'],
  ['.cat-zoom-close', 'a floating close button, not a container'],
  ['.orders-offline', 'one centred line of text on a full-width ground; nothing to align to a column'],
  ['#sw-update-host', 'a transparent host; #sw-update-banner inside is capped at 480px and centred'],
]);

test('the shared width token is defined', () => {
  const tokens = read('tokens.css');
  assert.match(tokens, /--app-max-width:\s*\d+px/, '--app-max-width must be defined in tokens.css');
  assert.match(tokens, /--app-gutter:\s*max\(/, '--app-gutter must be defined in tokens.css');
});

test('the cap is a floor, never a shrink: --app-gutter can never go below 0', () => {
  // If this ever became calc() without the max(), a phone would gain padding it
  // never had, which is the one regression this whole change promises not to cause.
  const tokens = stripComments(read('tokens.css'));
  const m = tokens.match(/--app-gutter:\s*([^;]+);/);
  assert.ok(m, '--app-gutter must exist');
  assert.match(m[1], /max\(\s*0px\s*,/, '--app-gutter must start from a 0px floor');
});

test('every container that must be capped, is', () => {
  const rules = allRules();
  const missing = [];
  for (const wanted of MUST_BE_CAPPED) {
    const found = rules.filter((r) => r.selector === wanted);
    if (!found.length) { missing.push(`${wanted} — selector not found at all`); continue; }
    if (!found.some(isCapped)) missing.push(`${wanted} — no var(--app-gutter)/var(--app-max-width)`);
  }
  assert.deepEqual(missing, [], `these containers stretch on a tablet:\n  ${missing.join('\n  ')}`);
});

test('no NEW full-width container escapes the decision', () => {
  // The point of this test. A container added later is in neither list, so it lands
  // here and has to be either capped or exempted WITH A REASON.
  const undecided = allRules()
    .filter(carriesContent)
    .filter((r) => !isCapped(r))
    .filter((r) => !EXEMPT.has(r.selector))
    .filter((r) => !MUST_BE_CAPPED.includes(r.selector))
    .map((r) => `${r.sheet}: ${r.selector}`);
  assert.deepEqual(undecided, [], `new full-width container(s) — cap them with var(--app-gutter), or add them to EXEMPT with the reason:\n  ${undecided.join('\n  ')}`);
});

test('the three -view wrappers share the one token, not their own copy of 620px', () => {
  for (const [sheet, sel] of [['catalogue.css', '.cat-view'], ['pastries.css', '.pas-view'], ['foodcost.css', '.fc-view']]) {
    const css = stripComments(read(sheet));
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === sel);
    assert.ok(rule, `${sel} not found in ${sheet}`);
    assert.match(rule[2], /max-width:\s*var\(--app-max-width\)/, `${sel} must use the shared token`);
  }
});

test('the order row keeps its two boxes within reach of each other', () => {
  // ⚠️ CAPPING THE ROW WAS NOT ENOUGH, and only measuring showed it. `space-between`
  // hands the whole remainder to the space BETWEEN the two boxes, so a 620px row
  // still left 428px of nothing — against 166px on a 390 phone. Capping .ing-fields
  // as well brought it to a constant 208px on every screen from 820 to 1366.
  const css = stripComments(read('orders.css'));
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === '.ing-fields');
  assert.ok(rule, '.ing-fields not found');
  assert.match(rule[2], /max-width:\s*400px/, '.ing-fields must cap at the width it has on the widest phone');
  assert.match(rule[2], /margin-inline:\s*auto/, '.ing-fields must stay centred once capped');
});

test('that cap never engages on a phone', () => {
  // The row is 288px wide at 320, 358 at 390 and 398 at 430 — all below the cap, so
  // no phone can be touched by it. If anyone lowers this number, that stops being
  // true and the widest phone loses layout it has today.
  const css = stripComments(read('orders.css'));
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === '.ing-fields');
  const cap = Number(rule[2].match(/max-width:\s*(\d+)px/)[1]);
  assert.ok(cap >= 398, `the cap (${cap}px) must not be under the 398px this row has on an iPhone 16 Pro Max`);
});

test('⚠️ NOTHING may lock the app to an orientation — not the manifest, not code', () => {
  // ⚠️⚠️ THIS TEST EXISTS BECAUSE THE OPPOSITE SHIPPED, AND BROKE THE ONE DEVICE THE
  // WHOLE RELEASE WAS FOR. v1.56.0 added js/orientation-lock.js: lock to portrait when
  // the screen's short side is at or below 600px CSS. The threshold was "derived" —
  // iPhone 440, iPad mini 744 — but derived by looking ONLY at Apple. Real Samsung
  // tablets sit inside it:
  //
  //     Galaxy Tab A 8.0    800x1280 @1.5  ->  533 CSS  ->  LOCKED
  //     Galaxy Tab A 10.1  1200x1920 @2.0  ->  600 CSS  ->  LOCKED
  //
  // Federico turned his tablet landscape and the app stayed upright, unreadable. His
  // photos showed ANDROID'S OWN STATUS BAR rotated with it — which no web page can do,
  // and only a real orientation lock can.
  //
  // ⚠️ THE LESSON IS NOT "pick a better number". No width separates a phone from a
  // tablet: the premise is wrong, and it failed on the first real device it met. The
  // lock was removed rather than retuned.
  //
  // ⚠️ AND IT NEVER KEPT ITS PROMISE ANYWAY: screen.orientation.lock() does not exist
  // on iOS Safari, iPhone or iPad. Half the devices could always rotate.
  //
  // ✅ Nothing is lost by removing it: a phone in landscape is 844px wide and gets the
  // same centred column a tablet gets — the width cap above is what makes that safe.
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.orientation, undefined,
    'manifest.json must not pin an orientation — it cannot tell a phone from a tablet');

  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'vendor') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
        // Skip the sentence where it appears in a COMMENT — including this file's own
        // note, and any future explanation of why the lock is gone.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/screen\s*\.\s*orientation\s*\.\s*lock\s*\(/.test(line)) {
          offenders.push(`${name}:${i + 1}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
  };
  walk(JS_DIR);

  assert.deepEqual(offenders, [],
    'a device must be free to turn. Guessing phone-vs-tablet from the screen size '
    + 'locked a real Galaxy Tab in portrait — the device this whole release was for:\n  '
    + offenders.join('\n  '));
});

test('no page loads an orientation lock, and the file is gone from the precache', () => {
  // ⚠️ DERIVED, NOT LISTED — a hand-written list cannot see the page added tomorrow,
  // and this one had already missed suppliers.html.
  const pages = readdirSync(root).filter((n) => n.endsWith('.html'));
  assert.ok(pages.length >= 8, `only found ${pages.length} pages — the scan is not finding them`);
  for (const page of pages) {
    assert.doesNotMatch(read(page), /orientation-lock/, `${page} must not load an orientation lock`);
  }
  // ⚠️ A precached file that no longer exists makes install() fail, and install() is
  // all-or-nothing: one missing entry and NOTHING is cached for that version.
  assert.doesNotMatch(read('sw.js'), /orientation-lock/,
    'sw.js must not precache a file that no longer exists');
});

// ---------------------------------------------------------------------------
// The update banner and the bottom bars share the foot of the screen
// ---------------------------------------------------------------------------

test('⚠⚠ every page-level bottom bar is one the update banner knows about', () => {
  // The banner host is `position: fixed; bottom: 0; z-index: 9999` and every bottom bar
  // in this app is the last thing in NORMAL FLOW, so they land on the same pixels.
  // Measured on the Recipe catalogue at 390×844 before the fix: the banner covered all
  // 69px of the bar and a tap aimed at «Settings» hit the banner. js/sw-update.js now
  // lifts the banner above whichever bar is on screen.
  //
  // ⚠ THIS IS A RULE, NOT A LIST. A bar added to a new feature next year lands in
  // neither place and turns this red, naming itself — which is the only way the list in
  // sw-update.js can stay true without somebody remembering it.
  const swUpdate = read('js/sw-update.js');
  const declared = new Set(
    [...(swUpdate.match(/const BOTTOM_BARS = \[([^\]]*)\]/) || [, ''])[1]
      .matchAll(/'\.([a-z-]+)'/g)].map((m) => m[1]),
  );
  assert.ok(declared.size > 0, 'BOTTOM_BARS is gone from js/sw-update.js');

  // A bar is a class ending in -footer used in the MARKUP of a page that loads the
  // banner. `-footer-btn` and the like are children, not the bar.
  const EXEMPT = new Map([
    // The client's ordering page deliberately does not load js/sw-update.js — it is
    // not the staff app, and a client must never be shown a staff update banner.
    ['co-footer', 'order.html does not load sw-update.js'],
    // Inside a full-screen overlay, not at the foot of the page.
    ['preview-footer', 'lives inside the send-order overlay'],
  ]);

  const missing = [];
  for (const page of readdirSync(root).filter((n) => n.endsWith('.html'))) {
    const html = read(page);
    if (!html.includes('sw-update.js')) continue;
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (!/^[a-z]+-footer$/.test(cls)) continue;
        if (declared.has(cls) || EXEMPT.has(cls)) continue;
        missing.push(`${page}: .${cls}`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    'add these to BOTTOM_BARS in js/sw-update.js, or the update banner will cover them');
});

test('⚠ the banner is actually placed, and stops watching when it goes', () => {
  const src = read('js/sw-update.js');
  assert.match(src, /document\.body\.appendChild\(host\);\s*\r?\n\s*keepAboveBottomBar\(host\);/,
    'showBanner must place the banner above the bottom bar');
  // ⚠ The observer outliving the banner would keep measuring for the life of the page.
  assert.match(src, /if \(!host\.isConnected\)[^\n]*disconnect\(\)/,
    'the observer must stop when the banner is gone');
  // ⚠ A bar that is NOT at the foot of the viewport must not push the banner up over
  // content — the geometric test is what makes the selector list safe to be approximate.
  assert.match(src, /Math\.abs\(box\.bottom - window\.innerHeight\)/,
    'the placement must check the bar really rests on the bottom edge');
});

test('⚠⚠ the allergen sheet is reachable by ANYBODY in the venue', () => {
  // It moved into the catalogue's bottom bar on 22 Aug 2026, and that bar had been
  // hidden from ordinary employees — correctly, while the photo switch was the only
  // thing behind it. It is not the only thing any more.
  //
  // The sheet has NEVER had a role gate: firestore.rules lets any member of the venue
  // read recipes and ingredients, and the screen's own header names counter staff as
  // its first audience — «somebody asked "does this contain nuts?" wants an answer
  // NOW». This is the one screen in the app that can send somebody to hospital, so
  // walling it behind the manager gate is the mistake this test exists to prevent.
  // Federico's decision, asked before the work: everyone, employees included.
  const main = read('js/catalogue/catalogue-main.js');
  const fn = main.slice(main.indexOf('function setHeader'), main.indexOf('function swap'));
  assert.ok(fn.length > 100, 'setHeader is gone');

  assert.match(fn, /footerEl\.hidden = !footer;/,
    'the BAR must not be gated on a role — the allergen sheet lives in it');
  assert.doesNotMatch(fn.replace(/\/\/[^\n]*/g, ''), /footerEl\.hidden[^;]*canManage/,
    'the bar is gated on canManage again, which hides the allergen sheet from staff');
  // ⚠ And the other half: the switch must STILL be gated, or an employee is shown a
  // control the server will refuse.
  assert.match(fn, /settingsBtn\.hidden = currentSession\(\)\.canManage !== true;/,
    'Settings must stay owner/manager only');
});

test('⚠ the catalogue\'s bottom bar holds both buttons, and the list holds neither', () => {
  const html = read('catalogue.html');
  const bar = html.slice(html.indexOf('<div class="cat-footer"'), html.indexOf('</div>', html.indexOf('<div class="cat-footer"')));
  assert.match(bar, /id="catAllergens"/, 'the allergen sheet button is not in the bar');
  assert.match(bar, /id="catSettings"/, 'the Settings button is not in the bar');
  // ⚠ The everyday screen is the first one, so it falls under the thumb.
  assert.ok(bar.indexOf('catAllergens') < bar.indexOf('catSettings'),
    'the allergen sheet must come first');
  assert.match(bar, /data-i18n="cat\.allergenSheet"/, 'the label must be translatable');

  // It must be GONE from the list, or there are two ways in and one of them is the
  // full-width row this change removed.
  const list = read('js/catalogue/catalogue-list.js');
  assert.doesNotMatch(list, /onAllergenSheet/, 'the sheet row is back on the recipe list');

  // And something must actually open it.
  assert.match(read('js/catalogue/catalogue-main.js'),
    /allergensBtn\.addEventListener\('click', showAllergenSheet\)/,
    'the new button opens nothing');
});

test('⚠ the catalogue\'s bottom bar is the page, and its buttons are the raised chip', () => {
  // The bar was copied from .pas-footer and the two colours were INVERTED in the
  // copying: the bar took --surface and the button --surface-2, which paints a pale
  // #FFFDF7 band across the foot of a #F4EDE0 page. Federico saw it on his own phone.
  // Pastries pairs them the other way; this pins the faithful copy.
  const css = read('catalogue.css');
  const bar = css.slice(css.indexOf('.cat-footer {'), css.indexOf('.cat-footer[hidden]'));
  const btn = css.slice(css.indexOf('.cat-footer-btn {'), css.indexOf('.cat-footer-btn > span'));

  assert.match(bar, /background: var\(--cat-ground\)/, 'the bar must be the page\'s own ground');
  assert.doesNotMatch(bar, /background: var\(--cat-surface\)/, 'the white band is back');
  assert.match(btn, /background: var\(--cat-surface\)/, 'the button must be the raised chip');

  // ⚠ The height is load-bearing beyond looks: js/sw-update.js measures this bar to
  // lift the update banner above it, so the padding must not drift.
  assert.match(bar, /padding: 10px 16px calc\(12px \+ env\(safe-area-inset-bottom\)\)/,
    'changing the bar\'s padding moves the update banner');
});
