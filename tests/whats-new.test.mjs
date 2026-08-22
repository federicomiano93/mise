// Unit tests for the "what's new" notice (P15 — the owner cannot read code, so
// these tests are the safety net).
//
// The failure that matters here is not a crash, it is being WRONG about who gets
// interrupted: a first-time user greeted with a list of changes to an app they have
// never opened, or a note silently swallowed because two releases went out while a
// phone sat unused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries, DEFAULT_LANGUAGE } from '../js/i18n.js';
import {
  RELEASES, newestId, pickNotices, noticeText,
} from '../js/whats-new.js';

const R3 = { id: 'r3', title: 'Orders', points: ['newest'] };
const R2 = { id: 'r2', title: 'Calculator', points: ['middle'] };
const R1 = { id: 'r1', title: 'Catalogue', points: ['oldest'] };
const LIST = [R3, R2, R1];   // newest first

// ── pickNotices ──────────────────────────────────────────────────────────────

test('a phone opening the app for the FIRST time is told nothing', () => {
  // No stamp, and no sign the app has ever run here: a list of changes to an app
  // you have never used is noise, not news.
  assert.deepEqual(pickNotices(LIST, '', false), []);
  assert.deepEqual(pickNotices(LIST, null, false), []);
  assert.deepEqual(pickNotices(LIST, undefined), []);   // defaults to "not returning"
});

test('a phone that has used the app but never had the feature IS told', () => {
  // Without this the very first release of the notices would tell nobody anything,
  // and they would not begin until the release after that.
  assert.deepEqual(pickNotices(LIST, '', true), [R3]);
  assert.deepEqual(pickNotices(LIST, null, true), [R3]);
});

test('the latest note only — a returning phone never gets the whole history', () => {
  assert.deepEqual(pickNotices(LIST, '', true), [R3]);
  assert.equal(pickNotices(LIST, '', true).length, 1);
});

test('once a stamp exists, "returning" stops mattering', () => {
  assert.deepEqual(pickNotices(LIST, 'r3', true), []);
  assert.deepEqual(pickNotices(LIST, 'r3', false), []);
  assert.deepEqual(pickNotices(LIST, 'r1', false), [R3, R2]);
  assert.deepEqual(pickNotices(LIST, 'r1', true), [R3, R2]);
});

test('a phone already on the newest release is told nothing', () => {
  assert.deepEqual(pickNotices(LIST, 'r3'), []);
});

test('one release missed shows that one release', () => {
  assert.deepEqual(pickNotices(LIST, 'r2'), [R3]);
});

test('two releases missed show BOTH, newest first — neither is swallowed', () => {
  assert.deepEqual(pickNotices(LIST, 'r1'), [R3, R2]);
});

test('a stamp nobody recognises shows the latest note only, never the history', () => {
  // A rolled-back release, or a hand-edited value.
  assert.deepEqual(pickNotices(LIST, 'something-else'), [R3]);
});

test('no releases at all is quiet, not a crash', () => {
  assert.deepEqual(pickNotices([], 'r1'), []);
  assert.deepEqual(pickNotices(null, 'r1'), []);
  assert.deepEqual(pickNotices(undefined, undefined), []);
  assert.deepEqual(pickNotices([], '', true), [], 'a returning phone with no notes is still quiet');
});

// ── newestId ─────────────────────────────────────────────────────────────────

test('the newest id is the one the phone records after reading', () => {
  assert.equal(newestId(LIST), 'r3');
  assert.equal(newestId([]), '');
  assert.equal(newestId(null), '');
});

// ── noticeText ───────────────────────────────────────────────────────────────

test('one notice reads as its area and its bullets', () => {
  assert.equal(noticeText([R3]), 'Orders\n• newest');
});

test('several notices are separated by a blank line, each under its own area', () => {
  assert.equal(noticeText([R3, R2]), 'Orders\n• newest\n\nCalculator\n• middle');
});

test('an entry with no points is dropped rather than shown as a bare heading', () => {
  assert.equal(noticeText([{ id: 'x', title: 'Empty', points: [] }, R3]), 'Orders\n• newest');
  assert.equal(noticeText([]), '');
  assert.equal(noticeText(null), '');
});

// ── the shipped list itself ──────────────────────────────────────────────────

test('every shipped release has a unique, non-empty id and something to say', () => {
  const ids = RELEASES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, 'a repeated id would re-show an old notice');
  RELEASES.forEach(r => {
    assert.ok(r.id && typeof r.id === 'string', 'every release needs a stamp');
    assert.ok(r.title, 'every release names the area it changed');
    assert.ok((r.points || []).length, 'a release with nothing to say must not be listed');
    r.points.forEach(p => assert.ok(p.length > 10, `too vague to be worth a tap: "${p}"`));
  });
});

test('the shipped list is ordered newest first', () => {
  assert.equal(newestId(), RELEASES[0].id);
});

// ⚠️ EVERY TITLE AND EVERY POINT IS A KEY, NOT A PHRASE — and this was NOT true until
// 22 Aug 2026: eight titles were the literals 'Pastries' and 'Orders'. noticeText()
// already ran them through t(), and a key the dictionary does not hold comes back as
// ITSELF, so they printed in English inside a fully Italian notice. Three times on one
// screen. Nothing failed: a missing key is deliberately silent (i18n-keys-exist only
// inspects LITERAL arguments, and t(n.title) is not one).
//
// It could not be seen at all while the notice was broken, which is the wider point —
// a defect hidden behind another defect surfaces the moment the first is fixed.
test('every shipped release names itself with a key the dictionary holds', () => {
  const known = _dictionaries()[DEFAULT_LANGUAGE];
  const italian = _dictionaries().it;
  const wrong = [];
  for (const r of RELEASES) {
    for (const key of [r.title, ...(r.points || [])]) {
      if (!(key in known)) wrong.push(`${r.id}: “${key}”`);
      else if (!(key in italian)) wrong.push(`${r.id}: “${key}” has no Italian`);
    }
  }
  assert.deepEqual(wrong, [],
    'a phrase written here does not fail — it prints in English inside an Italian notice');
});

// ⚠️ AND THE ENGLISH MUST NOT HAVE MOVED. Turning the eight literals into keys is only
// safe if an English reader sees exactly what they saw before; otherwise a translation
// fix quietly rewords a released note.
test('turning the titles into keys left the English untouched', () => {
  const en = _dictionaries()[DEFAULT_LANGUAGE];
  assert.equal(en['section.pastries'], 'Pastries');
  assert.equal(en['section.orders'], 'Orders');
  // The same key the Home card uses, so the notice and the card can never disagree.
  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /data-i18n="section\.pastries"/);
  assert.match(home, /data-i18n="section\.orders"/);
});

// ⚠️ THE FIXTURES ABOVE CANNOT SEE THIS, AND A MUTATION PROVED IT. They use titles
// like 'Orders' — which is what t('Orders') returns anyway, because a missing key
// comes back as itself. So translated and untranslated are the SAME STRING and the
// assertion holds either way: deleting the t() around the heading left every test
// green while the screen would print «section.orders» in both languages.
// A fixture whose values coincide proves nothing (v1.28.0, learnt again).
test('noticeText translates the heading, not only the bullets', () => {
  const out = noticeText([{ id: 'x', title: 'section.orders', points: ['help.gotIt'] }]);
  assert.equal(out, 'Orders\n• Got it');
  assert.doesNotMatch(out, /section\.|help\./, 'a key left untranslated prints on screen as itself');
});

// ⚠️ THE ONE-OFF REINSTALL ANNOUNCEMENT MUST ACTUALLY REACH A REAL PHONE, and "real"
// here has a precise meaning: v1.57.0's broken notice wrote the NEWEST id to every
// device before throwing, so every phone in the field carries
// '2026-08-06-pastries-confirm'. If the announcement were not newer than that, those
// devices — which are exactly the devices that need it — would be shown nothing.
//
// It exists because js/install-version.js cannot see an app installed before it did:
// no API anywhere exposes the manifest an installed app was built from (measured).
// A release note is the only channel that reaches them.
test('a phone carrying the stamp the broken notice left behind IS told to re-install', () => {
  const STAMP_LEFT_BY_THE_BUG = '2026-08-06-pastries-confirm';
  const shown = pickNotices(RELEASES, STAMP_LEFT_BY_THE_BUG, true);
  assert.equal(shown.length, 1, 'exactly one notice — the announcement, nothing else');
  assert.equal(shown[0].id, '2026-08-22-reinstall-once');

  const text = noticeText(shown);
  assert.doesNotMatch(text, /help\.|install\.stale/, 'every key must have become words');

  // ⚠️ ASSERT ON THE INSTRUCTION, NOT THE HEADING. The first version of this checked
  // the whole text for the word "re-install" — which the TITLE supplies, so it stayed
  // green when a mutation gutted the instruction itself. A mutation exposed it. Read
  // the bullets on their own.
  const instruction = text.split('\n').slice(1).join('\n');
  assert.match(instruction, /delete it and add it again/i,
    'the note must say what to DO, not merely name the subject');
  // ⚠️ The sentence whose absence left somebody with no app at all on 21 Aug.
  assert.match(instruction, /carry on from the browser/i,
    'it must offer the browser if the install will not go through');
  assert.match(instruction, /nothing is lost/i, 'and say plainly that nothing is lost');
});

test('a phone that has never opened the app is NOT shown the announcement', () => {
  // Nothing to re-install: it is about to be installed from the current manifest.
  assert.deepEqual(pickNotices(RELEASES, '', false), []);
});
