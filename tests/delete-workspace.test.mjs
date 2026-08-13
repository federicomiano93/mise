// Removing a business that was created by mistake.
//
// WHY IT EXISTS. Federico opened Misé on his phone, added his own bakery from the
// customer list, and was left with a business he could not enter and could not
// remove: the app could create and never undo, so the Firebase console was the
// only way out — the exact thing this area of the app exists to stop needing.
//
// ⚠️⚠️ AND WHY IT IS DANGEROUS. This is the only function in the project that
// destroys a whole location. Past the moment somebody has opened it, that location
// is a real customer's — their recipes, their suppliers, their staff, their prices
// — and none of it comes back. Everything below is about that one constraint.
//
// ⚠️ THESE ARE SOURCE CHECKS, like tests/create-own-business.test.mjs beside them.
// functions/onboarding.js runs in Cloud Functions against the Admin SDK; `node
// --test` can neither call it nor fake Firestore convincingly. What can be pinned
// is the SHAPE, and the shape is where the danger is. The behaviour is proved by
// driving the app against the emulator — including the case the screen cannot
// reach, which is a business somebody HAS opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'functions', 'index.js'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'js', 'staff', 'firebase-staff.js'), 'utf8');
const SCREEN = readFileSync(join(ROOT, 'js', 'staff', 'businesses.js'), 'utf8');

function bodyOf(name) {
  const start = SERVER.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `${name} is not exported from functions/onboarding.js`);
  const end = SERVER.indexOf('\n});', start);
  assert.notEqual(end, -1, `could not read the end of ${name}`);
  return SERVER.slice(start, end);
}

const BODY = bodyOf('deleteWorkspace');

// ── The constraint everything rests on ──────────────────────────────────────

// ⚠️ THE ONE TEST TO KEEP IF EVERY OTHER ONE WERE DELETED. Without this check the
// function will happily destroy a customer's live business, and there is no way
// back — no backup covers "I ran the delete on the wrong row", because the delete
// is exactly what a backup restore would be undoing.
test('a business somebody has opened CANNOT be deleted', () => {
  assert.match(BODY, /members\.empty/,
    'the roster must be consulted');
  assert.match(BODY, /throw new HttpsError\('failed-precondition'/,
    'and a business with anybody in it must be refused outright');
});

// ⚠️ READ INSIDE THE CALL, never taken from the list the screen loaded. Between
// the list being drawn and the bin being tapped, somebody can have opened the
// business — the same shape as the alarm sender re-reading "is this still
// wanted?" an instant before it sends (v1.34.0).
test('the roster is read here, not trusted from the screen', () => {
  const guardAt = BODY.indexOf('members.empty');
  const readAt = BODY.indexOf('.collection(`locations/${locationId}/members`)');
  assert.notEqual(readAt, -1, 'the members collection must be read inside the function');
  assert.ok(readAt < guardAt, 'and it must be read BEFORE the guard that uses it');
});

// ── Who may call it ─────────────────────────────────────────────────────────

test('only a signed-in app administrator may call it', () => {
  assert.match(BODY, /requireAuth\(request\)/, 'it must know who is calling');
  assert.match(BODY, /requireAppAdmin\(uid\)/, 'and refuse everybody but the app administrator');
});

// ⚠️ SAME MESSAGE FOR "NOT THERE" AND "NOT YOURS", as reissueOwnerLink already
// does. Telling them apart confirms that a location exists to somebody with no
// business knowing it does.
test('it only touches a business this administrator created', () => {
  assert.match(BODY, /createdBy !== uid/,
    'somebody else\'s business must be refused');
  assert.match(BODY, /!doc\.exists \|\| \(doc\.data\(\) \|\| \{\}\)\.createdBy !== uid/,
    'and "not there" must be refused by the same branch, with the same words');
});

// ── What actually goes ──────────────────────────────────────────────────────

// ⚠️ THE LINK MUST GO WITH THE BUSINESS. An unused link is a working key; leaving
// its row behind after the location has gone keeps the fingerprint of a secret
// that opens nothing, for no reason.
test('the join codes are deleted along with the location', () => {
  assert.match(BODY, /collection\('join-codes'\)\.where\('locationId', '==', locationId\)/,
    'the codes for this location must be found');
  assert.match(BODY, /codes\.docs\.forEach\(code => batch\.delete\(code\.ref\)\)/,
    'and deleted, not merely marked used — the location they point at is going');
  assert.match(BODY, /batch\.delete\(ref\)/, 'and the location document itself');
  assert.match(BODY, /batch\.commit\(\)/, 'in one batch');
});

// ── The shape of the module, pinned ─────────────────────────────────────────

// ⚠️ THE TECHNIQUE FROM v1.24.1, and this is the file that most needs it. A rule
// matters more than a behaviour here: nothing in this project may delete a
// location by ITSELF. Pinning the export list means that adding, say, a
// "tidy up old businesses" job turns this red and NAMES the file that did it,
// instead of quietly shipping the first automatic deletion since the pastry
// prune was removed on Federico's instruction ("niente si deve cancellare in
// automatico dal database").
test('deleteWorkspace is the ONLY thing here that deletes a location', () => {
  const deleters = SERVER.match(/batch\.delete\(|\.doc\(`locations\/\$\{locationId\}`\)\.delete\(/g) || [];
  assert.ok(deleters.length > 0, 'the delete must exist at all');
  const outside = SERVER.split('export const deleteWorkspace')[0];
  assert.doesNotMatch(outside, /batch\.delete\(ref\)/,
    'nothing before deleteWorkspace may delete a location document');
  assert.doesNotMatch(SERVER, /onSchedule|setInterval|pubsub/,
    'and nothing here may run on a timer: this project deletes only when a person asks');
});

// ── The two halves have to agree ────────────────────────────────────────────

// The lesson of 12 Aug 2026: a function deployed and correct that NOTHING calls
// is a feature that does not exist, and every test stays green while it does not.
test('the screen really calls it, through the data layer', () => {
  assert.match(INDEX, /deleteWorkspace/,
    'a callable missing from functions/index.js is not deployed at all');
  assert.match(CLIENT, /export async function deleteWorkspace/,
    'the data layer must expose it');
  assert.match(SCREEN, /deleteWorkspace\(row\.id\)/,
    'and the screen must call it — otherwise the server half is dead code');
});

// ⚠️ signedInReady, NOT sessionReady. This screen sits ABOVE every location, so
// waiting for one to open waits for ever — the defect that left the Businesses
// list on "Loading…" in v1.41.0, which 45 green checks did not notice.
test('it waits for the sign-in, not for a location to open', () => {
  const at = CLIENT.indexOf('export async function deleteWorkspace');
  const fn = CLIENT.slice(at, CLIENT.indexOf('\n}', at));
  assert.match(fn, /await signedInReady/, 'it must wait for the auth token');
  assert.doesNotMatch(fn, /sessionReady/, 'and never for a location, which never opens here');
});

// ── What the person is told ─────────────────────────────────────────────────

// ⚠️ NAMED AND MARKED DANGEROUS. It is the only irreversible action on that
// screen, and the app's own dialog — never the browser's grey box, which was
// removed everywhere in PR #28 and comes back the moment one call sneaks in.
test('deleting asks first, names the business, and is dressed as destructive', () => {
  const at = SCREEN.indexOf('async function remove(');
  assert.notEqual(at, -1, 'the delete handler must exist');
  const fn = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
  assert.match(fn, /confirmDialog\(/, 'it must confirm');
  assert.match(fn, /danger: true/, 'and be coloured as a destructive action');
  // ⚠️ THE NAME IS A HOLE IN THE SENTENCE NOW, not a template in the code — and
  // every language must keep the hole, or the dialog stops saying WHICH business
  // is about to be deleted while still looking exactly as convincing.
  assert.match(fn, /t\('bz\.delete\.message', \{ name: row\.name \}\)/,
    'and name the business it is about to remove');
  for (const [lang, dict] of Object.entries(_dictionaries())) {
    assert.match(dict['bz.delete.message'], /\{name\}/,
      `in ${lang} the confirmation must name the business`);
  }
  assert.doesNotMatch(SCREEN, /\bwindow\.confirm\(|[^.]\bconfirm\(/,
    'never the browser\'s own confirm()');
});

// ⚠️ DRAWN ONLY WHERE IT CAN WORK. A button that exists to be refused teaches
// people that refusals are normal. Hiding it is courtesy; the server is the
// protection — both, and in that order.
test('the bin is drawn only on a business nobody has opened', () => {
  const at = SCREEN.indexOf('if (stranded) {');
  assert.notEqual(at, -1, 'the actions must be inside the stranded branch');
  const branch = SCREEN.slice(at, SCREEN.indexOf('\n    }', at));
  assert.match(branch, /bz-del-icon/, 'the bin belongs to that branch');
  assert.match(branch, /remove\(row, bin\)/, 'and it is what the bin calls');
});
