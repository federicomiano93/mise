// whats-new-boot.js — shows the "what's new" notice on the Home screen. Loaded by
// index.html only; the decision itself is pure and lives in whats-new.js.
//
// HOME ONLY, on purpose. Home is the installed app's start_url, so it is seen
// anyway, and interrupting someone who opened Orders to record a delivery is
// exactly the wrong moment to explain a new feature.
//
// It lands right after the update flow: the "New version available" banner is
// tapped, the page reloads on the new code, and this file — new in that same
// version — finds a stamp it does not recognise and says what changed.

import { RELEASES, pickNotices, noticeText, newestId } from './whats-new.js';
import { alertDialog } from './confirm-dialog.js';
import { onSession } from './firebase.js';

const SEEN_KEY = 'whats-new-seen';

// Storage can throw (private mode, blocked cookies). It is a release note: if it
// cannot be remembered, say nothing at all rather than repeat the same notice on
// every single open.
function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return null; }
}

function writeSeen(id) {
  try { localStorage.setItem(SEEN_KEY, id); return true; } catch { return false; }
}

// Settings this app is known to leave behind. Any one of them means it has been
// used on this device before, whatever the service worker is doing.
const FOOTPRINTS = [
  'calculator-config',    // the Calculator's config cache — written on every load
  'lastHiddenAt',         // idle-reset, written whenever any page is backgrounded
  'logs-cache',
  'catalogue-recipes',
  'uk-bank-holidays',     // the bank-holiday calendar the Orders alerts use
];
// Anything listed here must be a key the app STILL writes: a dead one is a footprint
// that can never be found. 'orders-view' was dropped when the Orders view stopped
// being remembered.

// Has this app been opened on this device before?
//
// It decides the one ambiguous case: no stamp stored. A phone that has used the app
// for months and simply never had this feature should be told what changed; a phone
// opening the app for the first time should not.
//
// The service worker is the strong signal: it only CONTROLS the page once the app
// has been loaded here before — the very same test sw-update.js uses to tell an
// update from a first install. On a genuinely first visit it is null, because
// registration does not even start until the load event, after this runs.
// localStorage is the fallback for when the worker never registered at all.
function hasUsedTheAppBefore() {
  if (navigator.serviceWorker?.controller) return true;
  try {
    return FOOTPRINTS.some(key => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

// The splash sits at z-index 9999 and the dialog at 10000, so showing straight away
// would put the notice on top of the logo. boot.js REMOVES the splash from the DOM
// once it has faded, so that removal is the signal — no guessed delay that a slow
// phone would get wrong. The cap is above boot.js's own 4s failsafe + its 0.5s fade.
function afterSplash() {
  return new Promise(resolve => {
    if (!document.getElementById('splash')) return resolve();

    const stop = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
    const observer = new MutationObserver(() => {
      if (!document.getElementById('splash')) stop();
    });
    const cap = setTimeout(stop, 5000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Wait until a location is actually OPEN before saying anything.
//
// ⚠️ THIS IS NOT A NICETY. The sign-in cover is the topmost thing on the page and
// it makes everything behind it `inert`, so a notice opened while the cover is up
// is visible, unreachable, and sitting between the person and the sign-in form —
// on every phone that had used the app before, which is all of them. Measured, on
// a returning phone: the button reported `inert` and the cover on top of it.
//
// It is also just correct: an app you have not signed into has no business
// telling you what changed in it.
function afterSignIn() {
  return new Promise(resolve => {
    let settled = false;
    const unsubscribe = onSession(session => {
      if (settled || session.status !== 'ready') return;
      settled = true;
      resolve();
    });
    // onSession calls back synchronously with the current state, so this runs
    // after `unsubscribe` exists either way.
    if (settled) unsubscribe();
    else queueMicrotask(() => { if (settled) unsubscribe(); });
  });
}

async function run() {
  const seen = readSeen();
  if (seen === null) return;                 // storage unavailable — stay quiet

  const latest = newestId(RELEASES);
  if (!latest) return;

  // Read BEFORE the first await: the service-worker check has to happen while the
  // page is still in the state it loaded in.
  const notices = pickNotices(RELEASES, seen, hasUsedTheAppBefore());

  // Nothing to say — either already read, or a phone opening the app for the first
  // time. Adopt the current release silently either way.
  if (!notices.length) {
    if (seen !== latest) writeSeen(latest);
    return;
  }

  await afterSignIn();
  await afterSplash();

  // Recorded BEFORE the dialog opens, not after. The alternative re-shows the same
  // notice for ever if the page is closed or reloaded while it is open — and being
  // nagged by a message you have already read is worse than missing one.
  //
  // But AFTER the wait above, not before it: marking a notice read while it is
  // still stuck behind the sign-in screen would throw it away unread.
  writeSeen(latest);

  await alertDialog(noticeText(notices), { title: t('ui.whatsNew'), okLabel: t('help.gotIt') });
}

run();
