// pastries-model.js — everything the Pastries feature knows how to reason about,
// with nothing it can reason about a screen or a database with.
//
// PURE by design: no DOM, no Firebase, no localStorage, and — importantly — no
// Date.now() inside any function. Every entry point takes `nowMs`, so the one
// behaviour that is impossible to observe by hand (what the screen shows at 1am)
// can be asserted in a test at any hour, in any timezone, on any machine.
//
// The feature is seven lists, one per weekday: what has to be put to prove
// tonight for tomorrow's service.

// ── The vocabulary ───────────────────────────────────────────────────────────
// Monday-first, because that is how a week is read on a wall planner. JS's own
// getDay() is Sunday-first, so every conversion between the two goes through the
// (+6) % 7 shift below and nowhere else.
//
// The NAMES are deliberately the same strings the Orders feature stores in
// supplier orderDays/deliveryDays. A second weekday vocabulary in one database
// is a bug waiting for the day someone compares them.
export const WEEKDAYS = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

export const WEEKDAY_SHORT = Object.freeze([
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
]);

// ── The work day ─────────────────────────────────────────────────────────────
// A bakery's day does not end at midnight. Someone shaping pastries at 00:30 on
// Tuesday is still working Monday night's shift, and the list they need is the
// one for Tuesday — not Wednesday's. So the day rolls over at 4am, the same
// convention the Calculator already uses for its logs.
export const DAY_START_HOUR = 4;

// ── Limits ───────────────────────────────────────────────────────────────────
// MAX_ITEMS is enforced by firestore.rules too. The others cannot be: rules v2
// has no way to look inside a list, so the shape of each row is a guarantee this
// file makes and the database takes on trust.
export const MAX_ITEMS = 100;
export const MAX_NAME_LENGTH = 80;
export const MAX_QTY = 9999;

export function isWeekday(name) {
  return typeof name === 'string' && WEEKDAYS.includes(name);
}

function indexOfWeekday(day) {
  return WEEKDAYS.indexOf(day);
}

// Both wrap. Sunday's next day is Monday — a week has no end.
export function nextWeekday(day) {
  const i = indexOfWeekday(day);
  return i === -1 ? WEEKDAYS[0] : WEEKDAYS[(i + 1) % 7];
}

export function previousWeekday(day) {
  const i = indexOfWeekday(day);
  return i === -1 ? WEEKDAYS[0] : WEEKDAYS[(i + 6) % 7];
}

// Which work day a moment belongs to.
//
// ⚠️ THE FOUR HOURS ARE SUBTRACTED WITH setHours, NEVER FROM THE TIMESTAMP.
// `new Date(ms - 4 * 3600 * 1000)` looks equivalent and is wrong on BOTH
// clock-change Sundays, in opposite directions: a local day is 23 or 25 hours
// long there, so a fixed four-hour slice of milliseconds lands in the wrong
// place. Measured, not assumed (Europe/London and Europe/Rome share these dates):
//
//   Sun 25 Oct 2026 03:30 — ms says Sunday, correct is SATURDAY
//                           (03:30 is before 4am, so it is still the night before)
//   Sun 29 Mar 2026 04:30 — ms says Saturday, correct is SUNDAY
//                           (04:30 is past 4am, so the new work day has started)
//
// setHours works on the local calendar, which is the thing actually being asked
// about. It also makes this function correct in a zone with no DST at all, which
// is what CI runs in — so the tests below hold everywhere.
export function workWeekday(nowMs) {
  const ms = Number(nowMs);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  d.setHours(d.getHours() - DAY_START_HOUR);
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

// The day the screen opens on: the one being proved FOR, which is the day after
// the work day currently under way.
export function provingDayFor(nowMs) {
  return nextWeekday(workWeekday(nowMs));
}

// A quantity, made safe to store.
//
// ⚠️ A number field happily accepts `1e999`, which is Infinity, and Firestore
// REFUSES a non-finite number — so one keystroke would break every save that
// followed while the row on screen looked perfectly ordinary. Anything that is
// not a usable whole number becomes 0, which findInvalidItems then reports as a
// missing quantity: the person is told, rather than the save failing later.
//
// There is deliberately NO upper clamp here. Quietly turning a typed 50000 into
// 9999 would store a number nobody chose — the same objection that stops an
// over-long NAME being truncated on the way in. An absurd quantity is caught by
// findInvalidItems instead, which can point at the row and say so.
export function wholeNumber(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  return { name: name.slice(0, MAX_NAME_LENGTH), qty: wholeNumber(raw.qty) };
}

// One stored day document → the shape the rest of the feature works with.
// Never throws: a missing document, a corrupt field and a document that was
// never written all have to come back as an empty day, because that is what the
// screen shows on the days nobody has filled in yet.
//
// ⚠️ THE MAX_ITEMS TRUNCATION HERE IS LOAD-BEARING, and it is on the READ side
// on purpose. Without it a document that somehow carried more rows than the cap
// would display perfectly, accept one more row, and then have every single save
// refused by the rules — with nothing on screen able to explain why. Truncating
// on the way in means what you see is always something you can save.
export function normalizeDay(raw, dayId) {
  const day = isWeekday(dayId) ? dayId : (isWeekday(raw && raw.day) ? raw.day : WEEKDAYS[0]);
  const list = raw && Array.isArray(raw.items) ? raw.items : [];
  const items = [];
  for (const entry of list) {
    const item = normalizeItem(entry);
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return { day, items };
}

// The whole collection → { Monday: [...], …, Sunday: [...] }.
//
// ALL SEVEN KEYS, ALWAYS. The screen can be asked for any weekday at any moment,
// including the five nobody has ever filled in, and a caller that has to guard
// every lookup will eventually forget one.
//
// A document whose id is not a weekday is IGNORED rather than rendered: the
// rules refuse to create one, so its presence would mean something has gone
// wrong, and inventing an eighth day on screen is not the way to report that.
// Where the id and the stored `day` field disagree, the ID WINS — it is the one
// the rules pin, and it is the one that decides which list was being written.
export function normalizeDays(docs) {
  const out = {};
  WEEKDAYS.forEach(day => { out[day] = []; });
  if (!Array.isArray(docs)) return out;
  for (const doc of docs) {
    if (!doc || !isWeekday(doc.id)) continue;
    out[doc.id] = normalizeDay(doc, doc.id).items;
  }
  return out;
}

// An editor's working rows → what actually gets stored.
//
// A row with no name is DROPPED, not refused: an empty row is someone who has
// tapped "add" and not typed yet, and refusing to save because of it would make
// the button feel broken. (Same choice the recipe editor makes.) Order is
// preserved exactly — it is the order the work gets done in.
export function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const item = normalizeItem(raw);
    if (item) out.push(item);
  }
  return out;
}

// What must stop a save, and why — or null when there is nothing wrong.
//
// An EMPTY LIST IS VALID. "Nothing proves on Sunday" is a real answer, and
// clearing a day is how it gets recorded.
export function findInvalidItems(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length > MAX_ITEMS) return { problem: 'too-many', index: -1, name: '' };

  const seen = new Map();
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const name = raw && typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue; // dropped by cleanItems, not an error

    if (name.length > MAX_NAME_LENGTH) return { problem: 'too-long', index: i, name };

    // Case-insensitive: two rows reading "Cornetti" and "cornetti" carry no more
    // information than one, and with no quantity to tell them apart the second
    // is always a slip.
    const key = name.toLowerCase();
    if (seen.has(key)) return { problem: 'duplicate', index: i, name };
    seen.set(key, i);

    // A name with no number is the one thing this list cannot be read from: the
    // whole point is knowing HOW MANY to put out. Blocked rather than saved as
    // zero, which would look deliberate on the shelf at 4am. A non-number
    // (Infinity, text, a negative) has already become 0 by this point, so it
    // lands here too and is reported the same way.
    const qty = wholeNumber(raw.qty);
    if (qty <= 0) return { problem: 'no-qty', index: i, name };
    if (qty > MAX_QTY) return { problem: 'qty-too-big', index: i, name };
  }
  return null;
}
