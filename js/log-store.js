// log-store.js — single source of truth for the live logs, bridging Firestore and
// the UI (mirrors calculator-config-store.js).
//
// Resilience (P17): the UI paints instantly from a local cache and works offline;
// Firestore streams in and updates the cache. Every write is local-first — applied
// to memory + cache immediately, then synced best-effort (a sync failure never
// loses the local change or blocks the UI).

import {
  watchLogs, saveLogDoc, deleteLogDoc, anyLogExists, readOldLogsOnce,
} from './firebase.js';
import {
  createLog, addVersion, setForDay, restoreVersion, migrateOldLogs, sortLogs,
} from './log-model.js';

const CACHE_KEY = 'logs-cache';
const MIGRATED_KEY = 'logs-migrated-v1';

let current = readCache();
let notify = null; // called with the sorted logs whenever they change

function readCache() {
  try { const r = localStorage.getItem(CACHE_KEY); if (r) return JSON.parse(r); } catch (e) {}
  return [];
}
function writeCache(logs) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(logs)); } catch (e) {}
}

// Unique id for a new log document. Prefers the platform UUID; falls back to a
// time+random id (both are unique enough for one bakery's logs).
export function genLogId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'log-' + crypto.randomUUID();
  return 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// The current logs, newest first (sorted by creation time).
export function getLogs() { return sortLogs(current); }
export function getLogById(id) { return current.find(l => l.id === id) || null; }

// Start syncing. onUpdate(logs) fires whenever the set of logs changes. Returns the
// synchronous cached list so the first paint never waits on the network.
export function initLogs(onUpdate) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchLogs(logs => { current = logs; writeCache(current); if (notify) notify(getLogs()); });
  migrateIfNeeded();
  return getLogs();
}

// One-time migration of the old one-doc-per-dough `log` collection into the new
// model, so no existing log is lost. Idempotent: guarded by a localStorage flag and
// by checking the new collection is empty first.
async function migrateIfNeeded() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    if (await anyLogExists()) { localStorage.setItem(MIGRATED_KEY, '1'); return; }
    const old = await readOldLogsOnce();
    if (!old.length) { localStorage.setItem(MIGRATED_KEY, '1'); return; }
    const base = Date.now() - old.length; // keep original relative order, all in the past
    const migrated = migrateOldLogs(old, () => genLogId(), base);
    await Promise.all(migrated.map(saveLogDoc));
    localStorage.setItem(MIGRATED_KEY, '1');
    console.info('[logs] migrated ' + migrated.length + ' old record(s) into the new model.');
  } catch (e) {
    console.warn('[logs] migration skipped:', e);
  }
}

// Apply a created/updated log to memory + cache and notify (local-first).
function applyLocal(log) {
  const i = current.findIndex(l => l.id === log.id);
  if (i === -1) current = current.concat([log]);
  else { current = current.slice(); current[i] = log; }
  writeCache(current);
  if (notify) notify(getLogs());
}

function syncFail(label) {
  return (err) => { console.warn('[logs] ' + label + ' saved locally but not synced:', err); };
}

// Create a brand-new log. The caller may pass an id (so it can link the calculator
// tab to this log straight away); otherwise one is generated.
export function createAndSave({ id, dough, recipeId, forDay, version, createdAtMs, origin }) {
  const log = createLog({ id: id || genLogId(), dough, recipeId, forDay, version, createdAtMs, origin });
  applyLocal(log);
  return saveLogDoc(log).catch(syncFail('create')).then(() => log);
}

// Append an edited version to an existing log (append-only). An optional forDay
// updates the log's target day too, for a re-confirm that changed Today/Tomorrow.
export function appendAndSave(logId, version, forDay) {
  const log = getLogById(logId);
  if (!log) return Promise.resolve(null);
  let next = addVersion(log, version);
  if (forDay) next = setForDay(next, forDay);
  applyLocal(next);
  return saveLogDoc(next).catch(syncFail('edit')).then(() => next);
}

// Restore a past version: appends a copy on top (history never truncated).
export function restoreAndSave(logId, index, meta) {
  const log = getLogById(logId);
  if (!log) return Promise.resolve(null);
  const next = restoreVersion(log, index, meta);
  applyLocal(next);
  return saveLogDoc(next).catch(syncFail('restore')).then(() => next);
}

// Delete a whole log (explicit user action, confirmed in the UI).
export function deleteLog(logId) {
  current = current.filter(l => l.id !== logId);
  writeCache(current);
  if (notify) notify(getLogs());
  return deleteLogDoc(logId).catch(syncFail('delete'));
}
