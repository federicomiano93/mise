// Unit tests for the second session decision (P15): what a person may do once
// they are inside a location they already belong to.
//
// ⚠️ ALMOST EVERY TEST HERE IS THE SAME ASSERTION FROM A DIFFERENT DIRECTION —
// "this does NOT come out as owner". That is deliberate. There is exactly one
// dangerous answer this module can give, and it is handing somebody the power to
// delete another business's data because a value was missing, misspelled or
// corrupt. Everything else is recoverable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  DEFAULT_ROLE,
  isValidRole,
  roleOf,
  isOwner,
  roleLabel,
} from '../js/roles.js';
import { locationsOf, accessValue } from '../js/sections.js';

// ── The default, and the shape production is in TODAY ────────────────────────

test('the default is staff, not owner', () => {
  assert.equal(DEFAULT_ROLE, 'staff');
});

// ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Every membership in production is
// written `true`, so this is what the whole database says on the day the rules
// land: everyone keeps working, nobody holds owner powers until the backfill.
test('a plain `true` membership is a member, and is staff', () => {
  const doc = { locations: { bakery: true } };
  assert.deepEqual(locationsOf(doc), ['bakery']);
  assert.equal(roleOf(doc, 'bakery'), 'staff');
  assert.equal(isOwner(doc, 'bakery'), false);
});

// ⚠️ THE SECOND MOST IMPORTANT. locationsOf() used to filter on `=== true`, so
// without this an OWNER would have had no locations at all and would have been
// locked out of the app entirely by the change meant to give them more power.
test('an owner is still a member, and can still open the location', () => {
  const doc = { locations: { bakery: 'owner' } };
  assert.deepEqual(locationsOf(doc), ['bakery']);
  assert.equal(roleOf(doc, 'bakery'), 'owner');
  assert.equal(isOwner(doc, 'bakery'), true);
});

test('no document at all: no access, and certainly not owner', () => {
  for (const doc of [null, undefined, {}, { locations: null }]) {
    assert.deepEqual(locationsOf(doc), [], String(doc));
    assert.equal(roleOf(doc, 'bakery'), 'staff', String(doc));
    assert.equal(isOwner(doc, 'bakery'), false, String(doc));
  }
});

test('a corrupt locations field resolves to no access rather than throwing', () => {
  for (const broken of [[], 'owner', 42, true]) {
    const doc = { locations: broken };
    assert.deepEqual(locationsOf(doc), [], String(broken));
    assert.equal(isOwner(doc, 'bakery'), false, String(broken));
  }
});

// ── A value nobody recognises is never access, and never MORE power ──────────

test('a value from a future version of the app grants nothing at all', () => {
  const doc = { locations: { bakery: 'manager' } };
  assert.deepEqual(locationsOf(doc), [], 'not even membership');
  assert.equal(roleOf(doc, 'bakery'), 'staff');
  assert.equal(isOwner(doc, 'bakery'), false);
});

test('the value is case sensitive: Owner is not owner', () => {
  for (const bad of ['Owner', 'OWNER', ' owner', 'owner ']) {
    const doc = { locations: { bakery: bad } };
    assert.equal(isOwner(doc, 'bakery'), false, bad);
    assert.deepEqual(locationsOf(doc), [], bad);
  }
});

test('false and truthy-but-wrong values are not access', () => {
  for (const bad of [false, 0, 1, 'true', 'yes', null, {}, ['owner']]) {
    const doc = { locations: { bakery: bad } };
    assert.equal(accessValue(doc, 'bakery'), false, String(bad));
    assert.equal(isOwner(doc, 'bakery'), false, String(bad));
  }
});

// ⚠️ A stray space is invisible in the Firebase console and the backfill is
// typed there by hand. locationsOf() has always refused one in the KEY, because
// firestore.rules does not forgive one either; the VALUE is refused for the same
// reason. Being kinder than the rules draws a delete button the database refuses.
test('a location key typed with a stray space grants nothing', () => {
  const doc = { locations: { 'bakery ': 'owner' } };
  assert.deepEqual(locationsOf(doc), []);
  assert.equal(isOwner(doc, 'bakery'), false);
});

// ── One location at a time ───────────────────────────────────────────────────

test('owner of one location is only staff in the other', () => {
  const doc = { locations: { bakery: 'owner', restaurant: true } };
  assert.deepEqual(locationsOf(doc), ['bakery', 'restaurant']);
  assert.equal(isOwner(doc, 'bakery'), true);
  assert.equal(isOwner(doc, 'restaurant'), false);
  assert.equal(roleOf(doc, 'restaurant'), 'staff');
});

test('owner of two locations', () => {
  const doc = { locations: { bakery: 'owner', restaurant: 'owner' } };
  assert.equal(isOwner(doc, 'bakery'), true);
  assert.equal(isOwner(doc, 'restaurant'), true);
});

test('a location that is not yours at all', () => {
  const doc = { locations: { bakery: 'owner' } };
  assert.equal(isOwner(doc, 'somebody-else'), false);
  assert.equal(roleOf(doc, 'somebody-else'), 'staff');
});

// ── The small pieces ─────────────────────────────────────────────────────────

test('there are two roles and no more', () => {
  assert.deepEqual([...ROLES], ['owner', 'staff']);
});

test('isValidRole refuses everything that is not one of the two', () => {
  assert.equal(isValidRole('owner'), true);
  assert.equal(isValidRole('staff'), true);
  for (const bad of ['manager', 'Owner', '', ' staff', null, undefined, 1, {}, true]) {
    assert.equal(isValidRole(bad), false, String(bad));
  }
});

test('the label is a word a baker would use', () => {
  assert.equal(roleLabel('owner'), 'Owner');
  assert.equal(roleLabel('staff'), 'Staff');
  assert.equal(roleLabel('anything else'), 'Staff', 'an unknown role is never labelled Owner');
});
