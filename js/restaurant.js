// restaurant.js — which restaurant's data this app session is working on, and
// the ONE function that turns a collection name into a Firestore path.
//
// WHY THIS EXISTS. Every document used to sit at the top of the database
// (`suppliers/…`, `ingredients/…`) with a `bakery: 'main'` field that protected
// nothing — it was a label, not a boundary. With more than one restaurant using
// the app, the boundary has to be structural: the data lives under
// `restaurants/{id}/…`, so a restaurant's documents cannot be reached from
// another restaurant's path at all.
//
// Every collection access in the app goes through pathFor(). A single call site
// left on the old flat path would write one restaurant's data where every other
// restaurant can see it — which is exactly the failure this change exists to
// prevent, and it would be silent. That is why buildPath THROWS on a bad id
// instead of falling back to a default: a loud failure on one screen is a
// nuisance, a quiet write into shared space is a data leak.
//
// Today currentRestaurantId() is fixed to 'main' (the Italian Club). The login
// step replaces that with the restaurant the signed-in user belongs to; nothing
// else in the app has to change, because nothing else knows the path.

export const DEFAULT_RESTAURANT_ID = 'main';

// Restaurant ids are created by hand in the Firebase console, so they are held to
// a deliberately narrow shape: letters, digits, dash and underscore. This rejects
// the two things that would be dangerous in a path — a slash (which would silently
// re-point the write somewhere else) and an empty value.
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidRestaurantId(id) {
  return typeof id === 'string' && VALID_ID.test(id);
}

// 'suppliers' → 'restaurants/main/suppliers'. Throws rather than guessing.
export function buildPath(restaurantId, collectionName) {
  if (!isValidRestaurantId(restaurantId)) {
    throw new Error(`Invalid restaurant id: ${JSON.stringify(restaurantId)}`);
  }
  if (typeof collectionName !== 'string' || !collectionName || collectionName.includes('/')) {
    throw new Error(`Invalid collection name: ${JSON.stringify(collectionName)}`);
  }
  return `restaurants/${restaurantId}/${collectionName}`;
}

// The document holding a restaurant's own name and settings.
export function restaurantDocPath(restaurantId) {
  if (!isValidRestaurantId(restaurantId)) {
    throw new Error(`Invalid restaurant id: ${JSON.stringify(restaurantId)}`);
  }
  return `restaurants/${restaurantId}`;
}

let current = DEFAULT_RESTAURANT_ID;

export function currentRestaurantId() {
  return current;
}

// Set once, at startup, before any read or write. Switching restaurants inside a
// live page is deliberately NOT supported here: the app holds dozens of Firestore
// listeners and in-memory state, and the reliable way to change tenant is a full
// page reload (the login step does exactly that).
export function setCurrentRestaurantId(id) {
  if (!isValidRestaurantId(id)) {
    throw new Error(`Invalid restaurant id: ${JSON.stringify(id)}`);
  }
  current = id;
  return current;
}

// The path every data layer uses. Collection names stay plain strings at the
// call sites; only this file knows where they actually live.
export function pathFor(collectionName) {
  return buildPath(current, collectionName);
}
