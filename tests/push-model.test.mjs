// The scheduling decisions, which the app and the server BOTH read.
//
// The one that matters most is `isStillDue`: it is the only thing standing between
// the owner and a phone that buzzes for a step finished ten minutes ago — and an
// alarm that goes off for nothing is the fastest way to get notifications turned
// off for good, taking the useful ones with them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_AHEAD_MS, MAX_AHEAD_MS, MAX_LATE_MS, MAX_TITLE, MAX_BODY,
  isSchedulable, buildTimerDoc, isValidTimerDoc,
  isStillDue, skipReason, timerNotification, orderNotification, orderRequestNotification,
  targetPage, notificationTag, PUSH_KINDS,
} from '../js/push-model.js';

const NOW = 1_700_000_000_000;

// ── Scheduling ────────────────────────────────────────────────────────────────

test('an alarm far enough ahead is scheduled', () => {
  assert.equal(isSchedulable(NOW + 20 * 60 * 1000, NOW), true);
  assert.equal(isSchedulable(NOW + MIN_AHEAD_MS, NOW), true);
  assert.equal(isSchedulable(NOW + MAX_AHEAD_MS, NOW), true);
});

test('a timer too short to beat the delivery is NOT scheduled', () => {
  // Enqueueing and delivering take seconds between them, so a push for a
  // 10-second timer would arrive after the app's own alarm had already sounded.
  assert.equal(isSchedulable(NOW + 10 * 1000, NOW), false);
  assert.equal(isSchedulable(NOW + MIN_AHEAD_MS - 1, NOW), false);
});

test('an alarm in the past, or absurdly far ahead, is refused', () => {
  assert.equal(isSchedulable(NOW - 1000, NOW), false);
  assert.equal(isSchedulable(NOW, NOW), false);
  assert.equal(isSchedulable(NOW + MAX_AHEAD_MS + 1, NOW), false);
});

test('junk never schedules anything', () => {
  for (const bad of [null, undefined, NaN, 'soon', {}, Infinity, -Infinity]) {
    assert.equal(isSchedulable(bad, NOW), false, `${String(bad)} was schedulable`);
  }
  assert.equal(isSchedulable(NOW + 60000, 'x'), false);
});

test('the document written is exactly what the server needs, and is trimmed', () => {
  const doc = buildTimerDoc({
    uid: '  u1  ', token: ' tok ', fireAt: NOW + 60000,
    title: '  Croissant  ', body: '  Add the butter  ', nowMs: NOW,
  });
  assert.deepEqual(doc, {
    uid: 'u1', token: 'tok', fireAt: NOW + 60000,
    title: 'Croissant', body: 'Add the butter',
    active: true, createdAt: NOW,
  });
});

test('a document built from junk holds zeros and blanks, never NaN', () => {
  const doc = buildTimerDoc({});
  assert.equal(doc.fireAt, 0);
  assert.equal(doc.createdAt, 0);
  assert.equal(doc.title, '');
  assert.equal(Number.isNaN(doc.fireAt), false);
  assert.equal(isValidTimerDoc(doc, NOW), false);
});

test('long text is cut rather than sent whole', () => {
  const doc = buildTimerDoc({ title: 'x'.repeat(300), body: 'y'.repeat(400), nowMs: NOW });
  assert.equal(doc.title.length, MAX_TITLE);
  assert.equal(doc.body.length, MAX_BODY);
});

test('a timer with nowhere to send it, or nothing to say, is not valid', () => {
  const base = { uid: 'u1', token: 'tok', fireAt: NOW + 60000, title: 'Croissant', nowMs: NOW };
  assert.equal(isValidTimerDoc(buildTimerDoc(base), NOW), true);
  assert.equal(isValidTimerDoc(buildTimerDoc({ ...base, token: '' }), NOW), false);
  assert.equal(isValidTimerDoc(buildTimerDoc({ ...base, uid: '' }), NOW), false);
  assert.equal(isValidTimerDoc(buildTimerDoc({ ...base, title: '   ' }), NOW), false);
  assert.equal(isValidTimerDoc(null, NOW), false);
});

// ── The check that stops a phone buzzing for nothing ──────────────────────────

const due = (over = {}) => ({ active: true, fireAt: NOW, ...over });

test('an alarm due right now, still wanted, is sent', () => {
  assert.equal(isStillDue(due(), NOW), true);
});

test('A CANCELLED ALARM IS NEVER SENT', () => {
  // Somebody tapped Done, Skip, or left the mix. This single flag is the whole
  // cancellation mechanism, and it is read an instant before sending precisely
  // because deleting a queued job can fail quietly and this cannot.
  assert.equal(isStillDue(due({ active: false }), NOW), false);
  assert.equal(isStillDue(due({ active: undefined }), NOW), false);
  assert.equal(isStillDue(due({ active: 'true' }), NOW), false, 'only a real boolean counts');
});

test('AN ALARM THAT IS VERY LATE IS DROPPED, not sent', () => {
  // "Add the butter" an hour after the dough was finished is worse than silence.
  assert.equal(isStillDue(due(), NOW + MAX_LATE_MS), true);
  assert.equal(isStillDue(due(), NOW + MAX_LATE_MS + 1), false);
  assert.equal(isStillDue(due(), NOW + 60 * 60 * 1000), false);
});

test('an alarm that fires EARLY is not sent either', () => {
  // A queue retry or a clock skew. Ringing before the dough is ready is its own
  // kind of wrong, and silently accepting it would hide the real problem.
  assert.equal(isStillDue(due(), NOW - 1), false);
  assert.equal(isStillDue(due(), NOW - 60000), false);
});

test('a missing or junk timer is never sent', () => {
  assert.equal(isStillDue(null, NOW), false);
  assert.equal(isStillDue(undefined, NOW), false);
  assert.equal(isStillDue({}, NOW), false);
  assert.equal(isStillDue(due({ fireAt: 'x' }), NOW), false);
});

test('every skip says WHY, so a quiet phone is never a mystery', () => {
  assert.equal(skipReason(due(), NOW), '', 'a valid send has no reason');
  assert.match(skipReason(null, NOW), /no such timer/);
  assert.match(skipReason(due({ active: false }), NOW), /cancelled/);
  assert.match(skipReason(due(), NOW - 5000), /5s early/);
  assert.match(skipReason(due(), NOW + 30 * 60 * 1000), /30 minutes late/);
});

// ── What the phone shows ──────────────────────────────────────────────────────

test('a notification is never blank and never says undefined', () => {
  // It is read on a lock screen with no context around it.
  assert.deepEqual(timerNotification({ title: 'Croissant', body: 'Add the butter' }),
    { title: 'Croissant', body: 'Add the butter' });
  const empty = timerNotification({});
  assert.ok(empty.title.length > 0 && empty.body.length > 0);
  assert.equal(/undefined|null|NaN/.test(empty.title + empty.body), false);
  const junk = timerNotification(null);
  assert.equal(/undefined|null|NaN/.test(junk.title + junk.body), false);
});

test('an order notification names who it is from', () => {
  // Fake names: this repo is public, so no real client appears in a test.
  const n = orderNotification({ clientName: 'Bar Centrale', date: '2026-08-12' });
  assert.match(n.title, /Bar Centrale/);
  assert.match(n.body, /2026-08-12/);
});

test('…and still says something useful when the name is missing', () => {
  const n = orderNotification({});
  assert.ok(n.title.length > 0 && n.body.length > 0);
  assert.equal(/undefined|null/.test(n.title + n.body), false);
  assert.equal(/undefined|null/.test(orderNotification(null).title), false);
});

test('a tap lands on the screen that answers the notification', () => {
  assert.match(targetPage('timer'), /catalogue/);
  assert.match(targetPage('order'), /calculator/);
  assert.match(targetPage('orderRequest'), /orders/);
  assert.match(targetPage('nonsense'), /catalogue/, 'an unknown kind still opens somewhere');
});

test('one notification per thing, so a re-delivery replaces rather than stacks', () => {
  assert.equal(notificationTag('timer', 'abc'), 'timer-abc');
  assert.equal(notificationTag('order', '2026-08-12_c1'), 'order-2026-08-12_c1');
  assert.equal(notificationTag('nonsense', 'abc'), 'timer-abc');
  assert.equal(notificationTag('timer', ''), 'timer-x');
  assert.equal(notificationTag('timer', null), 'timer-x');
});

test('the kinds are a closed list', () => {
  assert.deepEqual([...PUSH_KINDS], ['timer', 'order', 'orderRequest']);
});

// ── An order list somebody sent ──────────────────────────────────────────────

test('the list notification names WHO is waiting, and how much there is', () => {
  const n = orderRequestNotification({ fromName: 'Marco Rossi', quantities: { a: 1, b: 2 } });
  assert.match(n.title, /Marco Rossi/);
  assert.match(n.body, /2/);
});

test('a list with no name still says something a person can act on', () => {
  const n = orderRequestNotification({ quantities: { a: 1 } });
  assert.equal(/undefined|null/.test(n.title + n.body), false);
  assert.ok(n.title.length > 0 && n.body.length > 0);
  const junk = orderRequestNotification(null);
  assert.equal(/undefined|null/.test(junk.title + junk.body), false);
  assert.ok(junk.body.length > 0);
});

// ⚠️ THE ONE THIS FILE EXISTS FOR SINCE THE APP SPEAKS TWO LANGUAGES. A
// notification is written when nobody is looking at the app, so the page that
// knows the language cannot build it — the server has to, and until this release
// every notification was English in both languages.
test('the notifications are written in the venue’s language', () => {
  const it = orderRequestNotification({ fromName: 'Marco', quantities: { a: 1, b: 2 } }, 'it');
  const en = orderRequestNotification({ fromName: 'Marco', quantities: { a: 1, b: 2 } }, 'en');
  assert.notEqual(it.title, en.title);
  assert.match(it.body, /voci/);
  assert.match(en.body, /items/);

  assert.match(orderNotification({ clientName: 'Bar Centrale', date: '2026-08-12' }, 'it').title, /Nuovo ordine/);
  assert.match(timerNotification({}, 'it').body, /Tempo scaduto/);
});

test('Italian gets a real singular, not "1 voci"', () => {
  assert.match(orderRequestNotification({ fromName: 'M', quantities: { a: 1 } }, 'it').body, /1 voce/);
  assert.match(orderRequestNotification({ fromName: 'M', quantities: { a: 1 } }, 'en').body, /1 item/);
});

// ⚠️ A LANGUAGE NOBODY RECOGNISES MUST NOT PRODUCE A BLANK LOCK SCREEN. A venue
// that has never chosen one, or one a future version writes, still gets words.
test('an unknown language falls back to English rather than to nothing', () => {
  const n = orderRequestNotification({ fromName: 'Marco', quantities: { a: 1 } }, 'zz');
  assert.match(n.body, /item/);
  assert.ok(timerNotification({}, undefined).body.length > 0);
});
