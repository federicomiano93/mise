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

// Apply it to real storage. Returns how many keys were removed.
export function clearLocalData(storage = globalThis.localStorage) {
  if (!storage) return 0;
  let keys = [];
  try { keys = Object.keys(storage); } catch { return 0; } // private mode / blocked
  const doomed = keysToClear(keys);
  doomed.forEach(key => { try { storage.removeItem(key); } catch { /* ignore */ } });
  return doomed.length;
}
