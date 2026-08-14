// The four ways an order can leave the app, and who may use which.
//
// ⚠️ THE TESTS THAT MATTER MOST ARE THE ONES THAT KEEP AN ORDER ABLE TO LEAVE. A
// restriction feature has one catastrophic failure mode — the order that can no
// longer get out at all — and it has three separate doors: every switch off, a
// preference pointing at a closed road, and a corrupt document read as "nothing
// allowed". Each has a test below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES, DEFAULT_ROUTES, normalizeSendRoutes, routesFor,
  routeAvailableFor, unreachable, validateRoutes, toStored,
} from '../js/orders/send-routes.js';

const ALL_OFF = { manager: false, whatsapp: false, whatsappSupplier: false, email: false };

// ── ⚠️ AN ORDER MUST ALWAYS BE ABLE TO LEAVE ─────────────────────────────────

// ⚠️ THE STRUCTURAL ONE. If the switches applied to everybody, turning WhatsApp off
// to hold an employee back would disarm the person who then has to reach the
// supplier, and the order could never leave the building.
test('⚠️ a manager or owner keeps ALL FOUR roads whatever the switches say', () => {
  const settings = normalizeSendRoutes({ sendRoutes: ALL_OFF });
  assert.deepEqual(routesFor(settings, { canManage: true }), [...ROUTES]);
});

test('an employee gets only what is switched on', () => {
  const settings = normalizeSendRoutes({
    sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false },
  });
  assert.deepEqual(routesFor(settings, { canManage: false }), ['manager']);
});

// ⚠️ Refused OUT LOUD, so it reads as a message rather than a switch that
// mysteriously will not stay off.
test('⚠️ the last road cannot be closed', () => {
  assert.deepEqual(validateRoutes(ALL_OFF, 'manager'), { ok: false, reason: 'none' });
});

// ⚠️ Left alone it would silently mean "no preference" and the app would offer
// whatever came first — a setting that stopped doing what it says without saying so.
test('⚠️ a preference pointing at a closed road is MOVED, not kept', () => {
  const r = validateRoutes({ ...DEFAULT_ROUTES, whatsapp: false }, 'whatsapp');
  assert.equal(r.ok, true);
  assert.equal(r.preferred, 'manager', 'moved to a road that is actually open');
});

test('a preference on an open road is left exactly as it is', () => {
  const r = validateRoutes(DEFAULT_ROUTES, 'whatsapp');
  assert.equal(r.preferred, 'whatsapp');
});

// ⚠️ An order that cannot leave the app at all is a worse failure than one that can
// leave by a road somebody meant to close.
test('⚠️ a corrupt document falls back to the defaults, never to "nothing allowed"', () => {
  ['', null, undefined, 42, { sendRoutes: 'yes' }, { sendRoutes: [] }].forEach(doc => {
    const s = normalizeSendRoutes(doc);
    assert.ok(routesFor(s, {}).length > 0, `${JSON.stringify(doc)} left no way out`);
  });
  assert.deepEqual(normalizeSendRoutes(null).routes, { ...DEFAULT_ROUTES });
});

// ⚠️ The settings screen refuses to save it, but a hand-written document, an older
// version or a partial merge could still produce it.
test('⚠️ a stored document with every road off is repaired on the way in', () => {
  const s = normalizeSendRoutes({ sendRoutes: ALL_OFF });
  assert.equal(s.routes.manager, true, 'the in-app road is the one that comes back');
  assert.equal(s.preferred, 'manager');
});

// ── The defaults ─────────────────────────────────────────────────────────────

// ⚠️ A default that switches on a way of contacting the OUTSIDE WORLD is a decision
// made by nobody. A venue that has never been asked has agreed to nothing.
test('⚠️ the two direct-to-supplier roads default to OFF', () => {
  assert.equal(DEFAULT_ROUTES.whatsappSupplier, false);
  assert.equal(DEFAULT_ROUTES.email, false);
  assert.equal(DEFAULT_ROUTES.manager, true, 'and the two that already existed stay on');
  assert.equal(DEFAULT_ROUTES.whatsapp, true);
});

test('a partially written document keeps its own values and defaults the rest', () => {
  const s = normalizeSendRoutes({ sendRoutes: { email: true } });
  assert.equal(s.routes.email, true);
  assert.equal(s.routes.whatsapp, true, 'untouched keys take the default');
  assert.equal(s.routes.whatsappSupplier, false);
});

// ⚠️ Only a real boolean counts. A string "false" is truthy, and reading it as ON
// would open a road the venue had closed.
test('only a real boolean counts as a decision', () => {
  const s = normalizeSendRoutes({ sendRoutes: { whatsappSupplier: 'false', email: 1 } });
  assert.equal(s.routes.whatsappSupplier, false, 'a string is not a decision');
  assert.equal(s.routes.email, false, 'nor is a number');
});

// ── A road needs somewhere to go ─────────────────────────────────────────────

// ⚠️ Never a chat that opens blank or a mail addressed to nobody: those look like
// the app failing, where "no number saved" names the thing to go and fix.
test('⚠️ a direct road is unavailable for a supplier with no contact, and says which', () => {
  const withPhone = { id: 'a', name: 'A', phone: '447700900123' };
  const without = { id: 'b', name: 'B', phone: '  ' };

  assert.equal(routeAvailableFor('whatsappSupplier', withPhone), true);
  assert.equal(routeAvailableFor('whatsappSupplier', without), false);
  assert.deepEqual(unreachable('whatsappSupplier', [withPhone, without]).map(s => s.id), ['b']);
});

test('email needs an email, not a phone', () => {
  assert.equal(routeAvailableFor('email', { phone: '447700900123' }), false);
  assert.equal(routeAvailableFor('email', { email: 'a@b.test' }), true);
});

// ⚠️ The two that do NOT address a supplier are always available: one goes inside
// the app, the other opens WhatsApp with no recipient for a person to choose.
test('the two indirect roads never depend on a supplier', () => {
  assert.equal(routeAvailableFor('manager', {}), true);
  assert.equal(routeAvailableFor('whatsapp', {}), true);
  assert.equal(routeAvailableFor('manager', null), true);
  assert.deepEqual(unreachable('whatsapp', [{ id: 'x' }]), []);
});

// ── What reaches Firestore ───────────────────────────────────────────────────

// ⚠️ EVERY KEY IS WRITTEN, and as a real boolean. config/{doc} validates a CLOSED
// key list, and a half-written map is how a setting silently reverts.
test('every road is stored explicitly, as a boolean', () => {
  const stored = toStored({ manager: true, whatsapp: 'yes' }, 'manager');
  assert.deepEqual(stored.sendRoutes,
    { manager: true, whatsapp: false, whatsappSupplier: false, email: false });
  assert.equal(stored.preferredRoute, 'manager');
});

test('a missing preference is stored as an empty string, not undefined', () => {
  assert.equal(toStored(DEFAULT_ROUTES, null).preferredRoute, '');
  assert.equal(typeof toStored(DEFAULT_ROUTES, undefined).preferredRoute, 'string');
});

test('the four roads are named once, and the screens read them from here', () => {
  assert.deepEqual([...ROUTES], ['manager', 'whatsapp', 'whatsappSupplier', 'email']);
});
