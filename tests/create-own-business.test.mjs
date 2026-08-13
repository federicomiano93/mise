// Creating a business for YOURSELF must not go through a link.
//
// THE DEFECT THIS CLOSES. Until 13 Aug 2026 createWorkspace had one path: mint a
// location, mint a one-time link, and let whoever opens it become the owner. That
// is right for a customer — it is their business, their staff, their prices, and
// whoever sells the app has no reason to hold those keys.
//
// It is wrong when there is nobody to invite. Federico created a second business
// for himself and could not get in: redeeming the link meant signing up again
// with an email that already had an account, which Firebase refuses outright.
// The link was not a missing feature for that case, it was a step that should
// never have been in the way.
//
// ⚠️ THESE ARE SOURCE CHECKS. functions/onboarding.js runs in Cloud Functions
// against the Admin SDK; `node --test` can neither call it nor fake Firestore
// convincingly. What can be pinned is the SHAPE — and the shape is where the
// danger is: three writes that must land together, and a link that must not be
// minted. The behaviour itself is proved by driving the app on the emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'js', 'staff', 'firebase-staff.js'), 'utf8');
const SCREEN = readFileSync(join(ROOT, 'js', 'staff', 'new-customer.js'), 'utf8');

// The body of createWorkspace, from its declaration to the closing of its own
// braces. Parameter lists are walked past first, for the reason spelled out in
// tests/staff-call-gates.test.mjs.
function createWorkspaceBody() {
  const start = SERVER.indexOf('export const createWorkspace');
  assert.notEqual(start, -1, 'createWorkspace is not exported from functions/onboarding.js');
  const end = SERVER.indexOf('\n});', start);
  assert.notEqual(end, -1, 'could not read the end of createWorkspace');
  return SERVER.slice(start, end);
}

const BODY = createWorkspaceBody();
// The `if (forSelf) { … }` branch only.
const SELF_BRANCH = (() => {
  const at = BODY.indexOf('if (forSelf)');
  assert.notEqual(at, -1, 'createWorkspace has no branch for a business of your own');
  return BODY.slice(at, BODY.indexOf('\n  }', at));
})();

// ── The three writes that must land together ────────────────────────────────

// ⚠️ HALF OF THIS IS WORSE THAN NONE OF IT. A location that exists with no member
// is exactly the stranded state the Businesses screen had to be built to repair
// (v273) — and here it would be stranded for the person who just made it, with no
// link to fall back on, recoverable only from the Firebase console.
test('a business of your own is created in ONE transaction', () => {
  assert.match(SELF_BRANCH, /runTransaction/,
    'the location, the membership and the roster row must land together or not at all');
  for (const [what, pattern] of [
    ['the location document', /tx\.set\(db\(\)\.doc\(`locations\/\$\{locationId\}`\)/],
    ['the membership', /tx\.set\(db\(\)\.doc\(`users\/\$\{uid\}`\)/],
    ['the roster row', /tx\.set\(db\(\)\.doc\(`locations\/\$\{locationId\}\/members\/\$\{uid\}`\)/],
  ]) {
    assert.match(SELF_BRANCH, pattern, `${what} must be written inside the transaction`);
  }
});

// ⚠️ merge:true, because the account almost certainly owns something already —
// that is what makes this business "one of mine". A blind set would delete every
// other membership the account has, locking somebody out of their own venues.
test('the membership is MERGED, never overwritten', () => {
  assert.match(SELF_BRANCH, /\{ merge: true \}/,
    'writing users/{uid} whole would wipe every other location this account belongs to');
});

test('the owner value comes from the shared helper, not a literal', () => {
  assert.match(SELF_BRANCH, /membershipValue\('owner'\)/,
    "the role IS the membership value — spelling it by hand is how the three copies drift");
});

// ── No link, and that is the point ──────────────────────────────────────────

// ⚠️ An unused link is a WORKING KEY. One minted for a business you are already
// inside protects nothing and is a way in for whoever finds it later.
test('no link is minted for a business of your own', () => {
  assert.doesNotMatch(SELF_BRANCH, /mintLinkToken|storeCode/,
    'a business you are already inside needs no invitation, and an unused one is a live key');
  assert.match(SELF_BRANCH, /return \{ locationId, mine: true \}/,
    'the caller must be told it is theirs, and given no token to leak');
});

// The customer path must keep behaving exactly as before.
test('a customer business still gets a link, and the caller still stays out', () => {
  const after = BODY.slice(BODY.indexOf('const token = mintLinkToken()'));
  assert.match(after, /storeCode\(/, 'the customer path still stores a one-time code');
  assert.doesNotMatch(after, /users\/\$\{uid\}/,
    'creating a CUSTOMER must never make the creator a member of their business');
});

// ── The two halves have to agree ────────────────────────────────────────────

// The lesson of 12 Aug 2026: createWorkspace shipped correct and deployed, and
// nothing called it — both halves right on their own, the feature absent.
test('the client passes forSelf through, and the screen can set it', () => {
  assert.match(CLIENT, /forSelf: opts\.forSelf === true/,
    'the data layer must forward the choice, strictly');
  assert.match(SCREEN, /forSelf/,
    'the screen must be able to ask for it — otherwise the server branch is dead code');
  assert.match(SCREEN, /createWorkspace\(typed, sections, \{ forSelf \}\)/,
    'the screen must actually pass it at the call site');
});

// ⚠️ THERE IS NO CHOICE ON THE SCREEN ANY MORE, AND THAT IS THE FIX.
//
// It was two radio rows for a few hours on 13 Aug 2026, defaulting to "for a
// customer" — and Federico, minutes after opening the app on his phone, created
// his own bakery as a customer's and could not get into it. The intent is already
// stated by the door somebody came through, so the screen is TOLD instead of
// asking. A screen that asks is a screen that can be answered wrongly.
test('the screen is told who the business is for, it does not ask', () => {
  assert.doesNotMatch(SCREEN, /nc-owner/,
    'the owner radio group must be gone, not hidden — dormant code gets switched back on');
  assert.doesNotMatch(SCREEN, /'For a customer'/,
    'the radio labels must be gone with it');
  assert.match(SCREEN, /const forSelf = ownerKind === 'self'/,
    'the kind is read once, from the caller');
});

// ⚠️ AND A CALLER THAT FORGETS MUST FAIL LOUDLY, never pick for itself. Neither
// default is safe: 'customer' silently strands a business its creator cannot
// enter — the exact defect above — and 'self' silently puts somebody else's
// business into this account. Same choice, same reason, as js/location.js
// throwing when no location is open.
test('a caller that does not say who it is for gets an error, not a guess', () => {
  assert.match(SCREEN, /if \(!OWNER_KINDS\.includes\(ownerKind\)\)/,
    'the kind must be validated');
  assert.match(SCREEN, /throw new Error/,
    'and an unrecognised kind must throw rather than default');
});

// The two doors, each stating its own meaning. If either stopped passing one,
// the screen would throw — but the point of pinning it here is that a WRONG one
// is silent, and it is the wrong one that cost an afternoon.
test('each entry point says which kind of business it adds', () => {
  const gate = readFileSync(join(ROOT, 'js', 'auth-gate.js'), 'utf8');
  const list = readFileSync(join(ROOT, 'js', 'staff', 'businesses.js'), 'utf8');
  assert.match(gate, /openNewCustomer\(\{ host: gateHost\(\), ownerKind: 'self' \}\)/,
    '"Choose location" lists YOUR venues, so a business added there is one of yours');
  assert.match(list, /openNewCustomer\(\{ onClose: load, ownerKind: 'customer' \}\)/,
    'the customer list adds customers, and its creator stays out');
});
