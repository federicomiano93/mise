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

export const SECTIONS = Object.freeze(['orders', 'calculator', 'catalogue']);

// Which sections a location uses.
//
// DEFAULT: ALLOWED. A missing or corrupt `sections` field must never empty a
// working location's app — losing the screen you use every morning because a
// field was forgotten is far worse than seeing a section you do not need. And it
// leaks nothing: a location only ever sees its OWN data, so an extra section
// shows an extra EMPTY screen. Only an explicit `false` hides one.
export function allowedSections(locationDoc) {
  const raw = locationDoc && typeof locationDoc === 'object' ? locationDoc.sections : null;
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  SECTIONS.forEach(name => { out[name] = map[name] !== false; });
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
export function locationsOf(userDoc) {
  const raw = userDoc && typeof userDoc === 'object' ? userDoc.locations : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw).filter(id => raw[id] === true).sort();
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
