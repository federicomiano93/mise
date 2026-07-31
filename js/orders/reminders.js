// reminders.js — the two things the Orders screen must tell you the moment it
// opens. Pure: no Firestore, no DOM.
//
//   1. todayOrders      — which suppliers are ordered TODAY, and which of them
//                         you have already placed (the record {today}_{supplier}
//                         exists). Before the per-day model there was no way to
//                         know the second half, so this reminder was switched off.
//   2. pendingSuppliers — an order you typed on an earlier day and never marked
//                         as placed. It must be filed under the day it was
//                         WRITTEN, not today, so the day is carried per supplier
//                         in the draft (drafts/current.days).

import { isBefore, weekdayOf } from './day.js';
import { ingredientsOf, supplierHasItems } from './archive.js';

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

// The suppliers an order was already recorded for on `today`.
//
// One definition of "already ordered", used by the Orders screen (which ticks them
// off) AND by the Home badge (which must not count them). Two copies of this would
// drift, and the drift would show as the Home nagging about an order the Orders
// screen has already ticked off.
export function placedOn(history, today) {
  return new Set(
    (history || [])
      .filter(r => r.date === today && r.supplierId)
      .map(r => r.supplierId),
  );
}

// The suppliers still waiting for an order today: everything except what has already
// been recorded. Left deliberately unfiltered by weekday — the caller decides whether
// it cares about order days (computeAlerts does).
export function suppliersStillToOrder(suppliers, history, today) {
  const placed = placedOn(history, today);
  return (suppliers || []).filter(s => !placed.has(s.id));
}

// Suppliers whose ORDER day is today → [{ supplier, placed }], sorted by name.
// `placed` is true once an order for that supplier exists under today's date.
export function todayOrders({ suppliers, history, today }) {
  if (!today) return [];
  const weekday = weekdayOf(today);

  const placed = placedOn(history, today);

  return (suppliers || [])
    .filter(s => s.active !== false && (s.orderDays || []).includes(weekday))
    .sort(byName)
    .map(supplier => ({ supplier, placed: placed.has(supplier.id) }));
}

// Suppliers carrying quantities typed on an EARLIER day and never placed →
// [{ supplier, day, itemCount }], oldest first.
//
// `days` is the draft's per-supplier stamp. A draft written before this feature
// existed has no stamp at all, so `fallbackDay` (the local day of the draft's own
// updatedAt) stands in — otherwise the very orders this is meant to rescue would
// be the only ones it could not see. A supplier that has been deleted or
// deactivated is ignored: its stamp can linger forever and nagging about rows
// nobody can see would never stop.
export function pendingSuppliers({ suppliers, ingredients, entries, days, fallbackDay, today }) {
  if (!today) return [];

  return (suppliers || [])
    .filter(s => s.active !== false)
    .map(supplier => {
      const day = days?.[supplier.id] || fallbackDay || '';
      if (!isBefore(day, today)) return null;
      if (!supplierHasItems(supplier.id, ingredients, entries)) return null;

      const itemCount = ingredientsOf(supplier.id, ingredients)
        .filter(i => (Number(entries?.[i.id]?.qty) || 0) > 0).length;

      return { supplier, day, itemCount };
    })
    .filter(Boolean)
    .sort((a, b) => a.day.localeCompare(b.day) || byName(a.supplier, b.supplier));
}
