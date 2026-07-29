// Unit tests for the "All ingredients" view's pure core (P15 — the owner cannot
// read code, so these tests are the safety net).
//
//   no-supplier.js       — where an ingredient without a (living) supplier belongs.
//   ingredient-search.js — the flat, searchable, A→Z row list.
//
// Both are pure, which is the whole reason they were split out of the view: the
// alternative is asserting on rendered markup, and the defects that nearly shipped
// in v1.9.0 all lived in the layer that could not be tested.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_SUPPLIER_ID, NO_SUPPLIER, isNoSupplier, resolveSuppliers, orderSuppliers,
} from '../js/orders/no-supplier.js';
import { normalizeText, letterOf, matchesQuery, flatRows } from '../js/orders/ingredient-search.js';

const SALVO = { id: 'salvo', name: 'Salvo', active: true };
const BRAKES = { id: 'brakes', name: 'Brakes', active: true };
const SUPPLIERS = [BRAKES, SALVO];

const BACON = { id: 'bacon', name: 'Bacon', weight: '2.27kg', brand: 'Denny', supplierId: 'brakes' };
const MOZZARELLA = { id: 'mozza', name: 'Mozzarella', weight: '5kg', supplierId: 'salvo' };
const ALMONDS = { id: 'almonds', name: 'Almond Flakes', weight: '1kg', supplierId: 'salvo' };
const PAPER = { id: 'paper', name: 'Baking Paper', supplierId: NO_SUPPLIER_ID };
const GONE = { id: 'gone', name: 'Ghost Item', supplierId: 'deleted-supplier' };
const RETIRED = { id: 'retired', name: 'Old Stock', supplierId: 'salvo', active: false };

// ── no-supplier: where an ingredient belongs ─────────────────────────────────

test('the pseudo-supplier has no order days, so it never joins "order today"', () => {
  assert.equal(NO_SUPPLIER.id, NO_SUPPLIER_ID);
  assert.equal(NO_SUPPLIER.name, 'No supplier');
  assert.deepEqual(NO_SUPPLIER.orderDays, []);
  assert.ok(isNoSupplier(NO_SUPPLIER_ID));
  assert.ok(!isNoSupplier('salvo'));
});

test('an ingredient whose supplier was DELETED is filed under No supplier', () => {
  const resolved = resolveSuppliers([BACON, GONE], SUPPLIERS, true);
  assert.equal(resolved.find(i => i.id === 'bacon').supplierId, 'brakes');
  assert.equal(resolved.find(i => i.id === 'gone').supplierId, NO_SUPPLIER_ID);
});

test('an ingredient saved WITHOUT a supplier stays under No supplier', () => {
  const resolved = resolveSuppliers([PAPER], SUPPLIERS, true);
  assert.equal(resolved[0].supplierId, NO_SUPPLIER_ID);
});

// The trap: suppliers and ingredients arrive in separate Firestore snapshots.
test('nothing is reclassified until the suppliers have actually arrived', () => {
  const resolved = resolveSuppliers([BACON, MOZZARELLA], [], false);
  assert.deepEqual(resolved.map(i => i.supplierId), ['brakes', 'salvo']);
  // …and the stored objects are handed back untouched, not copied and rewritten.
  assert.equal(resolved[0], BACON);
});

test('resolving never mutates the stored ingredient', () => {
  const resolved = resolveSuppliers([GONE], SUPPLIERS, true);
  assert.equal(GONE.supplierId, 'deleted-supplier');
  assert.notEqual(resolved[0], GONE);
});

test('No supplier appears only when something is filed under it, and always last', () => {
  const withNone = orderSuppliers([BRAKES, SALVO], resolveSuppliers([BACON, PAPER], SUPPLIERS, true));
  assert.deepEqual(withNone.map(s => s.name), ['Brakes', 'Salvo', 'No supplier']);

  const withoutNone = orderSuppliers([BRAKES, SALVO], resolveSuppliers([BACON], SUPPLIERS, true));
  assert.deepEqual(withoutNone.map(s => s.name), ['Brakes', 'Salvo']);
});

test('a DEACTIVATED no-supplier ingredient does not conjure up the card', () => {
  const hidden = { id: 'hidden', name: 'Hidden', supplierId: NO_SUPPLIER_ID, active: false };
  assert.deepEqual(orderSuppliers([SALVO], [hidden]).map(s => s.name), ['Salvo']);
});

// ── normalizeText / letterOf ─────────────────────────────────────────────────

test('text is compared without accents or capitals', () => {
  assert.equal(normalizeText('  Però  '), 'pero');
  assert.equal(normalizeText('ÀÈÌÒÙ'), 'aeiou');
  assert.equal(normalizeText(null), '');
});

test('a row is filed under its first letter; anything else under #', () => {
  assert.equal(letterOf('Bacon 2.27kg'), 'B');
  assert.equal(letterOf('Èspresso'), 'E');
  assert.equal(letterOf('00 Flour'), '#');
  assert.equal(letterOf(''), '#');
});

// ── matchesQuery ─────────────────────────────────────────────────────────────

const ROW = { label: 'Bacon 2.27kg', ingredient: { brand: 'Denny' }, supplierName: 'Brakes' };

test('an empty search matches everything', () => {
  assert.ok(matchesQuery(ROW, ''));
  assert.ok(matchesQuery(ROW, '   '));
});

test('the search looks at name, weight, brand and supplier', () => {
  assert.ok(matchesQuery(ROW, 'bac'));       // name
  assert.ok(matchesQuery(ROW, '2.27'));      // weight, part of the label
  assert.ok(matchesQuery(ROW, 'denny'));     // brand
  assert.ok(matchesQuery(ROW, 'BRAKES'));    // supplier, any case
  assert.ok(!matchesQuery(ROW, 'salvo'));
});

// ── flatRows ─────────────────────────────────────────────────────────────────

const ALL = [BACON, MOZZARELLA, ALMONDS, PAPER, GONE, RETIRED];

function rowsFor(query) {
  const ingredients = resolveSuppliers(ALL, SUPPLIERS, true);
  const suppliers = orderSuppliers([BRAKES, SALVO], ingredients);
  return flatRows({ ingredients, suppliers, query });
}

test('every orderable ingredient, A→Z by the label the operator reads', () => {
  const { rows, total } = rowsFor('');
  assert.deepEqual(rows.map(r => r.label), [
    'Almond Flakes 1kg', 'Bacon 2.27kg', 'Baking Paper', 'Ghost Item', 'Mozzarella 5kg',
  ]);
  assert.equal(total, 5);   // "Old Stock" is deactivated and does not count
});

test('a deactivated ingredient is left out entirely', () => {
  assert.ok(!rowsFor('').rows.some(r => r.ingredient.id === 'retired'));
  assert.ok(!rowsFor('old stock').rows.length);
});

test('an ingredient of a DEACTIVATED supplier is hidden, exactly as on the cards', () => {
  const ingredients = resolveSuppliers([BACON, MOZZARELLA], SUPPLIERS, true);
  const { rows, total } = flatRows({ ingredients, suppliers: [SALVO], query: '' });
  assert.deepEqual(rows.map(r => r.label), ['Mozzarella 5kg']);
  assert.equal(total, 1);
});

test('the letter is carried by the FIRST row of each run only', () => {
  const { rows } = rowsFor('');
  assert.deepEqual(rows.map(r => r.letter), ['A', 'B', '', 'G', 'M']);
});

test('the letters follow the SEARCH, they are not a stale copy of the full list', () => {
  const { rows } = rowsFor('mozz');
  assert.deepEqual(rows.map(r => r.letter), ['M']);
});

test('searching a supplier name lists what is bought from them', () => {
  assert.deepEqual(rowsFor('salvo').rows.map(r => r.label), ['Almond Flakes 1kg', 'Mozzarella 5kg']);
});

test('searching "no supplier" lists what is bought without one', () => {
  const labels = rowsFor('no supplier').rows.map(r => r.label);
  assert.deepEqual(labels, ['Baking Paper', 'Ghost Item']);
});

test('the counter has both halves: what is shown and what exists', () => {
  const { rows, total } = rowsFor('bak');
  assert.deepEqual(rows.map(r => r.label), ['Baking Paper']);
  assert.equal(total, 5);
});

test('each row carries the supplier it is filed under, for the line under the name', () => {
  const byId = Object.fromEntries(rowsFor('').rows.map(r => [r.ingredient.id, r.supplierName]));
  assert.equal(byId.bacon, 'Brakes');
  assert.equal(byId.paper, 'No supplier');
  assert.equal(byId.gone, 'No supplier');
});

test('nothing at all does not throw', () => {
  assert.deepEqual(flatRows({ ingredients: [], suppliers: [], query: '' }), { rows: [], total: 0 });
  assert.deepEqual(flatRows({}), { rows: [], total: 0 });
});
