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
//   3. Exports the log / calculator-config helpers
//
// Public API consumed by the rest of the app:
//   - sessionReady / onSession / currentSession  → every data layer and the gate
//   - signIn / sendReset / signOutNow            → js/auth-gate.js, js/home-session.js
//   - switchLocation / chooseLocation        → js/home-session.js, js/auth-gate.js
//   - saveLogToFirestore(record)                 → js/log.js
//   - deleteLogFromFirestore(dough)              → js/log.js
//   - side-effect `import './firebase.js'` for init → js/app.js

import { setLanguage, interfaceLanguage } from './i18n.js';
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
  runTransaction,
  query,
  where,
  limit,
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
import { allowedSections, sectionsFor, pickStart, locationsOf } from './sections.js';
import { roleOf, isOwner, canManage } from './roles.js';
import { clearLocalData, shouldClearLocalData } from './local-data.js';

// ── Configuration (PUBLIC config, P1 — committed on purpose, see .gitignore) ──
// Copied from firebase.example.js, whose "placeholders only" heading came with
// it: these are the real values, and this is the file the app actually loads.
export const firebaseConfig = {
  apiKey: "AIzaSyCIy5dRbE9Ce_mJQ4-r7QuSOquKpgkwoMo",
  authDomain: "bakery-app-ebf90.firebaseapp.com",
  projectId: "bakery-app-ebf90",
  storageBucket: "bakery-app-ebf90.firebasestorage.app",
  messagingSenderId: "27778450817",
  appId: "1:27778450817:web:74e1bab55d10c3f9279480"
};

// The Web Push key, for notifications that arrive with the app closed.
//
// ⚠️ PUBLIC CONFIG, NOT A SECRET (P1). It is the PUBLIC half of the Web Push
// certificate pair and is handed to every visitor's browser at runtime; only the
// private half, which never leaves the Firebase console, can send anything. It
// belongs in this file exactly like the keys above.
//
// Verified before committing rather than trusted: it decodes to 65 bytes starting
// 0x04 — an uncompressed P-256 point, which is what a PUBLIC key is. The private
// half is 32 bytes and would never be recognisable by shape alone if it were
// pasted here by mistake, so the check is worth the thirty seconds.
//
// Empty is a valid state, and was the state this shipped in: pushSupport() then
// reports 'not-configured' and every screen says so in words rather than offering
// a button that can never do anything.
//
// Regenerate at: Firebase console → Project settings → Cloud Messaging → Web
// configuration → Generate key pair.
export const VAPID_PUBLIC_KEY = 'BD2mUu9H_bxvaxiYdEYGmhFHA_kybZN84Oxzl5Y43Cuni6e41O1asMt8kr7TyAPIGU6FsnJKDaJVoujDOCgB3zU';

// ── Initialization ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ── Firestore, with the offline cache ON ─────────────────────────────────────
// WHY. Until now the app had no Firestore persistence at all, so a write made
// while the connection was down was held in MEMORY, never resolved, and was gone
// the moment the page reloaded — with nothing said to the person who made it.
// This app is used in a kitchen, on phones, where the signal comes and goes: an
// order typed in a cold room and lost on the next reload is exactly the failure
// nobody finds out about until the delivery does not arrive. With the cache on,
// that write is written to disk, survives a reload, and is sent when the phone
// is back. Reads come from disk too, so the app opens with real data offline.
//
// persistentMultipleTabManager, not the single-tab default: the same phone or
// laptop can have the Calculator open in one tab and Orders in another, and the
// single-tab manager gives the second tab NO cache at all (the first holds the
// lock). Sharing it across tabs is the behaviour that matches how the app is used.
//
// ⚠️ THIS MUST BE THE FIRST TOUCH OF FIRESTORE IN THE WHOLE APP. The SDK settles
// its settings on first use: initializeFirestore() after anything has already
// called getFirestore() throws, and getFirestore() first would create the default
// memory-only instance and silently keep it. The three feature data layers
// (orders/catalogue/pastries firebase-*.js) all `import '../firebase.js'`, and an
// ES module's imports run before its own body, so this line always wins the race.
// tests/firebase-offline-cache.test.mjs pins that, because nothing else would.
function startFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // No IndexedDB (private-mode Safari, a locked-down browser, an embedded
    // webview) is not a reason to have no app: fall back to the memory-only
    // client, which is exactly how the app behaved before this change.
    console.warn('Firestore offline cache unavailable — running from memory only:',
      err?.message || err);
    return getFirestore(app);
  }
}

const db = startFirestore();

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
// ⚠️ EXPORTED, AND EVERY OTHER FIREBASE APP IN THIS REPO MUST USE IT. The client
// ordering page and the link minter each create a SECOND Firebase app (so a client's
// session can never displace a member of staff's), and a second app is NOT covered by
// the connect*Emulator calls below — they attach to this app's instances only. A
// second app that decided for itself, or forgot to decide, would sign people in and
// write documents against PRODUCTION while the page it lives on says "LOCAL EMULATOR
// mode" in the console. That is the exact accident this project's hostname switch
// exists to make impossible, so the answer is asked once, here, and imported.
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
// ⚠️ STARTS false AND IS CLEARED ON SIGN-OUT, like userDocCache above. A stale
// `true` surviving a sign-out would draw the "New customer" entry for whoever
// signs in next on that phone.
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

  // ⚠️⚠️ THE VENUE'S LANGUAGE WINS FROM HERE ON, and it is applied BEFORE the
  // session is published — every screen paints after that, so nothing is ever
  // drawn in the device's language and then swapped. Above every venue there is
  // no setting to read and js/auth-gate.js uses the device instead; the moment a
  // location opens, its own choice takes over even if the two disagree. The
  // language belongs to the workplace, not to whoever is holding the phone.
  //
  // ⚠️ IT DOES NOT TOUCH A LABEL. That follows `country` (js/market.js), which is
  // a different field for a different reason: the law, not a preference.
  setLanguage(interfaceLanguage(location));

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
    // The interface language this venue's staff read (js/i18n.js). Separate from
    // `country`, which decides what a LABEL says and is not a preference.
    language: interfaceLanguage(location),
    // ⚠️ TWO ANSWERS, NOT ONE, AND THEY ARE NOT THE SAME QUESTION.
    // canManage is "may take things away" — the owner AND the manager. isOwner
    // is "may invite people and set roles" — the owner alone. Every delete
    // button reads canManage; only the "who can get in" entry reads isOwner.
    // Using isOwner for a bin would take the bins away from every manager.
    canManage: canManage(userDocCache, locationId),
    isOwner: isOwner(userDocCache, locationId),
    // ⚠️ A THIRD ANSWER, AND IT IS NOT ABOUT THIS LOCATION AT ALL. isOwner is
    // "may hire into THIS venue"; this is "may create a new customer's venue" —
    // the app's own administrator, not the customer's. Reading one for the other
    // would offer every bakery owner the power to mint businesses.
    isAppAdmin: appAdminCache,
  });
  markSessionReady(session);
}

// May this account create a NEW CUSTOMER's location? That is a different question
// from anything else in this file: every other permission is about one location,
// and this one sits above all of them.
//
// ⚠️ IT IS UX AND NOTHING ELSE (P2). createWorkspace reads the same document on
// the server and never trusts what is sent from here, so the worst a tampered
// `true` can do is draw a button that is then refused. The read exists only so
// the entry is not shown to the hundreds of people it would refuse, nor hidden
// from the one person it is for.
//
// ⚠️ EVERY UNCERTAIN ANSWER IS "NO". A refused read, a dropped connection, a
// document that is not there — all false. The opposite direction would draw an
// administrator's door during a network blip.
//
// ⚠️ COST (P14): one read per SIGN-IN, not per app open — it sits in the same
// place as the membership read, which the session already makes exactly once.
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
// js/log-model.js). This replaces the old one-document-per-dough `log` collection,
// which overwrote two logs of the same dough on the same day. The old `log`
// collection is kept read-only for the one-time migration below.

// How far back the Log screen ever reads. See LOG_WINDOW_DAYS below.
const LOG_WINDOW_DAYS = 30;

// Subscribe to the RECENT logs in real time. onChange receives an array of log
// documents (each with its id); ordering/sorting is done by the caller.
//
// ⚠️ BOUNDED ON PURPOSE (P14). Logs are never deleted — filterVisibleLogs is a
// display filter and says so — so this collection grows by a document per dough
// per day, for ever. Unbounded, every single opening of the Calculator re-read
// the entire history: a few hundred documents after one year, a few thousand
// after several, on every phone, several times a day, billed each time.
//
// 30 days is far wider than anything the screen can show: the longest retention
// selectable is 48 hours (LOG_RETENTION_OPTIONS), and even a log made FOR
// tomorrow is counted from the end of that day — a handful of days at the very
// most. The margin is there so the window can never be the thing that hides a
// log, and so raising the retention options later needs no thought here.
//
// A single-field range needs no composite index, so this works with no console
// setup. Documents missing createdAtMs would be excluded — but they are already
// invisible on screen, because filterVisibleLogs reads the same field and treats
// a missing one as 1970.
export function watchLogs(onChange) {
  const cutoff = Date.now() - LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  authReady.then(() => {
    onSnapshot(
      query(collection(db, pathFor('logs')), where('createdAtMs', '>=', cutoff)),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error('Logs listener failed:', err); },
    );
  }).catch(err => {
    // Every other function in this file catches its own; these two were the
    // exceptions, so a session that never opened surfaced as an unhandled
    // rejection rather than a line saying which stream never started.
    console.error('Logs listener never started (no location open):', err);
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

// Does this location have ANY log at all? Used by the one-time migration to
// decide whether the old records still need importing.
//
// ⚠️ limit(1), because that is the whole question. It used to read the entire
// collection and count it — and not once per device either: the guard flag lives
// in localStorage, which clearLocalData() wipes every time someone enters a
// location, so the whole archive was re-read on each entry to learn one bit.
export function anyLogExists() {
  return authReady
    .then(() => getDocs(query(collection(db, pathFor('logs')), limit(1))))
    .then(snap => !snap.empty)
    .catch(err => { console.error('anyLogExists failed:', err); return false; });
}

// One-shot read of the OLD `log` collection (one doc per dough), used only by the
// migration to convert legacy records into the new model without losing them.
export function readOldLogsOnce() {
  return authReady
    .then(() => getDocs(collection(db, pathFor('log'))))
    .then(snap => snap.docs.map(d => d.data()))
    .catch(err => { console.error('readOldLogsOnce failed:', err); return []; });
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
  }).catch(err => {
    // Deliberately does NOT call onChange: the store treats "called at all" as
    // proof the server answered, and answering on its behalf here would re-open
    // exactly the hole that guard exists to close (see calculator-config-store).
    console.error('Config listener never started (no location open):', err);
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
  // pathFor() must be resolved INSIDE the chain, not before it. Built here it
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
