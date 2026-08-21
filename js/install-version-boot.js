// install-version-boot.js — the Home-only wiring for js/install-version.js.
//
// ⚠️ THE HOME ONLY, like js/whats-new-boot.js and for the same reason: this is the
// screen somebody arrives on, not one they are working in. A dialog that appears while
// an order is being typed interrupts the one thing the app exists for.
//
// ⚠️ AND ONCE PER CHANGE. checkInstall() records the new fingerprint even when it warns,
// so the message is said once and not on every open — nagging is how a notice stops
// being read.

import { t } from './i18n.js';
import { alertDialog } from './confirm-dialog.js';
import { onSession } from './firebase.js';
import { checkInstall } from './install-version.js';

// The manifest as the browser would fetch it. cache: 'no-cache' asks the server whether
// the copy is still good rather than trusting a stale one — this file changes rarely,
// so it is almost always a 304 and costs nothing.
async function readManifest() {
  const res = await fetch('manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// ⚠️ WAIT FOR A LOCATION TO BE OPEN BEFORE SAYING ANYTHING, and this is not a nicety.
// js/auth-gate.js marks every other child of <body> `inert` while the sign-in cover is
// up, so a dialog opened before then is drawn normally, receives nothing, and sits
// between the person and the sign-in form. That is exactly the fault reported from a
// phone in v1.53.2 — "it looks like it starts and it doesn't, the button will not
// click" — and auth-gate.js says in as many words that anything wanting to interrupt
// must wait instead. Copied from js/whats-new-boot.js deliberately, not imported: these
// are two independent Home features and neither should be able to break the other.
function afterSignIn() {
  return new Promise(resolve => {
    let settled = false;
    const unsubscribe = onSession(session => {
      if (settled || session.status !== 'ready') return;
      settled = true;
      resolve();
    });
    if (settled) unsubscribe();
    else queueMicrotask(() => { if (settled) unsubscribe(); });
  });
}

// The splash sits at z-index 9999 and the dialog at 10000, so showing straight away
// would put the notice on top of the logo. boot.js REMOVES the splash once it has
// faded, so that removal is the signal rather than a guessed delay.
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

// ⚠️ AND WAIT FOR ANY OTHER DIALOG TO CLOSE. The Home can also raise the "What's new"
// notice, and the two would land on the same instant after an update — which is the
// one moment both have something to say. Two dialogs at once is one dialog covering
// another, and whichever is underneath is read by nobody.
//
// It waits rather than skipping: this notice says the app has to be re-installed, and
// that must not be dropped because a release note happened to be due the same morning.
function afterAnyOtherDialog() {
  return new Promise(resolve => {
    const open = () => document.querySelector('.app-dialog');
    if (!open()) return resolve();
    const stop = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
    const observer = new MutationObserver(() => { if (!open()) stop(); });
    // A cap, because a dialog left open for ever must not silence this for ever.
    const cap = setTimeout(stop, 120000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function run() {
  let result;
  try {
    result = await checkInstall({
      win: window,
      storage: localStorage,
      fetchManifest: readManifest,
    });
  } catch {
    return;   // ⚠️ never let this stop the Home from working
  }
  if (!result.warn) return;

  await afterSignIn();
  await afterSplash();
  await afterAnyOtherDialog();

  // Recorded HERE, not when the check ran: before the waits above, an app closed on
  // the sign-in screen would have spent its one notice without showing it. And BEFORE
  // the dialog rather than after, or closing the app while it is open re-shows it for
  // ever. Same reasoning, same order, as js/whats-new-boot.js.
  result.adopt();

  await alertDialog(
    t('install.stale.body'),
    { title: t('install.stale.title'), okLabel: t('help.gotIt') },
  );
}

run();
