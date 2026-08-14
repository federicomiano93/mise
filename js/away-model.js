// away-model.js — "I am on holiday: do not buzz my phone." PURE.
//
// Federico, 14 Aug 2026. The need is real and the app's own notification code
// already argues for it: «an alarm that goes off for nothing is the fastest way
// to get notifications turned off, taking the useful ones with it» (push-model).
// A manager buzzed at 6am for an order list they cannot possibly place is exactly
// that alarm.
//
// ⚠️⚠️ AND THE DANGER IT INTRODUCES IS BIGGER THAN THE ONE IT REMOVES, so the
// whole file is shaped around it: IF THE ONLY MANAGER IS AWAY, A LIST REACHES
// NOBODY AND NOTHING SAYS SO. The person who sent it sees "sent" and the order
// sits there for a week. Three rules follow, and none of them is optional:
//
//   1. being away silences the RINGING, never the work. The banner in Orders and
//      the badge on the Home are untouched, so somebody coming back does not find
//      an app that looks empty;
//   2. the sending screen says WHO will be told, and asks out loud when that is
//      nobody (see whoWillBeTold / nobodyWillBeTold);
//   3. it ENDS BY ITSELF on a date. A switch with no end is one flicked in August
//      and found in November, having missed three months of orders.
//
// No DOM, no Firestore, no clock read from inside — every function that cares
// about time is handed `now`. Same shape, same reason, as push-model.js.

import { t } from './i18n.js';

// ⚠️ A CEILING, AND IT IS NOT ARBITRARY. Somebody typing 2027 by mistake would
// switch their notifications off for a year and never think about it again. A
// year is longer than any holiday and short enough to be noticed.
export const MAX_AWAY_DAYS = 365;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  // Rejects 2026-02-31, which matches the pattern and then silently becomes 3 March.
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

// A local timestamp → 'YYYY-MM-DD' in the LOCAL calendar. Built by hand rather
// than with toISOString(), which converts to UTC first and so names the wrong day
// for anyone east of Greenwich in the small hours.
export function toISODate(ms) {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── Is this person away right now? ───────────────────────────────────────────

// ⚠️⚠️ THE LAST DAY IS INCLUDED, AND THAT IS THE WHOLE POINT OF THE COMPARISON.
// "Away until Friday" means Friday too — nobody means "back on Friday morning"
// when they type Friday. Comparing dates as strings is exact for ISO days.
//
// ⚠️ AND IT ENDS BY ITSELF: nothing counts down and nothing has to run at
// midnight. The answer is derived from the clock every time it is asked, exactly
// like the 4am pastry lock. There is no flag to get stuck.
export function isAway(doc, now = Date.now()) {
  const until = doc && doc.until;
  if (!isISODate(until)) return false;
  return toISODate(now) <= until;
}

// ⚠️ EVERY UNCERTAIN ANSWER IS "NOT AWAY", and the direction is deliberate. A
// corrupt record, a date nobody can parse, a document that failed to load: all of
// them mean the phone RINGS. The mistake this app can afford is one unnecessary
// notification; the one it cannot afford is an order list that reaches nobody
// because a broken record was read as a holiday.
export function awayUids(docs, now = Date.now()) {
  return new Set((docs || []).filter(d => isAway(d, now)).map(d => d && d.uid).filter(Boolean));
}

// ── Setting it ───────────────────────────────────────────────────────────────

// What a phone writes. Returns null when the date makes no sense, so a bad value
// never reaches Firestore and never silences anybody by accident.
export function buildAwayDoc({ uid, until, now = Date.now() }) {
  const id = String(uid || '').trim();
  if (!id) return null;

  // Clearing is a real answer — "I am back" — and is written as an empty string
  // rather than by deleting the document: a delete that fails leaves somebody
  // silenced with no record of why, and this way the last state is always there
  // to read.
  if (until === '' || until === null || until === undefined) {
    return { uid: id, until: '', updatedAt: now };
  }

  if (!isISODate(until)) return null;
  // ⚠️ A DATE IN THE PAST IS REFUSED rather than silently accepted: it would
  // store a holiday that is already over, which reads as "set" on the screen and
  // does nothing at all.
  if (until < toISODate(now)) return null;
  if (daysBetween(toISODate(now), until) > MAX_AWAY_DAYS) return null;

  return { uid: id, until, updatedAt: now };
}

// Whole days from one ISO day to another. Built with the local Date constructor
// so a clock change (a day is not always 24 hours) cannot shift the count.
export function daysBetween(fromISO, toISO) {
  if (!isISODate(fromISO) || !isISODate(toISO)) return NaN;
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

// The furthest date the picker offers, so the ceiling is a fact of the control
// rather than an error message after the fact.
export function maxAwayDate(now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() + MAX_AWAY_DAYS);
  return toISODate(d.getTime());
}

// ── Who will actually be told ────────────────────────────────────────────────

// The people a notification would reach: whoever runs the place, minus the sender,
// minus anybody away.
//
// ⚠️ THIS IS A LABEL FOR A SCREEN, NOT A DECISION. It reads the ROSTER, which the
// app can see — `users/{uid}`, the document the RULES and the SERVER read, is
// readable only by its own owner, so no phone can know for certain who the
// managers are. The server decides for real; this exists so the person sending a
// list is not left guessing.
//
// ⚠️ AND IT FAILS TOWARDS "somebody will be told". If the roster is unreadable or
// says nothing, this returns an empty list and the caller shows no warning — the
// list is sent, which is the recoverable direction. A false "nobody will hear
// this" would teach people to ignore the warning that matters.
export function whoWillBeTold(roster, awaySet, senderUid) {
  return (roster || [])
    .filter(m => m && m.uid && m.uid !== senderUid)
    .filter(m => m.role === 'owner' || m.role === 'manager')
    .filter(m => !(awaySet && awaySet.has(m.uid)));
}

// ⚠️ ONLY TRUE WHEN THERE REALLY ARE PEOPLE AND EVERY ONE OF THEM IS AWAY. An
// empty roster means "the app does not know", not "nobody is there" — warning
// then would fire on every send in a venue whose roster has not been filled in.
export function nobodyWillBeTold(roster, awaySet, senderUid) {
  const runners = (roster || [])
    .filter(m => m && m.uid && m.uid !== senderUid)
    .filter(m => m.role === 'owner' || m.role === 'manager');
  if (!runners.length) return false;
  return runners.every(m => awaySet && awaySet.has(m.uid));
}

// ── What the screen says ─────────────────────────────────────────────────────

export function personName(member) {
  const full = [member?.firstName, member?.lastName]
    .map(p => String(p || '').trim()).filter(Boolean).join(' ');
  return full || String(member?.email || '').trim() || t('orders.request.someone');
}

// "Marco is away until Friday" / "Marco and Giulia are away until…" — one phrase
// per shape, because a list of names and a verb agree differently in each
// language and gluing them in code decides that for all of them at once.
export function awayNames(roster, awaySet, senderUid) {
  return (roster || [])
    .filter(m => m && m.uid && m.uid !== senderUid)
    .filter(m => m.role === 'owner' || m.role === 'manager')
    .filter(m => awaySet && awaySet.has(m.uid))
    .map(personName);
}
