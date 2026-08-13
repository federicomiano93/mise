// «Head chef» — a job title, and the server half that keeps it honest.
//
// Federico, 13 Aug 2026: «aggiungi head chef come figura della cucina ma è come
// il ruolo del manager». js/roles.js is covered by tests/roles.test.mjs; this
// file covers the half that runs in Cloud Functions, which `node --test` can
// neither call nor fake convincingly — so it pins the SHAPE, and the shape is
// where the danger is.
//
// ⚠️ THIS FILE EXISTS BECAUSE A MUTATION CAME BACK GREEN. Breaking the server's
// title-clearing left all 1192 tests passing: the guard had nothing watching it.
// A green run after a real mutation means the guard is untested, and the answer
// is a test, never a shrug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'js', 'staff', 'firebase-staff.js'), 'utf8');
const SCREEN = readFileSync(join(ROOT, 'js', 'staff', 'people.js'), 'utf8');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

function bodyOf(name) {
  const start = SERVER.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `${name} is not exported from functions/onboarding.js`);
  const end = SERVER.indexOf('\n});', start);
  return SERVER.slice(start, end);
}

// ── It is a title, not a membership value ───────────────────────────────────

// ⚠️ THE ONE TO KEEP IF EVERY OTHER TEST HERE WERE DELETED. A new membership
// value must be added in THREE separate places — js/sections.js accessValue(),
// member() in firestore.rules, and accessValue() in functions/onboarding.js —
// and a value any one of them does not know is a LOCKOUT, not a demotion. That
// was missed in all three, on three separate days (v268). 'head-chef' is a word
// on the roster and must never reach a membership.
test('head-chef is never written as a membership value', () => {
  assert.match(SERVER, /const WRITABLE_ROLES = \['owner', 'manager', 'staff'\]/,
    'the roles this file writes must stay three');
  assert.doesNotMatch(RULES, /'head-chef'/,
    'firestore.rules must never have to know the word');

  // membershipValue() is what turns a role into what users/{uid} stores.
  const at = SERVER.indexOf('function membershipValue');
  assert.notEqual(at, -1);
  const fn = SERVER.slice(at, SERVER.indexOf('\n}', at));
  assert.doesNotMatch(fn, /head-chef/,
    'the membership value must not depend on the title');
});

// ── The title is cleared when the level loses it ────────────────────────────

// ⚠️ THE MUTATION THAT CAME BACK GREEN. A title left behind on somebody demoted
// to employee has the roster calling them "Head chef" while the database says
// they may delete nothing — and that screen is the only place anybody looks.
// These documents are merge-written, so "leave it out" means "keep what was
// there": it must be written EMPTY, not omitted.
test('demoting somebody clears their title, it does not leave it behind', () => {
  const body = bodyOf('setMemberRole');
  assert.match(body, /const nextTitle = role === 'manager' \? \(title \|\| 'manager'\) : ''/,
    'a non-manager must be written an EMPTY title, never have it omitted');
  assert.match(body, /tx\.set\(memberRef, \{ role, title: nextTitle \}/,
    'and the roster write must carry it');
});

test('an unrecognised title is refused, not quietly written', () => {
  const body = bodyOf('setMemberRole');
  assert.match(body, /!WRITABLE_TITLES\.includes\(title\)/);
  assert.match(body, /throw new HttpsError\('invalid-argument'/);
  assert.match(SERVER, /const WRITABLE_TITLES = \['manager', 'head-chef'\]/);
});

// ── It travels with the invitation ──────────────────────────────────────────

// ⚠️ WITHOUT THIS THE SCREEN AND THE ROSTER QUIETLY DISAGREE. The owner picks
// "Head chef" on the invite panel; if the code carried only the level, that
// person would join as "Manager" and nobody would ever find out, because nobody
// re-reads a screen they filled in yesterday.
test('a code minted for a head chef makes a head chef', () => {
  const store = SERVER.slice(SERVER.indexOf('async function storeCode'),
    SERVER.indexOf('\n}', SERVER.indexOf('async function storeCode')));
  assert.match(store, /title: role === 'manager' \? \(title \|\| 'manager'\) : ''/,
    'the code carries the title, and only for the level that has one');

  const redeem = bodyOf('redeemJoinCode');
  assert.match(redeem, /WRITABLE_TITLES\.includes\(title\)/,
    'and it is re-checked on the way out — old codes have no title at all');
  assert.match(redeem, /title: memberTitle/, 'then written onto the roster');
});

// ── The two halves have to agree ────────────────────────────────────────────

// The lesson of 12 Aug 2026: a server half that is correct and that nothing calls
// is a feature that does not exist, and every test stays green while it does not.
test('the screen really sends the title, through the data layer', () => {
  assert.match(CLIENT, /setMemberRole\(uid, role, title = null\)/,
    'the data layer must accept it');
  assert.match(CLIENT, /createJoinCode\(role = 'staff', title = null, kind = 'digits'\)/);
  assert.match(SCREEN, /setMemberRole\(person\.uid, choice\.role, choice\.title\)/,
    'the roster pills must pass it');
  assert.match(SCREEN, /createJoinCode\(newChoice\.role, newChoice\.title, kind\)/,
    'and so must the invite panel');
});

// ⚠️ FOUR PILLS THAT LOOK LIKE FOUR LEVELS ARE WORSE THAN NO TITLE AT ALL.
// Somebody would choose between Manager and Head chef believing it changed what
// the person can do. The sentence under the pills is the only place anybody is
// ever told, so it has to say they are the same.
//
// ⚠️ THE SENTENCE MOVED INTO THE DICTIONARY, THE RULE DID NOT — and the test got
// stronger following it, because a translation is exactly where this protection
// would be lost. A translator handed «The same as Manager…» in a list of phrases
// has no way of knowing that softening it changes who can delete a supplier. So
// EVERY language is asked, not just English.
test('the screen says out loud that head chef and manager are the same powers', () => {
  const at = SCREEN.indexOf('const ROLE_MEANS');
  const means = SCREEN.slice(at, SCREEN.indexOf('};', at));
  assert.match(means, /'head-chef':/, 'the head chef needs its own sentence');

  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    const headChef = dicts[lang]['role.means.headChef'];
    const manager = dicts[lang]['role.means.manager'];
    assert.ok(headChef, `${lang} has no sentence for the head chef`);
    assert.notEqual(headChef, manager,
      `in ${lang} the head chef must say it IS the manager level, not silently repeat it`);
    // Whatever the words, the sentence has to name the manager level and then go
    // on to describe it — so it is longer than the manager's own sentence, which
    // it contains the substance of.
    assert.ok(headChef.length > manager.length,
      `in ${lang} the head chef's sentence must ADD the "same as" statement, not replace it`);
  }
  assert.match(dicts.en['role.means.headChef'], /The same as Manager/,
    'and in English that statement is the one people have already read');
});
