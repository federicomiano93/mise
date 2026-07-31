// update-gate.js — WHETHER to force an update on the operator right now. PURE:
// no DOM, no service worker, so the decision can be asserted in a test instead of
// being reasoned about (P15). The screen it produces lives in js/sw-update.js.
//
// WHY FORCING AT ALL. The update banner could be ignored for ever, and this app has
// already paid for that: v1.11.0 tightened the Firestore rules, and phones still on
// the previous version had their History edits refused — loud, but only for the
// person holding that phone. Rules reach every device the instant they deploy while
// code arrives one device at a time, so "some phones are months behind" is not a
// tidiness problem, it is how two people end up with an app that disagrees about
// what is allowed.
//
// WHY IT IS SAFE TO BLOCK. The gate only ever appears when the new worker is already
// INSTALLED and waiting, which means the new files are already on the phone.
// Activating it is a local operation and needs no network. The escape hatch below is
// a seatbelt, not a routine path.

// How many failed attempts before the operator is allowed to carry on regardless.
// A kitchen mid-service cannot be left with an app that refuses to open because
// something went wrong on the way to activating a worker.
export const MAX_ATTEMPTS = 2;

// The things that mean "do not interrupt": a question waiting for an answer, or a
// form holding typing that a reload would throw away.
//
// Typing a QUANTITY is deliberately absent. The order draft autosaves every 800ms,
// so a reload loses nothing — and treating every keystroke as "busy" on a screen
// that is nothing but number fields would mean the gate never appears at all.
//
// ⚠️ EVERY SELECTOR HERE MUST MATCH ONLY WHAT IS ON SCREEN. The Orders and Catalogue
// entries are built and removed as they are used, so being in the document IS being
// visible. The CALCULATOR is the opposite: its sixteen overlays and modals are
// declared in calculator.html and merely hidden, so they are in the document from
// the moment the page loads — matching them by id alone would make the app look
// permanently busy and the gate would never appear at all. They are shown by adding
// `.visible` (one convention, used by every one of them), so that class is what the
// selectors below key on. A new selector for a statically declared element MUST
// carry the same qualifier.
export const BUSY_SELECTORS = Object.freeze([
  '.app-dialog-backdrop',       // a confirm/alert dialog is open
  '.mgmt-form',                 // adding or editing a supplier / ingredient
  '.hist-edit-list',            // correcting a recorded order
  '.cat-editor',                // writing a recipe
  '.preview-overlay',           // a tick-list waiting for a choice
  // The Calculator's own screens: Settings, the recipe editor, the log editors,
  // and the "Save this dough for: Today / Tomorrow" chooser raised by Confirm.
  // Found by driving the app: confirming a dough opens #day-modal, and the gate
  // used to appear straight over it, throwing away the confirmation half-done.
  '[id$="-overlay"].visible',
  '[id$="-modal"].visible',
]);

// Is the operator in the middle of something? `root` is a document or element —
// injected rather than reaching for `document`, so this is testable.
export function isBusy(root) {
  if (!root || typeof root.querySelector !== 'function') return false;
  return BUSY_SELECTORS.some(selector => root.querySelector(selector) !== null);
}

// What the gate should be doing:
//   'hidden'                — nothing to force, or not now
//   'blocking'              — the modal, with only "Update now"
//   'blocking-with-escape'  — the modal, plus a quiet way to carry on
//
// `busy` returns 'hidden' rather than a state of its own: the caller's job is
// simply "do not show it yet", and it retries when the screen changes.
export function updateGateState({ waiting = false, busy = false, attempts = 0 } = {}) {
  if (!waiting) return 'hidden';
  if (busy) return 'hidden';
  return Number(attempts) >= MAX_ATTEMPTS ? 'blocking-with-escape' : 'blocking';
}

// ── Counting the attempts ────────────────────────────────────────────────────
//
// sessionStorage, NOT localStorage, and that is the whole behaviour Federico asked
// for: the count survives the reload an update attempt performs, but dies when the
// app is closed. So someone who had to skip an update at 7am is asked again the
// next time they open the app, rather than never again.

const ATTEMPTS_KEY = 'sw-update-attempts';

export function readAttempts(storage = globalThis.sessionStorage) {
  try {
    const n = Number(storage?.getItem(ATTEMPTS_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;   // private mode / storage blocked: behave as a first attempt
  }
}

export function bumpAttempts(storage = globalThis.sessionStorage) {
  const next = readAttempts(storage) + 1;
  try { storage?.setItem(ATTEMPTS_KEY, String(next)); } catch { /* ignore */ }
  return next;
}

// Called once the update has actually landed (no worker waiting any more), so the
// next update starts from a clean slate instead of inheriting an old grudge.
export function resetAttempts(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(ATTEMPTS_KEY); } catch { /* ignore */ }
}
