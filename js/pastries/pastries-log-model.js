// pastries-log-model.js — what a record of a night's proving is.
//
// PURE: no DOM, no Firebase, no storage, and no Date.now() inside any function.
// Every entry point takes nowMs, so behaviour that depends on the clock can be
// asserted rather than waited for.
//
// ── NOTHING HERE DELETES, AND NOTHING IN THIS APP DOES ──────────────────────
// A record leaves the SCREEN after LOG_VISIBLE_DAYS and stays in the database
// for ever. That is the same shape as every other retention in The Italian
// Club: the Calculator's says "DISPLAY-only — the database keeps every log",
// and the Orders history's says "This HIDES, it never deletes".
//
// An earlier version of this file carried an automatic prune, with two
// thresholds and three brakes. It was REMOVED, not disabled, on Federico's
// instruction: deleting from the app by hand is fine, deleting from the
// database by hand is fine, but nothing may delete from the database on its
// own. Deleting the machinery rather than switching it off is the point — code
// that does not exist cannot be wired back up by accident.

import { WEEKDAYS, isWeekday, MAX_ITEMS } from './pastries-model.js';

// How long a record stays on the SCREEN. It is never removed from the database.
export const LOG_VISIBLE_DAYS = 15;
export const MAX_LOG_ITEMS = MAX_ITEMS;

const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The work DATE a moment belongs to, as 'YYYY-MM-DD'. Same 4am roll-over as the
// weekday: a record confirmed at 00:30 on Wednesday belongs to Tuesday night.
//
// ⚠️ setHours, never a millisecond subtraction — the two disagree on both
// clock-change Sundays, in opposite directions. See pastries-model.js.
export function workDate(nowMs) {
  const ms = Number(nowMs);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  d.setHours(d.getHours() - 4);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function logIdFor(date, day) {
  return `${date}_${day}`;
}

// True only for a string that is BOTH the right shape and a real calendar date.
// '2026-02-31' passes the regex and is not a day that exists.
export function isRealISODate(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms)) return false;
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

// Whole days from one ISO date to another, or null when either is unreadable.
// Both are read as UTC midnights, so a clock change cannot make a day 23 or 25
// hours long here and shift a count.
export function daysBetween(fromISO, toISO) {
  if (!isRealISODate(fromISO) || !isRealISODate(toISO)) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

// How old a record is in days, or null when that cannot be established.
function ageOf(log, nowMs) {
  if (!log || typeof log !== 'object') return null;
  const ms = Number(nowMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return daysBetween(log.date, workDate(ms));
}

// Is this record still on the screen?
//
// The ONLY question this file asks about age, and it decides nothing about the
// database. A record that stops being visible is still there — in the Firebase
// console, in a backup, and to anyone who looks.
//
// Anything unreadable is SHOWN rather than hidden: the screen is where a person
// would notice something wrong, and hiding it would remove the only symptom.
export function isLogVisible(log, nowMs, days = LOG_VISIBLE_DAYS) {
  const age = ageOf(log, nowMs);
  if (age === null) return true;    // unreadable: show it rather than hide it
  if (age < 0) return true;         // dated ahead of this clock: still show it
  return age <= days;
}

function normalizeLogItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const qty = Math.round(Number(raw.qty));
  return { name, qty: Number.isFinite(qty) ? Math.max(0, qty) : 0 };
}

// One stored record → the shape the screen works with. Never throws.
//
// The id carries the date and the weekday, and it is what the rules pin, so
// where the id and the fields disagree the ID WINS — same rule as the day
// documents.
export function normalizeLog(raw, id) {
  const fromId = typeof id === 'string' ? id.split('_') : [];
  const date = isRealISODate(fromId[0]) ? fromId[0]
    : (isRealISODate(raw && raw.date) ? raw.date : '');
  const day = isWeekday(fromId[1]) ? fromId[1]
    : (isWeekday(raw && raw.day) ? raw.day : '');
  const list = raw && Array.isArray(raw.items) ? raw.items : [];
  const items = [];
  for (const entry of list) {
    const item = normalizeLogItem(entry);
    if (item) items.push(item);
    if (items.length >= MAX_LOG_ITEMS) break;
  }
  return {
    id: typeof id === 'string' ? id : '',
    date,
    day,
    items,
    note: typeof (raw && raw.note) === 'string' ? raw.note : '',
    createdAt: typeof (raw && raw.createdAt) === 'string' ? raw.createdAt : '',
  };
}

// A record with no readable date or weekday is DROPPED from the list rather than
// shown: it cannot be placed on a timeline. It stays in the database, where it
// can be looked at — nothing here removes anything.
export function normalizeLogs(docs) {
  if (!Array.isArray(docs)) return [];
  return docs
    .map(d => normalizeLog(d, d && d.id))
    .filter(l => l.date && l.day);
}

// Newest first. Within a date, the weekday order is stable so two records on one
// date never swap places between paints.
export function sortLogs(logs) {
  return [...(Array.isArray(logs) ? logs : [])].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day);
  });
}

// What Confirm writes. `existing` is the record already filed for this date and
// weekday, if there is one — confirming twice in one night is a CORRECTION, so
// the record is replaced and its original createdAt is preserved.
export function buildLog({ day, items, note, nowMs, existing }) {
  const date = workDate(nowMs);
  const at = new Date(Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0).toISOString();
  const clean = [];
  for (const entry of (Array.isArray(items) ? items : [])) {
    const item = normalizeLogItem(entry);
    if (item) clean.push(item);
    if (clean.length >= MAX_LOG_ITEMS) break;
  }
  return {
    id: logIdFor(date, day),
    date,
    day,
    items: clean,
    // The standing note is FROZEN here: it was part of the instruction in force
    // that night, and a record showing today's note would misdescribe it.
    note: typeof note === 'string' ? note : '',
    createdAt: (existing && typeof existing.createdAt === 'string' && existing.createdAt) || at,
    updatedAt: at,
  };
}
