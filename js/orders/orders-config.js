// orders-config.js — the Orders screen's own settings. PURE: no DOM, no Firestore, so
// the reading of a stored document can be asserted in a test (P15).
//
// This is the first setting Orders has ever had. It lives in Firestore at
// config/orders so it applies to every phone in the bakery — "we do not track stock
// here" is a decision about how the place works, not a preference of one device.
//
// ⚠️ It needs NO rules change: `match /config/{doc}` already allows any authenticated
// write carrying bakery == 'main', and saveDoc() stamps that field itself. Confirmed
// against firestore.rules before choosing this home over a new collection.

// How many days of past orders the History tab shows before asking. The app is used
// mostly by kitchen staff, who need this week's orders, not July's — but NOTHING is
// deleted: older orders stay in Firestore, still feed the suggestion engine, and are
// one tap away behind "Show older orders".
export const DEFAULT_HISTORY_DAYS = 15;
const MAX_HISTORY_DAYS = 365;

// A stored document (or null when it does not exist yet) → the settings the screen
// uses.
//
// Defaults to SHOWING stock, and only an explicit `false` hides it. That direction
// matters: a corrupt value, a half-written document or a field that does not exist yet
// must leave the screen as it has always been rather than silently removing a column
// people are typing into.
export function normalizeOrdersConfig(doc) {
  return {
    showStock: doc?.showStock !== false,
    historyDays: historyDaysOf(doc?.historyDays),
  };
}

// Anything that is not a sane day count falls back to the default rather than to 0.
// A 0 here would render an EMPTY History and read as "the orders are gone" — the one
// outcome this feature must never produce, since the whole point is that nothing is
// lost. Booleans are rejected outright: `Number(true)` is 1, which would quietly turn
// a corrupt flag into a one-day window.
function historyDaysOf(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_HISTORY_DAYS;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HISTORY_DAYS;
  return Math.min(n, MAX_HISTORY_DAYS);
}
