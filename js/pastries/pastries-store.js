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

import {
  normalizeDays, normalizeDay, daysFromCache, cleanNote, setQuantityAt, WEEKDAYS,
} from './pastries-model.js';
import { watchPastryDays, savePastryDay } from './firebase-pastries.js';

const CACHE_KEY = 'pastries-days';

let days = readCache();
let notify = null;       // called with the new day map whenever it changes
let onSyncError = null;  // called with a message when a background write is rejected

// ── Cache (localStorage mirror for instant/offline first paint) ───────────────

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return daysFromCache(JSON.parse(raw));
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

// The tolerant reader lives in the pure model (daysFromCache), where a test can
// reach it: it also understands the pre-note cache shape, which is a migration
// that happens exactly once per device and would otherwise never be exercised.

// ── Reading ──────────────────────────────────────────────────────────────────

// The whole week: { Monday: { items, note }, …, Sunday: {…} }, always all seven.
export function getDays() {
  return days;
}

export function getItems(day) {
  return (days[day] || {}).items || [];
}

// The standing note for a day — permanent, and deliberately NOT cleared by
// accepting a list. It is a reminder about that weekday, not about one night.
export function getNote(day) {
  return (days[day] || {}).note || '';
}

// How many pastries each day holds — what the weekday strip dims an empty day by.
export function getCounts() {
  const out = {};
  WEEKDAYS.forEach(day => { out[day] = getItems(day).length; });
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

function applyLocal(day, value) {
  days = { ...days, [day]: value };
  writeCache(days);
  if (notify) notify(days);
}

// Save one day, local-first.
//
// Returns immediately — it never awaits the network, so a tap is never left
// hanging on a bad connection. If the write is refused, the previous day is put
// back and onSyncError is told, which the screen turns into a message.
//
// ⚠️ THE ITEMS AND THE NOTE TRAVEL TOGETHER, because the day is written with
// setDoc and NO merge — whatever is not in the payload is gone.
//
// So an OMITTED note means "keep the one that is there", not "clear it". Passing
// '' explicitly still clears it. Without that asymmetry, any future caller that
// only cares about the list — and there will be one — silently destroys a note
// somebody wrote, and nothing on screen would say so.
export function saveDay(day, items, note) {
  const nextNote = note === undefined ? getNote(day) : note;
  const clean = normalizeDay({ items, note: nextNote }, day);
  const previous = days[day] || { items: [], note: '' };
  applyLocal(day, { items: clean.items, note: clean.note });
  savePastryDay(day, clean.items, clean.note).catch(err => {
    console.warn('Pastry day did not sync to Firestore:', err);
    applyLocal(day, previous);
    if (onSyncError) onSyncError(`Couldn’t save ${day} — check your connection.`);
  });
}

// Change ONE row's quantity, from the day list.
//
// ⚠️ THE PAYLOAD IS COMPOSED HERE, FROM LIVE STATE, NOT FROM WHAT THE VIEW HELD.
// Between drawing a row and tapping its tick, minutes can pass and a snapshot
// from another phone can have reordered or replaced the rows. Building the whole
// day out of what the view captured at render time would silently undo whatever
// arrived in between — the whole document is replaced on every write.
//
// Returns false when the row is no longer the one that was typed into, so the
// screen can say so rather than change the wrong pastry.
export function setItemQuantity(day, index, name, qty) {
  const next = setQuantityAt(getItems(day), index, qty, name);
  if (!next) return false;
  saveDay(day, next, getNote(day));
  return true;
}

// Save just the standing note, keeping the list exactly as it is now.
export function saveNote(day, note) {
  saveDay(day, getItems(day), cleanNote(note));
}
