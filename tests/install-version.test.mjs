// ⚠️⚠️ A MANIFEST IS READ WHEN THE APP IS INSTALLED, NOT WHEN IT UPDATES — and that cost
// an evening on 21 Aug 2026.
//
// The manifest lost `"orientation": "portrait"` so a tablet could be used on its stand.
// It shipped, the tablet took the new CODE, and stayed locked upright anyway: Android
// had applied the orientation when the app was added to the home screen, and no update
// can reach that. Federico turned his tablet, found it sideways, and only a photograph
// of ANDROID'S OWN STATUS BAR rotated with the app identified the cause.
//
// The app cannot fix this by itself. What it can do is NOTICE and say so, which is what
// js/install-version.js is for. These checks pin the two halves that matter:
//   · the fingerprint covers exactly the fields a re-install is needed for, and is
//     stable against harmless rewrites of the file
//   · the notice NEVER fires when it has nothing to compare against
//
// ⚠️ And the last test bans the repeat: manifest.json may not change without the change
// being declared, because every change to it costs a re-install on every device.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fingerprint, shouldWarn, checkInstall, isStandalone, FIELDS_NEEDING_REINSTALL,
} from '../js/install-version.js';

const root = new URL('../', import.meta.url);
const read = (n) => readFileSync(new URL(n, root), 'utf8');
const MANIFEST = JSON.parse(read('manifest.json'));

const store = (initial = null) => {
  let v = initial;
  return { getItem: () => v, setItem: (_k, x) => { v = x; }, get value() { return v; } };
};

test('the fingerprint covers every field that needs a re-install', () => {
  for (const field of ['name', 'short_name', 'start_url', 'display', 'orientation']) {
    assert.ok(FIELDS_NEEDING_REINSTALL.includes(field), `${field} must be watched`);
    const changed = fingerprint({ ...MANIFEST, [field]: 'something-else' });
    assert.notEqual(changed, fingerprint(MANIFEST), `a change to ${field} must be noticed`);
  }
});

test('⚠️ orientation specifically — the field that caused this', () => {
  const before = fingerprint({ ...MANIFEST, orientation: 'portrait' });
  const after = fingerprint(MANIFEST);            // no orientation, as shipped
  assert.notEqual(before, after, 'losing the portrait lock must be noticed');
});

test('a changed icon needs a re-install too — it is baked into the installed app', () => {
  const other = { ...MANIFEST, icons: [{ src: 'icons/new.png', sizes: '192x192' }] };
  assert.notEqual(fingerprint(other), fingerprint(MANIFEST));
});

test('harmless fields do NOT raise a notice', () => {
  // ⚠️ A notice that fires for nothing is a notice nobody reads. Wording and colours
  // reach an installed app perfectly well and must stay silent.
  for (const field of ['description', 'background_color', 'theme_color']) {
    const changed = { ...MANIFEST, [field]: 'changed' };
    assert.equal(fingerprint(changed), fingerprint(MANIFEST), `${field} must not warn`);
  }
});

test('the fingerprint is stable against a harmless re-save', () => {
  // Same manifest, keys in a different order, icons listed the other way round.
  const shuffled = { icons: [...(MANIFEST.icons || [])].reverse(), ...MANIFEST };
  shuffled.icons = [...(MANIFEST.icons || [])].reverse();
  assert.equal(fingerprint(shuffled), fingerprint(MANIFEST),
    'reordering must not look like a change, or a re-saved file nags everybody');
});

test('⚠️ the first run never warns — it has nothing to compare against', () => {
  // Warning on a blank would fire on every fresh install, on every device whose storage
  // was cleared, and on the first run after this ships: three groups with nothing to fix.
  assert.equal(shouldWarn({ stored: '', current: 'a', standalone: true }), false);
  assert.equal(shouldWarn({ stored: null, current: 'a', standalone: true }), false);
});

test('a browser tab is never warned — the manifest does not apply there', () => {
  assert.equal(shouldWarn({ stored: 'a', current: 'b', standalone: false }), false);
});

test('an unreadable manifest is silent, never a guess', () => {
  assert.equal(shouldWarn({ stored: 'a', current: '', standalone: true }), false);
});

test('a real change, on an installed app, DOES warn', () => {
  assert.equal(shouldWarn({ stored: 'a', current: 'b', standalone: true }), true);
});

test('once adopted it is said once, and never again for the same change', async () => {
  // ⚠️ Leaving the old value would repeat the notice on every open until somebody
  // re-installs. Nagging is how a notice stops being read.
  const s = store('old-fingerprint');
  const win = { matchMedia: () => ({ matches: true }) };
  const first = await checkInstall({ win, storage: s, fetchManifest: async () => MANIFEST });
  assert.equal(first.warn, true, 'the change must be announced once');
  first.adopt();
  const second = await checkInstall({ win, storage: s, fetchManifest: async () => MANIFEST });
  assert.equal(second.warn, false, 'and never again for the same change');
});

test('⚠️ nothing is recorded until the caller says the notice was shown', async () => {
  // The caller has to wait for the sign-in cover to come down before it can show
  // anything. Recording before that wait spends the notice on somebody who never saw
  // it — the app is closed on the sign-in screen and the message is gone for good.
  const s = store('old-fingerprint');
  const win = { matchMedia: () => ({ matches: true }) };
  const r = await checkInstall({ win, storage: s, fetchManifest: async () => MANIFEST });
  assert.equal(r.warn, true);
  assert.equal(s.value, 'old-fingerprint', 'not adopted yet — the notice has not been shown');

  const again = await checkInstall({ win, storage: s, fetchManifest: async () => MANIFEST });
  assert.equal(again.warn, true, 'so the next open still says it');
});

test('with nothing to say it adopts immediately — a first run must not warn later', async () => {
  // Silent adoption has nothing to lose, so it does not wait for anything.
  const s = store(null);
  const win = { matchMedia: () => ({ matches: true }) };
  const first = await checkInstall({ win, storage: s, fetchManifest: async () => MANIFEST });
  assert.equal(first.warn, false, 'first run is silent');
  assert.equal(s.value, fingerprint(MANIFEST), 'and recorded there and then');
});

test('a failed fetch says nothing and does not throw', async () => {
  const s = store('old');
  const win = { matchMedia: () => ({ matches: true }) };
  const r = await checkInstall({ win, storage: s, fetchManifest: async () => { throw new Error('offline'); } });
  assert.equal(r.warn, false);
  assert.equal(r.reason, 'unreadable');
});

test('storage that refuses to work does not break the Home', async () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const win = { matchMedia: () => ({ matches: true }) };
  const r = await checkInstall({ win, storage: hostile, fetchManifest: async () => MANIFEST });
  assert.equal(r.warn, false, 'no stored value means first run, which is silent');
});

test('both ways of telling an installed app from a tab are honoured', () => {
  assert.equal(isStandalone({ navigator: { standalone: true } }), true, 'Safari');
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }) }), true, 'everybody else');
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStandalone(null), false);
});

test('the notice is wired into the Home, and ONLY the Home', () => {
  assert.match(read('index.html'), /js\/install-version-boot\.js/, 'the Home must load it');
  for (const page of ['orders.html', 'calculator.html', 'catalogue.html', 'pastries.html', 'foodcost.html']) {
    assert.doesNotMatch(read(page), /install-version-boot/,
      `${page} must not: a dialog in the middle of the work interrupts the one thing the app is for`);
  }
});

// ⚠️ A SOURCE CHECK, BECAUSE NOTHING ELSE REACHES THIS. The fault would live in the
// agreement between two files, each correct on its own — the same shape as the v1.53.2
// hotfix, where an update button was visible, enabled, on top, and carried `inert`.
//
// js/auth-gate.js marks every other child of <body> `inert` while the sign-in cover is
// up, and says in as many words that anything wanting to interrupt must wait for a
// location instead. A notice shown before then is drawn normally and receives nothing.
test('the notice waits for sign-in, the splash, and any other dialog', () => {
  const boot = read('js/install-version-boot.js');
  const body = boot.slice(boot.indexOf('async function run'));

  for (const [wait, why] of [
    ['afterSignIn', 'the sign-in cover makes everything behind it inert'],
    ['afterSplash', 'the splash sits in front of a dialog'],
    ['afterAnyOtherDialog', 'two dialogs at once means one covers the other'],
  ]) {
    assert.ok(body.includes(`await ${wait}()`), `run() must await ${wait}() — ${why}`);
    assert.ok(body.indexOf(`await ${wait}()`) < body.indexOf('alertDialog'),
      `${wait}() must come BEFORE the dialog opens`);
  }

  // ⚠️ AND THE RECORD IS MADE AFTER THE WAITS. Before them, an app closed on the
  // sign-in screen spends its one notice on somebody who never saw it.
  assert.ok(body.indexOf('adopt()') > body.indexOf('await afterSignIn()'),
    'adopt() must come after the waits, or the notice is thrown away unread');
  assert.ok(body.indexOf('adopt()') < body.indexOf('alertDialog'),
    'and before the dialog, or closing the app while it is open re-shows it for ever');
});

test('both files are precached', () => {
  const sw = read('sw.js');
  for (const f of ['./js/install-version.js', './js/install-version-boot.js']) {
    assert.ok(sw.includes(`'${f}'`), `${f} must be in the ASSETS list`);
  }
});

// ── the ban ────────────────────────────────────────────────────────────────────
// ⚠️ EVERY CHANGE TO manifest.json COSTS A RE-INSTALL ON EVERY DEVICE. It has happened
// 9 times in 753 commits — always a rename or a new start_url — and each time it silently
// stranded every installed app. The fingerprint below is what the notice compares
// against, so changing the manifest without updating it here would ship a change that
// warns nobody.
const DECLARED_FINGERPRINT =
  'name=Misé;short_name=Misé;start_url=index.html;display=standalone;orientation=;scope=;'
  + 'icons=icons/icon-192.png|192x192|any maskable,icons/icon-512.png|512x512|any maskable';

test('⚠️ manifest.json has not changed without the change being declared', () => {
  assert.equal(fingerprint(MANIFEST), DECLARED_FINGERPRINT,
    'manifest.json changed. EVERY installed app must be deleted and added again for this '
    + 'to take effect — an update cannot deliver it. If that is intended, update '
    + 'DECLARED_FINGERPRINT here, and tell Federico that everybody has to re-install.');
});
