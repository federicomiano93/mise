// firebase-pastries.js — Firestore data layer for the Pastries screen.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the
// single sanctioned cross-file bridge), so this screen shares the one signed-in
// account, the one open location, and inherits the localhost emulator switch +
// App Check.
//
// Collection: locations/{location}/pastries/{Weekday} — SEVEN documents, for
// ever, one per weekday, with the id being the capitalised English weekday name
// ('Monday'…'Sunday'). That is the same vocabulary the Orders feature already
// stores in supplier orderDays/deliveryDays, and it means this collection never
// grows: one listener, seven reads, no pagination and no cost that creeps up
// over the years (P14). js/location.js is the only place that knows the path.

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
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const PASTRIES = 'pastries';
const LOGS = 'pastry-logs';

// Resolves once a location is OPEN — not merely once someone is signed in.
export const authReady = sessionReady;

// Stamp the location id on a document payload.
//
// The stamp is applied HERE, never by a caller. The rules require the `bakery`
// field to name the folder the document is being written to, and a caller that
// hardcodes it goes stale the moment the folder changes — which is exactly what
// happened when the data moved under locations/: one module kept stamping 'main'
// and every write it made was refused, for weeks, silently. Deriving it from the
// open location in one place is what stops that happening twice.
function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

// Subscribe to all seven days in real time. onChange receives an array of
// { id, ...data }; the id is the weekday name.
//
// onSnapshot does NOT auto-resubscribe after an error, so a dropped stream would
// otherwise leave the screen looking like a location with nothing in it, for
// ever. onError lets the caller say so out loud. Returns the unsubscribe
// function. Attached only when this page is open, never at app boot.
export async function watchPastryDays(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(PASTRIES)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('watchPastryDays failed:', err); if (onError) onError(err); },
  );
}

// Write one whole day.
//
// ⚠️ setDoc WITHOUT { merge: true }, on purpose. The screen always holds the
// complete list for a day, so the document is replaced rather than merged — and
// that is what lets firestore.rules REQUIRE every field instead of having to
// treat them all as optional (a merge write is validated against the full merged
// document, so a rule can never be sure what a partial write will leave behind).
// It is also the only way removing the last row can actually empty the day:
// under a merge, a shorter list would still replace the array, but a removed
// FIELD would silently survive.
//
// `day` repeats the document id deliberately, and the rules pin the two equal,
// so the field and the folder can never drift apart.
//
// `note` is the day's STANDING note and is written on every save, because the
// whole document is replaced: omitting it would delete it.
export async function savePastryDay(day, items, note = '') {
  await authReady;
  const payload = withBakery({ day, items, note, updatedAt: new Date().toISOString() });
  return setDoc(doc(db, pathFor(PASTRIES), day), payload);
}

// ── Records of a night's proving ─────────────────────────────────────────────

// Subscribe to the records. onChange receives ({ logs, fromServer }).
//
// ⚠️ `fromServer` IS LOAD-BEARING and is why this signature is not the same as
// watchPastryDays. The automatic prune must never act on a cached list: doing
// so would delete on the strength of data that may be stale or partial. It is
// the ONE flag that separates "the server told us this" from "this is what we
// had last time", and the store refuses to prune without it.
export async function watchPastryLogs(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(LOGS)),
    { includeMetadataChanges: false },
    snap => onChange({
      logs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      fromServer: !snap.metadata.fromCache,
    }),
    err => { console.error('watchPastryLogs failed:', err); if (onError) onError(err); },
  );
}

// Read one record, or null. One read, only when Accept is tapped — it is what
// lets the confirmation say "tonight's record will be replaced" truthfully. The
// records listener is not running on the day screen (it is attached only when
// the Records screen opens), so the in-memory list cannot answer this.
export async function getPastryLog(id) {
  await authReady;
  const snap = await getDoc(doc(db, pathFor(LOGS), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Write a record, keeping whatever the first Accept of that night established.
//
// ⚠️ A TRANSACTION, not a plain write. Accepting twice in one night REPLACES the
// record, and `createdAt` has to survive that — but two phones can accept within
// a second of each other, and a read-then-write would let the second overwrite
// what the first had just established. `build(existing)` is handed the record as
// it is INSIDE the transaction, so it can never be built from a stale read.
export async function acceptPastryLog(id, build) {
  await authReady;
  const ref = doc(db, pathFor(LOGS), id);
  let written;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const built = build(snap.exists() ? snap.data() : null);
    // `id` is not a field: it is the document's name, and the rules pin the two
    // equal. Sending it as well would be refused by the key whitelist.
    const { id: _drop, ...payload } = built;
    written = withBakery(payload);
    tx.set(ref, written);
  });
  return written;
}

// Remove one record. Used by the bin on the Records screen AND by the automatic
// prune — the two are indistinguishable to Firestore, which is exactly why the
// retention window is guaranteed in pastries-log-model.js and not in the rules.
export async function deletePastryLog(id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(LOGS), id));
}
