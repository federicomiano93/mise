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
//   3. Exports helpers to persist / remove log and daily-log entries
//
// Public API consumed by the rest of the app:
//   - saveLogToFirestore(record)      → js/log.js
//   - deleteLogFromFirestore(dough)   → js/log.js
//   - saveDailyEntry(entry)           → js/log.js
//   - watchCalculatorConfig(onChange) → js/calculator-config-store.js
//   - saveCalculatorConfig(config)    → js/calculator-config-store.js
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
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { currentRestaurantId, pathFor } from './restaurant.js';

// ── Configuration (placeholders only — fill these in js/firebase.js) ──────────
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ── Initialization ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
// js/log-model.js). Replaces the old one-document-per-dough `log` collection. The
// old `log` collection is kept read-only for the one-time migration.
export function watchLogs(onChange) {
  authReady.then(() => {
    onSnapshot(
      collection(db, pathFor('logs')),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error('Logs listener failed:', err); },
    );
  });
}

export function saveLogDoc(log) {
  return authReady
    .then(() => setDoc(doc(db, pathFor('logs'), log.id), { ...log, bakery: currentRestaurantId() }))
    .catch(err => { console.error('saveLogDoc failed:', err); throw err; });
}

export function deleteLogDoc(id) {
  return authReady
    .then(() => deleteDoc(doc(db, pathFor('logs'), String(id))))
    .catch(err => { console.error('deleteLogDoc failed:', err); throw err; });
}

export function getLogsOnce() {
  return authReady
    .then(() => getDocs(collection(db, pathFor('logs'))))
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })))
    .catch(err => { console.error('getLogsOnce failed:', err); return []; });
}

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

// ── Calculator configuration (single client address book) ────────────────────
// One shared document: config/calculator. Shared across the team like the log,
// under Anonymous Auth. Shape:
//   { clients: [ { id, name, products: [ { id, name, dough, weight, kind,
//                    crate: { show: bool, perBox: number } } ] } ],
//     whatsappLists: [ { id, title,
//                        clients: [ { clientId, products: [productId, ...] } ] } ],
//     extraDough:      { focaccia: bool, brioche: bool, sourdough: bool },
//     divisorIncluded: { focaccia: [ids], brioche: [ids], sourdough: [ids] } }
// Each product knows its dough (focaccia|brioche|sourdough); the dough tabs are
// filtered views of `clients`. product.kind is the input widget: number|dropdown|kg.
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
    .then(() => setDoc(doc(db, pathFor('config'), 'calculator'), { ...config, bakery: currentRestaurantId() }))
    .catch(err => { console.error('saveCalculatorConfig failed:', err); throw err; });
}

// ── Orders system (js/orders/*) ──────────────────────────────────────────────
// The supplier-order feature has its own data layer, js/orders/firebase-orders.js,
// which reuses THIS app + anonymous auth (it imports firebaseConfig from here).
// It adds NO export here. Firestore collections it uses, every document carrying
// bakery: "main" (validated in firestore.rules):
//   - suppliers/{id}          { name, category, deliveryDays[], orderDays[], phone,
//                               email, active }
//   - ingredients/{id}        { name, supplierId, category, unit, active }
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
