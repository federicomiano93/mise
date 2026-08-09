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
import { allowedSections, pickLocation, locationsOf } from './sections.js';
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
//                               priceUnit, pricePerUnit, packPrice, packSize,
//                               unitWeightKg, priceUpdatedAt }
//   - ingredients/{id}/prices/{autoId}
//                             { recordedAt, priceUnit, pricePerUnit, packPrice,
//                               packSize, unitWeightKg, supplierId, source }
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
// PRICES. An ingredient carries what it costs, because in Orders an ingredient
// document already IS the pairing of a thing with the supplier who sells it, and a
// price belongs to that pairing rather than to the thing. It is entered as a
// purchase form — pack price, pack size, unit — and normalised into pricePerUnit;
// js/orders/price-model.js is the only place that maths lives. Every change also
// appends to the /prices subcollection, in the SAME atomic write, and that
// subcollection is create-only in the rules: it is the record the margin history
// will be rebuilt from, and one that can be edited afterwards answers nothing.
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
