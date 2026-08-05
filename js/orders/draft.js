// draft.js — the persistent, real-time order in progress.
//
// One shared document, drafts/current, holds every supplier's quantities. Every
// change autosaves (debounced) so reopening the app restores the exact state, and
// a real-time listener keeps two phones in sync.
//
// It also remembers, per supplier, the DAY its rows were last touched
// (`days: { supplierId: 'YYYY-MM-DD' }`). Without that the app cannot tell an
// order typed today from one typed on Sunday and never marked as placed — and it
// would file the Sunday order under today.
//
// Archiving is per supplier: it writes orders-history/{day}_{supplierId} and
// removes ONLY that supplier's keys from the draft. The other suppliers' work —
// including whatever someone else is typing right now — is left alone.

import {
  saveDoc, watchDoc, clearFields, transactDoc, replaceDoc, removeDoc, COLLECTIONS,
} from './firebase-orders.js';
import {
  buildSupplierArchive, mergeArchives, historyDocId, ingredientsOf, quantityPathsFor,
  changedEntries, changedDays,
} from './archive.js';

const DRAFT_ID = 'current';
const SAVE_DELAY_MS = 800; // debounce to limit Firestore writes (cost control)

let saveTimer = null;
let queued = null;         // the change waiting for the debounce, so it can be flushed
let reportSaveResult = null;   // (ok: boolean) => void — injected by orders-main.js

// The draft as this device last agreed on it with the server: what a snapshot
// reported, plus what we have since sent and had accepted. Everything the
// autosave sends is the difference against this — see changedEntries.
//
// It is deliberately NOT updated when a write fails: the change then still counts
// as unsent and goes out again with the next save, instead of being forgotten.
let known = { entries: {}, days: {} };

// What THIS phone has typed and the server has not confirmed yet.
//
// ⚠️ WITHOUT THIS, A TYPED QUANTITY CAN VANISH. Every incoming snapshot replaces
// the whole local entries map, and a change is not sent for up to 800ms (the
// autosave debounce). So when another phone wrote anything at all in that window,
// its snapshot arrived and took the half-typed number with it — the field still
// showed it (a focused input is left alone on repaint), but the value was gone
// from memory and never saved. Reproduced against the emulator before fixing.
//
// Re-applying this over each snapshot keeps the two truths straight: the server
// owns every row this phone has not touched, and this phone owns the one it is
// typing into until the write lands.
let pending = { entries: {}, days: {} };

// A DETACHED copy of an entries map: same numbers, none of the same objects.
//
// ⚠️ THIS IS LOAD-BEARING, AND ITS ABSENCE IS INVISIBLE TO EVERY UNIT TEST.
// orders-main's setEntries copies the snapshot's inner objects BY REFERENCE into
// the live state, and typing mutates one of those objects in place. Keeping the
// snapshot's own objects as the baseline therefore mutated the baseline too: the
// comparison could never see a difference, and after the first snapshot NOTHING
// typed would ever have been saved again. Found by driving the app; the tests,
// which build their own objects, were perfectly green throughout.
function detach(entries) {
  const out = {};
  Object.entries(entries || {}).forEach(([id, entry]) => {
    out[id] = { qty: entry?.qty, stock: entry?.stock };
  });
  return out;
}

// How the debounced autosave reports whether it landed. Injected one-way from
// orders-main.js rather than imported, so this module keeps knowing nothing about
// the page around it — and the user-facing wording stays in the UI layer.
export function setDraftSaveReporter(fn) {
  reportSaveResult = fn;
}

// Autosave the draft a short moment after the last change.
//
// The timer is the ONE draft write with no caller to hand a rejection to, so it has
// to catch its own. Without this, a refused write (no network, or a Firestore rule
// rejecting the payload) was an unhandled promise rejection in the console and
// nothing else: the operator kept typing an order that was no longer being saved
// anywhere, and a reload would have thrown it all away.
//
// Success is reported too, not just failure: a transient blip must not leave a
// permanent alarm on screen once a later save has carried the same values through.
export function scheduleDraftSave(entries, days) {
  queued = { entries, days };
  // Claim these rows as this phone's until the write lands, so an incoming
  // snapshot during the debounce cannot quietly take the typing away.
  pending = {
    entries: { ...pending.entries, ...changedEntries(entries, known.entries) },
    days: { ...pending.days, ...changedDays(days, known.days) },
  };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDraftNow(entries, days)
      .then(() => reportSaveResult?.(true))
      .catch(err => {
        console.error('Draft autosave failed:', err);
        reportSaveResult?.(false);
      });
  }, SAVE_DELAY_MS);
}

export function saveDraftNow(entries, days) {
  clearTimeout(saveTimer);
  queued = null;

  const entriesDelta = changedEntries(entries, known.entries);
  const daysDelta = changedDays(days, known.days);

  // Nothing this device changed — so nothing to say. Staying quiet here also stops
  // an incoming snapshot from bouncing straight back as a write.
  if (!Object.keys(entriesDelta).length && !Object.keys(daysDelta).length) {
    return Promise.resolve();
  }

  const payload = { updatedAt: new Date().toISOString() };
  if (Object.keys(entriesDelta).length) payload.entries = entriesDelta;
  if (Object.keys(daysDelta).length) payload.days = daysDelta;

  // setDoc(merge) with a PARTIAL map: Firestore merges key by key, so the rows
  // not mentioned here keep whatever anyone else has put there. It also still
  // creates drafts/current on the very first order, which an updateDoc of
  // dotted paths could not.
  return saveDoc(COLLECTIONS.drafts, DRAFT_ID, payload).then(result => {
    known = {
      entries: { ...known.entries, ...entriesDelta },
      days: { ...known.days, ...daysDelta },
    };
    // Release only what was actually sent, and only if it has not been typed
    // over in the meantime — a value changed again while this write was in
    // flight is still this phone's, and must stay claimed.
    Object.entries(entriesDelta).forEach(([id, sent]) => {
      const held = pending.entries[id];
      if (held && held.qty === sent.qty && held.stock === sent.stock) delete pending.entries[id];
    });
    Object.entries(daysDelta).forEach(([id, sent]) => {
      if (pending.days[id] === sent) delete pending.days[id];
    });
    return result;
  });
}

// Write a pending debounced change RIGHT NOW. Always await this before archiving:
// otherwise a quantity typed for ANOTHER supplier less than 800ms earlier is still
// sitting in the timer, the archive's surgical clear does not carry it, and the
// next snapshot quietly reverts it on screen.
export function flushDraftSave() {
  if (!queued) return Promise.resolve();
  return saveDraftNow(queued.entries, queued.days);
}

// Real-time subscription. onChange receives { entries, days, updatedAt, exists }.
// onError is passed straight through: losing this stream means the order stops
// syncing between phones, which nothing on screen would otherwise reveal.
export function watchDraft(onChange, onError) {
  return watchDoc(COLLECTIONS.drafts, DRAFT_ID, doc => {
    // The server's word on the draft becomes the baseline the next autosave
    // measures itself against, so a row someone else changed is not "changed
    // here" and never gets re-asserted at this phone's stale value.
    known = { entries: detach(doc?.entries), days: { ...(doc?.days || {}) } };
    // ...but anything typed here and not yet written goes back ON TOP, or the
    // snapshot would erase it mid-keystroke. See `pending`.
    onChange({
      entries: { ...(doc?.entries || {}), ...pending.entries },
      days: { ...(doc?.days || {}), ...pending.days },
      updatedAt: doc?.updatedAt || '',
      exists: Boolean(doc),
    });
  }, onError);
}

// Record one supplier's order under `date`, and return the stored record (or null
// when there was nothing to order).
//
// A second order to the same supplier on the same day ADDS to the first: the rows
// are cleared once archived, so the second payload only carries the items that
// were forgotten, and replacing would destroy the original order. The read and the
// write are one transaction, so two phones tapping at the same moment cannot lose
// one of the two orders.
export function archiveSupplier({ supplier, ingredients, entries, date, now = new Date() }) {
  const incoming = buildSupplierArchive({ supplier, ingredients, entries, date, now });
  if (!incoming) return Promise.resolve(null);

  return transactDoc(
    COLLECTIONS.history,
    historyDocId(date, supplier.id),
    existing => mergeArchives(existing, incoming),
  );
}

// Remove one supplier's rows (and its day stamp) from the shared draft.
//
// Clears with the UNFILTERED ingredient list on purpose: a quantity left on a
// since-deactivated product is invisible on screen but still in the document, and
// if it were not cleared it would be archived again on every future order.
export function clearSupplier(supplierId, ingredients) {
  const paths = ingredientsOf(supplierId, ingredients, { activeOnly: false })
    .map(ing => `entries.${ing.id}`);
  paths.push(`days.${supplierId}`);

  return clearFields(COLLECTIONS.drafts, DRAFT_ID, paths, {
    updatedAt: new Date().toISOString(),
  }).then(result => {
    forgetKnown(paths);
    return result;
  });
}

// Drop cleared fields from the baseline the autosave compares against.
//
// Without this there is a gap between the clear landing and its snapshot coming
// back in which `known` still holds the old quantity — so retyping that SAME
// number reads as "unchanged" and is never sent. The row would sit on screen
// looking saved while Firestore had nothing.
// ⚠️ It drops the row from `pending` too, and that part is not optional: pending
// rows are re-applied on top of every snapshot, so a quantity left there after
// its order was archived would reappear on screen and be ordered a second time.
function forgetKnown(paths) {
  paths.forEach(path => {
    const [root, id] = path.split('.');
    if (root === 'entries' && id) {
      delete known.entries[id];
      delete pending.entries[id];
    }
    if (root === 'days' && id) {
      delete known.days[id];
      delete pending.days[id];
    }
  });
}

// Throw away the quantities typed for one or more suppliers WITHOUT recording an
// order — the "start this order again" button.
//
// Deliberately NOT clearSupplier: that removes the whole row because the order has
// just been archived and the reading went with it. Here nothing is being recorded,
// so only `qty` goes and the STOCK reading stays: the shelves were counted, and
// that work should not have to be repeated.
//
// One write for every supplier chosen (see quantityPathsFor), so there is no moment
// where half the list is cleared — and clearFields only touches the named paths, so
// whatever another phone is typing for a supplier NOT in the list survives.
//
// ⚠️ orders-history is not touched. Nothing recorded is undone by this.
export function clearQuantities(supplierIds, ingredients) {
  const paths = quantityPathsFor(supplierIds, ingredients);
  if (!paths.length) return Promise.resolve();

  return clearFields(COLLECTIONS.drafts, DRAFT_ID, paths, {
    updatedAt: new Date().toISOString(),
  }).then(result => {
    // These paths are `entries.<id>.qty`, so forgetKnown drops the whole entry
    // from the baseline. Slightly broader than what was cleared, and deliberately
    // so: the stock reading is then simply re-sent unchanged on the next save,
    // which costs one field and cannot lose anything.
    forgetKnown(paths);
    return result;
  });
}

// Rewrite a history record whole (the History editor). Not a merge: the operator
// is correcting the record, so what they see is what it becomes.
export function saveHistoryRecord(id, record) {
  return replaceDoc(COLLECTIONS.history, id, record);
}

export function deleteHistoryRecord(id) {
  return removeDoc(COLLECTIONS.history, id);
}
