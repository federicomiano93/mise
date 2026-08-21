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
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const sheets = readdirSync(root).filter((n) => n.endsWith('.css'));
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

test('the manifest no longer locks the app to portrait', () => {
  // A tablet lives on a stand, in landscape. The phone/tablet distinction is made
  // in js/orientation-lock.js, which a manifest cannot do.
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.orientation, undefined,
    'manifest.json must not pin an orientation — it cannot tell a phone from a tablet');
});

test('js/orientation-lock.js is precached', () => {
  // Adding a cached file without listing it is the one failure mode that does not
  // heal itself: an offline installed user gets a page referencing a file they do
  // not have.
  assert.match(read('sw.js'), /'\.\/js\/orientation-lock\.js'/,
    'js/orientation-lock.js must be in the ASSETS list in sw.js');
});

test('every app page loads the orientation lock', () => {
  for (const page of ['index.html', 'orders.html', 'calculator.html', 'foodcost.html', 'pastries.html', 'catalogue.html']) {
    assert.match(read(page), /js\/orientation-lock\.js/, `${page} must load js/orientation-lock.js`);
  }
});

test('order.html does NOT load it — that page belongs to the client', () => {
  assert.doesNotMatch(read('order.html'), /js\/orientation-lock\.js/,
    "the client's ordering page must not lock the client's own phone");
});

// ---- the pure half of js/orientation-lock.js --------------------------------
const { shouldLockPortrait, shortSideOf, PHONE_MAX_SHORT_SIDE } = await import('../js/orientation-lock.js');

test('a phone is held upright, a tablet is free to turn', () => {
  assert.equal(shouldLockPortrait(390), true, 'iPhone');
  assert.equal(shouldLockPortrait(430), true, 'iPhone Pro Max');
  assert.equal(shouldLockPortrait(320), true, 'the smallest phone still sold');
  assert.equal(shouldLockPortrait(744), false, 'iPad mini');
  assert.equal(shouldLockPortrait(820), false, 'iPad');
  assert.equal(shouldLockPortrait(1024), false, 'iPad Pro');
});

test('the boundary sits in the empty space between the widest phone and the narrowest tablet', () => {
  assert.ok(PHONE_MAX_SHORT_SIDE > 440, 'must be above the iPhone 16 Pro Max (440)');
  assert.ok(PHONE_MAX_SHORT_SIDE < 744, 'must be below the iPad mini (744)');
});

test('an unreadable screen size is treated as a tablet, never as a phone', () => {
  // Failing this way round is deliberate: a wrongly locked tablet cannot be used on
  // its stand, while an unlocked phone merely rotates — and still lays out correctly,
  // because the width cap covers a phone in landscape too.
  for (const bad of [undefined, null, NaN, 0, -1, 'wide', {}]) {
    assert.equal(shouldLockPortrait(bad), false, `${String(bad)} must not lock`);
  }
});

test('the short side is the smaller of the two, whichever way the device is held', () => {
  assert.equal(shortSideOf({ width: 390, height: 844 }), 390);
  assert.equal(shortSideOf({ width: 844, height: 390 }), 390, 'a rotated phone is still a phone');
  assert.ok(Number.isNaN(shortSideOf(null)));
  assert.ok(Number.isNaN(shortSideOf({ width: 'x', height: 2 })));
});
