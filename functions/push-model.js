// push-model.js — PURE: what gets scheduled, whether it is still worth sending,
// and what the notification actually says.
//
// No DOM, no Firebase, no `Date.now()` read from inside — every function that
// cares about time is handed `nowMs`. It is shared by the APP (which schedules)
// and by the SERVER (which sends), so both sides agree by construction about when
// an alarm is still wanted. A second copy of these decisions on the server would
// be a copy of a JUDGEMENT, and the two would drift into a phone that buzzes for
// something it should not.
//
// ⚠️ IT LIVES IN js/ ROOT, like price-model.js, for the same reason: the guided
// mixing (a catalogue screen), the client orders (a calculator screen) and the
// server all read it, and a feature folder must never import from another one.

// ── Scheduling ────────────────────────────────────────────────────────────────

// Below this there is no point scheduling anything, and the reason is physical
// rather than a preference: enqueueing the job and delivering the push take a few
// seconds between them, so a notification for a 10-second timer would arrive
// AFTER the alarm the app itself already sounded. Nobody leaves the app for ten
// seconds either.
export const MIN_AHEAD_MS = 30 * 1000;

// Nothing is scheduled further out than this. It matches the model's own longest
// step (12 hours in guided-model.js), so a corrupt value cannot park a job in the
// queue for a week.
export const MAX_AHEAD_MS = 12 * 60 * 60 * 1000;

// ⚠️ AND A JOB THAT FIRES VERY LATE IS DROPPED, NOT SENT. A queue can retry, a
// phone can be off, a function can be slow — and a "add the butter" buzzing an
// hour after the dough was finished is worse than silence: it is the fastest way
// to make somebody turn notifications off for good. Fifteen minutes is generous
// for a delivery hiccup and far short of a step anybody is still waiting on.
export const MAX_LATE_MS = 15 * 60 * 1000;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export const MAX_TITLE = 80;
export const MAX_BODY = 160;

// Is this alarm far enough ahead to be worth scheduling, and not absurdly far?
export function isSchedulable(fireAt, nowMs) {
  const ahead = num(fireAt) - num(nowMs);
  return ahead >= MIN_AHEAD_MS && ahead <= MAX_AHEAD_MS;
}

// The document the app writes to ask for an alarm. The server reads exactly this.
//
// `active` is what makes cancelling work, and it is a FLAG rather than a delete on
// purpose — see isStillDue().
export function buildTimerDoc({ uid, token, fireAt, title, body, nowMs }) {
  return {
    uid: text(uid, 128),
    token: text(token, 4096),
    fireAt: num(fireAt),
    title: text(title, MAX_TITLE),
    body: text(body, MAX_BODY),
    active: true,
    createdAt: num(nowMs),
  };
}

// Enough to schedule at all: somewhere to send it, and something to say.
export function isValidTimerDoc(doc, nowMs) {
  return !!doc
    && !!text(doc.uid, 128)
    && !!text(doc.token, 4096)
    && isSchedulable(doc.fireAt, nowMs)
    && !!text(doc.title, MAX_TITLE);
}

// ── Sending ───────────────────────────────────────────────────────────────────

// ⚠️ THE SENDER ASKS "IS THIS STILL WANTED?", IT IS NOT CANCELLED.
//
// The obvious design is to delete the queued job when somebody taps Done. That
// fails quietly in every way a network can: the delete is refused, or arrives
// after the job has already been picked up, and the phone buzzes for a step
// finished ten minutes ago. Re-reading one flag an instant before sending cannot
// fail quietly — if the read fails, nothing is sent, which is the safe direction.
//
// Three ways to be un-wanted, and each is a real case:
//   active === false  — somebody tapped Done, Skip, or left the mix
//   too early         — the queue fired ahead of time (a retry, a clock skew)
//   too late          — see MAX_LATE_MS
export function isStillDue(doc, nowMs) {
  if (!doc || doc.active !== true) return false;
  const late = num(nowMs) - num(doc.fireAt);
  return late >= 0 && late <= MAX_LATE_MS;
}

// Why it was not sent, for the server log. A silent skip is indistinguishable
// from a broken function when somebody asks why their phone stayed quiet.
export function skipReason(doc, nowMs) {
  if (!doc) return 'no such timer';
  if (doc.active !== true) return 'cancelled before it was due';
  const late = num(nowMs) - num(doc.fireAt);
  if (late < 0) return `fired ${Math.round(-late / 1000)}s early`;
  if (late > MAX_LATE_MS) return `fired ${Math.round(late / 60000)} minutes late`;
  return '';
}

// ── What the phone shows ──────────────────────────────────────────────────────

// ⚠️ NEVER EMPTY AND NEVER "undefined". A notification is the one piece of this
// app somebody reads on a lock screen with no context around it, so every field
// falls back to something a person can act on rather than to a blank.
export function timerNotification(doc) {
  // ⚠️ THE LAST RESORT ONLY. Every notification this app sends carries its own
  // title; this is what appears if one ever arrives without one, and it is the
  // PRODUCT's name because the sender cannot know whose venue it is about.
  const title = text(doc && doc.title, MAX_TITLE) || 'Misé';
  const body = text(doc && doc.body, MAX_BODY) || 'Time is up.';
  return { title, body };
}

// The client-order notification. The client's NAME is the useful part on a lock
// screen — it is the bakery's own data, shown to the bakery.
export function orderNotification(order) {
  const who = text(order && order.clientName, MAX_TITLE);
  const when = text(order && order.date, 32);
  return {
    title: who ? `New order — ${who}` : 'New order received',
    body: when ? `For ${when}. Open the Calculator to see it.` : 'Open the Calculator to see it.',
  };
}

// ── Where a tap should land ───────────────────────────────────────────────────
// Kept here so the service worker, which cannot import a feature module, still
// agrees with the app about which screen answers which notification.
export const PUSH_KINDS = Object.freeze(['timer', 'order']);

export function targetPage(kind) {
  return kind === 'order' ? './calculator.html' : './catalogue.html';
}

// One notification per thing, so a re-delivery REPLACES rather than stacking
// three copies of the same alarm on the lock screen.
export function notificationTag(kind, id) {
  return `${PUSH_KINDS.includes(kind) ? kind : 'timer'}-${text(id, 128) || 'x'}`;
}
