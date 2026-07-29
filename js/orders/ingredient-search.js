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

// Ingredients that belong to one of the given suppliers, A→Z by displayed label.
//
// An ingredient whose supplier is not in the list is left OUT, exactly as the
// by-supplier view leaves it out: that is how a DEACTIVATED supplier's products
// stay hidden. Callers pass the resolved supplier list (no-supplier.js), so
// "belongs to nobody" is already "belongs to No supplier" by the time we get here.
//
// Returns { rows, total }: `total` is everything orderable, `rows` only what the
// search left standing — the counter needs both to say "12 of 65".
export function flatRows({ ingredients, suppliers, query }) {
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

  const rows = all.filter(row => matchesQuery(row, query));

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
