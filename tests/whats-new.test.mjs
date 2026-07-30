// Unit tests for the "what's new" notice (P15 — the owner cannot read code, so
// these tests are the safety net).
//
// The failure that matters here is not a crash, it is being WRONG about who gets
// interrupted: a first-time user greeted with a list of changes to an app they have
// never opened, or a note silently swallowed because two releases went out while a
// phone sat unused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
