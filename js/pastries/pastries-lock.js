// pastries-lock.js — is tonight's list already done, and may it still be changed?
//
// PURE: no DOM, no Firebase, no storage, and no Date.now() inside any function.
// Every entry point takes the clock, so behaviour that depends on it can be
// asserted rather than waited for.
//
// ── THE CHOICE THAT MADE THIS SIMPLE ────────────────────────────────────────
// "Has this list been confirmed tonight?" needs NO flag of its own. A record
// either exists at pastry-logs/{workDate}_{Weekday} or it does not, so the
// answer is already in the data. Three things follow for free:
//
//   1. it unlocks BY ITSELF when the work date rolls at 4am — there is no expiry
//      routine to run and no flag that can be left behind;
//   2. every phone agrees, because they are all reading the same records: if a
//      colleague confirms Thursday, Thursday reads as done here too;
//   3. there is nothing new to store, so there is nothing new to go wrong.
//
// ⚠️ UNLIKE THE CALCULATOR, A NEW DAY MUST NOT CLEAR ANYTHING. The Calculator
// empties its fields on a new work day because they are that day's orders. A
// pastry list is a STANDING value — typed once, good for weeks. So the roll at
// 4am unlocks, and never deletes. Getting this backwards would greet the bakery
// with seven empty lists every morning.

import { DAY_START_HOUR, isWeekday } from './pastries-model.js';
import { isRealISODate } from './pastries-log-model.js';

// Where this phone remembers it was allowed to edit an already-confirmed day.
//
// The value stored is the WORK DATE the permission was given on, which is the
// whole trick: at 4am the work date moves on, the stored one stops matching, and
// the permission is spent. Nothing has to expire it, and a key left behind by an
// old version is inert rather than wrong.
export const EDIT_GRANT_PREFIX = 'pastries-edit-';

export function grantKeyFor(day) {
  return isWeekday(day) ? `${EDIT_GRANT_PREFIX}${day}` : null;
}

// May this day's list still be changed?
//
// ⚠️ EVERY UNCERTAIN ANSWER IS "NOT LOCKED", which is the opposite of how the
// record model answers about deleting — and deliberately so. There, doubt had to
// mean "keep", because the mistake was irreversible. Here the mistake would be
// someone standing at 4am unable to correct a list, with nothing on screen
// explaining why. An unlocked list is exactly what this app did before this
// feature existed, so falling back to it can only ever lose the new convenience,
// never the work.
//
// Each line below is one unit test:
//   - nothing recorded tonight            → not locked
//   - a clock that cannot be read         → not locked
//   - recorded, and no permission given   → LOCKED
//   - recorded, permission given tonight  → not locked
//   - recorded, permission from last night → LOCKED again (it expired at 4am)
export function isDayLocked({ confirmed, grant, workDate } = {}) {
  if (!confirmed) return false;
  if (!isRealISODate(workDate)) return false;
  return grant !== workDate;
}

// How long until the work day rolls over — the moment a confirmed list unlocks
// by itself. The screen uses it to wake up at exactly 4am rather than polling.
//
// Returns null when the clock cannot be read, and the caller then simply sets no
// timer: the lock still releases the next time the screen is opened or returned
// to, because it is recomputed from the clock every time it is asked.
//
// ⚠️ Built with setHours on a LOCAL date, like workWeekday in pastries-model.js,
// because 4am means 4am on the wall — not four hours after a UTC midnight. That
// also makes it right on the two clock-change Sundays and in a zone with no
// daylight saving at all, which is what CI runs in.
export function msUntilWorkDayEnd(nowMs) {
  const ms = Number(nowMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const next = new Date(ms);
  next.setHours(DAY_START_HOUR, 0, 0, 0);
  // Already past today's 4am (or exactly on it — that roll has just happened),
  // so the next one is tomorrow's.
  if (next.getTime() <= ms) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - ms;
  return Number.isFinite(delay) && delay > 0 ? delay : null;
}

// Which weekday lists are confirmed, read off the records for one work date.
//
// Takes the records the query returned and answers with a Set of weekday names.
// Anything unreadable is simply not in the Set — an unreadable record must never
// lock a list, for the same reason as above.
export function confirmedDaysFrom(logs) {
  const out = new Set();
  if (!Array.isArray(logs)) return out;
  for (const log of logs) {
    if (!log || typeof log !== 'object') continue;
    // The rules pin the id to `${date}_${day}`, so the two always agree; the id
    // is preferred anyway, as it is everywhere else in this feature.
    const fromId = typeof log.id === 'string' ? log.id.split('_')[1] : null;
    const day = isWeekday(fromId) ? fromId : log.day;
    if (isWeekday(day)) out.add(day);
  }
  return out;
}
