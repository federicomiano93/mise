// archive.js — turning a draft into history records. Pure: no Firestore here.
//
// An order is one DAY and one SUPPLIER: orders-history/{YYYY-MM-DD}_{supplierId}.
// Marking Salvo as placed must not touch the quantities already typed for the
// supplier you order on Thursday, so every function below works on ONE supplier's
// slice of the shared draft.
//
// The field names `quantities` and `stock` are deliberately unchanged from the
// old weekly model: the legacy weekly documents (one per ISO week, all suppliers
// merged) stay readable by both the history view and the suggestion engine, so
// nothing had to be migrated.

import { toISODate, addDays, isBefore } from './day.js';

const num = v => Math.max(0, Math.round(Number(v) || 0));

export function historyDocId(date, supplierId) {
  return `${date}_${supplierId}`;
}

// A record written by the old weekly model has no supplierId.
export function isLegacyRecord(record) {
  return !record?.supplierId;
}

// The day a record belongs to, whichever model wrote it.
export function recordDate(record) {
  return record?.date || record?.weekStart || '';
}

// This supplier's ingredients. activeOnly is the right lens for anything the
// operator SEES (counting, nagging); pass false when CLEARING the draft, or a
// quantity left on a since-deactivated ingredient would sit there forever,
// invisible and unclearable.
export function ingredientsOf(supplierId, ingredients, { activeOnly = true } = {}) {
  return (ingredients || []).filter(i =>
    i.supplierId === supplierId && (!activeOnly || i.active !== false));
}

// Does this supplier have anything worth recording? (Stock on its own is not an
// order — see the note in buildSupplierArchive.)
export function supplierHasItems(supplierId, ingredients, entries) {
  return ingredientsOf(supplierId, ingredients).some(i => num(entries?.[i.id]?.qty) > 0);
}

// Build the history payload for ONE supplier out of the shared draft entries.
// Returns null when nothing was ordered — there is no such thing as an empty order.
//
// `quantities` holds ONLY rows with qty > 0, and that is load-bearing: it is the
// map the suggestion engine averages over. A "stock was full so I ordered 0" row
// has a HIGH level (stock + 0) and there is no matching downward pull, so
// recording it would ratchet the par level up week after week. `stock` may hold
// the reading for any filled-in row; the engine ignores rows absent from
// `quantities`, so it costs nothing and keeps the raw reading for later.
export function buildSupplierArchive({ supplier, ingredients, entries, date, now = new Date() }) {
  const quantities = {};
  const stock = {};
  const names = {};

  ingredientsOf(supplier.id, ingredients).forEach(ing => {
    const entry = entries?.[ing.id];
    if (!entry) return;
    const qty = num(entry.qty);
    const onHand = num(entry.stock);
    if (qty > 0) {
      quantities[ing.id] = qty;
      names[ing.id] = ingredientLabel(ing);
    }
    if (qty > 0 || onHand > 0) stock[ing.id] = onHand;
  });

  if (!Object.keys(quantities).length) return null;

  const timestamp = now.toISOString();
  return {
    date,
    supplierId: supplier.id,
    supplierName: supplier.name || '',
    quantities,
    stock,
    // What each item was CALLED on the day. The screen prefers the live ingredient
    // (a rename should show through everywhere), so this is only read once the
    // ingredient is gone — and then it is the only thing standing between a past
    // order and a row of raw document ids. Same reasoning as supplierName, which has
    // been frozen into the record since the per-day model.
    names,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// The label an order shows for an ingredient: "Bacon 2.27kg". One definition, so a
// name frozen into a record matches what the live row would have shown.
export function ingredientLabel(ing) {
  return [ing?.name, ing?.weight].filter(Boolean).join(' ');
}

// What a PAST order calls one of its items, in order of preference:
//   1. the ingredient as it is called NOW — a rename must show through everywhere;
//   2. the name frozen into the record when the order was placed;
//   3. an honest placeholder.
// Never the raw document id, which is what the screen used to fall back to: an order
// reading "Fdx92kQ1: 4" tells nobody what was bought, and the whole point of History
// is answering exactly that.
export function recordedName(id, ingredientsById, names) {
  const live = ingredientLabel(ingredientsById?.[id]);
  if (live) return live;
  const stored = names?.[id];
  return typeof stored === 'string' && stored.trim() ? stored.trim() : 'Deleted ingredient';
}

// The draft fields to delete when the operator throws away what they have typed
// for one or more suppliers, WITHOUT recording an order.
//
// Two things make this different from clearSupplier above, and both were asked for:
//   * only `entries.<id>.qty` goes, never the whole row — so the STOCK reading
//     survives. Counting the shelves is work already done, and starting the order
//     again should not mean counting them again.
//   * several suppliers in one list, so the whole thing is ONE Firestore write with
//     no half-cleared state in between (P14 as well: one operation, not N).
//
// The day stamp goes with the quantities: `days.<supplierId>` records when those
// rows were typed, and with nothing left to order it would describe nothing.
//
// ⚠️ NOTHING HERE TOUCHES orders-history. Clearing the draft is not the same as
// deleting an order: anything already recorded stays recorded, and the suggestion
// engine — which reads only the history — is unaffected.
//
// ⚠️ Uses the UNFILTERED ingredient list, exactly like clearSupplier: a quantity
// left on a since-deactivated product is invisible on screen but still in the
// document, and skipping it would leave a row nobody can see or clear.
export function quantityPathsFor(supplierIds, ingredients) {
  const ids = (supplierIds || []).filter(Boolean);
  const paths = [];
  ids.forEach(supplierId => {
    ingredientsOf(supplierId, ingredients, { activeOnly: false })
      .forEach(ing => paths.push(`entries.${ing.id}.qty`));
    paths.push(`days.${supplierId}`);
  });
  return paths;
}

// Two orders to the same supplier on the same day are ONE order: the second is
// "I forgot a couple of things", so quantities ADD UP rather than replace (which
// would silently destroy the first order — the rows are cleared after archiving,
// so the second payload only ever carries the forgotten items). The stock reading
// is a measurement, not a total: the newer one wins.
export function mergeArchives(existing, incoming) {
  if (!existing) return incoming;

  const quantities = { ...(existing.quantities || {}) };
  Object.entries(incoming.quantities || {}).forEach(([id, qty]) => {
    quantities[id] = num(quantities[id]) + num(qty);
  });

  return {
    ...incoming,
    quantities,
    stock: { ...(existing.stock || {}), ...(incoming.stock || {}) },
    // Keep every name the record has ever carried. The incoming write only names the
    // items IT adds, so replacing rather than merging would strip the names off the
    // rows placed earlier in the day — and a phone still on the previous version
    // sends no names at all, which must not erase the ones already stored.
    names: { ...(existing.names || {}), ...(incoming.names || {}) },
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: incoming.updatedAt,
  };
}

// Split day sections (the output of groupHistoryByDay) into the ones History shows
// straight away and the ones parked behind "Show older orders".
//
// This HIDES, it never deletes: `older` is returned, not dropped, and the suggestion
// engine reads the raw records rather than this split — so narrowing the window can
// never change a suggested quantity. That separation is the whole safety of the
// feature: an ingredient ordered weekly needs 4 past orders before suggestions turn
// on (suggestions.js), which a 15-day window would never accumulate.
//
// The window INCLUDES today: 15 days means today and the 14 before it. The boundary
// is computed once with addDays (DST-safe — see day.js), and the per-record test is a
// string compare on "YYYY-MM-DD", which is exact.
//
// An unusable window shows EVERYTHING rather than nothing: normalizeOrdersConfig has
// already applied the default, so anything wrong reaching here means the assumption
// failed somewhere, and the safe failure is a long list, never an empty one.
export function splitHistoryByAge(days, historyDays, now = new Date()) {
  const list = days || [];
  const window = Math.floor(Number(historyDays));
  if (!Number.isFinite(window) || window < 1) return { recent: list, older: [] };

  const cutoff = toISODate(addDays(now, -(window - 1)));
  return {
    recent: list.filter(d => !isBefore(d.date, cutoff)),
    older: list.filter(d => isBefore(d.date, cutoff)),
  };
}

// How many ORDERS sit in a set of day sections — what "Show older orders (N)" counts.
// Days are the sections; the operator thinks in orders.
export function countRecords(days) {
  return (days || []).reduce((total, d) => total + (d.records?.length || 0), 0);
}

// Group history records into day sections, most recent day first, and within a
// day by supplier name. Legacy weekly records land under their weekStart.
export function groupHistoryByDay(history) {
  const byDay = new Map();

  (history || []).forEach(record => {
    const date = recordDate(record);
    if (!date) return;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(record);
  });

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, records]) => ({
      date,
      records: records.slice().sort((a, b) =>
        String(a.supplierName || '').localeCompare(String(b.supplierName || ''))),
    }));
}
