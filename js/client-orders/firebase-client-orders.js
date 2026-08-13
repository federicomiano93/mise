// firebase-client-orders.js — the client page's own connection to Firestore.
//
// ⚠️ A SECOND FIREBASE APP, NOT THE DEFAULT ONE, AND THIS IS THE WHOLE REASON THE
// FILE EXISTS. Firebase keeps one signed-in account per app instance. If the client
// page signed in on the default app, then a member of staff who taps a client's link
// out of curiosity — or the owner, testing it on his own phone — would be signed OUT
// of the app and into the customer's account, on their own device, with nothing
// saying why. A named second app has its own session storage, so the two never meet.
//
// ⚠️ IT IMPORTS ../firebase.js FOR THE CONFIGURATION, AND ONLY FOR THAT. A second
// copy of the Firebase settings is the one thing worse than this import: two files
// that could disagree about which project the app talks to. Importing it also happens
// to satisfy the rule that the offline cache is configured before anything asks
// Firestore for an instance (tests/firebase-offline-cache.test.mjs) — an ES module's
// imports run before its body, so js/firebase.js always wins that race.
//
// What that import brings with it is the staff session machinery, which on this page
// finds nobody signed in on the default app and does nothing at all. It cannot grant
// anything either way: the rules decide what an account may touch, not which
// JavaScript happens to be loaded next to it.

import { t } from '../i18n.js';
import { firebaseConfig, isLocalEmulator } from '../firebase.js';
import { linkEmailFor } from '../client-order-model.js';
import {
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig, 'client-orders');
const auth = getAuth(app);
const db = getFirestore(app);

// ⚠️ THE SECOND APP HAS TO BE POINTED AT THE EMULATOR ITSELF. firebase.js's hostname
// switch attaches to the DEFAULT app's auth and firestore; this app is a different
// one, so without these two lines the client page would sign people in and write
// their orders straight into PRODUCTION while being served from localhost — on a page
// whose own console says "LOCAL EMULATOR mode". The decision itself is imported
// rather than repeated, so the two apps can never disagree about where they are.
if (isLocalEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// The location is not known until the link is read, and every path is built from it.
// It THROWS rather than defaulting, for the same reason js/location.js does: a read
// that quietly used the wrong venue would look perfectly normal on screen.
let location = null;

const VALID_LOCATION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function setLocation(id) {
  if (typeof id !== 'string' || !VALID_LOCATION.test(id)) {
    throw new Error(`Invalid location in the link: ${JSON.stringify(id)}`);
  }
  location = id;
}

function pathFor(collectionName) {
  if (location === null) throw new Error(t('co.theLinkDidNot'));
  return `locations/${location}/${collectionName}`;
}

// Sign in with the credentials carried by the link. Both halves are the same secret:
// they travel together, so splitting them would protect nothing (see
// js/client-orders-data.js, where the link is minted).
export function signInWithToken(token) {
  return signInWithEmailAndPassword(auth, linkEmailFor(token), token);
}

// Resolves with the signed-in user, or null. The session persists on the device, so a
// client who has used the link once never needs it again — which is the point: an
// order must not depend on finding an old WhatsApp message.
export function onUser(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

export function signOutClient() {
  return signOut(auth);
}

async function readDoc(collectionName, id) {
  const snap = await getDoc(doc(db, pathFor(collectionName), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Which client this account is. The account can read only its OWN grant document —
// it cannot list the collection — so one client can never learn that another exists.
export function readGrant(uid) {
  return readDoc('client-accounts', uid);
}

export function readMenu(clientId) {
  return readDoc('client-menus', clientId);
}

export function readOrder(orderId) {
  return readDoc('client-orders', orderId);
}

// When orders for a day close. Readable by every ordering account of this bakery —
// it is one clock time, the same for all of them, and it is printed on their screens
// anyway. It is NOT a field of config/calculator, because that document is the whole
// address book and there is no way to share one field of it without sharing all of it.
export function readCutoff() {
  return readDoc('client-settings', 'orders');
}

// ⚠️ WRITTEN WHOLE, NEVER MERGED. A merge deep-merges maps, so a line the client
// removed from the order would survive in Firestore and the bakery would make
// something nobody asked for. Writing whole is also why the order has to carry the
// bakery's "I have used this" fields forward untouched — the rules refuse the write
// if it does not, precisely so that record cannot be erased by accident.
export function writeOrder(orderId, order) {
  return setDoc(doc(db, pathFor('client-orders'), orderId), { ...order, bakery: location });
}
