// firebase-staff.js — the data layer for "who can get in".
//
// It is almost all CALLS rather than reads, and that is the shape of the feature:
// the documents that decide who may enter are writable by no client at all, so
// every change here is a request to a Cloud Function that does the write itself
// after checking who asked. See functions/onboarding.js for why.
//
// The one thing this file reads directly is the roster
// (locations/{lid}/members), which exists precisely because users/{uid} is
// readable only by its own owner — without it, an owner could never list their
// own staff.

import { firebaseConfig, sessionReady, currentSession, isLocalEmulator } from '../firebase.js';
import { pathFor } from '../location.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getFunctions, httpsCallable, connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ⚠️ THE REGION HAS TO MATCH THE ONE THE FUNCTIONS DECLARE. Left to its default
// the client calls us-central1 anyway, but saying it here means a later move of
// the functions to another region fails loudly in one place rather than as a
// silent CORS error on every call.
const functions = getFunctions(app, 'us-central1');

// ⚠️ THE SAME TRAP AS THE CLIENT ORDERING LINK (v1.31.0). js/firebase.js points
// Firestore and Auth at the emulator on localhost, but nothing points FUNCTIONS
// anywhere — so without this line, testing on localhost would call the REAL
// deployed functions and really create a location in production, on a page whose
// console says "LOCAL EMULATOR mode".
if (isLocalEmulator) connectFunctionsEmulator(functions, '127.0.0.1', 5001);

const call = name => httpsCallable(functions, name);

// ── The four ─────────────────────────────────────────────────────────────────

export async function createWorkspace(name, sections) {
  await sessionReady;
  const res = await call('createWorkspace')({ name, sections });
  return res.data;
}

export async function createJoinCode(role = 'staff') {
  await sessionReady;
  const res = await call('createJoinCode')({
    locationId: currentSession().locationId, role,
  });
  return res.data;
}

// ⚠️ THE ONE CALL THAT DOES NOT NEED A LOCATION OPEN, and must not wait for one.
// Whoever is redeeming has no location yet — that is the entire point — so
// awaiting sessionReady here would hang on the screen that exists to fix it.
// ⚠️ THE NAME TRAVELS WITH THE CODE, in the one call that already exists. Asking
// for it afterwards would leave a roster row with no name whenever anything went
// wrong between the two calls — a dropped signal, a phone that locked — and the
// person is already inside by then, so nothing would ever prompt them again.
export async function redeemJoinCode(code, kind = 'digits', firstName = '', lastName = '') {
  const res = await call('redeemJoinCode')({ code, kind, firstName, lastName });
  return res.data;
}

export async function setMemberRole(uid, role) {
  await sessionReady;
  const res = await call('setMemberRole')({
    locationId: currentSession().locationId, uid, role,
  });
  return res.data;
}

// ── The roster ───────────────────────────────────────────────────────────────

export async function watchMembers(onChange) {
  await sessionReady;
  return onSnapshot(collection(db, pathFor('members')), snap => {
    onChange(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
  }, err => {
    console.error('Could not read who works here:', err);
    onChange(null);
  });
}

// A call refused by the server arrives as a Firebase error with the function's
// own message inside it. Handing that message straight to the person is right
// here — the server writes them deliberately, and it is the only place that
// knows why (see redeemFailureText in join-code.js, which is careful never to
// confirm that a code exists).
export function callFailureText(err, fallback) {
  const message = err && typeof err.message === 'string' ? err.message.trim() : '';
  if (message && !/^internal$/i.test(message)) return message;
  return fallback;
}
