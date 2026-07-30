// ingredient-search.js — the rows behind the "All ingredients" view. PURE: no DOM,
// no Firestore, so it can be asserted in a unit test instead of read back out of
// rendered markup (P15) — the same reason archive.js, reminders.js and day.js exist.
//
// The view it feeds answers one question the by-supplier screen cannot: "where do I
// type the Bacon?" — without already knowing that Bacon comes from Brakes. With 6
// suppliers and 65 ingredients that meant opening and closing cards until it turned
// up.
//
// There is no second list of quantities anywhere: entries are keyed by INGREDIENT
// ({ id: { qty, stock } }), so the flat list and the supplier cards are two windows
// onto the same data. Typing 4 on Bacon here IS typing 4 in Brakes' order.

import { itemLabel } from './order-text.js';

// Everything NFD splits an accent into: "è" becomes "e" + a combining grave.
const COMBINING_MARKS = /[̀-ͯ]/g;

// Lower-cased and stripped of accents, so "però" is found by typing "pero" and
// "Sale" by typing "sale". Used for BOTH sides of every comparison.
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

// The letter a row is filed under. Anything not a letter — a number, a symbol —
// goes under "#" rather than inventing a divider per character.
export function letterOf(label) {
  const first = normalizeText(label).charAt(0);
  return first >= 'a' && first <= 'z' ? first.toUpperCase() : '#';
}

// Does this row match what was typed? Name, weight, brand AND supplier name, so
// "salvo" lists everything bought from Salvo and "no supplier" everything bought
// without one — which is the point of having the search at all.
export function matchesQuery(row, query) {
  const q = normalizeText(query);
  if (!q) return true;
  return [row.label, row.ingredient?.brand, row.supplierName]
    .some(field => normalizeText(field).includes(q));
}

// The suppliers matching what was typed, in the order they were given.
//
// Name and category, because those are the two things the supplier row shows — a
// search that matches something invisible reads as a bug. Typing "no supplier" finds
// the pseudo-supplier, the same as in the ingredient list.
//
// It does NOT look inside a supplier's ingredients: "where do I find Bacon" is what
// the All-ingredients view is for, and answering it here too would make two searches
// that behave almost-but-not-quite the same.
export function filterSuppliers(suppliers, query) {
  const q = normalizeText(query);
  if (!q) return (suppliers || []).slice();

  return (suppliers || []).filter(s =>
    [s?.name, s?.category].some(field => normalizeText(field).includes(q)));
}

// Ingredients that belong to one of the given suppliers, A→Z by displayed label.
//
// An ingredient whose supplier is not in the list is left OUT, exactly as the
// by-supplier view leaves it out: that is how a DEACTIVATED supplier's products
// stay hidden. Callers pass the resolved supplier list (no-supplier.js), so
// "belongs to nobody" is already "belongs to No supplier" by the time we get here.
//
// `only` is an optional Set of ingredient ids — the "just what I'm ordering" filter.
// It is a FROZEN set, decided by the caller when the filter is entered, never
// recomputed from the quantities: if it were, typing 0 into a row would delete that
// row from under the finger correcting it.
//
// Returns { rows, total }: `total` is everything orderable, `rows` only what the
// filter and the search left standing — the counter needs both to say "12 of 65".
export function flatRows({ ingredients, suppliers, query, only }) {
  const byId = new Map((suppliers || []).map(s => [s.id, s]));

  const all = (ingredients || [])
    .filter(ing => ing.active !== false && byId.has(ing.supplierId))
    .map(ing => ({
      ingredient: ing,
      supplier: byId.get(ing.supplierId),
      supplierName: byId.get(ing.supplierId).name || '',
      label: itemLabel(ing.name, ing.weight),
    }))
    // By label, then by id: without the tie-break two products with identical
    // labels could swap places between repaints and the rows would jump.
    .sort((a, b) =>
      a.label.localeCompare(b.label)
      || String(a.ingredient.id).localeCompare(String(b.ingredient.id)));

  const rows = all
    .filter(row => !only || only.has(row.ingredient.id))
    .filter(row => matchesQuery(row, query));

  // The letter is carried on the FIRST row of each run only, so the view can draw a
  // divider without re-deriving where the groups start. It is computed after
  // filtering: a search that leaves only Mozzarella must show an "M", not a stale "A".
  let previous = null;
  rows.forEach(row => {
    const letter = letterOf(row.label);
    row.letter = letter === previous ? '' : letter;
    previous = letter;
  });

  return { rows, total: all.length };
}

// What is currently being ordered, across every supplier → { itemCount,
// supplierCount, ids }.
//
// The problem it solves: with 65 ingredients the typed quantities are SCATTERED —
// inside closed supplier cards in one view, among 65 rows in the other — and there is
// nowhere that says "this is the whole order".
//
// Only rows with a real, positive quantity count. A corrupt stored value ("4 " from a
// bad write, or NaN) counts as nothing rather than poisoning the total — the same
// defensive reading computeSuggestion had to adopt in v1.11.0.
export function orderSummary({ ingredients, suppliers, entries }) {
  const known = new Set((suppliers || []).map(s => s.id));
  const ids = [];
  const suppliersUsed = new Set();

  (ingredients || []).forEach(ing => {
    if (ing.active === false || !known.has(ing.supplierId)) return;
    const qty = Number(entries?.[ing.id]?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    ids.push(ing.id);
    suppliersUsed.add(ing.supplierId);
  });

  return { itemCount: ids.length, supplierCount: suppliersUsed.size, ids };
}
