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
} from './archive.js';

const DRAFT_ID = 'current';
const SAVE_DELAY_MS = 800; // debounce to limit Firestore writes (cost control)

let saveTimer = null;
let queued = null;         // the change waiting for the debounce, so it can be flushed
let reportSaveResult = null;   // (ok: boolean) => void — injected by orders-main.js

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
// Success is reported too, not just failure. Every save sends the WHOLE entries map,
// so one success genuinely persists everything a failed write was carrying — which
// means a transient blip must not leave a permanent alarm on screen.
export function scheduleDraftSave(entries, days) {
  queued = { entries, days };
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
  return saveDoc(COLLECTIONS.drafts, DRAFT_ID, {
    entries,
    days,
    updatedAt: new Date().toISOString(),
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
export function watchDraft(onChange) {
  return watchDoc(COLLECTIONS.drafts, DRAFT_ID, doc => onChange({
    entries: doc?.entries || {},
    days: doc?.days || {},
    updatedAt: doc?.updatedAt || '',
    exists: Boolean(doc),
  }));
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
