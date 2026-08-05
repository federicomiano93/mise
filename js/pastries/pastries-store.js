// pastries-store.js — the seven live day lists, bridging Firestore and the UI.
//
// Resilience (P17) + cost (P14): the days are held in memory and mirrored to
// localStorage, so the screen paints instantly and works offline. The listener
// is attached only when this page initialises (via initPastries), never at app
// boot — and it is seven documents, so it stays seven reads for ever.
//
// Writes are per-day and LOCAL-FIRST: memory + cache + UI update immediately
// (instant, offline-friendly), and the Firestore write is best-effort. If it is
// REJECTED (rules, App Check, no network), the optimistic change is ROLLED BACK
// and the failure is surfaced — a row that stays on screen after a failed save
// is worse than no row at all, because it looks like the work is done.
//
// The cache key needs no registration anywhere: js/local-data.js clears every
// key it does not explicitly keep, so this data cannot follow someone from one
// location into another.

import { normalizeDays, normalizeDay, WEEKDAYS } from './pastries-model.js';
import { watchPastryDays, savePastryDay } from './firebase-pastries.js';

const CACHE_KEY = 'pastries-days';

let days = readCache();
let notify = null;       // called with the new day map whenever it changes
let onSyncError = null;  // called with a message when a background write is rejected

// ── Cache (localStorage mirror for instant/offline first paint) ───────────────

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return fromStored(JSON.parse(raw));
  } catch (e) {
    // Corrupt/unavailable cache — start empty; the listener will fill it in.
  }
  return normalizeDays([]);
}

function writeCache(map) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch (e) {
    // Storage full/unavailable — the in-memory copy still works this session.
  }
}

// The cache stores the same { Monday: [...] } shape the UI uses, so it is put
// back through the model to get the same guarantees a Firestore read gets: all
// seven keys present, junk rows dropped, the MAX_ITEMS cap applied.
function fromStored(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeDays([]);
  return normalizeDays(WEEKDAYS.map(day => ({ id: day, items: raw[day] })));
}

// ── Reading ──────────────────────────────────────────────────────────────────

// The whole week: { Monday: [...], …, Sunday: [...] }, always all seven keys.
export function getDays() {
  return days;
}

export function getItems(day) {
  return days[day] || [];
}

// How many pastries each day holds — what the weekday strip dims an empty day by.
export function getCounts() {
  const out = {};
  WEEKDAYS.forEach(day => { out[day] = (days[day] || []).length; });
  return out;
}

// Register a handler for background write failures (shown as a toast by the UI).
export function setSyncErrorHandler(fn) {
  onSyncError = typeof fn === 'function' ? fn : null;
}

// ── Syncing ──────────────────────────────────────────────────────────────────

// Start syncing with Firestore. onUpdate(days) fires whenever anything changes.
// onError(err) fires if the live stream dies (onSnapshot does not resubscribe).
// Returns the synchronous cached map, so the first paint never waits on the
// network.
export function initPastries(onUpdate, onError) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchPastryDays(
    remote => {
      days = normalizeDays(remote);
      writeCache(days);
      if (notify) notify(days);
    },
    err => { if (onError) onError(err); },
  ).catch(err => {
    console.error('Pastries live sync failed to start:', err);
    if (onError) onError(err);
  });
  return days;
}

function applyLocal(day, items) {
  days = { ...days, [day]: items };
  writeCache(days);
  if (notify) notify(days);
}

// Save one day, local-first.
//
// Returns immediately — it never awaits the network, so a tap is never left
// hanging on a bad connection. If the write is refused, the previous list is put
// back and onSyncError is told, which the screen turns into a message.
export function saveDay(day, items) {
  const clean = normalizeDay({ items }, day).items;
  const previous = days[day] || [];
  applyLocal(day, clean);
  savePastryDay(day, clean).catch(err => {
    console.warn('Pastry day did not sync to Firestore:', err);
    applyLocal(day, previous);
    if (onSyncError) onSyncError(`Couldn't save ${day} — check your connection.`);
  });
}
