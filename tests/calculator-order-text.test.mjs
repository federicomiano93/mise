// The WhatsApp order message the Calculator sends.
//
// This text is what a CLIENT actually receives, so its shape is pinned character for
// character (P15 — the owner cannot read code, and nobody proof-reads a message that
// looks about right). Same treatment as the Orders message builder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSections, buildOrderMessage, whatsappUrl } from '../js/calculator-order-text.js';

// Placeholder names on purpose: this repo is public.
const ENTRIES = [
  { client: { name: 'CLIENT A' }, products: [{ id: 'p1', name: 'Buns' }, { id: 'p2', name: 'Rolls' }] },
  { client: { name: 'CLIENT B' }, products: [{ id: 'p1', name: 'Buns' }] },
  { client: { name: 'CLIENT C' }, products: [{ id: 'p3', name: 'Trays' }] },
];

// qtyOf(entryIndex, productId), the shape the modal supplies.
const qtys = (map) => (ei, pid) => map[ei + '|' + pid] || 0;

// ── Which clients end up in the message ──────────────────────────────────────

test('only clients with something typed become sections', () => {
  const s = orderSections(ENTRIES, qtys({ '0|p1': 30, '2|p3': 4 }));
  assert.deepEqual(s.map(x => x.name), ['CLIENT A', 'CLIENT C']);
});

test('a client with everything at zero is left out entirely', () => {
  // An empty heading in a message reads as "we want nothing from you", which is not
  // what an untouched row means.
  const s = orderSections(ENTRIES, qtys({ '1|p1': 0 }));
  assert.deepEqual(s, []);
});

test('a section keeps its own index, so its rows can still be addressed', () => {
  const s = orderSections(ENTRIES, qtys({ '2|p3': 4 }));
  assert.equal(s[0].index, 2);
});

test('only the rows above zero are listed, in the order the products are shown', () => {
  const s = orderSections(ENTRIES, qtys({ '0|p1': 30, '0|p2': 0 }));
  assert.deepEqual(s[0].lines, [{ name: 'Buns', qty: 30 }]);
});

test('junk in a quantity is nothing, never NaN in somebody\'s message', () => {
  for (const bad of ['abc', null, undefined, NaN, Infinity, {}, -5]) {
    assert.deepEqual(orderSections(ENTRIES, () => bad), [], String(bad));
  }
});

test('a malformed order produces no sections rather than throwing', () => {
  assert.deepEqual(orderSections(null, qtys({})), []);
  assert.deepEqual(orderSections([null, {}, { client: null }], qtys({})), []);
  assert.deepEqual(orderSections([{ client: { name: 'X' }, products: null }], qtys({})), []);
  assert.deepEqual(orderSections(ENTRIES, null), []);
});

// ── The message, pinned character for character ──────────────────────────────

test('several clients: the message is byte-identical to what it has always sent', () => {
  const s = orderSections(ENTRIES, qtys({ '0|p1': 30, '0|p2': 10, '2|p3': 4 }));
  assert.equal(buildOrderMessage('Morning list', s, true),
    '*Morning list*\n\n*CLIENT A*\n- Buns: 30\n- Rolls: 10\n\n*CLIENT C*\n- Trays: 4');
});

test('one client on its own: its own name as the title, and no repeated heading', () => {
  const s = orderSections(ENTRIES, qtys({ '2|p3': 4 }));
  assert.equal(buildOrderMessage('CLIENT C', s, false), '*CLIENT C*\n\n- Trays: 4');
});

test('sending everything KEEPS the headings even when one client filled in', () => {
  // ⚠️ This is why `multi` is passed in rather than derived from sections.length.
  // The title is then the LIST's name, so dropping the heading would leave a message
  // that never says who it is for.
  const s = orderSections(ENTRIES, qtys({ '2|p3': 4 }));
  assert.equal(buildOrderMessage('Morning list', s, true), '*Morning list*\n\n*CLIENT C*\n- Trays: 4');
});

test('a missing title still produces a headed message', () => {
  const s = orderSections(ENTRIES, qtys({ '0|p1': 1 }));
  assert.equal(buildOrderMessage('', s, false), '*Order*\n\n- Buns: 1');
  assert.equal(buildOrderMessage(null, s, false), '*Order*\n\n- Buns: 1');
});

test('the builder never throws on a malformed section list', () => {
  assert.equal(buildOrderMessage('T', null, true), '*T*\n\n');
  assert.equal(buildOrderMessage('T', [{ name: 'X' }], true), '*T*\n\n*X*\n');
});

// ── The link ─────────────────────────────────────────────────────────────────

test('the link carries the message and names no recipient', () => {
  // No number on purpose: one order often goes to a person rather than to a stored
  // business number, so WhatsApp asks who.
  const url = whatsappUrl('*T*\n\n- Buns: 30');
  assert.equal(url, 'https://wa.me/?text=' + encodeURIComponent('*T*\n\n- Buns: 30'));
  assert.equal(url.includes('phone='), false);
});

test('the message survives the round trip through the link', () => {
  const text = '*Morning list*\n\n*CLIENT A*\n- Buns: 30 & Rolls: 10 (100%)';
  assert.equal(decodeURIComponent(whatsappUrl(text).split('text=')[1]), text);
});
