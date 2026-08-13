// local-data.js — wipe this device's cached copies of a location's data when
// the session changes (log out, or switch to another location).
//
// WHY IT MATTERS. The app keeps local copies so it opens instantly and survives
// a bad connection: the calculator's configuration, the recipe catalogue, the
// logs, the Orders settings, and every quantity typed into the calculator. Those
// are one location's data sitting in a phone's storage. Without this, switching
// locations would show the previous one's recipes and settings until the
// network answered — on a shared device, that is a leak between two businesses.
//
// THE DEFAULT IS TO CLEAR. keysToClear removes everything except an explicit keep
// list, rather than removing a list of known caches. The difference shows up in
// six months, when a new cache is added and nobody remembers this file: with a
// clear-list it would leak silently; this way it is simply cleared, which at
// worst costs one refetch.

// Prefixes that must SURVIVE a session change, and why each one is here.
import { t } from './i18n.js';

export const KEEP_PREFIXES = Object.freeze([
  'firebase:',            // Firebase Auth's own session — clearing it logs you back out
  'firebaseLocalStorage', // ditto (SDK fallback storage)
  'uk-bank-holidays',     // public data, belongs to nobody
  'whats-new-seen',       // about the app version you have seen, not about a location
  'lastHiddenAt',         // idle-reset timer
  'active-location',    // which location to open next — managed by the session itself
]);

// Given every key currently in storage, which ones must go.
export function keysToClear(allKeys, keepPrefixes = KEEP_PREFIXES) {
  return (allKeys || []).filter(key =>
    typeof key === 'string' && !keepPrefixes.some(prefix => key.startsWith(prefix)));
}

// Does OPENING a location have to wipe this device's cache first?
//
// Clearing on the way OUT (sign out, switch location) is not enough on its own: a
// phone can reach the sign-in form without ever passing through those. A session
// that expires or is revoked, and the leftover ANONYMOUS session that firebase.js
// discards by itself, both land on the form with the previous location's recipes,
// settings and typed quantities still in storage. Whoever signs in next would see
// them until the network replaced them — and offline they would simply stay.
//
// So the question is asked again on the way IN, where it can be answered from the
// only fact that matters: is the location being opened the one this cache belongs to?
//
// SAME location → KEEP. The cache belongs to the LOCATION, not to the person: two
// people from the same venue sharing a phone must find the app ready, not emptied.
// Nothing is gained by clearing there, and instant start-up is lost.
//
// Nothing remembered (a fresh install, or a phone coming from the pre-login app that
// never wrote this key) → CLEAR. Harmless when storage is empty, and it is exactly
// the case where an old single-venue cache could otherwise leak into a new venue.
export function shouldClearLocalData(remembered, opening) {
  if (!opening) return false;         // nothing is being opened; nothing to decide
  return remembered !== opening;
}

// Apply it to real storage. Returns how many keys were removed.
export function clearLocalData(storage = globalThis.localStorage) {
  if (!storage) return 0;
  let keys = [];
  try { keys = Object.keys(storage); } catch { return 0; } // private mode / blocked
  const doomed = keysToClear(keys);
  doomed.forEach(key => { try { storage.removeItem(key); } catch { /* ignore */ } });
  return doomed.length;
}
