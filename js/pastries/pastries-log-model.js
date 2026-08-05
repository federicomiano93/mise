// pastries-log-model.js — what a record of a night's proving is, and the ONE
// place in this whole app that is allowed to say "this may be deleted".
//
// It has its own file for exactly that reason. Nothing else in The Italian Club
// deletes anything automatically: the Calculator's filterVisibleLogs says in its
// own comment that it is "DISPLAY-only — the database keeps every log", and the
// Orders history's splitHistoryByAge says "This HIDES, it never deletes". This
// file is the exception, so it should be easy to find and hard to miss.
//
// PURE: no DOM, no Firebase, no storage, and no Date.now() inside any function.
// Every entry point takes nowMs, so behaviour that depends on the clock can be
// asserted rather than waited for.
//
// ── TWO THRESHOLDS, NEVER ONE ───────────────────────────────────────────────
// The owner asked for fifteen days. That is LOG_VISIBLE_DAYS, and it governs the
// screen. LOG_KEEP_DAYS is longer, and it is the only number that may delete.
//
// In the gap, a record has left the screen but still exists. If the visible rule
// is ever wrong, it shows up as "my records vanished early" a full week BEFORE
// it becomes irreversible. That turns "it can never delete too much" from a
// promise into a structural property.

import { WEEKDAYS, isWeekday, MAX_ITEMS } from './pastries-model.js';

export const LOG_VISIBLE_DAYS = 15;
export const LOG_KEEP_DAYS = 21;
export const MAX_LOG_ITEMS = MAX_ITEMS;

// At most this many deletions in one app open, whatever else goes wrong. The
// collection holds at most one record per night, so this drains it comfortably
// while making a burst impossible.
export const MAX_DELETES_PER_PASS = 5;

// A clock reading before this cannot be believed: the feature did not exist. A
// phone that thinks it is 1970 must not conclude that everything is 20,000 days
// old and delete the lot.
export const MIN_SANE_MS = Date.UTC(2026, 7, 1);

const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The work DATE a moment belongs to, as 'YYYY-MM-DD'. Same 4am roll-over as the
// weekday: a record accepted at 00:30 on Wednesday belongs to Tuesday night.
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
  if (ms < MIN_SANE_MS) return null;              // the device clock is in the past
  return daysBetween(log.date, workDate(ms));
}

// Is this record still on the screen? The number the owner asked for.
export function isLogVisible(log, nowMs, days = LOG_VISIBLE_DAYS) {
  const age = ageOf(log, nowMs);
  if (age === null) return true;    // unreadable: show it rather than hide it
  if (age < 0) return true;         // dated ahead of this clock: still show it
  return age <= days;
}

// May this record be DELETED?
//
// ⚠️ EVERY UNCERTAIN ANSWER IS `false`. Absence of evidence is never a reason to
// delete. Each line below is one unit test:
//   - not an object
//   - no date, a date that is not a string, or the wrong shape
//   - the right shape but not a real day ('2026-02-31')
//   - nowMs missing, not finite, or <= 0
//   - nowMs before MIN_SANE_MS — the phone's clock is wrong, not the data
//   - inside the keep window
//
// The negative-age line below is BELT AND BRACES, not load-bearing, and saying
// so is the point: mutation testing showed the suite stays green without it,
// because a negative age can never exceed a positive keep window anyway. It is
// kept as a statement of intent — "a record dated ahead of this clock is not
// old" — so that a future change to the comparison cannot quietly make skew
// mean deletion. The TEST pins the behaviour, whichever line delivers it.
export function isLogExpired(log, nowMs, keepDays = LOG_KEEP_DAYS) {
  const keep = Number(keepDays);
  if (!Number.isFinite(keep) || keep < 1) return false;
  const age = ageOf(log, nowMs);
  if (age === null) return false;
  if (age < 0) return false;
  return age > keep;
}

// Which records a single pass may remove, oldest first.
//
// Three brakes on top of the per-record decision:
//   1. THE MAJORITY GUARD. A pass that would remove more than half of a
//      collection of more than two is not a retention pass, it is a bug — a
//      clock jump, or a decision function that has gone wrong. It removes
//      NOTHING and says so.
//   2. THE CAP. At most maxPerPass in one app open, whatever happens.
//   3. Anything unreadable is simply never in the list, by isLogExpired.
export function expiredLogs(logs, nowMs, { keepDays = LOG_KEEP_DAYS, maxPerPass = MAX_DELETES_PER_PASS } = {}) {
  const list = Array.isArray(logs) ? logs.filter(l => l && typeof l === 'object') : [];
  if (!list.length) return [];

  const doomed = list
    .filter(log => isLogExpired(log, nowMs, keepDays))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (list.length > 2 && doomed.length > Math.floor(list.length / 2)) {
    console.warn(
      `[pastry-logs] refusing to remove ${doomed.length} of ${list.length} records in one pass — ` +
      'that is not a retention pass, something is wrong.');
    return [];
  }

  const cap = Number(maxPerPass);
  return doomed.slice(0, Number.isFinite(cap) && cap > 0 ? cap : 0);
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

// A record with no readable date or weekday is DROPPED rather than shown: it
// cannot be placed on a timeline, and it is also — deliberately — one that
// isLogExpired will never delete, so it stays in the database to be looked at.
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

// What Accept writes. `existing` is the record already filed for this date and
// weekday, if there is one — accepting twice in one night is a CORRECTION, so
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
