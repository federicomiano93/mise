// The phone's half of reading a recipe from a photograph: how big a photo may be,
// and what the screen says when it does not work.
//
// ⚠️ THE SENTENCE-CHOOSING IS THE PART THAT MATTERS MOST HERE, and it is the part
// that looks least like it needs a test. This project has already shipped a screen
// that told somebody with full signal to check their connection — which sends them
// to fix the one thing that is working. Exactly one answer here may mention the
// connection, and a test says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  MAX_EDGE, MAX_PHOTOS, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES,
  fitWithin, base64Of, mediaTypeOf, approxBytes, payloadProblem,
  photoErrorKey, noRecipeKey,
} from '../js/catalogue/photo-model.js';
import { _dictionaries, DEFAULT_LANGUAGE } from '../js/i18n.js';

const read = (n) => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');

// ── the size the photo is drawn at ───────────────────────────────────────────

test('a big photo is brought down to the long edge, aspect kept', () => {
  assert.deepEqual(fitWithin(4032, 3024), { w: 1568, h: 1176 });   // landscape
  assert.deepEqual(fitWithin(3024, 4032), { w: 1176, h: 1568 });   // portrait
  assert.deepEqual(fitWithin(4000, 4000), { w: 1568, h: 1568 });   // square
});

test('⚠️ a small photo is never UPSCALED', () => {
  // Blowing up a small picture adds bytes and pixels and not one legible letter,
  // and the reader charges by the pixel.
  assert.deepEqual(fitWithin(800, 600), { w: 800, h: 600 });
  assert.deepEqual(fitWithin(1568, 20), { w: 1568, h: 20 });
});

test('nonsense dimensions give nothing rather than NaN', () => {
  for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [NaN, 100], [undefined, 1], ['x', 'y']]) {
    assert.deepEqual(fitWithin(w, h), { w: 0, h: 0 }, `${w}x${h}`);
  }
});

test('the result is always whole pixels and at least one', () => {
  const { w, h } = fitWithin(10000, 3);
  assert.equal(w, MAX_EDGE);
  assert.equal(h, 1, 'a canvas of height 0 draws nothing at all');
  assert.ok(Number.isInteger(w) && Number.isInteger(h));
});

// ── the data URL ─────────────────────────────────────────────────────────────

test('the payload is taken out of the data URL, and only from a real one', () => {
  assert.equal(base64Of('data:image/jpeg;base64,QUFB'), 'QUFB');
  assert.equal(mediaTypeOf('data:image/jpeg;base64,QUFB'), 'image/jpeg');
});

test('⚠️ anything that is not an image data URL yields nothing', () => {
  // Sending the whole `data:…` string as if it were base64 is refused by the
  // server with a message about the photo, and nobody would ever work out why.
  for (const bad of ['', null, 42, 'QUFB', 'data:text/plain;base64,QUFB', 'https://x/y.jpg']) {
    assert.equal(base64Of(bad), '', JSON.stringify(bad));
  }
});

test('approxBytes never wildly over-states', () => {
  assert.equal(approxBytes('AAAA'), 3);
  assert.equal(approxBytes(''), 0);
  assert.equal(approxBytes(undefined), 0);
});

// ── the guard, run before anything is uploaded ───────────────────────────────

const img = (bytes) => ({ mediaType: 'image/jpeg', data: 'A'.repeat(Math.ceil(bytes * 4 / 3)) });

test('a good set has no problem', () => {
  assert.equal(payloadProblem([img(1000), img(1000)]), null);
});

test('every refusal is named', () => {
  assert.equal(payloadProblem([]), 'no-images');
  assert.equal(payloadProblem(null), 'no-images');
  assert.equal(payloadProblem(Array.from({ length: MAX_PHOTOS + 1 }, () => img(10))), 'too-many-images');
  assert.equal(payloadProblem([img(MAX_IMAGE_BYTES + 5000)]), 'image-too-large');
  assert.equal(payloadProblem([{ data: '' }]), 'bad-image');
  assert.equal(payloadProblem(Array.from({ length: 5 }, () => img(Math.floor(MAX_TOTAL_BYTES / 4)))),
    'images-too-large');
});

test('⚠️ the phone’s guard agrees with the server’s', () => {
  // The server's is the one that is enforced; this one only saves a slow upload.
  // If they disagreed, somebody would be refused by whichever is stricter with a
  // message written for the other.
  const server = read('functions/recipe-photo-model.js');
  const num = (name) => eval(new RegExp(`export const ${name} = ([^;]+);`).exec(server)[1]);
  assert.equal(MAX_PHOTOS, num('MAX_IMAGES'));
  assert.equal(MAX_IMAGE_BYTES, num('MAX_IMAGE_BYTES'));
  assert.equal(MAX_TOTAL_BYTES, num('MAX_TOTAL_BYTES'));
});

// ── what the screen says ─────────────────────────────────────────────────────

test('every code maps to a phrase the dictionary actually holds', () => {
  const known = _dictionaries()[DEFAULT_LANGUAGE];
  const italian = _dictionaries().it;
  const codes = [
    'signed-out', 'no-location', 'no-images', 'too-many-images', 'image-too-large',
    'images-too-large', 'bad-image', 'not-allowed', 'person-limit', 'venue-limit',
    'read-failed', 'undecodable', 'offline',
  ];
  for (const key of codes) {
    const phrase = photoErrorKey({ details: { key } });
    assert.ok(phrase in known, `${key} → ${phrase} is not in the English dictionary`);
    assert.ok(phrase in italian, `${key} → ${phrase} has no Italian`);
  }
  for (const reason of ['nothing-readable', 'refused', 'truncated', 'no-tool']) {
    assert.ok(noRecipeKey(reason) in known, reason);
    assert.ok(noRecipeKey(reason) in italian, reason);
  }
});

test('⚠️ ONLY the offline case mentions the connection', () => {
  // Telling somebody with full signal to check their connection sends them to fix
  // the one thing that is working. A refusal, a daily limit and an unreadable
  // photograph are all decisions, and each must say so.
  const dict = _dictionaries()[DEFAULT_LANGUAGE];
  const it = _dictionaries().it;
  const offline = photoErrorKey({ code: 'functions/unavailable' });
  assert.match(dict[offline], /connection/i);
  assert.match(it[offline], /connessione/i);

  for (const key of ['not-allowed', 'person-limit', 'venue-limit', 'read-failed',
    'nothing-readable', 'refused', 'truncated', 'bad-image', 'undecodable']) {
    const phrase = photoErrorKey({ details: { key } });
    assert.doesNotMatch(dict[phrase], /connection/i, `${key} must not blame the connection`);
    assert.doesNotMatch(it[phrase], /connessione/i, `${key} must not blame the connection`);
  }
});

test('a bare Firebase code still lands somewhere sensible', () => {
  assert.equal(photoErrorKey({ code: 'functions/unauthenticated' }), 'cat.photo.err.signedOut');
  assert.equal(photoErrorKey({ code: 'functions/permission-denied' }), 'cat.photo.err.notAllowed');
  assert.equal(photoErrorKey({ code: 'functions/resource-exhausted' }), 'cat.photo.err.personLimit');
  assert.equal(photoErrorKey({ code: 'functions/unavailable' }), 'cat.photo.err.offline');
  assert.equal(photoErrorKey({ code: 'functions/deadline-exceeded' }), 'cat.photo.err.tooSlow');
});

test('an unknown failure never leaves the screen blank', () => {
  for (const err of [null, undefined, {}, new Error('boom'), { code: 'functions/weird' }]) {
    const key = photoErrorKey(err);
    assert.ok(key && key in _dictionaries()[DEFAULT_LANGUAGE], JSON.stringify(err));
  }
});

test('⚠️ the details key wins over the code', () => {
  // The server sends both. The key is specific ("your daily allowance"), the code
  // is a family ("resource-exhausted") — and for the venue limit they differ.
  const err = { code: 'functions/resource-exhausted', details: { key: 'venue-limit' } };
  assert.equal(photoErrorKey(err), 'cat.photo.err.venueLimit');
});

// ── the file itself ──────────────────────────────────────────────────────────

test('⚠️ no phrase is resolved at module load', () => {
  // A t() in a module constant runs before a venue is open — so before the
  // interface language is even known — and freezes in whatever language the app
  // started in. Fourteen constants in this app did exactly that.
  // ⚠️ READ THE CODE, NOT THE PROSE. The comment in that file explains why a t()
  // must not be there, so a check over the whole text finds the very thing it is
  // banning inside the warning against it — and reports a correct file as broken.
  // Third time today; it is worth stating plainly.
  const code = read('js/catalogue/photo-model.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /(?:^|[^A-Za-z0-9_$.])t\s*\(/m,
    'this file deals in keys, never in phrases');
});

test('⚠️ the long edge stays at 1568', () => {
  // Larger is downsampled by the reader anyway — pure cost. Smaller loses
  // handwriting, which is most of what this feature is for.
  assert.equal(MAX_EDGE, 1568);
});

// ── two defects the photo screen exposed in code that was already there ──────

test('⚠️ the catalogue header stops being owned by the static text pass', () => {
  // catalogue.html marks #catTitle and #catSub `data-i18n` so they read correctly
  // before any JavaScript runs. But js/i18n-dom.js rewrites EVERY [data-i18n]
  // element on a language change, and the venue's language arrives a moment AFTER
  // the page has drawn itself — so opening a recipe, the allergen sheet or the
  // photo screen in that moment silently reverted the header to "Recipes". The
  // title said one thing while the screen showed another, on every screen of the
  // page. Found by driving the photo screen, which is simply fast enough to be
  // there when it happens.
  const main = read('js/catalogue/catalogue-main.js');
  const setHeader = main.slice(main.indexOf('function setHeader'), main.indexOf('function swap'));
  assert.match(setHeader, /titleEl\.removeAttribute\('data-i18n'\)/);
  assert.match(setHeader, /subEl\.removeAttribute\('data-i18n'\)/);
  // And the attributes must still be in the markup: they are what makes the header
  // readable in the right language before the first paint.
  assert.match(read('catalogue.html'), /id="catTitle" data-i18n=/);
});

test('⚠️ the photo screen answers a language change itself', () => {
  // Its strings would otherwise freeze in whatever language the app started in:
  // catalogue-main redraws only its LIST view, deliberately, because redrawing over
  // an open editor would throw away what somebody typed. This screen holds only
  // photographs and its paint() rebuilds them, so repainting costs nothing.
  const view = read('js/catalogue/photo-capture.js');
  assert.match(view, /onLanguageChange\(\(\) => \{ if \(root\.isConnected\) paint\(\); \}\)/);
  // Every phrase must be inside paint(), never written once at build time.
  const build = view.slice(view.indexOf('export function renderPhotoCapture'), view.indexOf('function paint()'));
  assert.doesNotMatch(build, /text: t\(/, 'a phrase set once at build time freezes in one language');
});

test('⚠️ every class the CATALOGUE uses is one this page actually defines', () => {
  // `.btn-primary` and `.btn-secondary` do NOT exist in catalogue.css — using them
  // produced a bare grey browser button and no error anywhere, the same silent
  // shape as the three spacing tokens that were used by twenty declarations and
  // defined nowhere.
  // ⚠️ EVERY FILE IN THE FEATURE, not just the one that was wrong. Scanning a
  // single file caught the defect that prompted this check and would have missed the
  // identical one two files away — `.btn-primary` was in catalogue-list.js too.
  // catalogue.html loads tokens.css, auth.css and catalogue.css and NOT style.css, so
  // every `.recipe-*` and `.mgmt-*` class the rest of the app uses is silently dead
  // here: an unstyled bar, a bare grey button, and no error anywhere.
  const css = read('catalogue.css') + read('tokens.css') + read('auth.css');
  const used = new Set();
  for (const file of readdirSync(new URL('../js/catalogue/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const src = read(`js/catalogue/${file}`);
    for (const m of src.matchAll(/class: '([^']+)'/g)) m[1].split(/\s+/).forEach(c => used.add(c));
    for (const m of src.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) used.add(m[1]);
  }
  // ⚠️ NO REGEX HERE ON PURPOSE. The first version built one from a template
  // literal, `\.` and `\s` collapsed to `.` and `s`, and it reported every class in
  // the file as undefined — the instrument, not the code, for the fifth time today.
  // A scan for the selector followed by a character that cannot be part of a name
  // needs no escaping at all.
  const defined = (c) => {
    for (let i = css.indexOf('.' + c); i !== -1; i = css.indexOf('.' + c, i + 1)) {
      const next = css[i + c.length + 1];
      if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return true;
    }
    return false;
  };
  // ⚠️ A CLASS MAY BE A HANDLE RATHER THAN A LOOK, and the check has to tell the
  // two apart or it is noise. Everything here was verified to be queried or gated from
  // JavaScript and styled by a sibling class it composes with — none of them is defined
  // in a stylesheet this page fails to load, which is the dangerous shape.
  //
  // ⚠️ THIS LIST MAY ONLY EVER SHRINK. Adding a name to it to make the check pass is
  // how `.btn-primary` would have shipped a second time; every entry needs a reason on
  // the line beside it.
  const HANDLES = new Set([
    'alg-sheet',              // namespace prefix; .alg-sheet-* carry the look
    'lab-view', 'lab-body',   // same, for the label screen
    'guided-body',            // same, for the guided editor
    'cat-cost-host',          // container replaced in place when prices arrive
    'cat-guided-host',        // container replaced in place when the batch changes
    'cat-photo-btn',          // queried to show/hide; .cat-alg-sheet-btn is the look
    'cat-photo-setting-label',// queried in the repaint; the row carries the look
    'guided-edit-list', 'guided-edit-missed', // queried while writing a procedure
    'guided-edit',            // js/update-gate.js BUSY_SELECTORS — a marker, not a look
    'cat-photo-busy',         // js/update-gate.js BUSY_SELECTORS — a paid read in flight
  ]);
  const missing = [...used].filter(c => !defined(c) && !HANDLES.has(c));
  assert.deepEqual(missing, [], 'these classes style nothing at all');
});

// ─────────────────────────────────────────────────────────────────────────────
// WHERE EACH CONTROL LIVES (Federico, 23 Aug 2026)
//
// Four notes, all of the same kind — *this control is in the wrong place* — and none
// of them changes what anything DOES. That makes them exactly the sort of change a
// later edit undoes without noticing, because nothing breaks when it does: the
// switch works just as well on the list, and the app still runs with the weight box
// two cards down. Only somebody looking at the screen would know. Hence these.
// ─────────────────────────────────────────────────────────────────────────────

test('⚠️ the recipe LIST carries neither the switch nor the way into the photo reader', () => {
  // Both used to live here. A switch nobody expects on a screen of recipes is worse
  // than a settings screen with one row on it, and the photo reader belongs where
  // the job is — inside the form for a NEW recipe.
  const list = codeOf(read('js/catalogue/catalogue-list.js'));
  assert.doesNotMatch(list, /cat-photo-setting/, 'the switch is back on the recipe list');
  assert.doesNotMatch(list, /cat-photo-btn|openPhotoCapture/, 'the photo entry is back on the recipe list');
  // And the props that fed them, or the list would quietly accept them again.
  for (const prop of ['onPhotoRecipe', 'onPhotoSetting', 'photoOn']) {
    assert.doesNotMatch(list, new RegExp(prop), `${prop} is back on the list`);
  }
});

test('⚠️ the photo reader is offered only while ADDING a recipe, never while editing', () => {
  // `recipe` is null exactly on the new-recipe path — the same flag the editor
  // already uses for its title and for hiding Delete. On an EXISTING recipe the
  // button would raise "merge with what is here, or replace it?", a question with no
  // good answer; on a new one the honest choice is binary and small.
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.match(editor, /!recipe && app\.photoOn && app\.photoOn\(\)/,
    'the photo entry must be gated on there being no recipe yet');
  // ⚠️ photoOn is CALLED, not read. A value captured when the editor was built is a
  // value from before the owner touched the switch. The `&&` guard before it is the
  // other half: a view mounted by something that does not pass photoOn must not throw.
  assert.doesNotMatch(editor, /app\.photoOn\s*[?)]/, 'photoOn must be called, not read as a value');
  // Nothing typed may vanish silently.
  assert.match(editor, /dirty/, 'the editor must ask before replacing what has been typed');
});

test('⚠️ the way back out of the photo screen is a ONE-SHOT marker', () => {
  // Left set, it would send every later Back into a new editor — the trap the
  // sessionStorage flag behind "Back to Misé" (v275) is consumed on read to avoid.
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const i = main.indexOf('backToEditor');
  assert.ok(i !== -1, 'the return marker is gone');
  // It has to be cleared in the same breath as it is read.
  assert.match(main, /backToEditor\s*=\s*false/, 'the marker is never cleared');
  const reads = [...main.matchAll(/if \(backToEditor\)/g)].length;
  assert.ok(reads >= 1, 'nothing ever reads the marker');
});

test('⚠️ the batch-weight box sits directly under the recipe, above the cost card', () => {
  // His screenshot: the box the screen is opened for was below the cost card AND a
  // nine-line allergen card. Order is the whole change, so order is what is pinned.
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  const row = detail.slice(detail.indexOf("class: 'cat-detail-top'"));
  const order = ['ingList', 'weightPanel', 'costHost', 'guidedHost'].map(n => row.indexOf(n));
  assert.ok(order.every(i => i !== -1), 'the detail top no longer holds all four');
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'the weight box must come after the recipe and before the cost card');
});

test('⚠️ the allergen card folds, and what stays OUTSIDE the fold is the safety rule', () => {
  // This is the only screen in the app that can send somebody to hospital. Folding
  // the ANSWER away would mean a rushed reply at the counter given without opening
  // the card. Only the JOB folds: which rows to fix, the traces, the way to a label.
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  const panel = detail.slice(detail.indexOf('function allergenPanel'), detail.indexOf('function reasonLabel'));

  assert.match(panel, /cat-alg-body[^)]*hidden: 'hidden'/s, 'the card no longer opens closed');
  assert.match(panel, /'aria-expanded': 'false'/, 'the head is not announced as a disclosure');
  assert.match(panel, /el\('button', \{\s*class: 'cat-alg-head cat-alg-toggle'/,
    'the head must be a real button — a div with a click handler reaches no keyboard');

  // ⚠️ THE STATE IS APPENDED TO THE PANEL, THE DETAIL TO THE BODY. Both branches.
  const declared = panel.slice(panel.indexOf('panel.appendChild(head(el(\'span\', { class: \'cat-alg-ok\''));
  assert.match(declared, /panel\.appendChild\(el\('p', \{ class: 'cat-alg-list'/,
    'what a recipe CONTAINS must stay outside the fold');
  assert.match(declared, /body\.appendChild\(el\('button', \{\s*class: 'cat-alg-label-btn'/,
    'the label button belongs inside the fold, so it cannot be tapped blind');
  const blocked = panel.slice(panel.indexOf('cat-alg-blocked'), panel.indexOf('cat-alg-ok'));
  assert.match(blocked, /panel\.appendChild\(head\(/, 'the "not declared" state must stay visible when shut');
  assert.match(blocked, /body\.appendChild\(el\('p', \{ class: 'cat-alg-warn'/,
    'the work list belongs inside the fold');
});

test('⚠️ the seven gap reasons are KEYS, resolved when the row is drawn', () => {
  // They were seven plain English strings in a frozen module constant — not the
  // v1.57.0 frozen-t() trap, but seven phrases no translation could ever reach.
  // ⚠️ Resolving them in the constant would be the OTHER half of that trap: a
  // module is evaluated once, before a venue is open, so before the language is
  // known. The defect is WHEN, not WHAT.
  const model = codeOf(read('js/catalogue/recipe-allergen-model.js'));
  const block = model.slice(model.indexOf('ALLERGEN_REASON_TEXT'), model.indexOf('ALLERGEN_REASON_TEXT') + 700);
  assert.doesNotMatch(block, /\bt\(/, 'a t() inside the constant freezes in one language');
  assert.match(block, /cat\.alg\.reason\./, 'the constant must hold keys');
  assert.match(codeOf(read('js/catalogue/catalogue-detail.js')), /function reasonLabel/,
    'nothing resolves the keys at draw time');
});

// Comments stripped before every source check above. Three separate checks in this
// project have failed on their own warning comment — a guard that fires on prose is
// a guard people widen, and widening is how a real guard gets weakened.
//
// Naive about `//` inside a string literal, deliberately: nothing matched above
// appears inside one.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => { const at = line.indexOf('//'); return at === -1 ? line : line.slice(0, at); })
    .join('\n');
}
