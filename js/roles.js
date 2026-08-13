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
// ⚠️ THE WORDS COME FROM THE DICTIONARY; THE VALUES DO NOT AND MUST NOT. Every
// identifier in this file — 'owner', 'manager', 'staff', 'head-chef' — is stored
// in users/{uid} and read by firestore.rules, so it is DATA. Only the words a
// person reads are looked up. tests/i18n.test.mjs fails if the two are confused.
import { t } from './i18n.js';

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
  if (role === OWNER) return t('role.owner');
  if (role === MANAGER) return t('role.manager');
  return t('role.staff');
}

// ── A job title, which is NOT a fourth level of power ────────────────────────
//
// Federico, 13 Aug 2026: «aggiungi head chef come figura della cucina ma è come
// il ruolo del manager». The comment on ROLES above already called this level
// "the head chef or manager" in his own words from 11 August — the level always
// meant this; only the word was missing.
//
// ⚠️⚠️ SO IT IS A TITLE STORED BESIDE THE ROLE, NOT A NEW MEMBERSHIP VALUE, and
// that distinction is the whole of this feature. A new membership value has to be
// added in THREE separate places — js/sections.js accessValue(), member() in
// firestore.rules, and accessValue() in functions/onboarding.js — and a value any
// one of them does not recognise is not a demotion, it is a LOCKOUT. That was
// missed in all three, on three separate days (v268). A head chef holds
// `'manager'`, so there is nothing for any of them to learn.
//
// ⚠️ AND NO RULE READS IT, exactly like firstName/lastName on the same document,
// which is already documented as "a label, never an identity". Renaming somebody
// must never change what they can do.
export const TITLES = Object.freeze(['manager', 'head-chef']);

export function titleLabel(title) {
  return title === 'head-chef' ? t('role.headChef') : t('role.manager');
}

// What the roster row calls this person: their job title where the level has one,
// otherwise the role itself.
//
// ⚠️ THE TITLE IS IGNORED UNLESS THE ROLE IS MANAGER. A title left behind on
// somebody who has since been made an employee would have the screen call them
// "Head chef" while the database says they may delete nothing — and the screen is
// the only place anybody ever checks. The server clears it on every change too;
// this is the second of the two, because one of them will be forgotten one day.
export function personLabel(role, title) {
  if (role !== MANAGER) return roleLabel(role);
  return titleLabel(title);
}

// The pills on "Who can get in": FOUR words, THREE levels of power.
//
// ⚠️ Two of them grant exactly the same thing, and the screen has to say so out
// loud — a row of four that looks like four levels is worse than no title at all.
//
// ⚠️ IT CARRIES A KEY, NOT A WORD, AND THAT IS NOT A STYLE CHOICE. This is a
// frozen constant built when the file is first imported — long before anybody has
// opened a venue, so long before the app knows what language to show. A word
// baked in here would be the language the app STARTED in, and it would never
// change again however many times somebody switched the setting. The screen asks
// for the word at the moment it draws it.
export const ROLE_CHOICES = Object.freeze([
  { key: OWNER, role: OWNER, title: null, labelKey: 'role.owner' },
  { key: MANAGER, role: MANAGER, title: 'manager', labelKey: 'role.manager' },
  { key: 'head-chef', role: MANAGER, title: 'head-chef', labelKey: 'role.headChef' },
  { key: 'staff', role: 'staff', title: null, labelKey: 'role.staff' },
]);

// The word for a pill, asked for now rather than remembered from import time.
export function choiceLabel(choice) {
  return t(choice.labelKey);
}

// ⚠️ THE SAME WORD, IN THE FORM THAT GOES INSIDE A SENTENCE — asked for, never
// computed. The screen used to write `label.toLowerCase()`, which is a
// language-specific operation performed on somebody else's language. Whether a
// word lowercases, and to what, is the translator's business; here we simply ask
// for the form we need and let the dictionary answer.
export function personLabelInSentence(role, title) {
  if (role !== MANAGER) {
    if (role === OWNER) return t('role.owner.inSentence');
    return t('role.staff.inSentence');
  }
  return title === 'head-chef' ? t('role.headChef.inSentence') : t('role.manager.inSentence');
}

export function choiceLabelInSentence(choice) {
  return t(`${choice.labelKey}.inSentence`);
}

// Which pill is lit for somebody who currently holds this role and title.
export function choiceKey(role, title) {
  if (role === MANAGER && title === 'head-chef') return 'head-chef';
  return role;
}
