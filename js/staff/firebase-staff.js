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

import { firebaseConfig, sessionReady, signedInReady, currentSession, isLocalEmulator }
  from '../firebase.js';
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

// ⚠️⚠️ THESE THREE AWAIT signedInReady, NOT sessionReady, AND THE DIFFERENCE IS
// THE WHOLE SCREEN WORKING OR HANGING FOR EVER.
//
// They are reached from the Misé home, which sits ABOVE every location — and
// they are about businesses their caller is deliberately NOT a member of, so
// there is no location involved at any point. sessionReady resolves when a
// location OPENS, which on that screen never happens: the Businesses list sat on
// "Loading…" indefinitely, with no error, nothing in the console and nothing on
// screen. Found by driving the app; the panel mounted, was tappable and had its
// title and its button, so every check about the panel passed.
//
// ⚠️ signedInReady gives the guarantee these calls actually needed and always
// did: that the auth token has been restored. Firing before it, a callable
// answers `unauthenticated` — "you are not allowed" when the truth is "you were
// not asked yet". Waiting for a location was only ever a way of waiting for that.
//
// ⚠️ THE VENUE CALLS BELOW KEEP sessionReady, and must. They read
// currentSession().locationId, so for them a location really does have to be
// open — swapping them over would let one fire with no location and send
// `undefined` as the place to write to.
//
// ⚠️ And none of these three takes a locationId from currentSession(): they are
// about the app's customers, never about the place you happen to have open.

// Create a business. `opts.forSelf` decides who ends up inside it:
//   false (default) → a CUSTOMER's business: returns a one-time link, and the
//                     caller does NOT become a member. Their data, their keys.
//   true            → ONE OF MINE: the caller is made owner on the spot, in one
//                     transaction, and NO link is minted. firstName/lastName go
//                     on the roster row, exactly as redeeming a code would.
//
// ⚠️ The two are not a style choice. Adding a business to yourself through the
// customer route means redeeming a link with an email that already has an
// account — refused by Firebase, and the reason Federico could not add his
// second business on 13 Aug 2026.
export async function createWorkspace(name, sections, opts = {}) {
  await signedInReady;
  const res = await call('createWorkspace')({
    name,
    sections,
    // ⚠️ 'GB' or 'IT'. It decides what LANGUAGE this venue's allergen labels are
    // printed in, which is a legal matter and not a preference (js/market.js).
    // Passed through untouched: the server refuses anything else rather than
    // guessing, because a guess here is a non-compliant label nobody notices.
    country: opts.country || '',
    forSelf: opts.forSelf === true,
    firstName: opts.firstName || '',
    lastName: opts.lastName || '',
  });
  return res.data;
}

export async function listWorkspaces() {
  await signedInReady;
  const res = await call('listWorkspaces')({});
  return (res.data && res.data.workspaces) || [];
}

export async function reissueOwnerLink(locationId) {
  await signedInReady;
  const res = await call('reissueOwnerLink')({ locationId });
  return res.data;
}

// ⚠️ signedInReady, NOT sessionReady — like listWorkspaces and reissueOwnerLink
// above and for the same reason: this is called from a screen that sits ABOVE
// every location, so waiting for one to open would wait for ever. That mistake
// shipped once and left the Businesses list on "Loading…" with nothing said
// (v1.41.0); tests/staff-call-gates.test.mjs pins both directions.
export async function deleteWorkspace(locationId) {
  await signedInReady;
  const res = await call('deleteWorkspace')({ locationId });
  return res.data;
}

// `title` names the manager level and travels WITH the code, so somebody invited
// as a head chef joins as one — otherwise the roster would quietly disagree with
// what the owner picked, and nobody re-reads a screen they filled in yesterday.
//
// `kind` is how the invitation TRAVELS: 'digits' to read out to somebody standing
// there, 'link' to send them over WhatsApp. ⚠️ It changes the LIFETIME too — both
// are staff invitations and live a day, never the customer link's week (TTL_MS in
// js/join-code.js). The server decides that, not this call.
export async function createJoinCode(role = 'staff', title = null, kind = 'digits') {
  await sessionReady;
  const res = await call('createJoinCode')({
    locationId: currentSession().locationId, role, title, kind,
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

// ⚠️ A NAME IS A LABEL AND THIS CALL PROVES IT: it reaches only the roster, never
// users/{uid}. Renaming somebody cannot change what they can do, because the
// document that decides that is not on this path at all.
export async function setMemberName(uid, firstName, lastName) {
  await sessionReady;
  const res = await call('setMemberName')({
    locationId: currentSession().locationId, uid, firstName, lastName,
  });
  return res.data;
}

// The interface language this venue's staff read.
//
// ⚠️ sessionReady, NOT signedInReady — it reads currentSession().locationId, so a
// location really does have to be open. Firing before one is would send
// `undefined` as the place to write to. tests/staff-call-gates.test.mjs pins it.
export async function setLocationLanguage(locationId, language) {
  await sessionReady;
  const res = await call('setLocationLanguage')({ locationId, language });
  return res.data;
}

// `title` names the manager level — 'manager' or 'head-chef'. It is a LABEL and
// grants nothing; the server clears it whenever the level is not manager.
export async function setMemberRole(uid, role, title = null) {
  await sessionReady;
  const res = await call('setMemberRole')({
    locationId: currentSession().locationId, uid, role, title,
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
