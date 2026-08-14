// work-week.js — where the working week starts, and what "this week" means.
//
// PURE: no DOM, no Firestore, so every boundary below is assertable in a test (P15).
//
// ⚠️⚠️ THE WEEK MUST NEVER EXPIRE IN SILENCE, and that is the whole reason this file
// exists rather than a one-line date comparison. Federico asked for two things that
// contradict each other taken literally: «only the current week» (so an order that never
// arrived disappears when the week rolls) and «an obligation to tick, because otherwise
// you lose the control the app gives you» (so it must not be able to disappear
// unanswered). They resolve in one order: the daily list is the current week, and what
// is left unanswered when the week turns is put IN FRONT of somebody rather than
// dropped. It leaves AFTER an answer, never before.
//
// 📌 Why this was needed at all: production carries 34 recorded orders and NONE of them
// has a delivery confirmation — the fields did not exist when they were written. Without
// a window, "Incoming" opens on 34 rows, every one of them marked late. The window is
// what makes the screen about today's work again.

// Sunday first, matching WEEKDAY_LONG in day.js and the UK week Federico named.
export const WEEKDAYS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

// ⚠️ SUNDAY IS THE DEFAULT because that is the week Federico works to, and because a
// venue that has never been asked must not have a boundary invented for it silently.
export const DEFAULT_WEEK_START = 'Sunday';

// A stored value → a weekday name.
//
// ⚠️ ANYTHING UNRECOGNISED FALLS BACK TO THE DEFAULT, never to "no week at all". An
// unreadable setting must leave a working screen; emptying the list would look exactly
// like the feature working and quietly hide everything.
// ⚠️ THE TYPE IS CHECKED BEFORE THE VALUE, and the test that made this necessary is
// worth keeping in mind: `String(['Monday'])` is `'Monday'`, so a LIST holding a valid
// day was being accepted as that day. A list is not a decision — the same rule the send
// routes learnt about `'false'` and `1`. Anything that is not a plain string is somebody
// or something writing the wrong shape, and the answer is the default, not a guess.
export function weekStartOf(doc) {
  const raw = doc?.weekStartsOn;
  if (typeof raw !== 'string') return DEFAULT_WEEK_START;
  const wanted = raw.trim().toLowerCase();
  return WEEKDAYS.find(d => d.toLowerCase() === wanted) || DEFAULT_WEEK_START;
}

export function isValidWeekStart(value) {
  return WEEKDAYS.includes(String(value || ''));
}

// The ISO day the current week began on.
//
// ⚠️ COMPUTED FROM THE CLOCK, never counted or stored. The same technique as the 4am
// pastry lock: a boundary derived from the date cannot drift, cannot be left stale by a
// failed write, and needs no timer to roll over.
export function weekStart(today, startsOn = DEFAULT_WEEK_START) {
  if (!today) return '';
  const d = new Date(`${today}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const startIndex = Math.max(0, WEEKDAYS.indexOf(startsOn));
  // How many days back to the most recent `startsOn`. 0 when today IS that day —
  // ⚠️ the starting day belongs to the week it OPENS, not to the one it closes.
  const back = (d.getDay() - startIndex + 7) % 7;
  d.setDate(d.getDate() - back);
  return toISO(d);
}

// True when an ISO day falls in the same week as `today`.
export function inCurrentWeek(iso, today, startsOn = DEFAULT_WEEK_START) {
  const from = weekStart(today, startsOn);
  if (!from || !iso) return false;
  const to = addDaysISO(from, 6);
  return String(iso) >= from && String(iso) <= to;
}

// True when an ISO day is older than the current week — the ones that must be answered
// for rather than forgotten.
export function beforeCurrentWeek(iso, today, startsOn = DEFAULT_WEEK_START) {
  const from = weekStart(today, startsOn);
  if (!from || !iso) return false;
  return String(iso) < from;
}

// ── local helpers, deliberately not imported ─────────────────────────────────
//
// ⚠️ day.js pulls in the interface dictionary (it spells weekday names for the screen),
// and this file is asked by the RULES-adjacent pure layer as well as by the view. Keeping
// it dependency-free means a test can assert a boundary without a language being loaded,
// and means nothing here can accidentally start depending on which language is on.
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
