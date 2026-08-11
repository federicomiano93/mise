// Unit tests for what somebody types on the way in (P15).
//
// ⚠️ THE POINT OF THESE IS THE HONEST LIMIT, NOT THE RULE. Firebase's own floor
// is six characters and cannot be raised without a paid tier, so nothing here is
// enforcement — it is the one screen where a password is ever chosen, doing what
// it can. The tests exist so that what it can do keeps working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PASSWORD_LENGTH,
  MAX_NAME_LENGTH,
  cleanName,
  nameProblem,
  passwordProblem,
} from '../js/credentials.js';

// ── The name ─────────────────────────────────────────────────────────────────

test('an ordinary name comes through untouched', () => {
  assert.equal(cleanName('Luca'), 'Luca');
  assert.equal(nameProblem('Luca', 'first'), null);
  assert.equal(nameProblem('Rossi', 'last'), null);
});

// ⚠️ A phone pastes odd whitespace, and a roster row that wraps for no visible
// reason reads as a broken screen rather than as a stray space.
test('whitespace a phone put there is collapsed, not preserved', () => {
  assert.equal(cleanName('  Luca   Maria  '), 'Luca Maria');
  assert.equal(cleanName('Luca\nRossi'), 'Luca Rossi');
  assert.equal(cleanName('Luca Rossi'), 'Luca Rossi', 'a non-breaking space is still a space');
});

test('a name that is only whitespace is no name at all', () => {
  for (const blank of ['', '   ', '\n', '\t\t']) {
    assert.equal(cleanName(blank), '');
    assert.equal(nameProblem(blank, 'first'), 'Enter your first name.');
    assert.equal(nameProblem(blank, 'last'), 'Enter your surname.');
  }
});

// ⚠️ THE FIELD THAT IS WRONG HAS TO BE NAMEABLE. Two boxes on screen and one
// message saying "check your details" tells somebody nothing.
test('the message names the field it is about', () => {
  assert.match(nameProblem('', 'first'), /first name/);
  assert.match(nameProblem('', 'last'), /surname/);
});

// A form filled in with a dash to get past it is exactly what this refuses.
test('punctuation is not a name', () => {
  for (const bad of ['-', '...', '???', '--', '1234']) {
    assert.ok(nameProblem(bad, 'first'), bad);
  }
});

// ⚠️ NOT REFUSED, AND ON PURPOSE: a single letter is a real name in plenty of
// places, and an app that argues with somebody about their own name is worse
// than one that records an odd one.
test('a one-letter name is accepted', () => {
  assert.equal(nameProblem('O', 'last'), null);
});

test('names outside the Latin alphabet are names', () => {
  for (const good of ['Zoë', 'Müller', 'Ñuñez', 'Đorđević', '李', 'Ольга']) {
    assert.equal(nameProblem(good, 'first'), null, good);
  }
});

test('a very long name is cut rather than refused', () => {
  const long = 'a'.repeat(200);
  assert.equal(cleanName(long).length, MAX_NAME_LENGTH);
  assert.equal(nameProblem(long, 'first'), null, 'still a name, just a shorter one');
});

test('a name that is not a string at all is no name', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(cleanName(bad), '');
    assert.ok(nameProblem(bad, 'first'));
  }
});

// ── The password ─────────────────────────────────────────────────────────────

test('the floor is ten, and it is the number in the message', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.match(passwordProblem('short', 'a@b.com'), /10/);
});

test('nine characters is refused and ten is not', () => {
  assert.ok(passwordProblem('abcdefghi', 'x@y.com'), 'nine');
  assert.equal(passwordProblem('abcdefghij', 'x@y.com'), null, 'ten');
});

test('an empty password says so rather than complaining about length', () => {
  assert.equal(passwordProblem('', 'a@b.com'), 'Choose a password.');
  assert.equal(passwordProblem(null, 'a@b.com'), 'Choose a password.');
});

// ⚠️ THE COMPARISON STRIPS NON-LETTERS, so the substitutions everybody makes are
// caught too. Without it a list of obvious passwords is decoration.
test('the obvious ones are caught even when dressed up', () => {
  for (const bad of ['password12', 'P@ssw0rd!!', 'PASSWORD!!!', 'letmein!!!!']) {
    assert.ok(passwordProblem(bad, 'x@y.com'), bad);
  }
});

test('one character repeated is one guess, however long', () => {
  assert.ok(passwordProblem('aaaaaaaaaa', 'x@y.com'));
  assert.ok(passwordProblem('!!!!!!!!!!!!', 'x@y.com'));
});

// The commonest bad choice of all is the address typed two boxes up.
test('the email address is not a password', () => {
  assert.ok(passwordProblem('federico1234', 'federico@club.com'));
  assert.ok(passwordProblem('xxfedericoxx', 'FEDERICO@club.com'), 'case does not hide it');
});

// ⚠️ A SHORT LOCAL PART IS NOT CHECKED, and that is deliberate: refusing every
// password containing "ann" because somebody's address is ann@… would reject
// perfectly good ones and teach people the form is broken.
test('a very short email local part does not poison every password', () => {
  assert.equal(passwordProblem('annapurna-trail', 'an@club.com'), null);
});

test('a good password is accepted quietly', () => {
  for (const good of ['correct horse battery', 'forno-di-notte-77', 'Sabbia&Sale2026']) {
    assert.equal(passwordProblem(good, 'luca@club.com'), null, good);
  }
});

// A missing email must weaken the check, never break it.
test('no email given still validates everything else', () => {
  assert.equal(passwordProblem('abcdefghij'), null);
  assert.ok(passwordProblem('short'));
});
