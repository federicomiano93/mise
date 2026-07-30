// location.js — which location's data this app session is working on, and
// the ONE function that turns a collection name into a Firestore path.
//
// WHY THIS EXISTS. Every document used to sit at the top of the database
// (`suppliers/…`, `ingredients/…`) with a `bakery: 'main'` field that protected
// nothing — it was a label, not a boundary. With more than one location using
// the app, the boundary has to be structural: the data lives under
// `locations/{id}/…`, so a location's documents cannot be reached from
// another location's path at all.
//
// Every collection access in the app goes through pathFor(). A single call site
// left on the old flat path would write one location's data where every other
// location can see it — which is exactly the failure this change exists to
// prevent, and it would be silent. That is why buildPath THROWS on a bad id
// instead of falling back to a default: a loud failure on one screen is a
// nuisance, a quiet write into shared space is a data leak.
//
// Today currentLocationId() is fixed to 'main' (the Italian Club). The login
// step replaces that with the location the signed-in user belongs to; nothing
// else in the app has to change, because nothing else knows the path.

// The location this app has always served: The Italian Club Bakery. The id says
// what the place IS, because the next one to join is a restaurant and 'main' vs
// 'the other one' would tell nobody anything in six months.
export const DEFAULT_LOCATION_ID = 'bakery';

// Location ids are created by hand in the Firebase console, so they are held to
// a deliberately narrow shape: letters, digits, dash and underscore. This rejects
// the two things that would be dangerous in a path — a slash (which would silently
// re-point the write somewhere else) and an empty value.
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidLocationId(id) {
  return typeof id === 'string' && VALID_ID.test(id);
}

// 'suppliers' → 'locations/main/suppliers'. Throws rather than guessing.
export function buildPath(locationId, collectionName) {
  if (!isValidLocationId(locationId)) {
    throw new Error(`Invalid location id: ${JSON.stringify(locationId)}`);
  }
  if (typeof collectionName !== 'string' || !collectionName || collectionName.includes('/')) {
    throw new Error(`Invalid collection name: ${JSON.stringify(collectionName)}`);
  }
  return `locations/${locationId}/${collectionName}`;
}

// The document holding a location's own name and settings.
export function locationDocPath(locationId) {
  if (!isValidLocationId(locationId)) {
    throw new Error(`Invalid location id: ${JSON.stringify(locationId)}`);
  }
  return `locations/${locationId}`;
}

let current = DEFAULT_LOCATION_ID;

export function currentLocationId() {
  return current;
}

// Set once, at startup, before any read or write. Switching locations inside a
// live page is deliberately NOT supported here: the app holds dozens of Firestore
// listeners and in-memory state, and the reliable way to change tenant is a full
// page reload (the login step does exactly that).
export function setCurrentLocationId(id) {
  if (!isValidLocationId(id)) {
    throw new Error(`Invalid location id: ${JSON.stringify(id)}`);
  }
  current = id;
  return current;
}

// The path every data layer uses. Collection names stay plain strings at the
// call sites; only this file knows where they actually live.
export function pathFor(collectionName) {
  return buildPath(current, collectionName);
}
