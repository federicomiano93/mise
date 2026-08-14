// firebase.example.js — Firebase setup template
//
// Copy this file to js/firebase.js and replace the placeholder config values
// with your real Firebase keys (from the Firebase Console).
// js/firebase.js IS committed to Git: Firebase web API keys are public config
// (sent to every visitor's browser), not secrets. Security comes from Firestore
// Security Rules + API key restrictions, never from hiding this file.
//
// This module:
//   1. Initializes Firebase and signs the user in anonymously
//   2. Mirrors the `log` collection in real time into window.firestoreLog
//      and notifies the app via a `firestore-log-updated` event
//   3. Exports helpers to persist / remove log entries
//
// Public API consumed by the rest of the app:
//   - saveLogToFirestore(record)      → js/log.js
//   - deleteLogFromFirestore(dough)   → js/log.js
//   - watchCalculatorConfig(onChange) → js/calculator-config-store.js
//   - saveCalculatorConfig(config)    → js/calculator-config-store.js
//   - side-effect `import './firebase.js'` for init → js/app.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  limit,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import {
  currentLocationId,
  pathFor,
  setCurrentLocationId,
  locationDocPath,
} from './location.js';
import { allowedSections, sectionsFor, pickStart, locationsOf } from './sections.js';
import { roleOf, isOwner, canManage } from './roles.js';
import { clearLocalData, shouldClearLocalData } from './local-data.js';

// ── Configuration (placeholders only — fill these in js/firebase.js) ──────────
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// The Web Push key, for notifications that arrive with the app closed.
// PUBLIC config (P1): the public half of the Web Push certificate pair, handed to
// every browser at runtime. Only the private half — which never leaves the
// Firebase console — can send anything.
// Firebase console → Project settings → Cloud Messaging → Web configuration →
// Generate key pair. Empty is a valid state: the app then says notifications are
// not set up rather than offering a button that cannot work.
export const VAPID_PUBLIC_KEY = '';

// ── Initialization ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ── Firestore, with the offline cache ON ─────────────────────────────────────
// Without this, a write made while the connection is down is held in memory and
// lost on the next reload, silently. With it, the write is on disk, survives the
// reload and is sent when the network returns; reads come from disk too, so the
// app opens with real data offline. persistentMultipleTabManager shares that
// cache between tabs — the single-tab default leaves the second tab with none.
//
// ⚠️ MUST BE THE FIRST TOUCH OF FIRESTORE IN THE APP: the SDK settles its
// settings on first use, so initializeFirestore() after any getFirestore() throws,
// and a getFirestore() that runs first silently keeps a memory-only client.
function startFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // No IndexedDB (private-mode Safari, a locked-down browser) is not a reason
    // to have no app: fall back to the memory-only client.
    console.warn('Firestore offline cache unavailable — running from memory only:',
      err?.message || err);
    return getFirestore(app);
  }
}

const db = startFirestore();

// ── Local emulator switch (AUTOMATIC, by hostname) ────────────────────────────
// On localhost / 127.0.0.1 the app talks to the LOCAL Firebase Emulator Suite, so
// development and manual browser testing NEVER touch production Firestore. On any
// other hostname (the live domain) it connects to production as before.
//
// This decision is made automatically from the URL — there is deliberately NO
// manual flag. A flag could be left in the wrong state and either point the live
// site at the emulator or point local testing at production. Hostname can't be
// forgotten: it is simply where the page is being served from.
//
// The production config above is unchanged; we only REDIRECT the SDK's traffic to
// the local emulator ports (firebase.json: auth 9099, firestore 8080) when local.
// ⚠️ EXPORTED, AND EVERY OTHER FIREBASE APP IN THE REPO MUST USE IT. A SECOND
// Firebase app (the client ordering page, the link minter) is not covered by the
// connect*Emulator calls below — those attach to this app's instances only — so a
// second app that decided for itself would talk to PRODUCTION while the console on
// the same page says "LOCAL EMULATOR mode". Ask once, here, and import the answer.
export const isLocalEmulator =
  typeof location !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);

const isLocalhost = isLocalEmulator;

if (isLocalhost) {
  // connectAuthEmulator must run before any sign-in; connectFirestoreEmulator
  // before any Firestore read/write. Both happen here, before either is used.
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  console.info('%c[Firebase] LOCAL EMULATOR mode — production data is NOT touched.',
    'color:#0a0;font-weight:bold');
} else {
  console.info('[Firebase] PRODUCTION mode.');
}

// ── App Check (reCAPTCHA v3) ──────────────────────────────────────────────────
// Verifies that requests genuinely come from THIS app, so a script that merely
// reuses the public web API key is rejected. Rolled out in MONITOR mode:
// enforcement is toggled separately in the Firebase console, so today this only
// emits tokens for metrics and blocks nothing. Skipped on localhost — local
// testing uses the Firebase emulator (which ignores App Check) and reCAPTCHA is
// unreliable there. Wrapped in try/catch so a reCAPTCHA hiccup never breaks boot.
// The reCAPTCHA v3 SITE key is public config (P1), safe to commit, like the API
// key above. Register the app in Firebase Console → App Check (reCAPTCHA v3).
if (!isLocalhost) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('YOUR_RECAPTCHA_V3_SITE_KEY'),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.error('App Check init failed:', err);
  }
}

// ── The session ───────────────────────────────────────────────────────────────
// Who is signed in, and WHICH LOCATION they are working on. The app used to
// sign itself in anonymously, which meant anyone who knew the public address was
// "authenticated" and the rules let them read and delete everything. Now a real
// account signs in, and the location it may enter is decided by a document
// only the Firebase console can write.
//
// ⚠️ ORDER MATTERS. The location id must be set BEFORE any read or write,
// because it is what builds every Firestore path. That is why nothing in the app
// awaits "signed in" any more — it awaits `sessionReady`, which resolves only
// once the location is known. js/location.js refuses to build a path until
// then, so a read that jumps the queue fails loudly instead of quietly using
// somebody else's folder.
//
// States a page can be in: loading · signed-out · hub · choose-location ·
// no-access · error · ready. js/auth-gate.js turns each one into a screen.

const ACTIVE_LOCATION_KEY = 'active-location';

// Has this opening of the app already been past the Misé home screen?
//
// ⚠️ sessionStorage, NOT localStorage, AND THE FEATURE DEPENDS ON IT. This app is
// several pages — the Home, the Calculator, Orders — and every one of them is a
// fresh document that runs this file again from the top. In localStorage the hub
// would be seen once per DEVICE, for ever; in memory it would be seen on every
// single page change, which throws somebody out of the Calculator on their way
// to Orders. sessionStorage is the one that means "once per opening": it
// survives a navigation and a reload, and dies with the window.
//
// Same storage and the same reasoning as js/update-gate.js (an update refused at
// 7am is offered again tomorrow) and js/splash-init.js.
const HUB_PASSED_KEY = 'hub-passed';

function hubPassed() {
  try { return sessionStorage.getItem(HUB_PASSED_KEY) === '1'; } catch { return false; }
}

function markHubPassed(passed) {
  try {
    if (passed) sessionStorage.setItem(HUB_PASSED_KEY, '1');
    else sessionStorage.removeItem(HUB_PASSED_KEY);
  } catch { /* private mode: the hub simply shows again, which is the safe way to fail */ }
}

// ⚠️ canManage AND isOwner START false AND MUST. Every screen decides what to draw from this
// object, and it exists before a location is open — so the safe starting answer
// is "no owner powers", the same direction the rules take for a value nobody set.
// "The back arrow was tapped inside a venue: come back up on the venue list."
//
// ⚠️ IT IS READ ONCE AND CLEARED IMMEDIATELY. It decides one page load. Left set, the
// app would return to the picker on every navigation for the rest of the session —
// the multi-page trap the hub flag exists to avoid, wearing the opposite hat.
const PICK_VENUE_KEY = 'pick-venue';

function takePickVenue() {
  try {
    const wanted = sessionStorage.getItem(PICK_VENUE_KEY) === '1';
    sessionStorage.removeItem(PICK_VENUE_KEY);
    return wanted;
  } catch { return false; }
}

// ⚠️ canManage AND isOwner START false AND MUST. Every screen decides what to draw from this
// object, and it exists before a location is open — so the safe starting answer
// is "no owner powers", the same direction the rules take for a value nobody set.
let session = { status: 'loading', user: null, locationId: null, location: null,
                sections: allowedSections(null), options: [], optionNames: {},
                role: 'staff', canManage: false, isOwner: false, isAppAdmin: false };
let userDocCache = null;
// ⚠️ STARTS false AND IS CLEARED ON SIGN-OUT. A stale `true` surviving a sign-out
// would draw the "New customer" entry for whoever signs in next on that phone.
let appAdminCache = false;
const sessionListeners = new Set();

let markSessionReady;
// Resolves the first time a location is open for business. Never rejects: a
// signed-out app simply never resolves it, and the gate is covering the screen.
export const sessionReady = new Promise(resolve => { markSessionReady = resolve; });

let markSignedIn;
// Resolves as soon as a REAL account is signed in — before any location is open,
// and whether or not one ever is.
//
// ⚠️ IT EXISTS BECAUSE THE MISÉ HOME SCREEN SITS ABOVE EVERY LOCATION. The calls
// made from there are about the app's own customers, and their caller is
// deliberately not a member of any of them, so there is no location to wait for.
// They used to await sessionReady — which never resolves on that screen — and the
// Businesses list simply sat on "Loading…" for ever, saying nothing. Silent, and
// impossible for the person holding the phone to explain.
//
// ⚠️ IT GIVES THE GUARANTEE THOSE CALLS ACTUALLY NEEDED, which was never "a
// location is open": it is that the auth token has been restored. Firing before
// that, a callable answers `unauthenticated`, which reads as "you are not
// allowed" when the truth is "you were not asked yet".
export const signedInReady = new Promise(resolve => { markSignedIn = resolve; });

function setSession(next) {
  session = { ...session, ...next };
  sessionListeners.forEach(cb => {
    try { cb(session); } catch (err) { console.error('Session listener failed:', err); }
  });
}

// Subscribe to session changes. Calls back immediately with the current state.
export function onSession(callback) {
  sessionListeners.add(callback);
  callback(session);
  return () => sessionListeners.delete(callback);
}

export function currentSession() {
  return session;
}

function readRememberedLocation() {
  try { return localStorage.getItem(ACTIVE_LOCATION_KEY); } catch { return null; }
}

function rememberLocation(id) {
  try { localStorage.setItem(ACTIVE_LOCATION_KEY, id); } catch { /* private mode */ }
}

// The location ids are database names ('main', 'trattoria-rosa'). Nobody should
// ever have to choose between those, so the picker and the switch confirmation
// use the real names from each location's own document. One small read each,
// once per sign-in; an unreadable name falls back to the id rather than to blank.
async function readLocationNames(ids) {
  const names = {};
  await Promise.all((ids || []).map(async id => {
    try {
      const snap = await getDoc(doc(db, locationDocPath(id)));
      names[id] = (snap.exists() && snap.data().name) || id;
    } catch {
      names[id] = id;
    }
  }));
  return names;
}

// Open a location: fix the path first, then read the location's own document
// for its name and which sections it uses.
async function enterLocation(locationId, options, user) {
  // ⚠️ BEFORE ANYTHING READS ANYTHING. Signing out and switching location both wipe
  // this device's cached copies, but a phone can reach the sign-in form without
  // passing through either — an expired or revoked session, or the leftover
  // anonymous session this file discards on sight. Whoever signs in next would open
  // their own location with the PREVIOUS one's recipes, settings and typed
  // quantities on screen until the network replaced them, and offline they would
  // stay. Asking again here is the only place that catches those.
  //
  // It must come before rememberLocation() below, which is what the answer is
  // compared against — after it, the check would compare the value with itself.
  if (shouldClearLocalData(readRememberedLocation(), locationId)) clearLocalData();

  setCurrentLocationId(locationId);
  let location = null;
  try {
    const snap = await getDoc(doc(db, locationDocPath(locationId)));
    location = snap.exists() ? snap.data() : null;
  } catch (err) {
    // The folder can hold data before anyone writes its description document.
    // Missing description ≠ no access: sections default to all (js/sections.js).
    console.warn('Location document unavailable:', err?.message || err);
  }
  rememberLocation(locationId);
  setSession({
    status: 'ready', user, locationId, location, options,
    optionNames: options.length > 1 ? await readLocationNames(options) : {},
    name: (location && location.name) || locationId,
    // ⚠️ THE LOCATION SET NARROWED BY THE ROLE. allowedSections() alone would
    // hand an employee the Food Cost screen; sectionsFor() is the one that
    // answers "and may THIS person see it".
    sections: sectionsFor(location, roleOf(userDocCache, locationId)),
    // ⚠️ FROM users/{uid}, WHICH NO CLIENT CAN WRITE — never from the location
    // document, which is also console-only but says nothing about people. The
    // app uses this only to avoid drawing controls the database would refuse:
    // it is UX, not security (P2). The rules are the security, and they read
    // this same value themselves rather than trusting anything sent from here.
    role: roleOf(userDocCache, locationId),
    // ⚠️ TWO ANSWERS, NOT ONE, AND THEY ARE NOT THE SAME QUESTION.
    // canManage is "may take things away" — the owner AND the manager. isOwner
    // is "may invite people and set roles" — the owner alone. Every delete
    // button reads canManage; only the "who can get in" entry reads isOwner.
    canManage: canManage(userDocCache, locationId),
    isOwner: isOwner(userDocCache, locationId),
    // ⚠️ A THIRD ANSWER, AND NOT ABOUT THIS LOCATION AT ALL. isOwner is "may hire
    // into THIS venue"; this is "may create a NEW customer's venue" — the app's
    // own administrator. Reading one for the other would offer every customer's
    // owner the power to mint businesses.
    isAppAdmin: appAdminCache,
  });
  markSessionReady(session);
}

// May this account create a NEW CUSTOMER's location? Every other permission in
// this file is about one location; this one sits above all of them.
//
// ⚠️ IT IS UX AND NOTHING ELSE (P2). createWorkspace reads the same document on
// the server and never trusts what is sent from here. ⚠️ EVERY UNCERTAIN ANSWER
// IS "NO" — a refused read, a dropped connection, a missing document.
// ⚠️ COST (P14): one read per SIGN-IN, not per app open.
async function resolveAppAdmin(user) {
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    appAdminCache = snap.exists();
  } catch {
    appAdminCache = false;
  }
}

// Which locations does this account have? The answer lives in users/{uid},
// which the app can read but never write — so nobody can grant themselves access.
async function resolveMembership(user) {
  setSession({ status: 'loading', user });
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    userDocCache = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error('Could not read the access document:', err);
    setSession({ status: 'error', user, error: 'network' });
    return;
  }

  await resolveAppAdmin(user);

  const pick = pickStart(userDocCache, {
    isAppAdmin: appAdminCache,
    hubPassed: hubPassed(),
    // Read (and cleared) here, so it decides THIS page load and no other.
    pickVenue: takePickVenue(),
    remembered: readRememberedLocation(),
  });

  // ⚠️ isAppAdmin IS SET ON EVERY BRANCH BELOW, not only inside enterLocation.
  // The hub is drawn before any location is open, so a session object still
  // carrying the starting `false` would draw the app's own home with the
  // administrator's door missing — for the one account it exists for.
  if (pick.status === 'hub') {
    // ⚠️ NO NAMES ARE READ HERE. The hub says "My businesses", not which ones,
    // so fetching each location's name would be one Firestore read per venue on
    // every app open, spent on text nobody sees (P14). The picker one step later
    // reads them, because that is the screen that shows them.
    setSession({ status: 'hub', user, options: pick.options, isAppAdmin: appAdminCache });
    return;
  }
  if (pick.status === 'none') {
    setSession({ status: 'no-access', user, options: [], isAppAdmin: appAdminCache });
    return;
  }
  if (pick.status === 'choose') {
    setSession({
      status: 'choose-location', user, options: pick.options,
      optionNames: await readLocationNames(pick.options),
      isAppAdmin: appAdminCache,
    });
    return;
  }
  await enterLocation(pick.locationId, pick.options, user);
}

// "My businesses" on the hub: leave the app's own home and go to the venues.
//
// ⚠️ IT ASKS WHICH VENUE EVERY TIME, ignoring the remembered one, and that is
// Federico's own description of the screen ("mi chiede quale dei miei profili
// voglio aprire"). The remembered location is still honoured everywhere else —
// on a page change, and after a "Switch location" that has already named where
// it is going — because there the question has been answered and asking again
// would be re-asking it.
//
// One venue opens straight into it: there is nothing to choose between.
export async function enterMyBusinesses() {
  markHubPassed(true);
  const user = session.user;
  const options = locationsOf(userDocCache);
  if (options.length === 0) {
    setSession({ status: 'no-access', user, options: [], isAppAdmin: appAdminCache });
    return;
  }
  if (options.length === 1) {
    await enterLocation(options[0], options, user);
    return;
  }
  setSession({
    status: 'choose-location', user, options,
    optionNames: await readLocationNames(options),
    isAppAdmin: appAdminCache,
  });
}

// Back to the app's own home, from the screens the hub leads to.
//
// ⚠️ A SCREEN WITH NO WAY BACK IS THE SHAPE THIS PROJECT KEEPS SHIPPING. Without
// this, an administrator who taps "My businesses" and then wants the customer
// list has to close the whole app to get it — and a reload would not even do,
// because the flag below is exactly what survives one.
//
// ⚠️ ONLY FROM THE PICKER AND "No location yet", where NO location is open. Use
// openVenuePicker() to come back up from INSIDE a venue: see the warning on it.
export function backToHub() {
  markHubPassed(false);
  setSession({ status: 'hub', user: session.user, options: locationsOf(userDocCache),
               isAppAdmin: appAdminCache });
}

// The back arrow at the top-left of a venue's Home: up one level, to the list of
// every venue this account has.
//
// ⚠️ IT RELOADS, for the same reason switchLocation does: an open venue is holding
// dozens of live Firestore listeners, and the next venue opened would be repainted by
// the previous one's.
//
// ⚠️ AND IT DELIBERATELY DOES NOT CALL forgetLocation(), which is the short way to the
// same screen. That one CLEARS THE LOCAL CACHE — the quantities typed and not yet
// saved. Stepping up to look at your venues and coming back must never cost somebody
// their morning's typing. Nothing is cleared until a DIFFERENT venue is actually
// entered, which enterLocation still decides on its own (shouldClearLocalData).
//
// ⚠️ The remembered location is kept for the same reason: coming back to the same
// venue must find its cache intact.
export function openVenuePicker() {
  try { sessionStorage.setItem(PICK_VENUE_KEY, '1'); } catch { /* private mode */ }
  markHubPassed(true);   // the arrow asks for the venue list, not for the Misé home
  location.reload();
}

onAuthStateChanged(auth, user => {
  if (!user) {
    userDocCache = null;
    appAdminCache = false;
    // Signing back in is opening the app again, so it starts at the app's own
    // home — the same reason appAdminCache above must not survive either.
    markHubPassed(false);
    setSession({ status: 'signed-out', user: null, locationId: null, location: null,
                 options: [], sections: allowedSections(null),
                 role: 'staff', canManage: false, isOwner: false, isAppAdmin: false });
    return;
  }

  // ⚠️ A LEFTOVER ANONYMOUS SESSION IS NOT A SIGNED-IN PERSON.
  //
  // Before this release the app signed itself in anonymously, and that session is
  // still sitting in the browser's storage on every phone that has used the app.
  // Treated as a sign-in it belongs to no account, so it resolves to no location
  // and parks the phone on "No location yet" — WITHOUT ever showing the sign-in
  // form, because as far as the app is concerned somebody is already in. Every
  // existing phone would have hit that, and the way out is not discoverable.
  //
  // Nothing uses anonymous auth any more, so the only correct reading of one is
  // "stale": drop it, which brings us back through here with no user and shows
  // the form.
  //
  // ⚠️ THIS BRANCH WAS MISSING FROM THIS TEMPLATE UNTIL 12 Aug 2026, while
  // js/firebase.js had carried it since v200. The example is what a new project
  // is built from, so the gap was a working app with a known emergency already
  // in it (P7 — the example must be complete, not merely illustrative).
  if (user.isAnonymous) {
    signOut(auth).catch(err => console.error('Could not clear the old session:', err));
    return;
  }

  // Below the anonymous check on purpose: a leftover anonymous session is not a
  // signed-in person, and nothing that waits on this should be woken by one.
  markSignedIn(user);
  resolveMembership(user);
});

// Create an account, for somebody joining with a code.
//
// ⚠️ THIS GRANTS NOTHING BY ITSELF, and that is the whole safety of letting the
// app do it. A brand-new account has no users/{uid} document, so every rule in
// firestore.rules refuses it by construction rather than by remembering to ask —
// it can sign in and see the "No location yet" screen, and nothing else. Access
// arrives only when a Cloud Function accepts a join code and writes the
// membership itself.
//
// ⚠️ AND IT SIGNS THE NEW ACCOUNT IN, on this app, replacing whoever was here.
// That is right for this flow (the person creating the account IS the person at
// the phone) and it is exactly what createOrderingLink must NOT do — which is
// why that one mints on a second Firebase app. Do not copy this into a screen
// where somebody creates an account for somebody else.
export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || ''));
}

export function sendReset(email) {
  return sendPasswordResetEmail(auth, String(email || '').trim());
}

// Signing out wipes this device's cached copies of the location's data — the
// recipes, settings and typed quantities kept locally so the app opens instantly.
// Leaving them would show the next person the previous one's work.
export async function signOutNow() {
  await signOut(auth);
  clearLocalData();
  markHubPassed(false);
  try { localStorage.removeItem(ACTIVE_LOCATION_KEY); } catch { /* private mode */ }
  location.reload();
}

// Move to another of YOUR locations. Two deliberate choices:
//   * the cached data of the previous location is cleared first;
//   * the page is then RELOADED rather than re-pointed. The app holds dozens of
//     live Firestore listeners and in-memory state; unwinding them by hand is
//     how a listener from the previous location survives and quietly repaints
//     the screen with the wrong data. A reload cannot leave one behind.
export function switchLocation(locationId) {
  if (!locationsOf(userDocCache).includes(locationId)) {
    throw new Error(`Not your location: ${locationId}`);
  }
  clearLocalData();
  rememberLocation(locationId);
  location.reload();
}

// Forget which location this device opens by default, then reload — which lands
// on the picker, because a remembered choice is the only reason the picker is
// skipped. Used by "Switch location" when the account has more than two: with
// exactly two the other one is unambiguous and switchLocation names it, but with
// three the app cannot guess, and reloading WITHOUT forgetting simply reopens the
// same location — a button that visibly does nothing.
export function forgetLocation() {
  clearLocalData();
  try { localStorage.removeItem(ACTIVE_LOCATION_KEY); } catch { /* private mode */ }
  location.reload();
}

// Used by the "choose location" screen, which has no page to reload into yet.
export function chooseLocation(locationId) {
  if (!locationsOf(userDocCache).includes(locationId)) {
    throw new Error(`Not your location: ${locationId}`);
  }
  return enterLocation(locationId, locationsOf(userDocCache), session.user);
}

// Kept for the modules that still say `authReady`: it now means "a location is
// open", which is the only moment a Firestore path can be built.
const authReady = sessionReady;

// ── Logs collection (new model) ───────────────────────────────────────────────
// Each log is its OWN document logs/{id} with an append-only version chain (see
// js/log-model.js). Replaces the old one-document-per-dough `log` collection. The
// old `log` collection is kept read-only for the one-time migration.
// ⚠️ BOUNDED (P14): logs are never deleted, so an unbounded listener re-read the
// entire history on every opening of the Calculator, for ever. 30 days is far
// wider than the longest retention the screen offers (48 hours), so the window
// can never be what hides a log. A single-field range needs no composite index.
const LOG_WINDOW_DAYS = 30;

export function watchLogs(onChange) {
  const cutoff = Date.now() - LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  authReady.then(() => {
    onSnapshot(
      query(collection(db, pathFor('logs')), where('createdAtMs', '>=', cutoff)),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error('Logs listener failed:', err); },
    );
  }).catch(err => {
    console.error('Logs listener never started (no location open):', err);
  });
}

export function saveLogDoc(log) {
  return authReady
    .then(() => setDoc(doc(db, pathFor('logs'), log.id), { ...log, bakery: currentLocationId() }))
    .catch(err => { console.error('saveLogDoc failed:', err); throw err; });
}

export function deleteLogDoc(id) {
  return authReady
    .then(() => deleteDoc(doc(db, pathFor('logs'), String(id))))
    .catch(err => { console.error('deleteLogDoc failed:', err); throw err; });
}

// Does this location have ANY log? limit(1), because that is the whole question:
// the migration only needs to know whether the new collection is still empty.
export function anyLogExists() {
  return authReady
    .then(() => getDocs(query(collection(db, pathFor('logs')), limit(1))))
    .then(snap => !snap.empty)
    .catch(err => { console.error('anyLogExists failed:', err); return false; });
}

export function readOldLogsOnce() {
  return authReady
    .then(() => getDocs(collection(db, pathFor('log'))))
    .then(snap => snap.docs.map(d => d.data()))
    .catch(err => { console.error('readOldLogsOnce failed:', err); return []; });
}

// ── Calculator configuration (single client address book) ────────────────────
// One shared document: config/calculator. Shared across the team like the log,
// under Anonymous Auth. Shape:
//   { clients: [ { id, name, products: [ { id, name, recipeId, weight, kind, active,
//                    crate: { show: bool, perBox: number } } ] } ],
//     whatsappLists: [ { id, title,
//                        clients: [ { clientId, products: [productId, ...] } ] } ],
//     extraDough:      { <recipeId>: bool, ... },
//     divisorIncluded: { <recipeId>: [productIds], ... } }
// A product belongs to the CLIENT that orders it — there is no shared catalogue. Two
// clients ordering the same thing hold independent copies (which may share an id, from
// the migration off the old catalogue: divisor ticks, WhatsApp lists, saved log rows
// and typed quantities all key by it). Each product names its recipe; the recipe tabs
// are filtered views of `clients`. product.kind is the input widget: number|dropdown|kg.
// product.active === false parks it: kept here, out of the calculator.
// product.crate optionally shows a per-product "crate box" (how many crates the order
// fills) bound to the product, not its name. `whatsappLists` are INDEPENDENT WhatsApp
// order lists, decoupled from the dough tabs: each list groups client entries, and an
// entry pairs an address-book client (by id) with product ids chosen from ANY client.
// Names resolve live from the address book; deleted clients/products are pruned.
// `extraDough` toggles the per-tab extra-dough box. `divisorIncluded` lists products
// kept IN each tab's divisor box (opt-in: empty = no product is split). Legacy per-tab
// and legacy `groups` documents are migrated on read by normalizeConfig in
// js/calculator-config.js. See firestore.rules.

// Subscribe to the config document in real time. onChange receives the raw data
// object, or null when the document does not exist yet (fresh project).
export function watchCalculatorConfig(onChange) {
  authReady.then(() => {
    onSnapshot(
      doc(db, pathFor('config'), 'calculator'),
      snap => onChange(snap.exists() ? snap.data() : null),
      err => { console.error('Config listener failed:', err); },
    );
  });
}

// Persist the whole config document (overwrite). bakery is stamped for
// forward-compatibility with a future per-bakery split, like the orders system.
export function saveCalculatorConfig(config) {
  return authReady
    .then(() => setDoc(doc(db, pathFor('config'), 'calculator'), { ...config, bakery: currentLocationId() }))
    .catch(err => { console.error('saveCalculatorConfig failed:', err); throw err; });
}

// ── Orders system (js/orders/*) ──────────────────────────────────────────────
// The supplier-order feature has its own data layer, js/orders/firebase-orders.js,
// which reuses THIS app + anonymous auth (it imports firebaseConfig from here).
// It adds NO export here. Firestore collections it uses, every document carrying
// bakery: "main" (validated in firestore.rules):
//   - suppliers/{id}          { name, category, deliveryDays[], orderDays[], phone,
//                               email, active }
//   - ingredients/{id}        { name, supplierId, category, unit, active,
//                               priceUnit, pricePerUnit, unitWeightKg,
//                               priceUpdatedAt }
//   - ingredient-prices/{id} { priceUnit, pricePerUnit, unitWeightKg,
//                               priceUpdatedAt } — the id is the INGREDIENT's id
//   - ingredients/{id}/prices/{autoId}
//                             { recordedAt, priceUnit, pricePerUnit,
//                               unitWeightKg, supplierId, source }
//
//     ⚠️⚠️ THE PRICE LIVES BESIDE THE INGREDIENT, NOT ON IT, and both of the two
//     above are behind canManage(lid, 'foodcost') — an ordinary employee cannot
//     read either. The reason is that ORDERS MUST READ EVERY INGREDIENT to work
//     at all: that is the order screen. A rate written on the ingredient document
//     is therefore a rate every person in the building can read, whatever the
//     Food Cost screen does — so closing Food Cost hid the MARGIN and left "what
//     a sack of flour costs" in plain view.
//
//     ⚠️ A PARALLEL COLLECTION, NOT A SUBCOLLECTION: Food Cost and the recipe
//     costing want them ALL, and one collection read costs far less than one read
//     per ingredient (P14). js/price-model.js owns splitPriceFields() (which half
//     goes where) and withPrices() (putting them back together for a screen that
//     may see one) — in js/ ROOT, because Orders writes prices while the
//     Catalogue and Food Cost read them, and a feature must never import from
//     another feature's folder.
//
//     ⚠️ A MISSING PRICE IS NOT AN ERROR. An employee is refused the collection,
//     so withPrices() simply returns the ingredient untouched and every screen
//     says "not priced yet" — which most ingredients are anyway. No new failure
//     mode, and nothing to handle.
//
//     ⚠️ THE PRICE FIELDS STAY IN THE ingredients WHITELIST in firestore.rules,
//     written null on every save so they drain out of documents written before
//     the move. Removing a field from a whitelist while production still carries
//     it makes those documents permanently unwritable — the notifyHoursBefore /
//     weekId trap, learnt twice.
//     pricePerUnit is the rate as TYPED (£ per kg / litre / piece, net of VAT).
//     packPrice and packSize are RETIRED — the rate used to be their quotient.
//     Both are still whitelisted in firestore.rules and still accepted here,
//     because documents written before the change carry them and a merge write
//     cannot remove a field by omission. Do not delete them from the rules until
//     production has stopped carrying them.
//   - drafts/current          { entries:{ id:{ qty, stock } },
//                               days:{ supplierId: 'YYYY-MM-DD' }, updatedAt }
//   - orders-history/{YYYY-MM-DD}_{supplierId}
//                             { date, supplierId, supplierName, quantities:{id:qty},
//                               stock:{id:qty}, createdAt, updatedAt }
//
// An order is ONE DAY and ONE SUPPLIER: suppliers are not ordered on the same days
// (Salvo on Mondays, Caterite almost daily), so a single weekly document could not
// say what was ordered, or when. `days` on the draft records which day each
// supplier's rows were typed on, so an order left unmarked overnight is filed
// under the day it was written rather than the day it was finally recorded.
// Documents written by the earlier model (one per ISO week, id "2026-W28", field
// weekStart, every supplier merged) are still read and still counted — nothing was
// migrated.
//
// FOOD COST. locations/{lid}/products/{id} is a finished product — kilos of
// recipes plus packaging counted in pieces — with the price it sells for and the
// food-cost target it is measured against. The selling price is stored GROSS (the
// number on the label) with its own vatRate beside it, and the food cost is worked
// out on the NET price; storing it net instead would make every past margin wrong
// the day a rate changes. `products/{id}/snapshots/{autoId}` is the append-only
// margin series, taken when the price or the composition changes, and it FREEZES
// the VAT rate and the ingredient prices of the moment.
//
// ⚠️ vatRate may legitimately be 0 — most takeaway bakery in the UK is zero-rated.
// Anything treating 0 as "not filled in" refuses to cost the bakery's main line.
//
// RECIPE COSTING. locations/{lid}/recipes/{id} gained `lossPct` (the weight the
// recipe loses while cooking) and each ingredient row may carry `kind`
// ('ingredient' | 'recipe') + `refId`. A linked row contributes both its cost and
// its weight; an unlinked one contributes NEITHER, so the price per kilo is always
// the price per kilo of what was actually costed — partial, and flagged as such.
// The maths is js/catalogue/recipe-cost-model.js. Rules cannot look inside a list,
// so the row shape is guaranteed by js/catalogue/catalogue-model.js.
//
// PRICES. An ingredient carries what it costs, because in Orders an ingredient
// document already IS the pairing of a thing with the supplier who sells it, and a
// price belongs to that pairing rather than to the thing. It is entered as a
// purchase form — pack price, pack size, unit — and normalised into pricePerUnit;
// js/price-model.js is the only place that maths lives (js/ root, not js/orders/,
// because the Recipe catalogue reads it too). Every change also
// appends to the /prices subcollection, in the SAME atomic write, and that
// subcollection is create-only in the rules: it is the record the margin history
// will be rebuilt from, and one that can be edited afterwards answers nothing.
//
// ── Who may do what, inside a location (js/roles.js) ─────────────────────────
// ⚠️ THE ROLE IS THE MEMBERSHIP VALUE, NOT A FIELD BESIDE IT:
//   users/{uid} = { locations: { <lid>: true | 'owner' } }
// `true` is staff and 'owner' is the person whose business it is. Anything else
// — missing, corrupt, a role from a later version — reads as staff, because
// power nobody granted must not exist. That default is also what makes the
// change safe to deploy: every membership written before it says `true`.
//
// js/sections.js accessValue() is the ONE reader, and firestore.rules reads the
// same single value the same way — so a membership and a role can never
// disagree. Only irreversible deletes are gated (suppliers, ingredients,
// recipes, products, client-ordering accounts and menus); everyday writing is
// untouched, because somebody working a shift has to be able to work.
//
// THREE roles: 'owner', 'manager' and the ordinary employee (`true`). The
// manager does everything an owner does INSIDE a location, deleting included;
// what separates them is hiring, which never reaches firestore.rules because
// memberships and join codes are written only by functions/onboarding.js.
//
// ⚠️ SO THE SESSION CARRIES TWO ANSWERS, NOT ONE. session.canManage draws every
// delete button; session.isOwner draws only the "who can get in" entry. Using
// isOwner for a bin takes the bins away from every manager.
//
// ⚠️ AND BOTH ARE UX ONLY (P2). They stop the app drawing a control the database
// would refuse; they are not the security. The security is firestore.rules, and
// the rules trust nothing sent from here.
//
// ── Joining, without the Firebase console (js/staff/*, functions/onboarding.js) ─
// The app can now let somebody in. It adds ONE export here — signUp() above —
// and everything else goes through Cloud Functions, because the documents that
// decide access are `allow write: if false` for every client and always will be.
// Letting the app write another person's users/{uid} would be a master key to
// the whole database, across every location, for ever.
//
// Collections, all written ONLY by the Admin SDK and readable by no client:
//   - admins/{uid}                     the app's own owner; the only account that
//                                      may create a customer's location
//   - join-codes/{sha256(code)}        ⚠️ the code itself is NEVER stored, only
//                                      its hash, so it cannot leak through a
//                                      function log or a database export
//   - rate-limits/{uid}                5 redeem attempts per account per hour
//
// One exception, readable by a location's own members:
//   - locations/{lid}/members/{uid}    { email, role, joinedAt }
//
// ⚠️ members IS A COPY OF A FACT AND IS NOT THE ONE THAT DECIDES. The truth is
// users/{uid}, which is what the rules read; members exists only so an owner can
// SEE the list, since users/{uid} is readable by its own account alone. Both are
// written in the SAME transaction, in the same function, so they cannot part.
//
// ── Push notifications (Firebase Cloud Messaging) — FUTURE / server step ──────
// Client-side alerts (js/orders/notifications.js) already work while the app is
// OPEN. Pushing to staff with the app CLOSED needs the server step, deferred for
// now. When adding it:
//   1. Firebase Console → Cloud Messaging: enable it and create a Web Push
//      certificate (VAPID key pair); keep the PUBLIC vapid key for the client.
//   2. Add a service worker firebase-messaging-sw.js (background receive) that
//      initializes this firebaseConfig and uses getMessaging()/onBackgroundMessage.
//   3. Client: getToken(messaging, { vapidKey }) and store it in a Firestore
//      collection (e.g. fcm-tokens/{token} with bakery:"main") + a matching rule.
//   4. Server (Cloud Functions, Blaze plan) on a schedule: send the order-due,
//      bank-holiday and delivery-conflict messages to the stored tokens.

// ── The Calculator reading a recipe out of the Catalogue ─────────────────────
//
// ⚠️ IT READS THE LINKED RECIPES ONE BY ONE, NEVER THE COLLECTION. The Catalogue
// is built for 500+ recipes and the Calculator needs three; a listener on the
// collection would turn every app open from 3 reads into 500+, on every phone,
// for ever (P14) — the mistake made and corrected on the Home's order badge.
//
// ⚠️ null IS A REAL ANSWER and must reach the caller: a linked recipe that has
// been deleted must make the tab REFUSE, not quietly keep using the last copy.
export function watchCatalogueRecipe(id, onChange) {
  let stop = () => {};
  authReady.then(() => {
    stop = onSnapshot(
      doc(db, pathFor('recipes'), id),
      snap => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      err => { console.error(`Linked recipe ${id} could not be read:`, err); onChange(null); },
    );
  }).catch(err => {
    console.error('Linked recipe listener never started (no location open):', err);
    onChange(null);
  });
  return () => stop();
}

// Write a Catalogue recipe back with a stable id on every ingredient row, at the
// moment it is linked.
//
// ⚠️ WITHOUT IT THE LEAVENING FALLS BACK TO MATCHING BY NAME, which is the defect
// being designed out: a recipe's leavening can be called one thing in the
// Calculator and another in the Catalogue. withRowIds is idempotent, so a recipe
// already carrying ids comes back byte-identical.
export function stampRecipeRowIds(id, ingredients) {
  return authReady.then(() => setDoc(
    doc(db, pathFor('recipes'), id),
    { ingredients },
    { merge: true },
  ));
}
