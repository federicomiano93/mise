// no-supplier.js — the pseudo-supplier for things bought without one. PURE.
//
// Plenty of what the bakery buys has no supplier: the supermarket, the cash &
// carry, the shop down the road. Those are ordinary ingredients and must behave
// like ordinary ingredients — same card, same row, same order flow.
//
// But the whole order flow is keyed by supplier: the draft stamps a day per
// supplier, an order is archived as orders-history/{day}_{supplierId}, the
// tick-lists are lists of suppliers. So "no supplier" needs a supplier to belong
// to, and it gets a fake one.
//
// It is NEVER written to the `suppliers` collection — it lives only in the page's
// memory, assembled here on every render. What DOES reach Firestore is the string
// 'no-supplier' as an ingredient's supplierId and as half of a history document id
// ("2026-07-29_no-supplier"). Both were checked against firestore.rules: a
// non-empty supplierId string and the "YYYY-MM-DD_<anything>" id pattern. No rules
// change, no rules deploy.

export const NO_SUPPLIER_ID = 'no-supplier';

// Frozen: it is handed to the same code that handles real suppliers, and a single
// shared object that anything could quietly mutate would be a very confusing bug.
export const NO_SUPPLIER = Object.freeze({
  id: NO_SUPPLIER_ID,
  name: 'No supplier',
  category: '',
  deliveryDays: Object.freeze([]),
  // No order days on purpose: these things are bought when you happen to pass the
  // shop, so they must never appear in the "order these today" reminder. They DO
  // appear in the "left over from an earlier day" one — that is a safety net and
  // has to catch everything.
  orderDays: Object.freeze([]),
  active: true,
});

export function isNoSupplier(supplierId) {
  return supplierId === NO_SUPPLIER_ID;
}

// Every ingredient's supplierId resolved against the suppliers that actually
// exist. Anything pointing nowhere — deliberately saved as 'no-supplier', or
// orphaned because its supplier was deleted — comes back filed under the
// pseudo-supplier.
//
// This is the ONE place that decides an ingredient's supplier. Everything
// downstream (which card it sits on, which order it is archived into, which rows
// are cleared afterwards) reads the resolved value, so those three can never
// disagree — which is exactly what would happen if the flat list merely DREW
// orphans under "No supplier" while the order flow still went by the stored id.
//
// `suppliersLoaded` is not optional. Suppliers and ingredients arrive from
// Firestore in separate snapshots, and before the supplier one lands every single
// supplier is "missing": resolving then would flash all 65 ingredients as
// "No supplier" for a frame. Untouched list until the suppliers are really in.
export function resolveSuppliers(ingredients, suppliers, suppliersLoaded) {
  const list = ingredients || [];
  if (!suppliersLoaded) return list;

  const known = new Set((suppliers || []).map(s => s.id));
  return list.map(ing =>
    known.has(ing.supplierId) ? ing : { ...ing, supplierId: NO_SUPPLIER_ID });
}

// The suppliers the order screen works with: the real active ones (already sorted
// by the caller) plus the pseudo-supplier, appended LAST so it reads as the
// leftovers bucket it is rather than sorting itself in among the N's.
//
// It only appears when something is actually filed under it — an empty
// "No supplier" card on every screen would be noise.
export function orderSuppliers(activeSuppliers, resolvedIngredients) {
  const used = (resolvedIngredients || []).some(
    i => i.supplierId === NO_SUPPLIER_ID && i.active !== false);
  const list = (activeSuppliers || []).slice();
  if (used) list.push(NO_SUPPLIER);
  return list;
}
