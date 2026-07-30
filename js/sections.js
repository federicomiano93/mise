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

export const SECTIONS = Object.freeze(['orders', 'calculator', 'catalogue']);

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
export function locationsOf(userDoc) {
  const raw = userDoc && typeof userDoc === 'object' ? userDoc.locations : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw)
    .filter(id => raw[id] === true && isValidLocationId(id))
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
