// firebase-foodcost.js — Firestore data layer for the Food Cost screen.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the one
// sanctioned cross-file bridge), so this page shares the signed-in account, the
// open location, the localhost emulator switch and App Check.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{lid}/products/{id}                — a finished product
//   locations/{lid}/products/{id}/snapshots/{id} — append-only margin history
//
// It also READS two collections it does not own: `recipes` (the catalogue's, to
// cost the components) and `ingredients` (Orders', for packaging). That is a
// shared COLLECTION, not a shared module — js/foodcost/ imports nothing from
// js/catalogue/ or js/orders/, so the feature stays liftable.

import { firebaseConfig, sessionReady } from '../firebase.js';
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
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const PRODUCTS = 'products';
const SNAPSHOTS = 'snapshots';
const RECIPES = 'recipes';
const INGREDIENTS = 'ingredients';

export const authReady = sessionReady;

function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

// A new client-side document id (no write), so a brand-new product can be shown
// locally before the network write — instantly, and offline.
export function newProductId() {
  return doc(collection(db, pathFor(PRODUCTS))).id;
}

function watch(name, onChange, onError, quiet) {
  return async () => {
    await authReady;
    return onSnapshot(
      collection(db, pathFor(name)),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        if (quiet) console.warn(`watch(${name}) failed:`, err);
        else console.error(`watch(${name}) failed:`, err);
        if (onError) onError(err);
      },
    );
  };
}

export const watchProducts = (onChange, onError) => watch(PRODUCTS, onChange, onError, false)();
// The two borrowed collections fail QUIETLY: they belong to other sections, a
// venue may not use them, and the worst outcome is a product that reads as
// unpriced — which is exactly what the screen says anyway when nothing is linked.
export const watchRecipes = (onChange, onError) => watch(RECIPES, onChange, onError, true)();
export const watchIngredients = (onChange, onError) => watch(INGREDIENTS, onChange, onError, true)();

// Save a product and, when the change is worth recording, append its margin —
// as ONE atomic write.
//
// ⚠️ THE BATCH IS THE POINT, exactly as it is for an ingredient's price. Done as
// two writes the second can fail alone, leaving a product whose margin history has
// no record of the change that was just made — the one question the history exists
// to answer. Either both land or neither does.
export async function saveProductWithSnapshot(id, data, snapshot) {
  await authReady;
  const products = collection(db, pathFor(PRODUCTS));
  const ref = id ? doc(products, id) : doc(products);

  const batch = writeBatch(db);
  // WHOLE, not merged: the editor has already computed the exact document, and a
  // merge would leave a component removed from the list alive in Firestore.
  batch.set(ref, withBakery(data));
  if (snapshot) batch.set(doc(collection(ref, SNAPSHOTS)), withBakery(snapshot));
  await batch.commit();
  return ref.id;
}

export async function removeProduct(id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(PRODUCTS), id));
}

// A product's margin over time, newest first. Read ON DEMAND — only when someone
// opens the history — never watched, so a series that grows for years costs
// nothing on the screens that do not ask for it (P14).
//
// ⚠️ ORDERED BY THE recordedAt FIELD, never by document id: Firestore refuses a
// descending scan by key, a trap this project has lost a release to twice.
export async function getProductHistory(productId, max = 30) {
  await authReady;
  const ref = doc(collection(db, pathFor(PRODUCTS)), productId);
  const snap = await getDocs(query(
    collection(ref, SNAPSHOTS),
    orderBy('recordedAt', 'desc'),
    limit(max),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
