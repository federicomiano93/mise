// Source-level check (P15) for a rule that otherwise lives only in a comment,
// and whose failure mode is a screen that hangs for ever in silence.
//
// ⚠️ THE DEFECT THIS PINS, found by driving the app on 12 Aug 2026. The three
// calls that belong to the app's OWN back office are made from the Misé home
// screen, which sits ABOVE every location. They awaited `sessionReady`, which
// resolves when a location OPENS — and on that screen none ever does. The
// Businesses list sat on "Loading…" indefinitely: no error, nothing in the
// console, nothing on screen. Every check about the panel passed, because the
// panel was fine.
//
// The two halves are each defensible on their own, which is what makes it the
// same shape as the sale that had no door (v1.39.0): a promise that means "a
// location is open", and a screen that has no location. Nothing links them
// except this test.
//
// ⚠️ AND THE OPPOSITE SWAP IS ALSO A DEFECT, so both directions are pinned. The
// venue calls read currentSession().locationId; on signedInReady they could fire
// with no location open and send `undefined` as the place to write to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/staff/firebase-staff.js', import.meta.url), 'utf8');

// The body of one exported async function, comments and all.
//
// ⚠️ IT SKIPS THE PARAMETER LIST FIRST, and that is not tidiness. Taking "the
// first { after the name" reads the default value in `opts = {}` as the body —
// so the body comes back as the two characters `{}`, every assertion below finds
// nothing, and the test reports a missing `await signedInReady` on a function
// that has one. That happened on 13 Aug 2026, and the failure pointed at
// perfectly correct code: a reader that can be fooled by an ordinary signature
// makes the suite lie about the app.
function bodyOf(name) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} is not exported from firebase-staff.js`);

  // Walk the parameter list to its matching ')', so any braces inside it — a
  // destructured argument, a default object — cannot be mistaken for the body.
  const paramsOpen = src.indexOf('(', start);
  let parens = 0;
  let paramsEnd = -1;
  for (let i = paramsOpen; i < src.length; i++) {
    if (src[i] === '(') parens++;
    else if (src[i] === ')' && --parens === 0) { paramsEnd = i; break; }
  }
  assert.notEqual(paramsEnd, -1, `could not read the parameters of ${name}`);

  const open = src.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`could not read the body of ${name}`);
}

// Strip comments: the warnings above name both promises on purpose, and a scan
// that reads them would find whichever it was told to look for in the prose.
const code = name => bodyOf(name).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── Above every location: wait for the ACCOUNT ───────────────────────────────

// These reach businesses their caller is deliberately not a member of. There is
// no location to wait for, and waiting for one is waiting for ever.
for (const name of ['createWorkspace', 'listWorkspaces', 'reissueOwnerLink']) {
  test(`${name} waits for the account, not for a location`, () => {
    const body = code(name);
    assert.ok(body.includes('await signedInReady'),
      `${name} must await signedInReady — it is called from the Misé home, where no location opens`);
    assert.ok(!body.includes('await sessionReady'),
      `${name} awaits sessionReady, which never resolves on the screen that calls it: it will hang for ever`);
  });

  test(`${name} does not reach for the open location`, () => {
    assert.ok(!code(name).includes('currentSession()'),
      `${name} is about the app's customers, never about the venue you happen to have open`);
  });
}

// ── Inside a location: wait for the LOCATION ─────────────────────────────────

for (const name of ['createJoinCode', 'setMemberRole', 'setMemberName']) {
  test(`${name} still waits for a location to be open`, () => {
    const body = code(name);
    assert.ok(body.includes('await sessionReady'),
      `${name} reads the open location, so it must wait for one`);
    assert.ok(!body.includes('await signedInReady'),
      `${name} on signedInReady could fire with no location and write to \`undefined\``);
  });
}

// ── The one that waits for neither ───────────────────────────────────────────

// ⚠️ Whoever is redeeming a code has no location AND is, on the join screen, in
// the middle of getting an account. It is the screen that exists to fix having
// neither, so it cannot wait for either.
test('redeemJoinCode waits for nothing at all', () => {
  const body = code('redeemJoinCode');
  assert.ok(!body.includes('await sessionReady'));
  assert.ok(!body.includes('await signedInReady'));
});

// ── The promise itself ───────────────────────────────────────────────────────

test('signedInReady is exported, and resolved after the anonymous check', () => {
  for (const file of ['../js/firebase.js', '../js/firebase.example.js']) {
    const fb = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(fb.includes('export const signedInReady'), `${file} must export signedInReady`);

    // ⚠️ A leftover anonymous session is not a signed-in person. Resolved above
    // the check, every one of the app's back-office calls would be woken by one.
    const anon = fb.indexOf('user.isAnonymous');
    const mark = fb.indexOf('markSignedIn(user)');
    assert.ok(anon !== -1 && mark !== -1 && mark > anon,
      `${file}: markSignedIn must come AFTER the anonymous session is discarded`);
  }
});
