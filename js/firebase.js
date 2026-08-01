// firebase.js — Firebase setup + Firestore helpers
//
// Real config lives here; firebase.example.js is the placeholder template.
// js/firebase.js IS committed to Git: Firebase web API keys are public config
// (sent to every visitor's browser), not secrets. Security comes from Firestore
// Security Rules + API key restrictions, never from hiding this file.
//
// This module:
//   1. Initializes Firebase
//   2. Owns THE SESSION: who is signed in and which location they are working
//      on, which is what decides where every Firestore path points
//   3. Exports the log / daily-log / calculator-config helpers
//
// Public API consumed by the rest of the app:
//   - sessionReady / onSession / currentSession  → every data layer and the gate
//   - signIn / sendReset / signOutNow            → js/auth-gate.js, js/home-session.js
//   - switchLocation / chooseLocation        → js/home-session.js, js/auth-gate.js
//   - saveLogToFirestore(record)                 → js/log.js
//   - deleteLogFromFirestore(dough)              → js/log.js
//   - saveDailyEntry(entry)                      → js/log.js
//   - side-effect `import './firebase.js'` for init → js/app.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  runTransaction,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { reconcileConfigWrite } from './calculator-config.js';
import {
  currentLocationId,
  pathFor,
  setCurrentLocationId,
  locationDocPath,
} from './location.js';
import { allowedSections, pickLocation, locationsOf } from './sections.js';
import { clearLocalData, shouldClearLocalData } from './local-data.js';

// ── Configuration (placeholders only — fill these in js/firebase.js) ──────────
export const firebaseConfig = {
  apiKey: "AIzaSyCIy5dRbE9Ce_mJQ4-r7QuSOquKpgkwoMo",
  authDomain: "bakery-app-ebf90.firebaseapp.com",
  projectId: "bakery-app-ebf90",
  storageBucket: "bakery-app-ebf90.firebasestorage.app",
  messagingSenderId: "27778450817",
  appId: "1:27778450817:web:74e1bab55d10c3f9279480"
};

// ── Initialization ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Local emulator switch (AUTOMATIC, by hostname) ────────────────────────────
// On localhost / 127.0.0.1 the app talks to the LOCAL Firebase Emulator Suite, so
// development and manual browser testing NEVER touch production Firestore. On any
// other hostname (the live github.io domain) it connects to production as before.
//
// This decision is made automatically from the URL — there is deliberately NO
// manual flag. A flag could be left in the wrong state and either point the live
// site at the emulator or point local testing at production. Hostname can't be
// forgotten: it is simply where the page is being served from.
//
// The production config above is unchanged; we only REDIRECT the SDK's traffic to
// the local emulator ports (firebase.json: auth 9099, firestore 8080) when local.
const isLocalhost =
  typeof location !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);

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
if (!isLocalhost) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Ldc0y4tAAAAAKhEn8mGHyVMryZPYao7l48AX-Rh'),
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
// States a page can be in: loading · signed-out · choose-location · no-access
// · error · ready. js/auth-gate.js turns each one into a screen.

const ACTIVE_LOCATION_KEY = 'active-location';

let session = { status: 'loading', user: null, locationId: null, location: null,
                sections: allowedSections(null), options: [], optionNames: {} };
let userDocCache = null;
const sessionListeners = new Set();

let markSessionReady;
// Resolves the first time a location is open for business. Never rejects: a
// signed-out app simply never resolves it, and the gate is covering the screen.
export const sessionReady = new Promise(resolve => { markSessionReady = resolve; });

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
    sections: allowedSections(location),
  });
  markSessionReady(session);
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

  const pick = pickLocation(userDocCache, readRememberedLocation());
  if (pick.status === 'none') { setSession({ status: 'no-access', user, options: [] }); return; }
  if (pick.status === 'choose') {
    setSession({
      status: 'choose-location', user, options: pick.options,
      optionNames: await readLocationNames(pick.options),
    });
    return;
  }
  await enterLocation(pick.locationId, pick.options, user);
}

onAuthStateChanged(auth, user => {
  if (!user) {
    userDocCache = null;
    setSession({ status: 'signed-out', user: null, locationId: null, location: null,
                 options: [], sections: allowedSections(null) });
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
  if (user.isAnonymous) {
    signOut(auth).catch(err => console.error('Could not clear the old session:', err));
    return;
  }

  resolveMembership(user);
});

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
// js/log-model.js). This replaces the old one-document-per-dough `log` collection,
// which overwrote two logs of the same dough on the same day. The old `log`
// collection is kept read-only for the one-time migration below.

// Subscribe to the whole logs collection in real time. onChange receives an array
// of log documents (each with its id); ordering/sorting is done by the caller.
export function watchLogs(onChange) {
  authReady.then(() => {
    onSnapshot(
      collection(db, pathFor('logs')),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error('Logs listener failed:', err); },
    );
  });
}

// Persist one log document (create or overwrite). bakery is stamped for
// forward-compatibility, like the rest of the app. Append-only history lives
// INSIDE the document (the versions array), so overwriting the doc is correct.
export function saveLogDoc(log) {
  return authReady
    .then(() => setDoc(doc(db, pathFor('logs'), log.id), { ...log, bakery: currentLocationId() }))
    .catch(err => { console.error('saveLogDoc failed:', err); throw err; });
}

// Delete one whole log document (the user explicitly deleted that log).
export function deleteLogDoc(id) {
  return authReady
    .then(() => deleteDoc(doc(db, pathFor('logs'), String(id))))
    .catch(err => { console.error('deleteLogDoc failed:', err); throw err; });
}

// One-shot read of the new logs collection (used by the migration to decide
// whether anything already exists before importing the old records).
export function getLogsOnce() {
  return authReady
    .then(() => getDocs(collection(db, pathFor('logs'))))
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })))
    .catch(err => { console.error('getLogsOnce failed:', err); return []; });
}

// One-shot read of the OLD `log` collection (one doc per dough), used only by the
// migration to convert legacy records into the new model without losing them.
export function readOldLogsOnce() {
  return authReady
    .then(() => getDocs(collection(db, pathFor('log'))))
    .then(snap => snap.docs.map(d => d.data()))
    .catch(err => { console.error('readOldLogsOnce failed:', err); return []; });
}

// Daily production log: one document per day (entry.date_iso, 'YYYY-MM-DD'),
// keyed by dough type so confirming one dough never overwrites the others.
// Re-confirming the same dough on the same day updates its sub-entry (merge).
// entry = buildDailyEntry(...) from js/log.js (includes entry.dough + entry.date_iso)
//
// ⚠️ pathFor() must be called INSIDE the authReady chain, like every other function
// here. It THROWS while no location is open, and this one is called straight from
// commitLog() — a synchronous throw there skipped the three lines that follow it, so
// Confirm saved the log but never revealed the recipe or locked the tab, and tapping
// again made a duplicate. Today the opaque auth gate makes that window unreachable by
// a finger; that is a guard elsewhere, not a reason to build the path early.
export function saveDailyEntry(entry) {
  const key = entry.dough.toLowerCase();
  return authReady
    .then(() => setDoc(
      doc(db, pathFor('daily-logs'), entry.date_iso),
      { [key]: entry },
      { merge: true }
    ))
    .catch(err => { console.error('saveDailyEntry failed:', err); });
}

// ── Calculator configuration (clients / products / weights) ──────────────────
// One shared document: config/calculator. Shared across the team like the log,
// under Anonymous Auth (same per-bakery caveat). Holds the configurable clients,
// products and per-client weights for the three dough tabs (+ the market order).

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

// Persist the whole config document. Written in a transaction with an optimistic
// revision counter (configRev): it always writes the caller's config, but if the
// server document changed since this config was loaded (a different writer — e.g.
// a Recipe-catalogue import that added a recipe), the imported (cat-*) recipes we
// don't already have are preserved, so a blind overwrite can't silently drop them.
// Normal edits (including deleting a recipe) are unaffected: with no concurrent
// writer the rev matches and nothing extra is merged. bakery is stamped as before.
export function saveCalculatorConfig(config) {
  // Same rule as saveDailyEntry: resolve the path INSIDE the chain. Built here it
  // would throw before the caller ever gets a promise, so the error could not be
  // caught and reported by the .catch below.
  return authReady
    .then(() => runTransaction(db, async (tx) => {
      const ref = doc(db, pathFor('config'), 'calculator');
      const snap = await tx.get(ref);
      const server = snap.exists() ? snap.data() : null;
      const { recipes, configRev } = reconcileConfigWrite(config, server);
      tx.set(ref, { ...config, recipes, configRev, bakery: currentLocationId() });
    }))
    .catch(err => { console.error('saveCalculatorConfig failed:', err); throw err; });
}
