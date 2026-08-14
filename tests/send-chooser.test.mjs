// What the send chooser OFFERS, and the two links it builds.
//
// The screen itself needs a browser; these are the parts that decide what a person
// is told, which is where the mistakes with consequences live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerFor, digitsOf, mailto } from '../js/orders/send-chooser.js';
import { normalizeSendRoutes } from '../js/orders/send-routes.js';

const ALL_ON = normalizeSendRoutes({
  sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: true, email: true },
});
const S = (id, over = {}) => ({ id, name: id.toUpperCase(), ...over });

const routeNames = offers => offers.map(o => o.route);
const by = (offers, route) => offers.find(o => o.route === route);

// ── ⚠️ WHAT CANNOT BE REACHED IS NAMED ───────────────────────────────────────

// ⚠️ A supplier missing from a send that nobody mentioned is an order that simply
// never happened, discovered when the delivery does not turn up.
test('⚠️ a supplier with no number is named, not silently dropped', () => {
  const suppliers = [S('a', { phone: '447700900123' }), S('b', { phone: '' })];
  const o = by(offerFor({ settings: ALL_ON, canManage: true, suppliers }), 'whatsappSupplier');

  assert.deepEqual(o.reachable.map(s => s.id), ['a']);
  assert.deepEqual(o.cannot.map(s => s.id), ['b']);
  assert.match(o.note, /B/, 'the note has to NAME the one it cannot reach');
});

// ⚠️ Discovering it halfway through is how somebody sends the first and forgets
// the other two.
test('⚠️ "one message per supplier" is said BEFORE the road is taken', () => {
  const suppliers = [S('a', { phone: '1' }), S('b', { phone: '2' }), S('c', { phone: '3' })];
  const o = by(offerFor({ settings: ALL_ON, canManage: true, suppliers }), 'whatsappSupplier');
  assert.match(o.note, /3/, 'it says how many trips that is');
});

test('with ONE supplier there is no such warning — it would be noise', () => {
  const o = by(offerFor({ settings: ALL_ON, canManage: true, suppliers: [S('a', { phone: '1' })] }),
    'whatsappSupplier');
  assert.equal(o.note, '');
});

// ⚠️ A road that can reach NOBODY is not offered at all. Offering it means a tap
// that opens nothing, which reads as the app being broken.
test('⚠️ a road that can reach nobody is not usable', () => {
  const suppliers = [S('a', { phone: '' }), S('b', { phone: '' })];
  const offers = offerFor({ settings: ALL_ON, canManage: true, suppliers });
  assert.equal(by(offers, 'whatsappSupplier').usable, false);
  assert.equal(by(offers, 'whatsapp').usable, true, 'the indirect road is unaffected');
  assert.equal(by(offers, 'manager').usable, true);
});

// ── Who is offered what ──────────────────────────────────────────────────────

test('an employee is offered only the open roads; a manager gets all four', () => {
  const limited = normalizeSendRoutes({
    sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false },
  });
  const suppliers = [S('a', { phone: '1', email: 'a@b.test' })];

  assert.deepEqual(routeNames(offerFor({ settings: limited, canManage: false, suppliers })),
    ['manager']);
  assert.deepEqual(routeNames(offerFor({ settings: limited, canManage: true, suppliers })),
    ['manager', 'whatsapp', 'whatsappSupplier', 'email']);
});

test('the two indirect roads never depend on a supplier having contacts', () => {
  const offers = offerFor({ settings: ALL_ON, canManage: true, suppliers: [S('a')] });
  assert.equal(by(offers, 'manager').usable, true);
  assert.equal(by(offers, 'whatsapp').usable, true);
});

test('no suppliers at all is answered without throwing', () => {
  const offers = offerFor({ settings: ALL_ON, canManage: true, suppliers: [] });
  assert.equal(by(offers, 'manager').usable, false, 'nothing to send');
  assert.equal(offers.length, 4);
});

// ── ⚠️ THE TWO LINKS ─────────────────────────────────────────────────────────

// ⚠️ wa.me REFUSES anything but digits, and refuses it by opening a page saying the
// number is invalid — which reads as the app being broken, not the number needing
// tidying. The stored format is "447700900123", but people type what they read.
test('⚠️ a phone number is reduced to digits, whatever it was typed as', () => {
  assert.equal(digitsOf('+44 7700 900123'), '447700900123');
  assert.equal(digitsOf('(0044) 7700-900123'), '00447700900123');
  assert.equal(digitsOf(''), '');
  assert.equal(digitsOf(null), '');
});

// ⚠️ An order carries names, weights and newlines. Unescaped, the first "&" in a
// supplier's name would truncate the message at exactly that point — and the
// supplier would receive half an order with nothing saying so.
test('⚠️ the mail link escapes the whole message, so nothing is truncated', () => {
  const url = mailto('a@b.test', 'Order from Misé', 'Flour 25kg: 2\nSalt & pepper: 1');
  assert.ok(url.startsWith('mailto:a%40b.test?subject='));
  assert.ok(!url.includes('Salt & pepper'), 'the ampersand must not survive raw');
  assert.ok(url.includes('%26'), 'it is escaped');
  assert.ok(url.includes('%0A'), 'and so are the line breaks');
});

test('a blank address still produces a well-formed link rather than junk', () => {
  assert.equal(mailto('  ', 's', 'b').startsWith('mailto:?subject='), true);
});
