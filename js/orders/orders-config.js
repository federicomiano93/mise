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

// A stored document (or null when it does not exist yet) → the settings the screen
// uses.
//
// Defaults to SHOWING stock, and only an explicit `false` hides it. That direction
// matters: a corrupt value, a half-written document or a field that does not exist yet
// must leave the screen as it has always been rather than silently removing a column
// people are typing into.
export function normalizeOrdersConfig(doc) {
  return { showStock: doc?.showStock !== false };
}
