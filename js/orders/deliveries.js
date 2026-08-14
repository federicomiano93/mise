// deliveries.js — what has been ordered and has not arrived yet, and what is still
// to re-order because it never came.
//
// PURE: no DOM, no Firestore, so every rule below can be asserted in a test (P15).
//
// ⚠️⚠️ THE WHOLE FEATURE RESTS ON ONE DECISION: THE APP IS TOLD WHAT ARRIVED, IT
// DOES NOT GUESS. A supplier's `deliveryDays` say when a delivery is EXPECTED; they
// are not a record that anything turned up. The obvious cheaper design — drop an
// order off the list once its expected day has passed — fails in the one direction
// that matters: the order nobody delivered would be the only one you never see, and
// the screen would look perfectly healthy, empty. So an order leaves this list when
// somebody says it arrived, and never on its own.
//
// The second decision, Federico's, 14 Aug 2026: an ingredient that did not arrive is
// MARKED, never removed from the order. `orders-history.quantities` is the same map
// the suggestion engine averages over, so deleting from it would quietly change what
// the app suggests for months — and it would also destroy the evidence that the thing
// was ordered at all, which is exactly what you need to chase a supplier.

import { recordDate, isLegacyRecord, wholeNumber } from './archive.js';
import { parseISODate, toISODate, addDays, isBefore, weekdayOf } from './day.js';

// How far ahead "coming" reaches. Beyond this an order is still pending, it is
// simply not shown as imminent.
export const AHEAD_DAYS = 7;

// How far forward to look for a supplier's next delivery day before giving up.
// Two weeks covers every weekly rhythm; a supplier that declares no days at all is
// answered with '' by the loop never matching.
const MAX_LOOKAHEAD = 14;

// Has somebody said this order arrived?
//
// ⚠️ ANY NON-EMPTY STAMP COUNTS AS DELIVERED, and an unreadable one counts as NOT
// delivered. The two directions are deliberate opposites: a corrupt value must leave
// the order on the list (visible, correctable) rather than making it disappear.
export function isDelivered(order) {
  return typeof order?.deliveredAt === 'string' && order.deliveredAt.trim() !== '';
}

// The ingredient ids that were ordered and did not arrive.
//
// ⚠️ INTERSECTED WITH `quantities`, NOT READ FROM `missing` ALONE. A `missing` entry
// for something the order never contained is meaningless — and would put a phantom
// row on the "still to re-order" list that no amount of ordering could clear.
export function shortfall(order) {
  const missing = order?.missing || {};
  const quantities = order?.quantities || {};
  return Object.keys(missing)
    .filter(id => missing[id] === true && wholeNumber(quantities[id]) > 0)
    .sort();
}

// When this order is expected, from the supplier's own declared delivery days.
//
// ⚠️ STRICTLY AFTER THE ORDER DATE. Ordering on a delivery day means the NEXT one:
// what is on today's van was decided before today's order existed.
//
// ⚠️ A SUPPLIER THAT DECLARES NO DELIVERY DAYS GETS '', AND THAT IS NOT AN ERROR —
// it means "we do not know", and the caller must still show the order. Treating an
// unknown date as "no delivery" would hide exactly the suppliers nobody has finished
// setting up.
export function expectedDeliveryOn(order, supplier) {
  const from = recordDate(order);
  const days = supplier?.deliveryDays;
  if (!from || !Array.isArray(days) || !days.length) return '';

  const start = parseISODate(from);
  for (let i = 1; i <= MAX_LOOKAHEAD; i++) {
    const iso = toISODate(addDays(start, i));
    if (days.includes(weekdayOf(iso))) return iso;
  }
  return '';
}

// Everything ordered and not yet confirmed, in the order the screen shows it.
//
//   { late: [...], dueToday: [...], coming: [...] }
//
// Each entry is { order, supplier, expected } — `expected` may be ''.
//
// ⚠️⚠️ `late` IS UNBOUNDED IN THE PAST, ON PURPOSE. Everything else here is a
// window; this is not. An order whose expected day went by three weeks ago and was
// never confirmed is the single most important row on the screen, and any window at
// all would eventually swallow it. It is also why `late` is listed FIRST.
//
// ⚠️ AN ORDER WITH NO EXPECTED DATE IS NEVER "late" — we do not know that it is. It
// sits at the end of `coming`, visible, waiting for somebody to confirm it.
export function pendingDeliveries(orders, suppliersById, today, { aheadDays = AHEAD_DAYS } = {}) {
  const out = { late: [], dueToday: [], coming: [] };
  if (!today) return out;

  const horizon = toISODate(addDays(parseISODate(today), aheadDays));

  (orders || []).forEach(order => {
    // The pre-v179 weekly records merged every supplier into one document, so they
    // cannot name a delivery. They stay readable in History and are not deliveries.
    if (!order || isLegacyRecord(order) || isDelivered(order)) return;

    const supplier = suppliersById?.[order.supplierId] || null;
    const expected = expectedDeliveryOn(order, supplier);
    const entry = { order, supplier, expected };

    if (!expected) { out.coming.push(entry); return; }
    if (isBefore(expected, today)) out.late.push(entry);
    else if (expected === today) out.dueToday.push(entry);
    else if (!isBefore(horizon, expected)) out.coming.push(entry);
    else out.coming.push(entry);
  });

  const byExpected = (a, b) => String(a.expected || '￿').localeCompare(String(b.expected || '￿'));
  out.late.sort(byExpected);
  out.dueToday.sort(byExpected);
  out.coming.sort(byExpected);
  return out;
}

// Everything that did not arrive and has not been dealt with since.
//
//   -> [{ id, supplierId, qty, missedOn }]
//
// ⚠️⚠️ IT IS DERIVED, NOT STORED, AND THAT IS WHAT MAKES IT SAFE. There is no "I
// have re-ordered this" flag to set, so there is nothing that can be left switched on
// by a failed write and nothing that can disagree with the orders themselves. Same
// reasoning as the pastry lock, where "is tonight's list done?" needed no flag: a
// record either exists or it does not.
//
// An ingredient drops off when EITHER
//   * a later order to the same supplier asked for it again, or
//   * it already has a quantity in the order being typed right now.
//
// ⚠️ THE SECOND ONE IS WHY THE BANNER GOES QUIET THE MOMENT THE WORK IS DONE, rather
// than waiting until that order is placed. Without it, "put it back in the order"
// would leave its own reminder on screen, and a reminder that survives the action it
// asked for is one people learn to ignore.
export function stillToReorder(history, draftEntries) {
  const records = (history || []).filter(r => r && !isLegacyRecord(r));
  const out = [];

  records.forEach(record => {
    const missedOn = recordDate(record);
    const supplierId = record.supplierId;

    shortfall(record).forEach(id => {
      // Asked for again, later, from the same supplier?
      const reordered = records.some(other =>
        other.supplierId === supplierId &&
        isBefore(missedOn, recordDate(other)) &&
        wholeNumber(other.quantities?.[id]) > 0);
      if (reordered) return;

      // Already in the order being typed?
      if (wholeNumber(draftEntries?.[id]?.qty) > 0) return;

      out.push({
        id,
        supplierId,
        qty: wholeNumber(record.quantities?.[id]),
        missedOn,
      });
    });
  });

  // Newest first: the thing that has just failed to turn up is the thing being
  // thought about. Ties broken by id so two repaints never swap two rows.
  return out.sort((a, b) =>
    String(b.missedOn).localeCompare(String(a.missedOn)) || String(a.id).localeCompare(String(b.id)));
}

// What "put it back in the order" would actually do, decided here rather than in the
// screen so it can be tested and so the refusal is a value, not a silence.
//
//   -> { applied: [{id, qty}], skipped: [{id, qty, existing}] }
//
// ⚠️⚠️ A ROW THAT ALREADY HAS A QUANTITY IS NEVER OVERWRITTEN. The order is shared and
// live: that number was typed by a person, possibly seconds ago on another phone and
// possibly mid-keystroke. Replacing it would change somebody's order under their
// hands, silently. It is skipped and REPORTED, so the screen can say so — a skip
// nobody is told about is the same defect wearing a quieter hat.
export function applyReorder(items, draftEntries) {
  const applied = [];
  const skipped = [];

  (items || []).forEach(item => {
    if (!item?.id) return;
    const existing = wholeNumber(draftEntries?.[item.id]?.qty);
    if (existing > 0) skipped.push({ id: item.id, qty: item.qty, existing });
    else applied.push({ id: item.id, qty: wholeNumber(item.qty) });
  });

  return { applied, skipped };
}
