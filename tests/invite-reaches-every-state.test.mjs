// An invitation must be answered in EVERY state a person can be holding one, and
// until 13 Aug 2026 it was answered in only two of them.
//
// THE DEFECT THIS PINS. js/auth-gate.js render() switches on the session status.
// The invitation was handled in 'signed-out' and 'no-access' — somebody with no
// account, and somebody with an account but no location. It was handled nowhere
// else, so an owner ALREADY SIGNED IN who opened an invitation got nothing at all:
// no dialog, no error, no hint. The token sat in the address bar doing nothing.
//
// Both halves were written deliberately. The hashchange listener even explains the
// omission in words — "an invitation is not a reason to throw a working session off
// its screen" — which is right for an employee at the mixer and wrong for the person
// the feature exists for. Federico found it the first time he tried to give himself
// a second business, and could not.
//
// ⚠️ THESE ARE SOURCE CHECKS, and they have to be: render() needs a DOM, a Firebase
// session and a live gate element, none of which exist under `node --test`. What can
// be pinned is the SHAPE — that no signed-in branch is left without an answer — and
// that is exactly the thing that was wrong. Mutation-tested: delete offerInvite from
// any one branch and the first test names that branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(join(ROOT, 'js', 'auth-gate.js'), 'utf8');

// The body of one `case 'x':` inside render()'s switch, up to its `break`.
function caseBody(status) {
  const start = SOURCE.indexOf(`case '${status}':`);
  assert.notEqual(start, -1, `render() has no case for '${status}' — has a state been renamed?`);
  const end = SOURCE.indexOf('break;', start);
  assert.notEqual(end, -1, `case '${status}' has no break — this test can no longer read it`);
  return SOURCE.slice(start, end);
}

// ⚠️ EVERY state in which somebody is already through the door. A new one added
// here without an answer to an invitation is the exact defect of 13 Aug 2026,
// wearing whatever name the new state is given.
const INSIDE = ['ready', 'hub', 'choose-location'];

// States reached WITHOUT a usable account: the invitation is answered by putting
// the join screen up directly, not by asking a question over the app.
const OUTSIDE = ['signed-out', 'no-access'];

test('every state where somebody is already signed in offers the invitation', () => {
  for (const status of INSIDE) {
    assert.match(caseBody(status), /offerInvite\(/,
      `'${status}' does not offer an invitation: somebody already signed in who opens ` +
      'a join link gets nothing at all, silently. See the file header.');
  }
});

test('the states without an account handle it too, by their own route', () => {
  for (const status of OUTSIDE) {
    assert.match(caseBody(status), /invitedWith/,
      `'${status}' ignores an invitation`);
  }
});

// ⚠️ 'ready' is the one where the app is VISIBLE. Asking over a cover that is still
// up puts the question in front of a page nobody can see behind, and "Not now" would
// leave somebody staring at the cover with no way on.
test('in ready, the question comes AFTER the app is uncovered', () => {
  const body = caseBody('ready');
  const uncovered = body.indexOf('hidden = true');
  const asked = body.indexOf('offerInvite(');
  assert.ok(uncovered !== -1 && asked !== -1, 'both steps must be present');
  assert.ok(uncovered < asked,
    'offerInvite must come after the gate is hidden, or the dialog covers a covered page');
});

// ⚠️ THE HALF THAT MAKES THE OTHER HALF WORK. Redeeming can need a sign-in first,
// and signing in RELOADS — so an invitation living only in a module variable is
// thrown away by the very step the app recommends ("sign in with it instead").
// sessionStorage for the same reason as hub-passed and pick-venue: memory is too
// short for a multi-page app, localStorage too long for a one-off.
test('the invitation survives a reload, and is stored per session', () => {
  assert.match(SOURCE, /sessionStorage\.setItem\(INVITE_KEY/,
    'the invitation must be remembered across the reload a sign-in causes');
  assert.doesNotMatch(SOURCE, /localStorage\.setItem\(INVITE_KEY/,
    'localStorage would offer an invitation declined today again next month');
});

// ⚠️ What comes back out of storage is no more trustworthy than what was in the
// address bar — another tab or a stale entry could have left anything there, and
// handing rubbish to redeemJoinCode spends one of five attempts an hour.
test('what comes back from storage is validated, not trusted', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function rememberedInvite'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /kindOfTyped/,
    'a token read back from storage must be shape-checked, exactly as the URL one is');
});

// A half-forget is worse than none: gone from the address bar and still offered on
// the next page, with nothing on screen explaining where it came from.
test('forgetting an invitation clears all three places at once', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function forgetInvite'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /invitedWith = ''/, 'the variable must be cleared');
  assert.match(body, /removeItem\(INVITE_KEY\)/, 'the stored copy must be cleared');
  assert.match(body, /replaceState/, 'the address bar must be cleared');
});

// ⚠️ IT IS A QUESTION, NOT A REDIRECT — the whole reason the fix does not break the
// case it was warned about. Taking over the screen would answer the owner's need by
// destroying an employee's half-typed order.
test('the offer is a dialog with a way to decline', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function offerInvite'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /confirmDialog/, 'it must ask, not act');
  // ⚠️ THE WORDS MOVED TO THE DICTIONARY, THE RULE DID NOT — and asking every
  // language is the stronger question. A translation that dropped the decline
  // label would leave only Escape, which on a phone is nothing at all.
  assert.match(body, /cancelLabel: t\('invite\.cancel'\)/,
    'the dialog must offer a way to decline');
  for (const lang of Object.keys(_dictionaries())) {
    const word = _dictionaries()[lang]['invite.cancel'];
    assert.ok(word && word.trim().length > 1,
      `${lang} must say how to decline, in words`);
  }
  assert.match(body, /forgetInvite\(\)/, 'declining must end it for this opening of the app');
  assert.match(body, /inviteOffered/, 'it must not ask twice in one page');
});

// ⚠️ THE SECOND HALF OF THE SAME DEFECT, still there after the first fix — and
// found while building the driver, not by any test.
//
// A link opened while the app is ALREADY on this page changes only the fragment,
// and a browser does not reload for that. The hashchange listener exists for it,
// and it used to end with `if (lastSession.status !== 'ready') render(...)` — so
// the state where somebody is inside and working, the single most likely place to
// open an invitation from, was the one state that still did nothing at all.
//
// Reacting is now unconditional. Not throwing anybody off their screen is kept by
// offerInvite ASKING, which is where that rule belongs.
test('an invitation arriving by fragment reacts in every state, ready included', () => {
  const listener = SOURCE.slice(SOURCE.indexOf("addEventListener('hashchange'"));
  const body = listener.slice(0, listener.indexOf('\n});'));
  assert.doesNotMatch(body, /status !== 'ready'/,
    "'ready' must not be excluded: it is the state an owner adding a business is in");
  assert.match(body, /render\(lastSession\)/, 'it must re-render for the new invitation');
  assert.match(body, /rememberInvite\(/,
    'and store it, or an invitation arriving this way is lost on the next reload');
});

// The dead end the app itself used to recommend: "sign in with it instead", which
// led nowhere because the invitation did not survive the sign-in.
test('an email that already has an account is offered a way forward', () => {
  assert.match(SOURCE, /auth\/email-already-in-use'\) signInInstead\.hidden = false/,
    'that refusal must reveal the route to signing in, not just describe it');
  assert.match(SOURCE, /signInInstead\.hidden = true/,
    'and it must be BUILT hidden, not built on demand — a control created only in an ' +
    'error path has no element to reveal when the error arrives (v1.19.1)');
});
