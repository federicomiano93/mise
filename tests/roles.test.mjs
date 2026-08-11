// Unit tests for the second session decision (P15): what a person may do once
// they are inside a location they already belong to.
//
// ⚠️ ALMOST EVERY TEST HERE IS THE SAME ASSERTION FROM A DIFFERENT DIRECTION —
// "this does NOT come out as owner". That is deliberate. There is exactly one
// dangerous answer this module can give, and it is giving somebody the power to
// delete another business's data because a field was missing, misspelled,
// corrupt, or written for a different location. Everything else is recoverable.

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

const member = (extra = {}) => ({ locations: { bakery: true }, ...extra });

// ── The default ──────────────────────────────────────────────────────────────

test('the default is staff, not owner', () => {
  assert.equal(DEFAULT_ROLE, 'staff');
});

test('a document with no roles field at all: staff', () => {
  assert.equal(roleOf(member(), 'bakery'), 'staff');
  assert.equal(isOwner(member(), 'bakery'), false);
});

test('no document at all: staff', () => {
  assert.equal(roleOf(null, 'bakery'), 'staff');
  assert.equal(roleOf(undefined, 'bakery'), 'staff');
  assert.equal(isOwner(null, 'bakery'), false);
});

test('a corrupt roles field resolves to staff rather than throwing', () => {
  for (const broken of [[], 'owner', 42, true, null]) {
    assert.equal(roleOf(member({ roles: broken }), 'bakery'), 'staff', String(broken));
    assert.equal(isOwner(member({ roles: broken }), 'bakery'), false, String(broken));
  }
});

// ── A value nobody recognises is never MORE power ────────────────────────────

test('a role from a future version of the app reads as staff', () => {
  assert.equal(roleOf(member({ roles: { bakery: 'manager' } }), 'bakery'), 'staff');
  assert.equal(isOwner(member({ roles: { bakery: 'manager' } }), 'bakery'), false);
});

test('the wrong TYPE in the role slot reads as staff', () => {
  for (const broken of [true, 1, null, {}, ['owner']]) {
    assert.equal(roleOf(member({ roles: { bakery: broken } }), 'bakery'), 'staff', String(broken));
  }
});

test('the role is case sensitive: Owner is not owner', () => {
  assert.equal(roleOf(member({ roles: { bakery: 'Owner' } }), 'bakery'), 'staff');
  assert.equal(roleOf(member({ roles: { bakery: 'OWNER' } }), 'bakery'), 'staff');
});

// ⚠️ The first roles in this database are typed BY HAND in the Firebase console
// (the backfill for the accounts that exist today) and a trailing space is
// invisible there. It cost half an hour on 30 July 2026 on the `sections` field.
// Here it must NOT be forgiven, because firestore.rules does not forgive it
// either — and drawing a delete button the database then refuses is worse than
// not drawing it. This test pins the app to the rules, not to convenience.
test('a location key typed with a stray space grants nothing', () => {
  const doc = { locations: { bakery: true }, roles: { 'bakery ': 'owner' } };
  assert.equal(roleOf(doc, 'bakery'), 'staff');
  assert.equal(isOwner(doc, 'bakery'), false);
});

// ── Membership first, always ─────────────────────────────────────────────────

test('owner of a location this account does not belong to grants nothing', () => {
  const doc = { locations: { bakery: true }, roles: { restaurant: 'owner' } };
  assert.equal(isOwner(doc, 'restaurant'), false);
  assert.equal(isOwner(doc, 'bakery'), false);
});

test('a role without any membership at all grants nothing', () => {
  const doc = { roles: { bakery: 'owner' } };
  assert.equal(roleOf(doc, 'bakery'), 'owner', 'the field is readable on its own');
  assert.equal(isOwner(doc, 'bakery'), false, 'but it cannot widen membership');
});

test('membership revoked while the role stays behind grants nothing', () => {
  const doc = { locations: { bakery: false }, roles: { bakery: 'owner' } };
  assert.equal(isOwner(doc, 'bakery'), false);
});

// ── The one case that says yes ───────────────────────────────────────────────

test('a member explicitly marked owner is an owner, in that location only', () => {
  const doc = {
    locations: { bakery: true, restaurant: true },
    roles: { bakery: 'owner' },
  };
  assert.equal(isOwner(doc, 'bakery'), true);
  assert.equal(isOwner(doc, 'restaurant'), false, 'the other location falls back to staff');
  assert.equal(roleOf(doc, 'restaurant'), 'staff');
});

test('owner of two locations', () => {
  const doc = {
    locations: { bakery: true, restaurant: true },
    roles: { bakery: 'owner', restaurant: 'owner' },
  };
  assert.equal(isOwner(doc, 'bakery'), true);
  assert.equal(isOwner(doc, 'restaurant'), true);
});

// ── The small pieces ─────────────────────────────────────────────────────────

test('there are two roles and no more', () => {
  assert.deepEqual([...ROLES], ['owner', 'staff']);
});

test('isValidRole refuses everything that is not one of the two', () => {
  assert.equal(isValidRole('owner'), true);
  assert.equal(isValidRole('staff'), true);
  for (const bad of ['manager', 'Owner', '', ' staff', null, undefined, 1, {}]) {
    assert.equal(isValidRole(bad), false, String(bad));
  }
});

test('the label is a word a baker would use', () => {
  assert.equal(roleLabel('owner'), 'Owner');
  assert.equal(roleLabel('staff'), 'Staff');
  assert.equal(roleLabel('anything else'), 'Staff', 'an unknown role is never labelled Owner');
});
