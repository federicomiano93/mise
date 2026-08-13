// push.js — turning notifications on for this phone, and scheduling one.
//
// ⚠️ IN js/ ROOT, like price-model.js, and for the same reason: the Catalogue
// schedules alarms, the Calculator shows order alerts, and Orders will want its
// own — a feature folder must never import from another feature's folder.
//
// ⚠️ NO SECOND SERVICE WORKER. Firebase's usual setup registers its own worker at
// the SITE ROOT, and this app is not at the root (it lives under
// /mise/ on GitHub Pages). getToken() is handed the app's
// existing registration instead, and sw.js does the receiving.

import { t } from './i18n.js';
import { getApps, getApp, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getMessaging, getToken, deleteToken }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getFirestore, doc, setDoc, deleteDoc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
// ⚠️ IMPORTING firebase.js FOR ITS SIDE EFFECT MATTERS, not only for these names:
// it is the ONE place Firestore is started, offline cache included, and an ES
// module's imports run before its own body — so it always wins the race to
// configure the SDK. Reaching for getApp() without it would quietly get a
// memory-only Firestore. Same reason every other data layer imports it.
import { firebaseConfig, currentSession, VAPID_PUBLIC_KEY } from './firebase.js';
import { pathFor, currentLocationId } from './location.js';
import { buildTimerDoc, isValidTimerDoc, isSchedulable } from './push-model.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = () => getFirestore(app);

const TOKENS = 'fcm-tokens';
const TIMERS = 'push-timers';
const TOKEN_KEY = 'push-token';

// ── Can this phone receive anything at all? ──────────────────────────────────
//
// ⚠️ THE APP SAYS WHICH OF THESE IS MISSING RATHER THAN JUST FAILING. On an
// iPhone, web notifications work ONLY when the app has been added to the Home
// screen — opened from Safari they are not merely blocked, the API is absent. A
// screen that just says "off" leaves somebody tapping a button that can never
// work, so each reason has its own answer.

export function pushSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS Safari outside a Home-screen app lands here.
    return { ok: false, reason: isIOS() && !isStandalone() ? 'install-first' : 'unsupported' };
  }
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'not-configured' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'blocked' };
  if (Notification.permission === 'granted') return { ok: true, reason: 'granted' };
  return { ok: false, reason: 'ask' };
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// What to say for each reason, in one place so every screen says the same thing.
export const SUPPORT_TEXT = Object.freeze({
  granted: t('help.notificationsAreOnFor'),
  ask: t('help.getToldWhenA'),
  blocked: t('help.notificationsAreBlockedFor'),
  'install-first': t('help.addThisAppTo'),
  'not-configured': t('help.notificationsAreNotSet'),
  unsupported: t('help.thisPhoneCannotShow'),
});

// ── Turning them on ──────────────────────────────────────────────────────────

// ⚠️ MUST BE CALLED FROM A REAL TAP. Browsers refuse a permission prompt that
// nobody asked for, and iOS refuses it outright outside a user gesture.
export async function enablePush() {
  const support = pushSupport();
  if (!support.ok && support.reason !== 'ask') return support;

  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); }
    catch (err) { return { ok: false, reason: 'unsupported' }; }
  }
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'blocked' : 'ask' };

  try {
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: 'unsupported' };
    await rememberToken(token);
    return { ok: true, reason: 'granted' };
  } catch (err) {
    console.warn('Could not register this phone for notifications:', err);
    return { ok: false, reason: 'unsupported' };
  }
}

export async function disablePush() {
  const token = storedToken();
  try { await deleteToken(getMessaging(app)); } catch (err) { /* best-effort */ }
  if (token) {
    try { await deleteDoc(doc(db(), pathFor(TOKENS), token)); }
    catch (err) { console.warn('Could not unregister this phone:', err); }
  }
  try { localStorage.removeItem(TOKEN_KEY); } catch (err) {}
}

function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (err) { return ''; }
}

// The document id IS the token, so re-registering the same phone overwrites
// rather than piling up rows nothing will ever clean.
async function rememberToken(token) {
  const session = currentSession();
  const uid = session && session.user ? session.user.uid : '';
  if (!uid) return;
  const previous = storedToken();
  // A token can rotate. Drop the old row so the location does not accumulate
  // registrations for phones that will never answer again.
  if (previous && previous !== token) {
    try { await deleteDoc(doc(db(), pathFor(TOKENS), previous)); } catch (err) {}
  }
  await setDoc(doc(db(), pathFor(TOKENS), token), {
    bakery: currentLocationId(), uid, updatedAt: Date.now(),
  });
  try { localStorage.setItem(TOKEN_KEY, token); } catch (err) {}
}

// ── Scheduling one alarm ─────────────────────────────────────────────────────

// Ask for a notification at `fireAt`. Returns the id to cancel it with, or '' if
// nothing was scheduled — which is a normal outcome, not a failure: notifications
// may be off, or the timer may be too short to be worth one.
//
// ⚠️ IT NEVER THROWS AND NEVER BLOCKS. This is called from the tap that starts a
// mixing timer, and the timer itself must start whatever the network is doing. A
// notification that fails to schedule costs a convenience; a Start button that
// hangs costs the dough.
export async function scheduleAlarm({ id, fireAt, title, body }) {
  try {
    if (!pushSupport().ok) return '';
    const token = storedToken();
    const session = currentSession();
    const uid = session && session.user ? session.user.uid : '';
    if (!token || !uid) return '';
    const now = Date.now();
    if (!isSchedulable(fireAt, now)) return '';

    const payload = buildTimerDoc({ uid, token, fireAt, title, body, nowMs: now });
    if (!isValidTimerDoc(payload, now)) return '';

    await setDoc(doc(db(), pathFor(TIMERS), id),
      { bakery: currentLocationId(), ...payload });
    return id;
  } catch (err) {
    console.warn('Could not schedule a notification:', err);
    return '';
  }
}

// ⚠️ CANCELLING MARKS, IT DOES NOT DELETE. The server re-reads this document an
// instant before sending and only sends while `active` is true. If cancelling
// deleted it instead, a read that failed for any other reason would look exactly
// like "cancelled", and the two would be impossible to tell apart in a log —
// which is the difference between knowing why a phone stayed quiet and guessing.
export async function cancelAlarm(id) {
  if (!id) return;
  try {
    await updateDoc(doc(db(), pathFor(TIMERS), id), { active: false });
  } catch (err) {
    // Already gone, offline, or never written. The send-side check is what
    // actually protects against a phantom buzz; this is the fast path.
    console.warn('Could not cancel a scheduled notification:', err);
  }
}
