// calculator-order-prefill.js — PURE: fill a WhatsApp order from what was already
// calculated and logged, so the same quantities are not typed twice.
//
// No DOM, no Firebase, no storage, so it can be unit-tested under Node (P15 — the
// owner cannot read code, and these numbers end up in a message sent to a client).
//
// ⚠️ This deliberately bends P20 ("never auto-fill real-looking values"). It is
// acceptable ONLY because the order modal shows the numbers before anything is sent
// and every one of them can be corrected — and because the screen says where they came
// from. That sentence is not decoration: it is the condition that makes the exception
// honest. If it ever disappears, this should go with it.

import { workDayIndex } from './log-model.js';

// A row's identity: the client it belongs to plus the product. The same product
// ordered by two clients is two independent numbers.
const rowKey = (clientName, productId) => String(clientName || '') + '|' + String(productId || '');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── How far back the offer may reach ─────────────────────────────────────────
// TWO WORK DAYS: today and yesterday. Not a preference — it is how the bakery
// works. Some products are made the day BEFORE the order goes out and some the
// same morning, so today's order is assembled from both days' work and neither
// alone is the answer.
//
// ⚠️ WORK days, so the boundary is 4am and not midnight (workDayIndex). Someone
// shaping at 00:30 is still on last night's shift, and a midnight cut would drop
// their own log out of the window they are standing in.
//
// ⚠️ THIS IS ALSO THE FIX FOR AN OLDER HOLE: there used to be NO limit at all.
// The logs are never deleted — the "keep visible for N hours" setting only hides
// them from the Log screen — so the offer could reach back weeks and present a
// three-week-old quantity as "from your saved logs", with nothing saying how old
// it was. A plausible stale number is the worst kind: nothing on screen looks wrong.
export const PREFILL_WORK_DAYS = 2;

// Which work days each window accepts, as offsets back from today. Written as a table
// rather than as comparisons so the three options cannot drift apart, and so
// 'yesterday' is visibly [1] — yesterday ONLY, not "yesterday onwards".
const WINDOW_OFFSETS = {
  both: [0, 1],
  today: [0],
  yesterday: [1],
};

// The quantity to offer for each (client, product), taken from the most recent log
// IN THE WINDOW that recorded one. `logs` must arrive NEWEST FIRST (log-store's
// getLogs already sorts that way) and `latestOf` returns a log's current version.
//
// `nowMs` is the clock and `window` the chosen setting, both passed in so this stays
// pure and testable.
//
// Only a quantity ABOVE ZERO counts as recorded: a log that lists a product with 0 is
// saying it was not ordered, not that the answer is zero.
//
// ⚠️ AN UNREADABLE CLOCK OFFERS NOTHING, deliberately. Falling back to "no window"
// would silently restore the unbounded behaviour above — the failure would look
// exactly like the feature working. Offering nothing means the quantities get typed,
// which is merely the old way of doing it.
export function prefillFromLogs(entries, logs, latestOf, { nowMs, window } = {}) {
  const clock = Number(nowMs);
  if (!Number.isFinite(clock) || clock <= 0) return {};
  // An unknown window widens to 'both' rather than narrowing: a corrupt setting must
  // not quietly hide a day's work from the order.
  const offsets = WINDOW_OFFSETS[window] || WINDOW_OFFSETS.both;
  const today = workDayIndex(clock);
  const allowed = new Set(offsets.map(o => today - o));

  const found = new Map();

  for (const log of (Array.isArray(logs) ? logs : [])) {
    if (!log || typeof latestOf !== 'function') continue;
    // A log with no usable timestamp lands far in the past and is skipped: there is
    // no honest way to say whether it belongs to this order.
    if (!allowed.has(workDayIndex(num(log.createdAtMs)))) continue;
    const version = latestOf(log);
    for (const item of ((version && version.items) || [])) {
      if (!item) continue;
      const qty = num(item.qty);
      if (qty <= 0) continue;
      const key = rowKey(item.clientName, item.id);
      if (!found.has(key)) found.set(key, qty); // newest first, so the first win stands
    }
  }

  // Only answer for the rows the modal is actually showing.
  const out = {};
  (Array.isArray(entries) ? entries : []).forEach((entry, entryIndex) => {
    if (!entry || !entry.client) return;
    for (const product of (entry.products || [])) {
      if (!product) continue;
      const qty = found.get(rowKey(entry.client.name, product.id));
      if (qty !== undefined) out[entryIndex + '|' + product.id] = qty;
    }
  });
  return out;
}

// The sentence shown above the form. Names where the numbers came from, or says
// plainly that nothing was found — never silent either way.
//
// ⚠️ IT NAMES THE WINDOW THAT WAS ACTUALLY USED, not just "your saved logs". The old
// wording was true and useless: it did not say how old the numbers were, which is the
// one thing somebody checking them before sending needs to know. And since the window
// is now a SETTING, the sentence has to follow it — a fixed sentence would start
// lying the moment the setting was changed, which is worse than saying nothing.
const WINDOW_WORDS = {
  both: 'yesterday or today',
  today: 'today',
  yesterday: 'yesterday',
};

export function prefillNote(filledCount, window) {
  const when = WINDOW_WORDS[window] || WINDOW_WORDS.both;
  if (!filledCount) return `Nothing logged for these clients ${when} — type the quantities.`;
  return filledCount === 1
    ? `One quantity filled in from what you logged ${when} — check it before sending.`
    : `${filledCount} quantities filled in from what you logged ${when} — check them before sending.`;
}
