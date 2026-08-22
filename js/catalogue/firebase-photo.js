// firebase-photo.js — the one call that reads a photographed recipe.
//
// It is a Cloud Function and not a direct API call for one reason: the key that
// pays for the read is a REAL secret. Anything the browser holds is readable by
// anybody holding the phone, so a key in the app would be a key on the internet.
// See functions/recipe-photo.js.

import { sessionReady, isLocalEmulator } from '../firebase.js';
import { currentLocationId } from '../location.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFunctions, httpsCallable, connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { firebaseConfig } from '../firebase.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ⚠️ THE REGION HAS TO MATCH THE ONE THE FUNCTION DECLARES. Left to its default the
// client calls us-central1 anyway, but saying it here means a later move fails
// loudly in one place rather than as a silent CORS error on every call.
const functions = getFunctions(app, 'us-central1');

// ⚠️ THE SAME TRAP AS THE CLIENT ORDERING LINK (v1.31.0) AND THE STAFF SCREEN.
// js/firebase.js points Firestore and Auth at the emulator on localhost, but
// nothing points FUNCTIONS anywhere — so without this line, testing on localhost
// would call the REAL deployed function and spend REAL money, on a page whose
// console says "LOCAL EMULATOR mode".
if (isLocalEmulator) connectFunctionsEmulator(functions, '127.0.0.1', 5001);

// ⚠️⚠️ THE TIMEOUT IS SET EXPLICITLY, AND IT MUST STAY >= THE FUNCTION'S OWN.
// httpsCallable defaults to 70 seconds; functions/recipe-photo.js declares 120.
// Left at the default, the phone gives up on a call that is still running and has
// ALREADY BEEN PAID FOR — the person sees a failure, the money is gone, and the
// daily allowance has been spent. Two numbers, each correct on its own, in two
// files: tests/photo-timeouts.test.mjs pins the relationship between them.
const CLIENT_TIMEOUT_MS = 120000;

const readRecipeFromPhotos = httpsCallable(functions, 'readRecipeFromPhotos', {
  timeout: CLIENT_TIMEOUT_MS,
});

// Ask the server to read these photographs.
//
// Resolves with the server's own answer, which is one of:
//   { ok: true,  recipe, notes, remaining }
//   { ok: false, reason }        ← the call worked; there was no recipe to find
// and REJECTS only when the call itself failed. Those two are different things
// and the screen says different sentences for them.
//
// ⚠️ sessionReady, NOT signedInReady: this call carries a locationId, so it needs a
// location to be OPEN and not merely an account to be signed in. Sent too early it
// would answer 'unauthenticated', which reads exactly like being logged out.
//
// ⚠️⚠️ AND THE LOCATION IS READ HERE, AFTER THAT WAIT — NEVER PASSED IN FROM THE
// SCREEN. The first version took it as an argument and the screen resolved it once,
// while rendering. currentLocationId() returns null before a location is open (it is
// pathFor that throws, not this), so the screen froze a null and every read
// afterwards came back "which location?" — for the life of that screen.
//
// It was a RACE, which is the worst part: the same code read a recipe perfectly on
// one run and refused on the next, with nothing on screen distinguishing them. Found
// by driving the app twice. Reading it at call time cannot race, because by then the
// wait above has already finished.
export async function readRecipePhotos(images) {
  await sessionReady;
  const locationId = currentLocationId();
  const res = await readRecipeFromPhotos({ locationId, images });
  return res.data;
}

// Switch the feature on or off for this venue.
//
// ⚠️ IT WRITES NOTHING ITSELF — locations/{lid} is `allow write: if false` for every
// client, so this is a request to a Cloud Function that checks the role and does the
// write. Hiding the control from an employee is courtesy; the server is what refuses.
export async function setPhotoEnabled(enabled) {
  await sessionReady;
  const locationId = currentLocationId();
  const res = await httpsCallable(functions, 'setRecipePhoto')({ locationId, enabled });
  return res.data;
}
