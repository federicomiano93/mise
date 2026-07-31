// Unit tests for turning a draft into history records (P15 — the owner cannot
// read code, so these tests are the safety net).
//
// What must never break:
//   - marking one supplier as placed must not touch another supplier's rows;
//   - the order is filed under the day it was PLACED, not blindly under today;
//   - a second order to the same supplier on the same day ADDS to the first
//     (replacing it would destroy the first order, because the rows are cleared
//     after archiving and the second payload only carries the forgotten items);
//   - a "stock was full, ordered 0" row must NOT be recorded as an order, or the
//     suggested par level ratchets upward forever;
//   - the one legacy weekly record still parses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyDocId, isLegacyRecord, recordDate, ingredientsOf, supplierHasItems,
  buildSupplierArchive, mergeArchives, groupHistoryByDay, splitHistoryByAge, countRecords,
  recordedName, ingredientLabel,
} from '../js/orders/archive.js';

const SALVO = { id: 'salvo', name: 'Salvo' };
const BAKO = { id: 'bako', name: 'Bako' };

const INGREDIENTS = [
  { id: 'flour', name: 'Flour uniqua blue', supplierId: 'salvo' },
  { id: 'semola', name: 'Semola', supplierId: 'salvo' },
  { id: 'oldbag', name: 'Discontinued bag', supplierId: 'salvo', active: false },
  { id: 'nutella', name: 'Nutella 3kg', supplierId: 'bako' },
];

const NOW = new Date(2026, 6, 13, 9, 0);

test('historyDocId is the day and the supplier', () => {
  assert.equal(historyDocId('2026-07-13', 'salvo'), '2026-07-13_salvo');
});

test('ingredientsOf hides deactivated products by default, but can list them all', () => {
  assert.deepEqual(ingredientsOf('salvo', INGREDIENTS).map(i => i.id), ['flour', 'semola']);
  assert.deepEqual(
    ingredientsOf('salvo', INGREDIENTS, { activeOnly: false }).map(i => i.id),
    ['flour', 'semola', 'oldbag'],
  );
});

test('supplierHasItems is about ORDERED quantities, not stock readings', () => {
  assert.equal(supplierHasItems('salvo', INGREDIENTS, { flour: { qty: 3, stock: 0 } }), true);
  assert.equal(supplierHasItems('salvo', INGREDIENTS, { flour: { qty: 0, stock: 9 } }), false);
  assert.equal(supplierHasItems('salvo', INGREDIENTS, {}), false);
});

test('the archive holds ONLY that supplier\'s products', () => {
  const entries = {
    flour: { qty: 4, stock: 1 },
    nutella: { qty: 7, stock: 2 }, // another supplier — must not leak in
  };
  const record = buildSupplierArchive({ supplier: SALVO, ingredients: INGREDIENTS, entries, date: '2026-07-13', now: NOW });

  assert.deepEqual(record.quantities, { flour: 4 });
  assert.deepEqual(record.stock, { flour: 1 });
  assert.equal(record.supplierId, 'salvo');
  assert.equal(record.supplierName, 'Salvo'); // frozen: survives a rename or a delete
  assert.equal(record.date, '2026-07-13');
  assert.equal(record.createdAt, NOW.toISOString());
});

test('the archive uses the day it is GIVEN, so a forgotten order files under its own day', () => {
  const record = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 4, stock: 0 } },
    date: '2026-07-12', // yesterday — the day the operator actually typed it
    now: NOW,           // ...even though it is being saved today
  });
  assert.equal(record.date, '2026-07-12');
});

test('a row with stock but nothing ordered is NOT an order (it would ratchet par upward)', () => {
  const record = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 4, stock: 1 }, semola: { qty: 0, stock: 9 } },
    date: '2026-07-13', now: NOW,
  });
  // The stock reading is kept, but semola is absent from quantities, so the
  // suggestion engine (which filters on quantities) never counts it as an order.
  assert.deepEqual(record.quantities, { flour: 4 });
  assert.deepEqual(record.stock, { flour: 1, semola: 9 });
});

test('an empty order is no order at all', () => {
  assert.equal(buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS, entries: {}, date: '2026-07-13', now: NOW,
  }), null);
  assert.equal(buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 0, stock: 5 } }, date: '2026-07-13', now: NOW,
  }), null);
});

test('junk quantities are clamped, never NaN or negative', () => {
  const record = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: '4.6', stock: -3 }, semola: { qty: 'abc', stock: 'x' } },
    date: '2026-07-13', now: NOW,
  });
  assert.deepEqual(record.quantities, { flour: 5 });
  assert.deepEqual(record.stock, { flour: 0 });
});

test('a second order the same day ADDS to the first — nothing is ever lost', () => {
  const first = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 4, stock: 1 } }, date: '2026-07-13', now: NOW,
  });
  // "I forgot the semola" — and one more bag of flour.
  const second = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 1, stock: 0 }, semola: { qty: 2, stock: 0 } },
    date: '2026-07-13', now: new Date(2026, 6, 13, 15, 0),
  });

  const merged = mergeArchives(first, second);
  assert.deepEqual(merged.quantities, { flour: 5, semola: 2 }); // 4 + 1
  assert.equal(merged.stock.semola, 0);
  assert.equal(merged.createdAt, first.createdAt);              // when the order started
  assert.equal(merged.updatedAt, second.updatedAt);             // when it was last touched
});

test('merging into nothing is just the new order', () => {
  const incoming = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 4, stock: 1 } }, date: '2026-07-13', now: NOW,
  });
  assert.deepEqual(mergeArchives(null, incoming), incoming);
});

test('the newer stock reading wins — a measurement is not a total', () => {
  const existing = { quantities: { flour: 4 }, stock: { flour: 1 } };
  const incoming = { quantities: { flour: 1 }, stock: { flour: 6 } };
  assert.deepEqual(mergeArchives(existing, incoming).stock, { flour: 6 });
});

// ── legacy weekly records ─────────────────────────────────────────────────────

const LEGACY = {
  id: '2026-W28',
  weekStart: '2026-07-06',
  quantities: { flour: 6, nutella: 1 },
  stock: { flour: 4, nutella: 1 },
};

test('the old weekly record is recognised and still has a date', () => {
  assert.equal(isLegacyRecord(LEGACY), true);
  assert.equal(recordDate(LEGACY), '2026-07-06');
  assert.equal(isLegacyRecord({ supplierId: 'salvo', date: '2026-07-13' }), false);
  assert.equal(recordDate({ supplierId: 'salvo', date: '2026-07-13' }), '2026-07-13');
});

test('history groups by day, newest day first, suppliers by name inside a day', () => {
  const groups = groupHistoryByDay([
    { id: '2026-07-13_salvo', date: '2026-07-13', supplierId: 'salvo', supplierName: 'Salvo', quantities: { flour: 1 } },
    LEGACY,
    { id: '2026-07-13_bako', date: '2026-07-13', supplierId: 'bako', supplierName: 'Bako', quantities: { nutella: 1 } },
  ]);

  assert.deepEqual(groups.map(g => g.date), ['2026-07-13', '2026-07-06']);
  assert.deepEqual(groups[0].records.map(r => r.supplierName), ['Bako', 'Salvo']);
  assert.equal(groups[1].records.length, 1);
  assert.equal(isLegacyRecord(groups[1].records[0]), true);
});

test('a record with no date at all is dropped rather than grouped under ""', () => {
  assert.deepEqual(groupHistoryByDay([{ id: 'junk', quantities: { flour: 1 } }]), []);
  assert.deepEqual(groupHistoryByDay(null), []);
});

test('the legacy record sorts as the newest record of its own year, and no further', () => {
  // History is read with orderBy(documentId(), 'desc').limit(200) — cheap, and it
  // stays cheap as records pile up. Where the legacy id lands in that ordering is
  // not obvious, and it decides whether the record shows up at all:
  //   - against a 2026 date it wins, because the ids differ at index 5, where
  //     'W' (0x57) beats any digit. So it reads as the newest record of 2026...
  assert.ok('2026-W28' > '2026-12-31_salvo');
  assert.ok('2026-W28' > '2026-07-13_salvo');
  //   - ...but a later YEAR beats it outright (they differ at index 3 first).
  assert.ok('2027-01-05_salvo' > '2026-W28');
  // Which is why History cannot rely on the window alone to keep old records
  // reachable: it also loads older pages on demand (loadOlderHistory).
});

// ── The History window: hiding old orders, never losing them ─────────────────
//
// The app is used mostly by kitchen staff, who need this week's orders rather than
// last month's. What must never break:
//   - the window is counted in DAYS and includes today (15 days = today + 14);
//   - an unusable window shows EVERYTHING — the failure mode of an empty History
//     ("our orders are gone") is far worse than a long list;
//   - what falls outside is RETURNED as `older`, not dropped, because it is put
//     behind a button and still feeds the suggestion engine.

const WINDOW_DAYS = [
  { date: '2026-07-31', records: [{ supplierId: 'salvo' }] },
  { date: '2026-07-17', records: [{ supplierId: 'bako' }] },
  { date: '2026-07-16', records: [{ supplierId: 'salvo' }, { supplierId: 'bako' }] },
  { date: '2026-07-09', records: [{ weekStart: '2026-07-09' }] },
];
const WINDOW_NOW = new Date('2026-07-31T09:00:00');

test('a 15-day window keeps today and the 14 days before it', () => {
  const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 15, WINDOW_NOW);
  assert.deepEqual(recent.map(d => d.date), ['2026-07-31', '2026-07-17']);
  assert.deepEqual(older.map(d => d.date), ['2026-07-16', '2026-07-09']);
});

test('the boundary day is INSIDE the window', () => {
  // "The last 15 days" means the whole fortnight, not 14 days and a bit.
  const { recent } = splitHistoryByAge([{ date: '2026-07-17', records: [1] }], 15, WINDOW_NOW);
  assert.equal(recent.length, 1);
  const { older } = splitHistoryByAge([{ date: '2026-07-16', records: [1] }], 15, WINDOW_NOW);
  assert.equal(older.length, 1);
});

test('a one-day window is today only', () => {
  const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 1, WINDOW_NOW);
  assert.deepEqual(recent.map(d => d.date), ['2026-07-31']);
  assert.equal(older.length, 3);
});

test('an unusable window hides NOTHING', () => {
  // normalizeOrdersConfig applies the default before this is called, so anything
  // wrong arriving here means an assumption failed upstream. Show everything.
  [0, -5, NaN, undefined, null, 'abc'].forEach(bad => {
    const { recent, older } = splitHistoryByAge(WINDOW_DAYS, bad, WINDOW_NOW);
    assert.equal(recent.length, WINDOW_DAYS.length, `window ${String(bad)} must show everything`);
    assert.equal(older.length, 0);
  });
});

test('nothing recent: everything is older, and nothing is lost', () => {
  const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 15, new Date('2026-09-01T09:00:00'));
  assert.equal(recent.length, 0);
  assert.equal(older.length, WINDOW_DAYS.length);
});

test('the legacy weekly record is placed by its own day like any other', () => {
  const { older } = splitHistoryByAge(WINDOW_DAYS, 15, WINDOW_NOW);
  assert.ok(older.some(d => d.date === '2026-07-09'));
});

test('the window is counted in calendar days, not 24-hour blocks (DST)', () => {
  // British clocks go back on 25 Oct 2026. Adding 7 * 86 400 000 ms across that
  // night lands an hour early and would push the boundary onto the previous day.
  const days = [{ date: '2026-10-26', records: [1] }, { date: '2026-10-25', records: [1] }];
  const { recent, older } = splitHistoryByAge(days, 7, new Date('2026-11-01T12:00:00'));
  assert.deepEqual(recent.map(d => d.date), ['2026-10-26']);
  assert.deepEqual(older.map(d => d.date), ['2026-10-25']);
});

test('empty input is handled without throwing', () => {
  assert.deepEqual(splitHistoryByAge(null, 15, WINDOW_NOW), { recent: [], older: [] });
  assert.deepEqual(splitHistoryByAge([], 15, WINDOW_NOW), { recent: [], older: [] });
});

test('the button counts ORDERS, not days', () => {
  // Three records across two days: the operator thinks in orders.
  const { older } = splitHistoryByAge(WINDOW_DAYS, 15, WINDOW_NOW);
  assert.equal(countRecords(older), 3);
  assert.equal(countRecords([]), 0);
  assert.equal(countRecords(null), 0);
  assert.equal(countRecords([{ date: '2026-07-01' }]), 0);
});

// ── Names frozen into the record ─────────────────────────────────────────────
//
// Before this, a past order resolved its item names from the CURRENT ingredient
// list, so deleting an ingredient turned its own order into a row of raw document
// ids — and History exists to answer "what did I order", which an id cannot.

test('an order records what each item was called that day', () => {
  const ingredients = [{ id: 'flour', name: 'Flour uniqua blue', weight: '25kg', supplierId: 'salvo' }];
  const record = buildSupplierArchive({
    supplier: SALVO, ingredients,
    entries: { flour: { qty: 4, stock: 1 } },
    date: '2026-07-13', now: NOW,
  });
  assert.deepEqual(record.names, { flour: 'Flour uniqua blue 25kg' });
});

test('only ORDERED items are named — the same rows quantities holds', () => {
  const record = buildSupplierArchive({
    supplier: SALVO, ingredients: INGREDIENTS,
    entries: { flour: { qty: 4, stock: 1 }, semola: { qty: 0, stock: 9 } },
    date: '2026-07-13', now: NOW,
  });
  assert.deepEqual(Object.keys(record.names), Object.keys(record.quantities));
});

test('a second order the same day ADDS names instead of replacing them', () => {
  // The forgotten-items write only names what IT adds; replacing would strip the
  // names off the rows placed earlier in the day.
  const existing = { quantities: { flour: 4 }, stock: {}, names: { flour: 'Flour 25kg' } };
  const incoming = { quantities: { semola: 2 }, stock: {}, names: { semola: 'Semola 5kg' } };
  assert.deepEqual(mergeArchives(existing, incoming).names,
    { flour: 'Flour 25kg', semola: 'Semola 5kg' });
});

test('a phone on the old version sending no names cannot erase the stored ones', () => {
  const existing = { quantities: { flour: 4 }, stock: {}, names: { flour: 'Flour 25kg' } };
  const incoming = { quantities: { flour: 1 }, stock: {} };   // pre-update phone
  assert.deepEqual(mergeArchives(existing, incoming).names, { flour: 'Flour 25kg' });
});

test('the live ingredient wins, then the frozen name, then an honest placeholder', () => {
  const byId = { flour: { id: 'flour', name: 'Flour uniqua blue', weight: '25kg' } };
  assert.equal(recordedName('flour', byId, { flour: 'Old label' }), 'Flour uniqua blue 25kg');
  assert.equal(recordedName('gone', byId, { gone: 'Ricotta 1.5kg' }), 'Ricotta 1.5kg');
  assert.equal(recordedName('gone', byId, {}), 'Deleted ingredient');
  assert.equal(recordedName('gone', byId, undefined), 'Deleted ingredient');
  assert.equal(recordedName('gone', byId, { gone: '   ' }), 'Deleted ingredient');
  assert.equal(recordedName('gone', byId, { gone: 42 }), 'Deleted ingredient');
});

test('ingredientLabel joins name and weight, and copes with either missing', () => {
  assert.equal(ingredientLabel({ name: 'Bacon', weight: '2.27kg' }), 'Bacon 2.27kg');
  assert.equal(ingredientLabel({ name: 'Loose apples' }), 'Loose apples');
  assert.equal(ingredientLabel(undefined), '');
});
