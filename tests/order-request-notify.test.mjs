// WHO gets told when somebody sends an order list.
//
// ⚠️⚠️ THIS IS THE ONLY PART OF THE NOTIFICATION THAT CAN BE PROVED FROM HERE.
// There is no fake phone to receive a push, so nothing on this machine can show
// that a notification ever arrives — that is Federico's, on a real handset. What
// CAN be proved, and matters most, is the choice of recipients: every other
// notification in this app goes to every phone in the location, and this one must
// not. Get it wrong and the whole kitchen buzzes for a list addressed to one
// person, which is how a team learns to switch notifications off entirely.
//
// The rule is asserted against the SOURCE of functions/index.js rather than by
// running it: the function needs the Admin SDK, Firestore and a live event, none
// of which exist under `node --test`. A source check is weaker than a behaviour
// check and is used here for the same reason tests/firebase-offline-cache.test.mjs
// uses one — the alternative is no check at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'functions', 'index.js'), 'utf8');

test('the order-list notification is wired to the right collection', () => {
  assert.match(src, /document:\s*'locations\/\{lid\}\/order-requests\/\{id\}'/);
  assert.match(src, /export const notifyOrderRequest = onDocumentCreated/);
});

// ⚠️ ON CREATE ONLY, like its client-order twin. Ticking a line off rewrites the
// document; notifying on every write would buzz once per tick, all day.
test('it fires when a list ARRIVES, not every time somebody ticks a line', () => {
  assert.equal(/notifyOrderRequest = onDocumentWritten/.test(src), false);
  assert.equal(/notifyOrderRequest = onDocumentUpdated/.test(src), false);
});

test('only the two upper roles are told', () => {
  const fn = src.slice(src.indexOf('async function managersAmong'));
  assert.match(fn, /access === 'owner' \|\| access === 'manager'/);
  // The membership VALUE is the role — the same fact firestore.rules reads. A
  // second place deciding what a role is would be a second answer waiting to
  // disagree, which this project has already paid for three times.
  assert.match(fn, /users\/\$\{uid\}/);
  assert.match(fn, /locations \|\| \{\}\)\[lid\]/);
});

test('the person who sent the list is never told about their own tap', () => {
  const fn = src.slice(src.indexOf('async function managersAmong'));
  assert.match(fn, /uid === senderUid/);
  assert.match(src, /managersAmong\(tokens\.docs, lid, request\.fromUid\)/);
});

// ⚠️ THE SAFE DIRECTION IS SILENCE. A missed notification leaves a list sitting
// in the app, where the banner and the Home badge still show it; a notification
// sent because a role could not be read is a phone buzzing on no evidence.
test('a role that cannot be read means DO NOT send', () => {
  const fn = src.slice(src.indexOf('async function managersAmong'));
  assert.match(fn, /roleByUid\.set\(uid, undefined\)/);
});

// One read per person, not per phone (P14).
test('a person with three phones costs one role read, not three', () => {
  const fn = src.slice(src.indexOf('async function managersAmong'));
  assert.match(fn, /new Set\(tokens\.map/);
});

// ⚠️ A QUIET PHONE WITH NOTHING IN THE LOG IS INDISTINGUISHABLE FROM A BROKEN
// FUNCTION — the rule the whole notification system in this app is built on.
test('every reason for sending nothing is written down', () => {
  assert.match(src, /An order list arrived, but nobody who runs this place has notifications on/);
});

test('the tap lands on Orders, and the words follow the venue’s language', () => {
  assert.match(src, /targetPage\('orderRequest'\)/);
  assert.match(src, /orderRequestNotification\(request, await languageOf\(lid\)\)/);
});
