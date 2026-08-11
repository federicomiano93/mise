// firebase-orders.js — Firestore data layer for the Orders system.
//
// Reuses the Firebase app and the SESSION already established by js/firebase.js
// (imported here for its config and its init side effect), so every page shares
// one signed-in account and one open location.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{location}/suppliers/{id} · …/ingredients/{id} ·
//   …/drafts/{id} · …/orders-history/{id} · …/config/{id}
//
// Collection names stay plain strings at every call site; pathFor() is the only
// thing that knows where they live. Every document still carries the `bakery`
// field — now the location id, matching its own path — because removing a
// field that live documents already carry is what breaks merge writes for good.

import { firebaseConfig, sessionReady, currentSession } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
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
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  runTransaction,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// The id stamped on every document, in the `bakery` field. It is the same value
// as the location folder the document sits in, so the field and the path can
// never disagree — and the rules check exactly that.
export function currentBakery() {
  return currentLocationId();
}

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

// Resolves once a location is OPEN — not merely once someone is signed in.
// Every read and write awaits this, because until it resolves there is no
// location folder to build a path from (js/location.js throws if asked).
export const authReady = sessionReady;

// Stamp the current bakery id on a document payload.
function withBakery(data) {
  return { ...data, bakery: currentBakery() };
}

// Subscribe to a collection in real time. onChange receives an array of
// documents ({ id, ...data }). Returns the unsubscribe function.
//
// onError is how a failure REACHES SOMEONE. Without it the stream dying — a
// revoked session, a rule change, a network Firestore gives up on — left the
// screen looking exactly like a location with no data in it, and onSnapshot does
// NOT resubscribe after an error, so it stayed that way until a reload. The
// console line remains for diagnosis; it is not a substitute for telling the user.
export async function watchCollection(name, onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(name)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error(`watchCollection(${name}) failed:`, err);
      onError?.(err);
    },
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
  const snap = await getDocs(collection(db, pathFor(name)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The orders recorded on ONE day. Used by the Home screen, which only needs to know
// what has already been placed today.
//
// Deliberately a WHERE query rather than getCollection('orders-history'): the Home is
// opened many times a day on every phone, and reading the whole archive there would
// bill for the entire order history each time — a cost that grows for ever while the
// answer needed is always one day wide (P14). An equality filter on a single field
// needs no composite index, so this works with no console setup.
//
// The legacy weekly record carries `weekStart` instead of `date` and therefore never
// matches. That is correct here: it is from July 2026 and can never be "placed today".
export async function getHistoryForDay(date) {
  await authReady;
  const snap = await getDocs(query(
    collection(db, pathFor(COLLECTIONS.history)),
    where('date', '==', date),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Create or merge a document. The bakery field is always stamped server-side
// of the client (rules also enforce that it matches the location folder).
export async function saveDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(name), id), withBakery(data), { merge: true });
}

// Overwrite a document WHOLE — no merge. saveDoc's { merge: true } deep-merges
// maps, so a key removed from `quantities` would survive in Firestore; when the
// caller has already computed the exact final document (a history record), that
// is wrong. Use saveDoc when you are patching, this when you are replacing.
export async function replaceDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(name), id), withBakery(data));
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
  const update = { ...patch, bakery: currentBakery() };
  paths.forEach(path => { update[path] = deleteField(); });
  return updateDoc(doc(db, pathFor(name), id), update);
}

// Read-modify-write a single document atomically. `updater` receives the current
// document ({ id, ...data }) or null, and returns the FULL new document — or null
// to leave it alone. Used so that two orders to the same supplier on the same day
// add up correctly even if two people tap at once.
export async function transactDoc(name, id, updater) {
  await authReady;
  const ref = doc(db, pathFor(name), id);
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
  const ref = await addDoc(collection(db, pathFor(name)), withBakery(data));
  return ref.id;
}

// Delete a document. The rules permit this for drafts, suppliers, ingredients
// and — since orders became correctable — orders-history.
export async function removeDoc(name, id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(name), id));
}

// ── Ingredient prices ────────────────────────────────────────────────────────
// The name of the append-only history that hangs under each ingredient. It is a
// SUBCOLLECTION, so it never appears in COLLECTIONS above: pathFor() builds a
// location's top-level collections and refuses a name containing a slash. The
// path is composed from the ingredient's own document reference instead.
const PRICES = 'prices';

// Save an ingredient and, when its price actually changed, record that price —
// as ONE atomic write.
//
// ⚠️ THE BATCH IS THE POINT. These are two documents in two different places, and
// done as two writes the second can fail on its own: the ingredient would then
// carry a price that the history has no record of, which is precisely the
// question the history exists to answer. Either both land or neither does.
//
// `priceRecord` is null when nothing about the price moved — re-saving an
// ingredient to fix a typo in its name must not plant a second identical entry,
// or the history fills with non-events and "when did this go up?" stops being
// answerable.
//
// A new ingredient gets its id here rather than from addDoc(): doc() on a
// collection mints an id WITHOUT writing anything, which is what lets a brand-new
// ingredient and its first price go in the same batch. Returns the id either way.
export async function saveIngredientWithPrice(id, data, priceRecord) {
  await authReady;
  const ingredients = collection(db, pathFor(COLLECTIONS.ingredients));
  const ref = id ? doc(ingredients, id) : doc(ingredients);

  const batch = writeBatch(db);
  batch.set(ref, withBakery(data), { merge: true });
  if (priceRecord) batch.set(doc(collection(ref, PRICES)), withBakery(priceRecord));
  await batch.commit();
  return ref.id;
}

// What this ingredient has cost, newest first. Read ON DEMAND — only when someone
// opens the ingredient — never watched, so an archive that grows for years costs
// nothing on the screens that do not ask for it (P14).
//
// ⚠️ ORDERED BY THE recordedAt FIELD, never by document id. Firestore refuses a
// descending scan by key, and limitToLast on an ascending key order is rewritten
// into that same refused query. This project has already lost a release to that
// exact trap twice.
export async function getPriceHistory(ingredientId, max = 20) {
  await authReady;
  const ref = doc(collection(db, pathFor(COLLECTIONS.ingredients)), ingredientId);
  const snap = await getDocs(query(
    collection(ref, PRICES),
    orderBy('recordedAt', 'desc'),
    limit(max),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// One-off read of a single document. Returns { id, ...data } or null.
export async function getDocOnce(name, id) {
  await authReady;
  const snap = await getDoc(doc(db, pathFor(name), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Subscribe to a single document in real time. onChange receives { id, ...data }
// or null when the document does not exist. Returns the unsubscribe function.
export async function watchDoc(name, id, onChange, onError) {
  await authReady;
  return onSnapshot(
    doc(db, pathFor(name), id),
    snap => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => {
      console.error(`watchDoc(${name}/${id}) failed:`, err);
      onError?.(err);
    },
  );
}

// Whether this session may take things away in this location.
//
// ⚠️ UX ONLY (P2). The rules decide, and they read users/{uid} themselves rather
// than trusting anything this page says. This exists so a screen does not draw a
// button the database is going to refuse — a control that fails on tap teaches
// people the app is broken, not that they lack the permission.
export function isOwnerHere() {
  return currentSession().isOwner === true;
}
