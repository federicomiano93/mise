// roles.js — what a person may do inside a location they already belong to.
//
// This is the SECOND question about an account, and it is not the first one.
// js/sections.js answers "which locations may this account open"; that is the
// boundary between two businesses. This file answers "and once inside, may they
// take things away" — a boundary between two people in the SAME business.
//
// It exists because the app is going to be sold. With two venues that both
// belong to Federico, everyone inside a location being able to delete everything
// is a shrug. With a paying customer it is a support call: their counter staff
// empties their supplier list and the phone that rings is ours.
//
// ⚠️ THE ROLE HAS NO FIELD OF ITS OWN — it is the VALUE of the membership entry
// (`locations.<id>`), and accessValue() in js/sections.js is the one place that
// reads it. A separate `roles` map was built first and abandoned: firestore.rules
// could not read a second map without answering with an evaluation error instead
// of a clean refusal. It denied, so the app behaved correctly, but a security
// rule whose failure mode nobody can explain is not one to keep. The full story
// is in the comment on accessValue().
//
// The happy consequence is that membership and role became the SAME fact, so a
// role can no longer disagree with a membership — the earlier shape allowed
// `roles: { someone-elses-place: 'owner' }` and had to defend against it.

import { accessValue, OWNER, MANAGER } from './sections.js';

// THREE roles, and the third one earns its place. Federico's own words for them
// (11 Aug 2026): the proprietario, the head chef or manager, and the ordinary
// employee. That is a real distinction in a kitchen, not a technical one — it
// separates the person who HIRES from the people who WORK — which is why it will
// still make sense when the software has changed.
//
// ⚠️ THREE IS ALSO THE CEILING. The reason is not effort, it is that a
// permission system nobody can hold in their head fails the same way every
// time: it becomes so tiring to work out who may do what that everybody is made
// an owner to get the app working, and then there are no roles at all.
export const ROLES = Object.freeze([OWNER, MANAGER, 'staff']);

// ⚠️ THE DEFAULT IS THE WHOLE DESIGN, AND IT POINTS AT `staff`.
//
// The two defaults already in this app point in OPPOSITE directions, each for a
// stated reason (js/sections.js): membership defaults to NONE because it is a
// boundary; sections default to ALL ON because a forgotten field must never
// empty an app that is working.
//
// This one is about DESTRUCTIVE POWER, so it follows membership, not sections:
// power that nobody explicitly granted does not exist. It is also what makes the
// change safe to deploy — every membership in production is written `true`, which
// reads as staff, so nobody is locked out on the day the rules land; the accounts
// that should hold owner powers get them from the backfill.
export const DEFAULT_ROLE = 'staff';

export function isValidRole(value) {
  return typeof value === 'string' && ROLES.includes(value);
}

// The role this account holds in one location. Anything that is not exactly
// 'owner' or 'manager' — a plain `true`, a missing entry, a corrupt one, a role
// from a future version of the app, a value with a stray space — is an ordinary
// employee. A value nobody here understands must never be read as more power
// than the least.
export function roleOf(userDoc, locationId) {
  const value = accessValue(userDoc, locationId);
  if (value === OWNER) return OWNER;
  if (value === MANAGER) return MANAGER;
  return DEFAULT_ROLE;
}

// May this account take things away in this location — suppliers, ingredients,
// recipes, products, a client's ordering link?
//
// ⚠️ THIS IS THE ONE THE RULES ASK, and it is deliberately NOT isOwner(). The
// manager runs the place: everything an owner can do inside their location, the
// manager can do too. What separates them is hiring, below — not destroying.
//
// ⚠️ WHICH MEANS A MANAGER CAN DO IRREVERSIBLE DAMAGE, exactly as an owner can.
// Said plainly because it is easy to assume otherwise from the name: the guard
// against a manager emptying a supplier list is not this function, it is the
// nightly backup (restore tested 1 Aug 2026, 0 documents lost).
export function canManage(userDoc, locationId) {
  const value = accessValue(userDoc, locationId);
  return value === OWNER || value === MANAGER;
}

// May this account invite people and decide their roles?
//
// ⚠️ OWNER ONLY, and this is the whole difference between the two upper roles.
// It is enforced where it matters — requireOwner() in functions/onboarding.js,
// which reads users/{uid} with the Admin SDK. firestore.rules never asks this,
// because no client writes a membership or a join code: those documents are
// `allow write: if false` and always will be.
export function isOwner(userDoc, locationId) {
  return accessValue(userDoc, locationId) === OWNER;
}

// For the "who can get in" list. Plain words, because the person reading it runs
// a bakery and is not an administrator of a system.
export function roleLabel(role) {
  if (role === OWNER) return 'Owner';
  if (role === MANAGER) return 'Manager';
  return 'Employee';
}
