// pastries-logs-store.js — the records of past nights, and the one place that
// asks whether any of them may be forgotten.
//
// Deliberately separate from pastries-store.js. The day lists are read on every
// opening of the screen; the records are read only when someone opens Records,
// so the everyday cost stays at seven documents (P14). It also means the prune
// only ever runs on a screen where the records are in front of a person: if
// something goes wrong, they are looking straight at it.
//
// NOT cached in localStorage, unlike the day lists. A record is a historical
// note, not something anyone needs in their hand offline, and a cached copy is
// one more thing that could be pruned against.

import {
  normalizeLogs, sortLogs, expiredLogs, buildLog, isLogVisible,
  LOG_KEEP_DAYS, MAX_DELETES_PER_PASS,
} from './pastries-log-model.js';
import {
  watchPastryLogs, acceptPastryLog, deletePastryLog, getPastryLog,
} from './firebase-pastries.js';

let logs = [];
let notify = null;
let onError = null;
let pruned = false;      // once per page load, whatever happens

export function getLogs() {
  return logs;
}

// What the screen shows: the last LOG_VISIBLE_DAYS, newest first. Records past
// that but inside the keep window still exist and are deliberately unreachable —
// they are a safety margin, not a feature.
export function getVisibleLogs(nowMs) {
  return sortLogs(logs.filter(l => isLogVisible(l, nowMs)));
}

export function setLogsErrorHandler(fn) {
  onError = typeof fn === 'function' ? fn : null;
}

// ── The prune ────────────────────────────────────────────────────────────────
//
// ⚠️ THIS IS THE ONLY AUTOMATIC DELETION IN THE APP. Every guard is deliberate:
//
//   - it runs ONLY on a real SERVER snapshot. Acting on a cached list would
//     delete on the strength of data that may be stale or incomplete, and that
//     is the easiest mistake here to make and the hardest to notice;
//   - ONCE per page load;
//   - the decision is made by expiredLogs(), which keeps anything it cannot
//     read, caps a pass at MAX_DELETES_PER_PASS, and removes NOTHING at all if
//     a pass would take more than half of the records;
//   - nothing is removed locally first. The snapshot reports what actually
//     happened, so a delete the server refused cannot hide a record that is
//     still there;
//   - failures are swallowed. The next opening tries again, and a record that
//     lingers a day longer costs nothing.
function pruneOnce(nowMs) {
  if (pruned) return;
  pruned = true;
  const doomed = expiredLogs(logs, nowMs, {
    keepDays: LOG_KEEP_DAYS, maxPerPass: MAX_DELETES_PER_PASS,
  });
  if (!doomed.length) return;
  console.info(
    `[pastry-logs] removing ${doomed.length} record(s) past the ${LOG_KEEP_DAYS}-day keep window:`,
    doomed.map(l => l.id).join(', '));
  // Two phones pruning at once both compute the same set and both issue the
  // deletes; deleting an already-deleted document succeeds silently. Idempotent
  // on purpose — nothing here needs to win a race.
  Promise.allSettled(doomed.map(l => deletePastryLog(l.id)));
}

// Start syncing. onUpdate() fires whenever the records change. Attach this only
// when the Records screen opens — never at page boot.
export function initPastryLogs(onUpdate, onStreamError, nowMs = Date.now()) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchPastryLogs(
    ({ logs: remote, fromServer }) => {
      logs = normalizeLogs(remote);
      if (notify) notify(logs);
      if (fromServer) pruneOnce(nowMs);
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
