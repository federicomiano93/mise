// sections.js — two decisions, both pure, both taken from documents that only
// the Firebase console can write:
//
//   1. WHICH LOCATION is this session working on (users/{uid}.locations)
//   2. WHICH PARTS of the app that location uses (locations/{id}.sections)
//
// They are pure functions here so the awkward cases — a missing document, a
// corrupt field, a remembered location that is no longer yours — can be tested
// without a browser or a database. The defaults below are deliberate and they
// point in OPPOSITE directions, for a reason given at each one.

import { isValidLocationId } from './location.js';

// ⚠️ A NEW NAME HERE IS NOT OPTIONAL, IT IS WHAT MAKES A PAGE REACHABLE. A
// section missing from this list is not "allowed by default" — allowedSections
// never produces a key for it, so isSectionAllowed returns false and
// js/auth-gate.js redirects that page to the Home on EVERY location. The screen
// simply cannot be opened, anywhere, and nothing says why.
//
// ⚠️ AND ADDING ONE TURNS IT ON FOR EVERY EXISTING LOCATION, because the default
// below is ALLOWED and no location document written before today mentions the
// new name. A venue that should not have it needs `sections.<name>: false` typed
// into its document in the Firebase console — and until that is done, the same
// default in firestore.rules lets that venue WRITE the new collection too.
export const SECTIONS = Object.freeze(['orders', 'calculator', 'catalogue', 'pastries', 'foodcost']);

// Read a field by name, accepting a name typed with stray spaces around it.
//
// WHY THIS EXISTS. These documents are typed by hand in the Firebase console, and
// a trailing space is INVISIBLE there — `sections ` renders almost exactly like
// `sections` but is a different field. It cost half an hour on 30 July 2026: the
// restaurant had `sections ` and `calculator `, so the app found no field at all
// and — correctly, per the default below — switched every section on. The screen
// simply disagreed with the document and nothing said why.
//
// An exact match always wins, so a document with both names is not ambiguous.
function fieldNamed(obj, wanted) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, wanted)) return obj[wanted];
  const loose = Object.keys(obj).find(key => key.trim() === wanted);
  return loose === undefined ? undefined : obj[loose];
}

// Which sections a location uses.
//
// DEFAULT: ALLOWED. A missing or corrupt `sections` field must never empty a
// working location's app — losing the screen you use every morning because a
// field was forgotten is far worse than seeing a section you do not need. And it
// leaks nothing: a location only ever sees its OWN data, so an extra section
// shows an extra EMPTY screen. Only an explicit `false` hides one.
export function allowedSections(locationDoc) {
  const raw = fieldNamed(locationDoc, 'sections');
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  SECTIONS.forEach(name => { out[name] = fieldNamed(map, name) !== false; });
  return out;
}

export function isSectionAllowed(locationDoc, name) {
  return allowedSections(locationDoc)[name] === true;
}


// Which locations this person may enter, in a stable order.
//
// DEFAULT: NONE. The opposite bias to sections, and for the opposite reason —
// this one IS the boundary between two businesses' data. A missing or unreadable
// users/{uid} document must mean "no access", never "all of them". The result is
// an account that sees empty screens until the document is created, which is a
// two-minute fix in the console; the alternative would be a stranger's account
// walking into a location.
//
// ⚠️ AND IT DELIBERATELY DOES NOT USE fieldNamed(). A location id typed with a
// stray space is refused here, even though allowedSections above forgives one.
// The reason is that firestore.rules reads this same document and does NOT
// forgive: being kinder than the rules would open the app on a location the
// database then refuses on every single read — permission errors everywhere
// instead of one honest "no access". Where the app and the rules must agree, the
// app matches the rules exactly.
//
// Ids that could never name a real folder are DROPPED rather than passed on. A
// hand-typed `restaurant ` used to travel all the way to buildPath, which throws
// on it — so one stray space in this document crashed the sign-in instead of
// producing the honest, recoverable "no location yet". Dropping is not
// forgiveness: the id still grants nothing, it just fails gracefully.
// What `locations.<id>` may say, and what each answer means.
//
// ⚠️ THE ROLE LIVES IN THIS VALUE, IT DOES NOT GET A FIELD OF ITS OWN. A
// separate `roles` map was built first and abandoned: firestore.rules could not
// read a second map without answering with an evaluation error instead of a
// clean refusal — it denied, so the app looked right, but a security rule whose
// failure mode nobody can explain is not one to keep. This shape needs no second
// lookup at all, because the rules already read this exact value to decide
// membership.
//
//   true       → a member of this location, an ordinary employee
//   'manager'  → a member who runs this location: deletes too, but hires nobody
//   'owner'    → a member, and the person whose business it is
//   anything else (false, missing, a typo) → no access at all
//
// ⚠️ `true` MEANS EMPLOYEE ON PURPOSE, and that is what makes this safe to
// deploy: every users document in production says `true` today, so nobody loses
// access — or any of the powers they already had — the moment the rules land.
// The accounts that should hold more get it from a backfill.
//
// ⚠️ AND THE ORDER OF THAT BACKFILL IS NOT NEGOTIABLE: the rules must accept
// 'manager' BEFORE any account is set to it. Written first, the value is one the
// deployed rules do not recognise, and that account is locked out of everything
// instantly. Same trap as 'owner' on 11 Aug 2026, and the fix is the same —
// deploy, then write, then read it back from the API.
export const OWNER = 'owner';
export const MANAGER = 'manager';

// The values that mean "this account may open this location", in order of power.
// ⚠️ A value NOT in here is no access at all, never a lesser access. A role from
// a later version of the app, a typo, a string with a stray space: all refused.
// Being generous here would let an unrecognised value walk into a location.
const ACCESS_VALUES = Object.freeze([true, MANAGER, OWNER]);

export function accessValue(userDoc, locationId) {
  const raw = userDoc && typeof userDoc === 'object' ? userDoc.locations : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw[locationId];
  return ACCESS_VALUES.includes(value) ? value : false;
}

// ── Sections that also depend on WHO is looking ──────────────────────────────
//
// A location decides which parts of the app it bought. A role decides which of
// those a given person sees. Food Cost is the only one so far, and the reason is
// specific rather than general: it is the screen that says what the business PAYS
// for its ingredients and what it EARNS on each product. Everything else in the
// app is what to make and how much of it.
//
// ⚠️ THE DEFAULT IS THE OPPOSITE WAY ROUND FROM allowedSections ABOVE, and both
// are right. A missing `sections` field must never empty a working app, so that
// one defaults to ALLOWED. Here a role nobody recognises is not on the list, so
// it is REFUSED — this is about who may see money, and power nobody granted does
// not exist. Same reasoning as js/roles.js, and it has to be, because a role
// arriving from a future version of the app must never open the one screen an
// employee is not meant to open.
const ROLE_ONLY = Object.freeze({ foodcost: [OWNER, MANAGER] });

// Which sections this person sees in this location: the location's set NARROWED
// by the role. Never widened — a role cannot turn on a section the venue does
// not have, whatever it says.
export function sectionsFor(locationDoc, role) {
  const fromLocation = allowedSections(locationDoc);
  const out = {};
  SECTIONS.forEach(name => {
    const roles = ROLE_ONLY[name];
    out[name] = fromLocation[name] === true && (!roles || roles.includes(role));
  });
  return out;
}

export function isSectionAllowedFor(locationDoc, role, name) {
  return sectionsFor(locationDoc, role)[name] === true;
}

export function locationsOf(userDoc) {
  const raw = userDoc && typeof userDoc === 'object' ? userDoc.locations : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw)
    .filter(id => accessValue(userDoc, id) !== false && isValidLocationId(id))
    .sort();
}

// Decide what happens right after a successful sign-in.
//
//   { status: 'none'   }                    → this account has no location yet
//   { status: 'ready',  locationId, options }  → go straight in
//   { status: 'choose', options }           → ask which one
//
// `remembered` is the last choice made on THIS device. It is honoured only if it
// is still one of yours: an access that was taken away must not survive in a
// phone's local storage.
export function pickLocation(userDoc, remembered) {
  const options = locationsOf(userDoc);
  if (options.length === 0) return { status: 'none', options };
  if (options.length === 1) return { status: 'ready', locationId: options[0], options };
  if (remembered && options.includes(remembered)) {
    return { status: 'ready', locationId: remembered, options };
  }
  return { status: 'choose', options };
}
