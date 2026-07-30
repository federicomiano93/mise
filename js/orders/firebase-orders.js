// firebase-orders.js — Firestore data layer for the Orders system.
//
// Reuses the Firebase app + anonymous auth already initialized by js/firebase.js
// (imported here only for its config and init side effect). js/firebase.js is
// never modified — we import its exported firebaseConfig and attach to the same
// default app, so the Orders pages share the one anonymous session.
//
// Collections (every document carries bakery: "main", forward-compatible with a
// future per-bakery split):
//   suppliers/{id} · ingredients/{id} · drafts/{id} · orders-history/{id}

import { firebaseConfig } from '../firebase.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getFirestore(app);

// Bakery id stamped on every document. Hardcoded for now; becomes dynamic when
// real authentication and per-bakery isolation land.
export const BAKERY = 'main';

// Collection names, in one place so the feature modules never hardcode strings.
export const COLLECTIONS = {
  suppliers: 'suppliers',
  ingredients: 'ingredients',
  drafts: 'drafts',
  history: 'orders-history',
  // Shared with the Calculator, which keeps config/calculator here. Orders uses
  // config/orders. The rules match /config/{doc} generically, so this needed no
  // change to firestore.rules.
  config: 'config',
};

// Resolves once anonymous auth is ready. Firestore rules require
// request.auth != null, so every read/write awaits this first.
export const authReady = new Promise(resolve => {
  const unsub = onAuthStateChanged(auth, user => {
    if (user) {
      unsub();
      resolve(user);
    }
  });
});

// Stamp the current bakery id on a document payload.
function withBakery(data) {
  return { ...data, bakery: BAKERY };
}

// Subscribe to a collection in real time. onChange receives an array of
// documents ({ id, ...data }). Returns the unsubscribe function.
export async function watchCollection(name, onChange) {
  await authReady;
  return onSnapshot(
    collection(db, name),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error(`watchCollection(${name}) failed:`, err),
  );
}

// COST NOTE (P14) — orders-history is read WHOLE on every app open, and with one
// document per day per supplier it now grows by roughly 500-1000 documents a year
// (it used to grow by 52). That is fine at today's size and stays well inside the
// free tier for a long time, but it does not stay fine for ever.
//
// The obvious fix — read only the newest N by document id — does NOT work:
// Firestore refuses a descending scan by key ("does not support descending key
// scans"), and limitToLast on an ascending key order is rewritten into exactly
// that same descending scan, so it fails too. Bounding the read means ordering by
// a FIELD (`date`, descending, which is fully supported) — and the one legacy
// weekly document has no `date` field, so it would silently drop out of History.
//
// So: revisit when orders-history passes ~1000 documents. Then add `date` to the
// legacy record (one additive write) and switch this listener to
// orderBy('date','desc') + limit. Not before — today the collection holds two
// documents, and a production data change to speed that up would be absurd.

// One-off read of a collection. Returns an array of { id, ...data }.
export async function getCollection(name) {
  await authReady;
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Create or merge a document. The bakery field is always stamped server-side
// of the client (rules also enforce bakery == 'main').
export async function saveDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, name, id), withBakery(data), { merge: true });
}

// Overwrite a document WHOLE — no merge. saveDoc's { merge: true } deep-merges
// maps, so a key removed from `quantities` would survive in Firestore; when the
// caller has already computed the exact final document (a history record), that
// is wrong. Use saveDoc when you are patching, this when you are replacing.
export async function replaceDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, name, id), withBakery(data));
}

// Remove specific fields — including keys inside a map ('entries.<ingredientId>')
// — and patch the rest, leaving every other key untouched.
//
// This is how one supplier's rows leave the shared draft. Rewriting the whole
// draft document instead would wipe whatever another phone typed for a DIFFERENT
// supplier in the second before this write landed; deleteField touches only the
// named keys, so concurrent edits elsewhere in the document survive.
export async function clearFields(name, id, paths, patch = {}) {
  await authReady;
  const update = { ...patch, bakery: BAKERY };
  paths.forEach(path => { update[path] = deleteField(); });
  return updateDoc(doc(db, name, id), update);
}

// Read-modify-write a single document atomically. `updater` receives the current
// document ({ id, ...data }) or null, and returns the FULL new document — or null
// to leave it alone. Used so that two orders to the same supplier on the same day
// add up correctly even if two people tap at once.
export async function transactDoc(name, id, updater) {
  await authReady;
  const ref = doc(db, name, id);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const next = updater(existing);
    if (!next) return null;
    tx.set(ref, withBakery(next));
    return next;
  });
}

// Create a document with an auto-generated id. Returns the new id.
export async function createDoc(name, data) {
  await authReady;
  const ref = await addDoc(collection(db, name), withBakery(data));
  return ref.id;
}

// Delete a document. The rules permit this for drafts, suppliers, ingredients
// and — since orders became correctable — orders-history.
export async function removeDoc(name, id) {
  await authReady;
  return deleteDoc(doc(db, name, id));
}

// One-off read of a single document. Returns { id, ...data } or null.
export async function getDocOnce(name, id) {
  await authReady;
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Subscribe to a single document in real time. onChange receives { id, ...data }
// or null when the document does not exist. Returns the unsubscribe function.
export async function watchDoc(name, id, onChange) {
  await authReady;
  return onSnapshot(
    doc(db, name, id),
    snap => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => console.error(`watchDoc(${name}/${id}) failed:`, err),
  );
}
