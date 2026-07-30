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

async function run() {
  const seen = readSeen();
  if (seen === null) return;                 // storage unavailable — stay quiet

  const latest = newestId(RELEASES);
  if (!latest) return;

  const notices = pickNotices(RELEASES, seen);

  // First run on this phone: adopt the current version silently, so the next real
  // change is the first thing anybody is ever shown.
  if (!notices.length) {
    if (seen !== latest) writeSeen(latest);
    return;
  }

  // Recorded BEFORE the dialog opens, not after. The alternative re-shows the same
  // notice for ever if the page is closed or reloaded while it is open — and being
  // nagged by a message you have already read is worse than missing one.
  writeSeen(latest);

  await afterSplash();
  await alertDialog(noticeText(notices), { title: "What's new", okLabel: 'Got it' });
}

run();
