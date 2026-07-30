// Unit tests for the Orders WhatsApp message builder (P15 — the owner cannot read
// code, so these tests are the safety net).
//
// This text is what the SUPPLIER actually receives, so a mistake here is not a UI
// glitch: it is a wrong order arriving at the bakery. The same builder is now used
// from two sources — the draft being typed, and a history record being re-sent — and
// these tests pin that both produce byte-identical output for the same order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderMessage, orderTitle, itemsFromQuantities, indexById, itemLabel,
  whatsappUrl, sortItems,
} from '../js/orders/order-text.js';

// The restaurant placing the order. It used to be baked into the builder as a
// constant; it now comes from the signed-in session, so every message test says
// it out loud — that is the point of the change.
const CLUB = { restaurantName: 'The Italian Club' };

const ingredients = [
  { id: 'i1', name: 'Bacon', weight: '2.27kg', unit: 'casse' },
  { id: 'i2', name: 'Mozzarella', weight: '1kg', unit: 'box' },
  { id: 'i3', name: 'Loose apples', weight: '' },
];

test('the message keeps the format the app has always sent', () => {
  const text = buildOrderMessage([
    { supplierName: 'Brava Fresh', items: [
      { name: 'Bacon', weight: '2.27kg', qty: 5 },
      { name: 'Mozzarella', weight: '1kg', qty: 2 },
    ] },
  ], CLUB);
  assert.equal(text,
    '*Order — The Italian Club*\n\n' +
    '*Brava Fresh*\n' +
    '- Bacon 2.27kg: 5\n' +
    '- Mozzarella 1kg: 2');
});

test('several suppliers are separated by a blank line', () => {
  const text = buildOrderMessage([
    { supplierName: 'Bako', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
    { supplierName: 'Salvo', items: [{ name: 'Olives', weight: '', qty: 1 }] },
  ], CLUB);
  assert.equal(text,
    '*Order — The Italian Club*\n\n' +
    '*Bako*\n- Flour 25kg: 4\n\n' +
    '*Salvo*\n- Olives: 1');
});

test('an empty weight is skipped, leaving no double space', () => {
  assert.equal(itemLabel('Loose apples', ''), 'Loose apples');
  assert.equal(itemLabel('Bacon', '2.27kg'), 'Bacon 2.27kg');
});

test('the order unit never reaches the supplier — only the number', () => {
  const text = buildOrderMessage([
    { supplierName: 'S', items: [{ name: 'Bacon', weight: '2.27kg', qty: 3 }] },
  ], CLUB);
  assert.ok(!text.includes('casse'), 'the order unit is a private reminder');
  assert.ok(text.includes('- Bacon 2.27kg: 3'));
});

test('a supplier with no items is dropped, and an empty order builds no message', () => {
  const text = buildOrderMessage([
    { supplierName: 'Empty', items: [] },
    { supplierName: 'Real', items: [{ name: 'Flour', weight: '', qty: 2 }] },
  ], CLUB);
  assert.ok(!text.includes('Empty'));
  assert.equal(buildOrderMessage([{ supplierName: 'Empty', items: [] }]), '');
  assert.equal(buildOrderMessage([]), '');
  assert.equal(buildOrderMessage(null), '');
});

// ── Building from a stored history record ────────────────────────────────────
test('a history record produces the same message as the draft did', () => {
  const byId = indexById(ingredients);
  const fromHistory = buildOrderMessage([{
    supplierName: 'Brava Fresh',
    items: itemsFromQuantities({ i1: 5, i2: 2 }, byId),
  }], CLUB);
  const fromDraft = buildOrderMessage([{
    supplierName: 'Brava Fresh',
    items: [
      { name: 'Bacon', weight: '2.27kg', qty: 5 },
      { name: 'Mozzarella', weight: '1kg', qty: 2 },
    ],
  }], CLUB);
  assert.equal(fromHistory, fromDraft,
    're-sending a placed order must read exactly like the original');
});

test('items are sorted by their displayed label, not by id', () => {
  const byId = indexById(ingredients);
  const items = itemsFromQuantities({ i2: 1, i1: 1, i3: 1 }, byId);
  assert.deepEqual(items.map(i => i.name), ['Bacon', 'Loose apples', 'Mozzarella']);
});

test('an ingredient deleted since the order falls back to its id, never vanishes', () => {
  const items = itemsFromQuantities({ gone: 3 }, indexById(ingredients));
  assert.deepEqual(items, [{ name: 'gone', weight: '', qty: 3 }]);
});

test('zero and junk quantities are dropped, never sent to a supplier', () => {
  const byId = indexById(ingredients);
  assert.deepEqual(itemsFromQuantities({ i1: 0 }, byId), []);
  assert.deepEqual(itemsFromQuantities({ i1: -2 }, byId), []);
  assert.deepEqual(itemsFromQuantities({ i1: 'HELLO' }, byId), []);
  assert.deepEqual(itemsFromQuantities({ i1: null }, byId), []);
  assert.deepEqual(itemsFromQuantities({}, byId), []);
  assert.deepEqual(itemsFromQuantities(null, byId), []);
});

test('a decimal quantity is rounded, so no supplier is asked for 2.5 boxes', () => {
  const items = itemsFromQuantities({ i1: 2.4 }, indexById(ingredients));
  assert.deepEqual(items, [{ name: 'Bacon', weight: '2.27kg', qty: 2 }]);
});

test('the WhatsApp url carries no recipient — the operator picks the chat', () => {
  const url = whatsappUrl('*Order*\n- x: 1');
  assert.ok(url.startsWith('https://wa.me/?text='), 'empty path = no recipient');
  assert.equal(decodeURIComponent(url.split('?text=')[1]), '*Order*\n- x: 1');
});

test('the builder sorts the lines itself, whatever order the caller passes', () => {
  // The draft used to hand items over in raw Firestore order. Sorting inside the
  // builder is what makes a draft send and a later re-send from History identical.
  const shuffled = buildOrderMessage([{
    supplierName: 'S',
    items: [
      { name: 'Mozzarella', weight: '1kg', qty: 2 },
      { name: 'Bacon', weight: '2.27kg', qty: 5 },
    ],
  }], CLUB);
  assert.equal(shuffled,
    '*Order — The Italian Club*\n\n*S*\n- Bacon 2.27kg: 5\n- Mozzarella 1kg: 2');
});

test('sortItems does not mutate the caller\'s array', () => {
  const items = [{ name: 'B', weight: '', qty: 1 }, { name: 'A', weight: '', qty: 1 }];
  const sorted = sortItems(items);
  assert.deepEqual(items.map(i => i.name), ['B', 'A'], 'the original must be untouched');
  assert.deepEqual(sorted.map(i => i.name), ['A', 'B']);
});

// ── "One list": a shopping list for yourself, not an order for a supplier ────
//
// The second format has no supplier headings, so it must never be reachable by
// accident. These tests pin the new shape AND stand guard over the old one.

const THREE_SUPPLIERS = [
  { supplierName: 'Brakes', items: [{ name: 'Bacon', weight: '2.27kg', qty: 4 }] },
  { supplierName: 'Salvo', items: [{ name: 'Mozzarella', weight: '5kg', qty: 2 }] },
  { supplierName: 'No supplier', items: [{ name: 'Baking Paper', weight: '', qty: 2 }] },
];

test('One list drops every supplier heading and sorts the whole order A-Z', () => {
  assert.equal(buildOrderMessage(THREE_SUPPLIERS, { grouped: false, ...CLUB }),
    '*Order — The Italian Club*\n\n' +
    '- Bacon 2.27kg: 4\n' +
    '- Baking Paper: 2\n' +
    '- Mozzarella 5kg: 2');
});

test('the By supplier format is byte-identical with or without the option', () => {
  // The guard that matters most: this is the message a SUPPLIER receives, and adding
  // a second format must not have moved a single character of it.
  const golden =
    '*Order — The Italian Club*\n\n' +
    '*Brakes*\n- Bacon 2.27kg: 4\n\n' +
    '*Salvo*\n- Mozzarella 5kg: 2\n\n' +
    '*No supplier*\n- Baking Paper: 2';
  assert.equal(buildOrderMessage(THREE_SUPPLIERS, CLUB), golden);
  assert.equal(buildOrderMessage(THREE_SUPPLIERS, { ...CLUB }), golden);
  assert.equal(buildOrderMessage(THREE_SUPPLIERS, { grouped: true, ...CLUB }), golden);
});

test('One list adds up two lines carrying the same label', () => {
  // The same product bought from two suppliers is one thing to buy.
  const text = buildOrderMessage([
    { supplierName: 'Bako', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
    { supplierName: 'Salvo', items: [{ name: 'Flour', weight: '25kg', qty: 3 }] },
  ], { grouped: false, ...CLUB });
  assert.equal(text, '*Order — The Italian Club*\n\n- Flour 25kg: 7');
});

test('…while the By supplier format keeps them apart, one line per supplier', () => {
  const text = buildOrderMessage([
    { supplierName: 'Bako', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
    { supplierName: 'Salvo', items: [{ name: 'Flour', weight: '25kg', qty: 3 }] },
  ], CLUB);
  assert.equal(text,
    '*Order — The Italian Club*\n\n*Bako*\n- Flour 25kg: 4\n\n*Salvo*\n- Flour 25kg: 3');
});

test('One list distinguishes two weights of the same product', () => {
  const text = buildOrderMessage([
    { supplierName: 'S', items: [
      { name: 'Flour', weight: '25kg', qty: 1 },
      { name: 'Flour', weight: '1kg', qty: 2 },
    ] },
  ], { grouped: false, ...CLUB });
  assert.equal(text, '*Order — The Italian Club*\n\n- Flour 1kg: 2\n- Flour 25kg: 1');
});

test('One list never sends a line worth nothing', () => {
  const text = buildOrderMessage([
    { supplierName: 'S', items: [
      { name: 'Bacon', weight: '', qty: 0 },
      { name: 'Flour', weight: '', qty: 3 },
    ] },
  ], { grouped: false, ...CLUB });
  assert.equal(text, '*Order — The Italian Club*\n\n- Flour: 3');
});

test('One list with nothing to send builds no message at all', () => {
  assert.equal(buildOrderMessage([], { grouped: false, ...CLUB }), '');
  assert.equal(buildOrderMessage(null, { grouped: false, ...CLUB }), '');
  assert.equal(buildOrderMessage(
    [{ supplierName: 'S', items: [{ name: 'x', weight: '', qty: 0 }] }],
    { grouped: false },
  ), '', 'a group whose every quantity is zero must not open an empty chat');
});

test('One list rounds and ignores junk exactly as the grouped format does', () => {
  const text = buildOrderMessage([
    { supplierName: 'S', items: [
      { name: 'Bacon', weight: '', qty: 2.4 },
      { name: 'Cream', weight: '', qty: 'HELLO' },
      { name: 'Dates', weight: '', qty: -5 },
      { name: 'Eggs', weight: '', qty: 1 },
    ] },
  ], { grouped: false, ...CLUB });
  assert.equal(text, '*Order — The Italian Club*\n\n- Bacon: 2\n- Eggs: 1');
});

// ── Who the order is from ────────────────────────────────────────────────────
// The title used to be a constant. With more than one restaurant that constant
// would have signed one restaurant's order with another's name — the supplier
// would deliver to the wrong place and nothing on screen would have looked odd.

test('the title names the restaurant that is placing the order', () => {
  assert.equal(orderTitle('Trattoria Rosa'), '*Order — Trattoria Rosa*');
  const text = buildOrderMessage(
    [{ supplierName: 'Bako', items: [{ name: 'Flour', weight: '25kg', qty: 1 }] }],
    { restaurantName: 'Trattoria Rosa' });
  assert.ok(text.startsWith('*Order — Trattoria Rosa*'));
  assert.ok(!text.includes('Italian Club'));
});

test('with no name the order goes out anonymous rather than wrongly signed', () => {
  ['', '   ', null, undefined].forEach(missing => {
    assert.equal(orderTitle(missing), '*Order*', `${JSON.stringify(missing)} must not invent a name`);
  });
  const text = buildOrderMessage(
    [{ supplierName: 'Bako', items: [{ name: 'Flour', weight: '25kg', qty: 1 }] }]);
  assert.ok(text.startsWith('*Order*\n'));
});
