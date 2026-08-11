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

import { accessValue, OWNER } from './sections.js';

// The two roles, and deliberately only two. A third one ("manager", "read only")
// is easy to add here and expensive to add everywhere else — every rule, every
// hidden button, every test doubles. Two roles answer the question that actually
// gets asked: is this the person whose business it is, or someone who works here.
export const ROLES = Object.freeze([OWNER, 'staff']);

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
// 'owner' — a plain `true`, a missing entry, a corrupt one, a role from a future
// version of the app, a value with a stray space — is staff. A value nobody here
// understands must never be read as more power than the least.
export function roleOf(userDoc, locationId) {
  return accessValue(userDoc, locationId) === OWNER ? OWNER : DEFAULT_ROLE;
}

// May this account take things away in this location?
//
// Membership no longer has to be checked separately: it IS this value. Only
// `true` and 'owner' count as access at all (accessValue refuses everything
// else), so an owner is a member by construction rather than by remembering to
// ask. firestore.rules reads the same single value the same way.
export function isOwner(userDoc, locationId) {
  return accessValue(userDoc, locationId) === OWNER;
}

// For the "who can get in" list. Plain words, because the person reading it is
// the owner of a bakery, not an administrator of a system.
export function roleLabel(role) {
  return role === OWNER ? 'Owner' : 'Staff';
}
