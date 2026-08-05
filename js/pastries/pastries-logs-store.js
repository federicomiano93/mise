// pastries-logs-store.js — the records of past nights.
//
// Deliberately separate from pastries-store.js. The day lists are read on every
// opening of the screen; the records are read only when someone opens Records,
// so the everyday cost stays at seven documents (P14).
//
// NOT cached in localStorage, unlike the day lists. A record is a historical
// note, not something anyone needs in their hand offline.
//
// ⚠️ NOTHING IN THIS FILE DELETES ANYTHING BY ITSELF. It used to: there was a
// prune here, with its own guards. It was REMOVED — not switched off — because
// nothing may delete from the database on its own. The bin on the Records
// screen is now the only thing in the app that removes a record, and a person
// has to tap it. Deleting a record from the Firebase console still works too;
// that is a human decision as well.

import {
  normalizeLogs, sortLogs, buildLog, isLogVisible,
} from './pastries-log-model.js';
import {
  watchPastryLogs, acceptPastryLog, deletePastryLog, getPastryLog,
} from './firebase-pastries.js';

let logs = [];
let notify = null;
let onError = null;

export function getLogs() {
  return logs;
}

// What the screen shows: the last LOG_VISIBLE_DAYS, newest first.
//
// This is a DISPLAY filter and nothing else — the same shape as the Calculator's
// log window and the Orders history window. An older record is still in the
// database, still in a backup, and still there for anyone who looks.
export function getVisibleLogs(nowMs) {
  return sortLogs(logs.filter(l => isLogVisible(l, nowMs)));
}

export function setLogsErrorHandler(fn) {
  onError = typeof fn === 'function' ? fn : null;
}

// Start syncing. onUpdate() fires whenever the records change. Attach this only
// when the Records screen opens — never at page boot.
export function initPastryLogs(onUpdate, onStreamError) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchPastryLogs(
    remote => {
      logs = normalizeLogs(remote);
      if (notify) notify(logs);
    },
    err => { if (onStreamError) onStreamError(err); },
  ).catch(err => {
    console.error('Pastry records live sync failed to start:', err);
    if (onStreamError) onStreamError(err);
  });
  return logs;
}

// Is there already a record for tonight and this list? One read, only on Accept.
// Returns null when it cannot be established — the caller then simply does not
// promise a replacement, which is the safe way to be wrong.
export async function tonightsRecord(day, nowMs = Date.now()) {
  try {
    return await getPastryLog(buildLog({ day, items: [], note: '', nowMs }).id);
  } catch (err) {
    console.warn('Could not check for an existing record:', err);
    return null;
  }
}

// Keep tonight's list as a record.
//
// NOT optimistic, unlike saveDay: nothing is added locally until the write has
// actually landed. A record shown on screen that does not exist is worse than
// no record at all, because the whole point of one is to be able to trust it.
// Returns the record on success, or null with the failure reported.
export async function acceptDay(day, items, note, nowMs = Date.now()) {
  const id = buildLog({ day, items, note, nowMs }).id;
  try {
    return await acceptPastryLog(id, existing => buildLog({ day, items, note, nowMs, existing }));
  } catch (err) {
    console.warn('Pastry record did not save:', err);
    if (onError) onError(`Couldn't record ${day} — check your connection.`);
    return null;
  }
}

// Remove one record by hand, from the bin on the Records screen.
export async function removeLog(id) {
  try {
    await deletePastryLog(id);
    return true;
  } catch (err) {
    console.warn('Pastry record did not delete:', err);
    if (onError) onError("Couldn't remove that record — check your connection.");
    return false;
  }
}
