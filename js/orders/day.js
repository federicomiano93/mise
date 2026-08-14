// day.js — local-day helpers for the Orders system.
//
// An order is filed under the DAY it was placed ("2026-07-13"), per supplier.
// Everything here works in LOCAL time: the bakery's day is the day the operator
// sees on the wall, not a UTC day. Two rules keep BST from shifting a date:
//   - never `new Date('2026-07-13')` — that parses as UTC midnight, which is the
//     previous day locally for any negative offset. Always parse with an explicit
//     time (`T00:00:00`), which the spec reads as local.
//   - move by days with setDate(), never by adding 86 400 000 ms (a DST day is
//     23 or 25 hours long).
// Comparing two "YYYY-MM-DD" strings with < is exact, so isBefore is a string
// compare on purpose.

import { t } from '../i18n.js';

// ⚠️⚠️ TWO LISTS OF WEEKDAYS, AND ONLY ONE OF THEM IS WORDS.
//
// WEEKDAY_LONG is DATA. Those exact strings are stored on every supplier
// (`orderDays`, `deliveryDays`) and are the document ids of the seven proving
// lists (`pastries/Monday`). Translating them would not change a label — it would
// make a Monday supplier never match a Monday, and all seven proving lists
// unreachable, with the app cheerfully showing seven empty days. They are on the
// DATA_WORDS list in js/i18n.js and tests/orders-day.test.mjs pins them English.
//
// The short forms below are PRESENTATION — they only ever reach a screen — so they
// come from the dictionary. Same word, opposite nature; the difference is which
// side of the app reads it.
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const weekdayShort = i => t(`day.weekdayShort.${i}`);
const monthShort = i => t(`day.monthShort.${i}`);

// A Date → "YYYY-MM-DD", read with local getters.
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD" → a Date at local midnight (see the T00:00:00 note above).
export function parseISODate(iso) {
  return new Date(`${iso}T00:00:00`);
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

// `days` may be negative. DST-safe.
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// True when ISO day `a` falls strictly before ISO day `b`.
export function isBefore(a, b) {
  return Boolean(a) && Boolean(b) && String(a) < String(b);
}

// The weekday NAME of an ISO day ("Monday"), matching the supplier orderDays /
// deliveryDays vocabulary used across the Orders feature.
export function weekdayOf(iso) {
  return WEEKDAY_LONG[parseISODate(iso).getDay()];
}

// A day spelled out: "Mon 6 Jul 2026" / "lun 6 lug 2026". Assembled from the
// dictionary rather than with toLocaleDateString, so the output is identical on
// every device whatever its own locale happens to be, and assertable in a test.
//
// ⚠️ THE ORDER OF THE PIECES IS ITSELF A PHRASE, not four values glued together.
// A language that puts the month before the day says so in its own entry instead
// of needing code that knows about it.
export function spellDay(iso) {
  if (!iso) return '';
  const d = parseISODate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return t('day.spelled', {
    weekday: weekdayShort(d.getDay()),
    d: d.getDate(),
    month: monthShort(d.getMonth()),
    year: d.getFullYear(),
  });
}

// Human label for a day section: "Today" / "Yesterday" / "Mon 6 Jul 2026".
export function dayLabel(iso, now = new Date()) {
  if (!iso) return '';
  if (iso === toISODate(now)) return t('day.today');
  if (iso === toISODate(addDays(now, -1))) return t('day.yesterday');
  return spellDay(iso);
}

// The day as it is SPOKEN mid-sentence: "today" / "yesterday" / "Sat 11 Jul 2026".
//
// ⚠️ THE LOWERCASE FORM IS ASKED FOR, NEVER COMPUTED. This used to call
// .toLowerCase() on the label — a language-specific operation performed on
// somebody else's language. Whether a word loses its capital mid-sentence, and to
// what, is the translator's business: German keeps it, and a language whose word
// is identical in both forms simply repeats it. Same technique, same reason, as
// personLabelInSentence() in js/roles.js.
//
// A spelled-out date is a NAME and keeps its own capital either way — lowercasing
// the lot gives "sat 11 jul 2026", which reads like a typo.
export function daySpoken(iso, now = new Date()) {
  if (!iso) return '';
  if (iso === toISODate(now)) return t('day.today.inSentence');
  if (iso === toISODate(addDays(now, -1))) return t('day.yesterday.inSentence');
  return spellDay(iso);
}

// The day with the preposition a sentence needs: "today" / "on Sat 11 Jul 2026".
//
// ⚠️ A WHOLE PHRASE WITH A HOLE, not a word glued to a preposition. English says
// "on Saturday" and nothing before "today"; Italian says "il sabato" — and a
// language may need no preposition at all, or one that changes with the word
// after it. Gluing "on " in code decides that for every language at once.
export function dayWhen(iso, now = new Date()) {
  if (!iso) return '';
  const spoken = daySpoken(iso, now);
  return isNamedDay(iso, now) ? spoken : t('day.on', { day: spoken });
}

// The day as it reads after "an order": "for today" / "for Mon 6 Jul 2026". Every
// confirmation that records or removes an order names its day out loud, so filing
// a forgotten order under an older date can never be a surprise — and there is
// exactly one place that decides how it is worded.
export function dayPhrase(iso, now = new Date()) {
  if (!iso) return '';
  return t('day.for', { day: daySpoken(iso, now) });
}

// Is this one of the days the language has a WORD for, rather than a date?
//
// ⚠️ IT COMPARES DAYS, NOT THE PRINTED WORDS. The old code asked whether the label
// equalled the string 'today' — which stopped being true the moment the label
// could be «oggi», and would have silently started writing "on oggi".
function isNamedDay(iso, now) {
  return iso === toISODate(now) || iso === toISODate(addDays(now, -1));
}

// The local day an ISO TIMESTAMP (e.g. draft.updatedAt, "2026-07-12T21:04:00Z")
// happened on. Used as the fallback stamp for a draft written before the app
// started recording a per-supplier day. Returns '' when there is nothing to read.
export function localDayOf(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? '' : toISODate(d);
}
