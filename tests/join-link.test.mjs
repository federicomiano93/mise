// Unit tests for how a join code travels (P15).
//
// ⚠️ THE DEFECT THIS FEATURE EXISTS TO FIX WAS FOUND BY WALKING A FAKE SALE, NOT
// BY A TEST: createWorkspace minted a 32-character token and the only join screen
// in the app rejected anything that was not six digits, so the token it produced
// could not be redeemed from the app at all. Both halves were correct on their
// own and every test stayed green. These tests pin the JOIN between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOIN_PAGE, joinLinkFor, readJoinToken, kindOfTyped, CODE_SHAPE_HINT,
} from '../js/join-link.js';
import { LINK_LENGTH, DIGITS_LENGTH } from '../js/join-code.js';

const HERE = 'https://example.test/the_italian_club_app/orders.html';
const TOKEN = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';           // 32, the real shape
const LONGER = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4gH7jKl0n'; // 40, still valid

test('the token is a real 32-character link token', () => {
  assert.equal(TOKEN.length, LINK_LENGTH);
});

// ── Building the link ────────────────────────────────────────────────────────

test('the link lands on the front door, not a page of its own', () => {
  const link = joinLinkFor(TOKEN, HERE);
  assert.ok(link.startsWith('https://example.test/the_italian_club_app/' + JOIN_PAGE), link);
});

// ⚠️ THE WHOLE POINT. A query string is sent to the server and lands in its logs;
// a fragment never leaves the browser. If this test goes red because somebody
// moved the token to `?join=`, the secret has started being logged by GitHub.
test('the token rides in the FRAGMENT, never the query string', () => {
  const link = joinLinkFor(TOKEN, HERE);
  assert.ok(link.includes('#join='), link);
  assert.ok(!link.includes('?'), 'a query string would reach the server log');
});

test('a token needing escaping is escaped', () => {
  const link = joinLinkFor('a b&c=d', HERE);
  assert.ok(!link.includes(' '), link);
  assert.ok(!link.includes('&'), link);
});

// ── Reading it back ──────────────────────────────────────────────────────────

test('a link built here is read back identically', () => {
  assert.equal(readJoinToken(joinLinkFor(TOKEN, HERE)), TOKEN);
  assert.equal(readJoinToken(joinLinkFor(LONGER, HERE)), LONGER);
});

// ⚠️ Whatever is in a URL was put there by whoever sent it, so it is untrusted.
// Handing rubbish back would spend one of five join attempts an hour on it.
test('anything that is not a token reads as nothing', () => {
  for (const href of [
    'https://example.test/index.html',                     // no fragment
    'https://example.test/index.html#',                     // empty fragment
    'https://example.test/index.html#b=bakery&k=xyz',       // the CLIENT link, not this one
    'https://example.test/index.html#join=',                // named but empty
    'https://example.test/index.html#join=tooshort',        // under 32
    'https://example.test/index.html#join=' + 'a'.repeat(65), // over 64
    'https://example.test/index.html#join=' + 'a'.repeat(31) + '!', // bad character
    'not a url at all',
    '',
    null,
    undefined,
  ]) {
    assert.equal(readJoinToken(href), '', String(href));
  }
});

test('a six-digit code in the fragment is NOT accepted as a link', () => {
  assert.equal(readJoinToken('https://example.test/index.html#join=123456'), '');
});

// ── Telling the two shapes apart ─────────────────────────────────────────────

test('six digits are digits', () => {
  assert.equal(kindOfTyped('123456'), 'digits');
  assert.equal('123456'.length, DIGITS_LENGTH);
});

// People type codes with spaces, and phones add them.
test('six digits survive the way people actually type them', () => {
  for (const typed of [' 123456 ', '123 456', '123-456', '12 34 56']) {
    assert.equal(kindOfTyped(typed), 'digits', typed);
  }
});

test('a link token is a link', () => {
  assert.equal(kindOfTyped(TOKEN), 'link');
  assert.equal(kindOfTyped('  ' + TOKEN + '  '), 'link', 'a pasted token carries whitespace');
});

// ⚠️ CASE IS KEPT FOR A LINK AND FOLDED FOR DIGITS. Folding a link destroys it,
// and this is the test that says so if somebody "tidies" normalizeTyped.
test('a link keeps its case', () => {
  const mixed = 'AAAAbbbbCCCCddddEEEEffffGGGGhhhh';
  assert.equal(kindOfTyped(mixed), 'link');
  assert.equal(readJoinToken(joinLinkFor(mixed, HERE)), mixed);
});

// ⚠️ The two shapes cannot overlap — six characters and thirty-two — so the
// answer is never a guess and no precedence rule can be got wrong later.
test('nothing can be both', () => {
  assert.notEqual(kindOfTyped('123456'), 'link');
  assert.notEqual(kindOfTyped(TOKEN), 'digits');
});

test('everything else is refused before the network', () => {
  for (const bad of ['', '   ', '12345', '1234567', 'abcdef', 'a'.repeat(31),
                     'a'.repeat(65), null, undefined, 123456, {}, []]) {
    assert.equal(kindOfTyped(bad), null, String(bad));
  }
});

// ⚠️ The screen now accepts two shapes, so a message naming only one reads as a
// refusal of the link somebody was just sent.
test('the hint names both ways in', () => {
  assert.match(CODE_SHAPE_HINT, /six-digit/);
  assert.match(CODE_SHAPE_HINT, /link/);
});
