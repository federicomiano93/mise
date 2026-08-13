// client-orders-data.js — everything the BAKERY does with client ordering: publish
// what each client may order, mint and revoke the links, read the orders that arrive,
// and record that one has been put into the Calculator.
//
// The client's own half lives in js/client-orders/ and shares only the pure model
// (js/client-order-model.js). Nothing here is imported from there, or the other way
// round: they are two apps that happen to sit in one repository.
//
// ⚠️ The Firestore instance is the DEFAULT app's, exactly like every other data layer,
// and firebase.js is imported so its offline cache is configured before this file asks
// for one (an ES module's imports run before its body — see
// tests/firebase-offline-cache.test.mjs).

import { t } from './i18n.js';
import { countryOf } from './market.js';
import { firebaseConfig, sessionReady, isLocalEmulator, currentSession } from './firebase.js';
import { currentLocationId, pathFor } from './location.js';
import {
  menuFor, menuChanged, isValidOrderClientId, orderDocId, toISODate, linkEmailFor,
} from './client-order-model.js';
import { getClients } from './calculator-config.js';
import {
  getApps, getApp, initializeApp, deleteApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signOut, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc,
  onSnapshot, query, where, updateDoc, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { MAX_HISTORY_READ } from './client-order-history.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

export const MENUS = 'client-menus';
export const ACCOUNTS = 'client-accounts';
export const ORDERS = 'client-orders';
export const SETTINGS = 'client-settings';
const SETTINGS_DOC = 'orders';

const nowIso = () => new Date().toISOString();

function stamped(data) {
  return { ...data, bakery: currentLocationId() };
}

// ── The deadline, shared with every client's page ────────────────────────────
// One document, one field. It lives outside config/calculator because the client page
// has to read it and that document is the whole address book — see the rules.

// Watch it, so changing the deadline reaches the Calculator's own screens without a
// reload. onChange receives the cutoff string ('' meaning no deadline at all).
export async function watchClientCutoff(onChange, onError) {
  await sessionReady;
  return onSnapshot(
    doc(db, pathFor(SETTINGS), SETTINGS_DOC),
    snap => onChange(snap.exists() ? String(snap.data().cutoff ?? '') : null),
    err => {
      console.error('watchClientCutoff failed:', err);
      onError?.(err);
    },
  );
}

export async function saveClientCutoff(cutoff) {
  await sessionReady;
  return setDoc(doc(db, pathFor(SETTINGS), SETTINGS_DOC),
    stamped({ cutoff: String(cutoff ?? ''), updatedAt: nowIso() }));
}

// ── Publishing what a client may order ───────────────────────────────────────

// Republish every client's product list, writing ONLY the ones that actually moved.
//
// ⚠️ IT MUST RUN ON EVERY SAVE OF THE ADDRESS BOOK. A client cannot order a product
// whose menu was never published, and nothing about that failure is visible from the
// bakery's side: the owner adds a product, the client's page simply does not show it,
// and nobody finds out until somebody telephones. Writing only what changed is what
// keeps that safe to do on every save (P14).
//
// A client with no ordering link still gets its menu published. That costs one small
// document and means the link, when it is created, works immediately rather than
// after the next unrelated save.
export async function publishMenus(config) {
  await sessionReady;
  const published = await readMenus();
  let written = 0;
  for (const client of getClients(config)) {
    if (!client || !isValidOrderClientId(client.id)) continue;
    const wanted = menuFor(client, currentSession().name, countryOf(currentSession().location));
    if (!menuChanged(published.get(client.id), wanted)) continue;
    await setDoc(doc(db, pathFor(MENUS), client.id), stamped({ ...wanted, updatedAt: nowIso() }));
    written++;
  }
  return written;
}

async function readMenus() {
  const snap = await getDocs(collection(db, pathFor(MENUS)));
  return new Map(snap.docs.map(d => [d.id, d.data()]));
}

// ── The ordering links ───────────────────────────────────────────────────────

// The link's secret. 32 random bytes from the browser's own generator — not
// Math.random(), which is predictable enough that a few links would reveal the rest.
function mintToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ⚠️ ONE SECRET, USED FOR BOTH HALVES OF THE ACCOUNT, and that is not a shortcut: the
// email and the password travel together in the same link, so splitting them into two
// secrets would protect nothing and double what has to be stored to re-send it. The
// address itself is built by the shared model, so this side and the client page can
// never disagree about it.

// The address that IS the link. The secret sits in the FRAGMENT, after the #, because
// a fragment is never sent to the server and never lands in a web-server log.
export function orderingLinkFor(token, locationId = currentLocationId()) {
  const base = new URL('order.html', window.location.href);
  return `${base.origin}${base.pathname}#b=${encodeURIComponent(locationId)}&k=${encodeURIComponent(token)}`;
}

export async function listOrderingAccounts() {
  await sessionReady;
  const snap = await getDocs(collection(db, pathFor(ACCOUNTS)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// Mint a link for a client: a fresh account, the grant that says which client it is,
// and that client's menu published so the page has something to show.
//
// ⚠️ THE ACCOUNT IS CREATED ON A SECOND FIREBASE APP, and this is not tidiness.
// Creating a user signs you in as that user on the app it was created with; on the
// default one that would replace the OWNER'S OWN SESSION with the client's — the
// person minting the link would find themselves logged in as their customer, on their
// own phone, with no idea why. The second app has its own session storage, is signed
// out immediately, and is thrown away.
//
// Regenerating (a client already has a link) is deliberately a SEPARATE, louder
// action in the UI: the old link stops working the moment its grant is deleted, so a
// tap meant to re-send a link must never silently cut off the phone already using it.
export async function createOrderingLink(client, { replacing = null } = {}) {
  await sessionReady;
  if (!client || !isValidOrderClientId(client.id)) {
    throw new Error(t('co.thisClientCannotHave'));
  }

  const token = mintToken();
  const secondary = initializeApp(firebaseConfig, `client-link-${Date.now()}`);
  let uid = null;
  try {
    const auth = getAuth(secondary);
    // ⚠️ A SECOND APP IS NOT COVERED BY firebase.js's EMULATOR SWITCH — that one
    // attaches to the default app's instances. Without this line, creating a link on
    // localhost would create a REAL account in the production Firebase project, on a
    // page whose console says "LOCAL EMULATOR mode". Found by driving the app: the
    // link creation failed, and the reason it failed was that it was trying to reach
    // production from a machine that cannot.
    if (isLocalEmulator) connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    const credential = await createUserWithEmailAndPassword(auth, linkEmailFor(token), token);
    uid = credential.user.uid;
    await signOut(auth);
  } finally {
    // Whatever happened, this app must not outlive the call — a leftover instance
    // keeps an auth observer alive against an account that is not the owner's.
    await deleteApp(secondary).catch(() => {});
  }

  await setDoc(doc(db, pathFor(ACCOUNTS), uid), stamped({
    clientId: client.id,
    clientName: String(client.name || ''),
    createdAt: nowIso(),
    linkToken: token,
  }));

  // Only now: the new link works before the old one stops, so there is no window in
  // which the client has neither.
  if (replacing && replacing !== uid) await revokeOrderingLink(replacing);

  await setDoc(doc(db, pathFor(MENUS), client.id),
    stamped({
      ...menuFor(client, currentSession().name, countryOf(currentSession().location)),
      updatedAt: nowIso(),
    }));

  return { uid, token, link: orderingLinkFor(token) };
}

// Revoking is deleting the grant. The account survives and can do nothing at all,
// anywhere — it is not a member of any location and now grants no client either.
export async function revokeOrderingLink(uid) {
  await sessionReady;
  return deleteDoc(doc(db, pathFor(ACCOUNTS), uid));
}

// ── The orders that arrive ───────────────────────────────────────────────────

// Everything still to come, in real time, so an order sent while the Calculator is
// open appears without a reload.
//
// ⚠️ A RANGE ON ONE FIELD, NOT THE WHOLE COLLECTION (P14). Orders accumulate for ever
// and the bakery only ever needs the ones that have not yet been delivered; reading
// them all would bill for every order ever placed, on every app open, for ever. A
// single-field range needs no composite index, so this works with no console setup.
export async function watchUpcomingOrders(onChange, onError) {
  await sessionReady;
  return onSnapshot(
    query(collection(db, pathFor(ORDERS)), where('date', '>=', toISODate(Date.now()))),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('watchUpcomingOrders failed:', err);
      onError?.(err);
    },
  );
}

// The upcoming orders, read ONCE. The Home badge uses this rather than a listener:
// the Home is a landing screen somebody passes through, and a live subscription there
// would keep a connection open for a number that is read at a glance.
export async function getUpcomingOrdersOnce() {
  await sessionReady;
  const snap = await getDocs(query(
    collection(db, pathFor(ORDERS)),
    where('date', '>=', toISODate(Date.now())),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The orders that have already been — the history screen.
//
// ⚠️ A RANGE ON THE SAME ONE FIELD, ordered by that field, with a cap. Two
// inequalities on `date` plus `orderBy('date')` need NO composite index, so this
// works with nothing set up in the console.
//
// ⚠️ ORDERED BY THE `date` FIELD, NEVER BY THE DOCUMENT ID. The id here is
// `{date}_{clientId}`, so ordering by id looks like the obvious shortcut — and
// Firestore REFUSES descending key scans. It cost this project a release in Orders
// (v1.9.0) and has had to be avoided twice since.
//
// ⚠️ READ ONCE, NOT WATCHED, and only when the history is opened. A past order does
// not change, so a live subscription would be a connection held open for nothing
// (P14). The window is applied HERE rather than after reading everything, which is
// what keeps this cheap for ever — unlike orders-history, which reads its whole
// archive on every app open and sits in the backlog as a cost to revisit.
//
// ⚠️ THE WINDOW HIDES, IT DOES NOT DELETE. Everything outside it stays in the
// database; asking for a wider window brings it back. See js/client-order-history.js.
export async function getPastOrders({ before, since, cap = MAX_HISTORY_READ } = {}) {
  await sessionReady;
  const snap = await getDocs(query(
    collection(db, pathFor(ORDERS)),
    where('date', '<', String(before)),
    where('date', '>=', String(since)),
    orderBy('date', 'desc'),
    limit(Math.max(1, Number(cap) || MAX_HISTORY_READ)),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Has this bakery EVER received an order? One document is enough to answer it, and the
// answer decides which of two very different sentences an empty history shows: "nobody
// has sent one yet" or "none in the last 15 days, and the older ones are still kept".
export async function hasAnyClientOrder() {
  await sessionReady;
  const snap = await getDocs(query(collection(db, pathFor(ORDERS)), limit(1)));
  return !snap.empty;
}

export async function getOrder(date, clientId) {
  await sessionReady;
  const snap = await getDoc(doc(db, pathFor(ORDERS), orderDocId(date, clientId)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Record that this exact version of the order went into the Calculator.
//
// ⚠️ `appliedFor` STORES WHICH VERSION, not merely that one was used. It is what lets
// the screen say "this changed after you used it" instead of comparing two clocks and
// guessing — and that sentence is the only thing between a late correction and the
// wrong amount of bread. A patch, not a whole write, so a correction landing in the
// same second cannot be overwritten by this.
export async function markOrderApplied(order) {
  await sessionReady;
  return updateDoc(doc(db, pathFor(ORDERS), order.id), {
    bakery: currentLocationId(),
    appliedAt: nowIso(),
    appliedFor: String(order.updatedAt || ''),
  });
}

export async function deleteOrder(id) {
  await sessionReady;
  return deleteDoc(doc(db, pathFor(ORDERS), id));
}
