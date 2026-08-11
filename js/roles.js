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
// Pure, for the same reason as sections.js: the awkward cases — no roles field
// at all, a role nobody recognises, a role for a location this account is not in
// — are exactly the ones that must be tested without a browser or a database.

import { locationsOf } from './sections.js';

// The two roles, and deliberately only two. A third one ("manager", "read only")
// is easy to add here and expensive to add everywhere else — every rule, every
// hidden button, every test doubles. Two roles answer the question that actually
// gets asked: is this the person whose business it is, or someone who works here.
export const ROLES = Object.freeze(['owner', 'staff']);

// ⚠️ THE DEFAULT IS THE WHOLE DESIGN, AND IT POINTS AT `staff`.
//
// The two defaults already in this app point in OPPOSITE directions, each for a
// stated reason (js/sections.js): membership defaults to NONE because it is a
// boundary; sections default to ALL ON because a forgotten field must never
// empty an app that is working.
//
// This one is about DESTRUCTIVE POWER, so it follows membership, not sections:
// power that nobody explicitly granted does not exist. Compare the two failures.
// Defaulting to `owner` means any account whose role write was lost — or that
// was created before this file existed — silently becomes an owner of somebody
// else's business, and the roles do nothing at all for every account already in
// the database. Defaulting to `staff` means somebody temporarily cannot delete:
// visible, recoverable, and it fails towards keeping data rather than losing it.
export const DEFAULT_ROLE = 'staff';

export function isValidRole(value) {
  return typeof value === 'string' && ROLES.includes(value);
}

// The role this account holds in one location.
//
// ⚠️ IT DELIBERATELY DOES NOT FORGIVE A STRAY SPACE, and that is a departure
// from allowedSections() two files over. The reason is the same one written into
// locationsOf(): firestore.rules reads this same field with a plain
// .get('roles', {}).get(lid, 'staff') and does NOT forgive — being kinder than
// the rules would draw a delete button the database then refuses, which is worse
// than not drawing it. Where the app and the rules must agree, the app matches
// the rules exactly.
//
// ⚠️ AND IT MATTERS HERE MORE THAN ANYWHERE, because the first roles in this
// database are typed BY HAND in the Firebase console (the backfill for the
// accounts that exist today), and a trailing space is invisible there. That is
// why the backfill has to be read back from the API rather than eyeballed.
//
// Anything unrecognised — a missing field, a corrupt one, a role from a future
// version of the app, a role stored as a number — resolves to the default. A
// value nobody here understands must never be read as more power than `staff`.
export function roleOf(userDoc, locationId) {
  const raw = userDoc && typeof userDoc === 'object' ? userDoc.roles : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_ROLE;
  const value = raw[locationId];
  return isValidRole(value) ? value : DEFAULT_ROLE;
}

// May this account take things away in this location?
//
// ⚠️ MEMBERSHIP IS CHECKED FIRST, and not because it is tidy. A users document
// carries a role PER LOCATION, so `roles: { 'someone-elses-place': 'owner' }` is
// a shape the database can hold — and without this check it would read as owner
// there. Membership is the thing that was never writable by any client; asking
// it first means a role can only ever narrow what membership already granted, it
// can never widen it. firestore.rules composes the two the same way round.
export function isOwner(userDoc, locationId) {
  return locationsOf(userDoc).includes(locationId) && roleOf(userDoc, locationId) === 'owner';
}

// For the "who can get in" list. Plain words, because the person reading it is
// the owner of a bakery, not an administrator of a system.
export function roleLabel(role) {
  return role === 'owner' ? 'Owner' : 'Staff';
}
