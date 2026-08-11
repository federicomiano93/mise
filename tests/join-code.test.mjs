// Unit tests for the only door this app opens from the inside (P15).
//
// ⚠️ THE LIMITS ONLY WORK TOGETHER. Six digits is a million combinations, and a
// callable function is reachable by anyone who knows the project id — which is
// public. What makes that safe is the whole set: a short life, a cap per code, a
// cap per account per hour, and single use. Each test below pins one of them, so
// removing any one turns something red rather than quietly halving the cost of a
// search.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_KINDS, DIGITS_LENGTH, TTL_MS,
  MAX_FAILED_ATTEMPTS, MAX_ATTEMPTS_PER_HOUR, ATTEMPT_WINDOW_MS,
  normalizeTyped, isWellFormed,
  codeStatus, isRedeemable,
  recentAttempts, isRateLimited, retryAfterMs,
  redeemFailureText, expiresInWords,
} from '../js/join-code.js';

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const live = (extra = {}) => ({ expiresAt: NOW + 60_000, failedAttempts: 0, ...extra });

// ── What somebody typed ──────────────────────────────────────────────────────

test('a typed code forgives spaces and dashes', () => {
  assert.equal(normalizeTyped(' 123 456 '), '123456');
  assert.equal(normalizeTyped('123-456'), '123456');
  assert.equal(normalizeTyped('123456'), '123456');
});

// ⚠️ A link token uses upper and lower case to stay short, so folding case would
// destroy it. A digits code has no letters, so nothing is lost by trimming only.
test('a link token keeps its case; only the ends are trimmed', () => {
  const token = 'aB3-_x'.repeat(6).slice(0, 36);
  assert.equal(normalizeTyped(`  ${token}  `, 'link'), token);
});

test('well-formed means exactly six digits, nothing else', () => {
  assert.equal(isWellFormed('123456'), true);
  for (const bad of ['12345', '1234567', '12345a', '', '  ', null, undefined, 123456]) {
    assert.equal(isWellFormed(bad), false, String(bad));
  }
  assert.equal(DIGITS_LENGTH, 6);
});

test('a link token has to be long', () => {
  assert.equal(isWellFormed('a'.repeat(32), 'link'), true);
  assert.equal(isWellFormed('a'.repeat(31), 'link'), false);
  assert.equal(isWellFormed('a'.repeat(65), 'link'), false);
  assert.equal(isWellFormed('has spaces in it and is long enough!!', 'link'), false);
});

// ── Whether a stored code may still be redeemed ──────────────────────────────

test('a live, unused, untried code is redeemable', () => {
  assert.equal(codeStatus(live(), NOW), 'ok');
  assert.equal(isRedeemable(live(), NOW), true);
});

test('single use: a code that let somebody in is spent', () => {
  assert.equal(codeStatus(live({ usedAt: NOW - 1000 }), NOW), 'used');
  assert.equal(isRedeemable(live({ usedAt: NOW - 1000 }), NOW), false);
});

test('a code dies after five wrong guesses', () => {
  assert.equal(codeStatus(live({ failedAttempts: MAX_FAILED_ATTEMPTS - 1 }), NOW), 'ok');
  assert.equal(codeStatus(live({ failedAttempts: MAX_FAILED_ATTEMPTS }), NOW), 'locked');
  assert.equal(MAX_FAILED_ATTEMPTS, 5);
});

test('an expired code is refused, on the exact millisecond', () => {
  assert.equal(codeStatus({ expiresAt: NOW + 1 }, NOW), 'ok');
  assert.equal(codeStatus({ expiresAt: NOW }, NOW), 'expired');
  assert.equal(codeStatus({ expiresAt: NOW - 1 }, NOW), 'expired');
});

// ⚠️ THE DIRECTION THAT MATTERS. Everywhere else this app widens on doubt — an
// unknown setting falls back to the most generous reading. A key is the opposite:
// one whose lifetime cannot be read must not be immortal.
test('an unreadable expiry means expired, never "no expiry"', () => {
  for (const bad of [undefined, null, 'soon', NaN, {}, Infinity]) {
    assert.equal(codeStatus({ expiresAt: bad }, NOW), 'expired', String(bad));
  }
});

test('a code that is not there at all is missing, not ok', () => {
  for (const nothing of [null, undefined, '', 0, 'code']) {
    assert.equal(codeStatus(nothing, NOW), 'missing', String(nothing));
    assert.equal(isRedeemable(nothing, NOW), false, String(nothing));
  }
});

test('a staff code lasts a day and an owner link a week', () => {
  assert.equal(TTL_MS.digits, 24 * 60 * 60 * 1000);
  assert.equal(TTL_MS.link, 7 * 24 * 60 * 60 * 1000);
  assert.deepEqual([...CODE_KINDS], ['digits', 'link']);
});

// ── How hard somebody has been trying ────────────────────────────────────────

test('only attempts inside the last hour count', () => {
  const record = { attempts: [NOW - 30_000, NOW - ATTEMPT_WINDOW_MS - 1, NOW - 1000] };
  assert.equal(recentAttempts(record, NOW).length, 2);
});

test('five tries an hour, and the sixth is blocked', () => {
  const four = { attempts: Array(4).fill(NOW - 1000) };
  const five = { attempts: Array(5).fill(NOW - 1000) };
  assert.equal(isRateLimited(four, NOW), false);
  assert.equal(isRateLimited(five, NOW), true);
  assert.equal(MAX_ATTEMPTS_PER_HOUR, 5);
});

test('a corrupt or missing attempts record does not block anybody', () => {
  for (const broken of [null, undefined, {}, { attempts: 'lots' }, { attempts: null }]) {
    assert.equal(isRateLimited(broken, NOW), false, String(broken));
  }
});

test('rubbish inside the attempts list is ignored rather than counted', () => {
  const record = { attempts: ['soon', null, NaN, NOW + 60_000, NOW - 1000] };
  assert.equal(recentAttempts(record, NOW).length, 1, 'only the one real, past attempt');
});

test('the wait is measured from the OLDEST attempt in the window', () => {
  const record = { attempts: [NOW - 50 * 60_000, NOW - 1000, NOW - 900, NOW - 800, NOW - 700] };
  const wait = retryAfterMs(record, NOW);
  assert.equal(Math.round(wait / 60_000), 10, 'ten minutes until the oldest falls out');
});

test('nobody under the limit is asked to wait', () => {
  assert.equal(retryAfterMs({ attempts: [NOW - 1000] }, NOW), 0);
});

// ── What the person is told ──────────────────────────────────────────────────

// ⚠️ "That code has expired" would confirm the code EXISTED, which is precisely
// what a search is looking for. Every refusal reads the same except the rate
// limit, which says nothing about any code — only about this account.
test('a refusal never says WHY, so it cannot confirm a code exists', () => {
  const expired = redeemFailureText('expired');
  assert.equal(redeemFailureText('used'), expired);
  assert.equal(redeemFailureText('locked'), expired);
  assert.equal(redeemFailureText('missing'), expired);
  assert.match(expired, /does not work/);
  assert.doesNotMatch(expired, /expired|used|already/i);
});

test('the rate limit is the one refusal that says something useful', () => {
  assert.match(redeemFailureText('rate-limited', 9 * 60_000), /Wait 9 minutes/);
  assert.match(redeemFailureText('rate-limited', 30_000), /Wait 1 minute\b/);
});

test('the time left is coarse, in words the owner can read aloud', () => {
  assert.equal(expiresInWords({ expiresAt: NOW + 5 * 60_000 }, NOW), '5 minutes left');
  assert.equal(expiresInWords({ expiresAt: NOW + 60_000 }, NOW), '1 minute left');
  assert.equal(expiresInWords({ expiresAt: NOW + 3 * 60 * 60_000 }, NOW), '3 hours left');
  assert.equal(expiresInWords({ expiresAt: NOW + 7 * 24 * 60 * 60_000 }, NOW), '7 days left');
  assert.equal(expiresInWords({ expiresAt: NOW - 1 }, NOW), 'expired');
  assert.equal(expiresInWords({}, NOW), 'expired');
});
