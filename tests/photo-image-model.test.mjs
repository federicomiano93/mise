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
import { readFileSync } from 'node:fs';
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

test('⚠️ every class the photo screen uses is one this page actually defines', () => {
  // `.btn-primary` and `.btn-secondary` do NOT exist in catalogue.css — using them
  // produced a bare grey browser button and no error anywhere, the same silent
  // shape as the three spacing tokens that were used by twenty declarations and
  // defined nowhere.
  const css = read('catalogue.css') + read('tokens.css');
  const view = read('js/catalogue/photo-capture.js');
  const used = new Set();
  for (const m of view.matchAll(/class: '([^']+)'/g)) m[1].split(/\s+/).forEach(c => used.add(c));
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
  const missing = [...used].filter(c => !defined(c));
  assert.deepEqual(missing, [], 'these classes style nothing at all');
});
