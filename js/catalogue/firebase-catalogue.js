// firebase-catalogue.js — Firestore data layer for the Recipe catalogue.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the
// single sanctioned cross-file bridge), so the catalogue shares the one
// signed-in account, the one open restaurant, and inherits the localhost
// emulator switch + App Check.
//
// Collection: restaurants/{restaurant}/recipes/{id} — one document per recipe
// (scales to 500+). Every document carries the restaurant id in `bakery`, which
// must match the folder it sits in (rules enforce it). js/restaurant.js is the
// only place that knows the path.

import { firebaseConfig, sessionReady } from '../firebase.js';
import { currentRestaurantId, pathFor } from '../restaurant.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const RECIPES = 'recipes';

// Resolves once a restaurant is OPEN — not merely once someone is signed in.
// It no longer needs its own timeout: a sign-in that cannot complete is now a
// SCREEN (js/auth-gate.js shows why), not a promise that quietly never settles
// behind a spinner.
export const authReady = sessionReady;

// A new client-side document id (no write). Lets a brand-new recipe be shown
// locally BEFORE the network write, so saving works instantly and offline.
export function newRecipeId() {
  return doc(collection(db, pathFor(RECIPES))).id;
}

// Stamp the bakery id on a document payload (usageCount is local-only and never
// written here — it lives in localStorage per device).
function withBakery(data) {
  return { ...data, bakery: currentRestaurantId() };
}

// Subscribe to the whole recipes collection in real time. onChange receives an
// array of { id, ...data }. onError (optional) is called if the stream errors —
// note onSnapshot does NOT auto-resubscribe after an error, so the caller decides
// whether to warn the user. Returns the unsubscribe function. Attach this only
// when the catalogue page is open (not at app boot) to avoid an unbounded read.
export async function watchRecipes(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(RECIPES)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('watchRecipes failed:', err); if (onError) onError(err); },
  );
}

// Create or merge a recipe document at a known id (id is generated client-side).
export async function saveRecipeDoc(id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(RECIPES), id), withBakery(data), { merge: true });
}

// Delete a recipe document.
export async function removeRecipeDoc(id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(RECIPES), id));
}

// Read the shared config/calculator document once (or null if it doesn't exist).
// Read-only; used to check whether a catalogue recipe was imported into the
// Calculator before deleting it (so we can warn). Never writes.
export async function getCalculatorConfig() {
  await authReady;
  const snap = await getDoc(doc(db, pathFor('config'), 'calculator'));
  return snap.exists() ? snap.data() : null;
}

// Atomically read-modify-write the shared config/calculator document. applyFn
// receives the current raw config data (or null when the doc doesn't exist yet)
// and must return the full new document to write. Used ONLY by the Calculator
// import so a whole-document overwrite can't clobber a concurrent Calculator save
// (runTransaction re-reads and retries on conflict). Returns whatever applyFn built.
export async function updateConfigInTransaction(applyFn) {
  await authReady;
  const ref = doc(db, pathFor('config'), 'calculator');
  let built;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    built = applyFn(snap.exists() ? snap.data() : null);
    tx.set(ref, built);
  });
  return built;
}
