// firebase.js — Firebase setup + Firestore helpers
//
// Real config lives here; firebase.example.js is the placeholder template.
// js/firebase.js IS committed to Git: Firebase web API keys are public config
// (sent to every visitor's browser), not secrets. Security comes from Firestore
// Security Rules + API key restrictions, never from hiding this file.
//
// This module:
//   1. Initializes Firebase and signs the user in anonymously
//   2. Mirrors the `log` collection in real time into window.firestoreLog
//      and notifies the app via a `firestore-log-updated` event
//   3. Exports helpers to persist / remove log and daily-log entries
//
// Public API consumed by the rest of the app:
//   - saveLogToFirestore(record)      → js/log.js
//   - deleteLogFromFirestore(dough)   → js/log.js
//   - saveDailyEntry(entry)           → js/log.js
//   - side-effect `import './firebase.js'` for init → js/app.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
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
import { currentLocationId, pathFor } from './location.js';

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

// Firestore Security Rules require an authenticated user (request.auth != null),
// so we sign in anonymously and only start reading once auth is ready.
signInAnonymously(auth).catch(err => {
  console.error('Anonymous sign-in failed:', err);
});

// Resolves once an authenticated user exists. Config read/write awaits this so
// it never hits Firestore before request.auth is set (rules would reject it).
const authReady = new Promise(resolve => {
  const unsub = onAuthStateChanged(auth, user => {
    if (user) { unsub(); resolve(user); }
  });
});

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
export function saveDailyEntry(entry) {
  const key = entry.dough.toLowerCase();
  return setDoc(
    doc(db, pathFor('daily-logs'), entry.date_iso),
    { [key]: entry },
    { merge: true }
  ).catch(err => { console.error('saveDailyEntry failed:', err); });
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
  const ref = doc(db, pathFor('config'), 'calculator');
  return authReady
    .then(() => runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const server = snap.exists() ? snap.data() : null;
      const { recipes, configRev } = reconcileConfigWrite(config, server);
      tx.set(ref, { ...config, recipes, configRev, bakery: currentLocationId() });
    }))
    .catch(err => { console.error('saveCalculatorConfig failed:', err); throw err; });
}
