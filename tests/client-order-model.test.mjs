// A client types their own order and it reaches the Calculator without anyone
// retyping it. These numbers decide how much dough is made, so they get the same
// safety net as the dough math itself (P15 — the owner cannot read code).
//
// Client names here are placeholders on purpose: this repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isISODate, toISODate, startOfDayMs,
  cutoffMinutes, closesAtMs, isDateOpen, orderableDates, defaultOrderDate,
  isValidOrderClientId, orderDocId,
  menuFor, menuChanged,
  normalizeQuantities, buildOrder, orderChangedSinceApplied, isApplied,
  orderRows, orderTotalLines, calculatorPatch,
  MAX_QTY, MAX_NOTE,
} from '../js/client-order-model.js';

// Local wall-clock times, built the way a person reads them — a UTC timestamp would
// not say which local day, and the whole cutoff is a local-clock idea.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const MON_0900 = at(2026, 8, 10, 9, 0);   // Monday morning
const MON_1730 = at(2026, 8, 10, 17, 30); // Monday, after a 16:00 cutoff

// ── Dates ────────────────────────────────────────────────────────────────────

test('a date that only LOOKS valid is refused', () => {
  assert.equal(isISODate('2026-08-11'), true);
  assert.equal(isISODate('2026-02-31'), false); // passes the pattern, then becomes 3 March
  assert.equal(isISODate('2026-13-01'), false);
  assert.equal(isISODate('11/08/2026'), false);
  assert.equal(isISODate(''), false);
  assert.equal(isISODate(null), false);
});

test('a timestamp names its LOCAL day, not the UTC one', () => {
  // 00:30 local. toISOString() would name the previous day anywhere east of Greenwich,
  // which would file an order under a day the client never chose.
  assert.equal(toISODate(at(2026, 8, 11, 0, 30)), '2026-08-11');
  assert.equal(toISODate(at(2026, 8, 11, 23, 30)), '2026-08-11');
});

test('startOfDayMs is midnight local, and NaN for a non-date', () => {
  assert.equal(startOfDayMs('2026-08-11'), at(2026, 8, 11, 0, 0));
  assert.ok(Number.isNaN(startOfDayMs('nonsense')));
});

// ── The cutoff ───────────────────────────────────────────────────────────────

test('a cutoff is read as a clock time', () => {
  assert.equal(cutoffMinutes('16:00'), 960);
  assert.equal(cutoffMinutes('00:00'), 0);
  assert.equal(cutoffMinutes('23:59'), 1439);
  assert.equal(cutoffMinutes(' 16:00 '), 960);
});

test('an unreadable cutoff leaves the door OPEN, never shut', () => {
  // ⚠️ The direction matters. A corrupt setting that CLOSED the door would stop every
  // client ordering, with nothing on screen explaining why — a fault that looks
  // exactly like the business having no customers.
  for (const bad of ['25:00', '16:60', 'sixteen', '16', '', null, undefined, 42, {}]) {
    assert.equal(cutoffMinutes(bad), null, `expected no cutoff for ${JSON.stringify(bad)}`);
  }
  assert.equal(isDateOpen('2026-08-11', MON_1730, 'nonsense'), true);
});

test('the door for a day shuts at the cutoff on the day BEFORE it', () => {
  assert.equal(closesAtMs('2026-08-11', '16:00'), at(2026, 8, 10, 16, 0));
  assert.equal(closesAtMs('2026-08-01', '16:00'), at(2026, 7, 31, 16, 0)); // across a month
  assert.equal(closesAtMs('2026-08-11', null), null);
});

test('tomorrow is open before the cutoff and shut after it', () => {
  assert.equal(isDateOpen('2026-08-11', MON_0900, '16:00'), true);
  assert.equal(isDateOpen('2026-08-11', MON_1730, '16:00'), false);
  // The day after tomorrow is still open at 17:30 — its own door shuts tomorrow.
  assert.equal(isDateOpen('2026-08-12', MON_1730, '16:00'), true);
});

test('TODAY is never orderable while a cutoff is set — that is what a deadline means', () => {
  assert.equal(isDateOpen('2026-08-10', MON_0900, '16:00'), false);
  // …and IS orderable when the bakery has no cutoff at all.
  assert.equal(isDateOpen('2026-08-10', MON_0900, null), true);
});

test('the past is refused whatever the cutoff says', () => {
  assert.equal(isDateOpen('2026-08-09', MON_0900, null), false);
  assert.equal(isDateOpen('2026-08-09', MON_0900, '16:00'), false);
});

test('an unreadable clock offers no day at all', () => {
  // Same choice as the WhatsApp prefill: a broken clock must not silently behave like
  // "no limit", because that failure looks exactly like the feature working.
  assert.deepEqual(orderableDates(0, '16:00'), []);
  assert.deepEqual(orderableDates(NaN, null), []);
  assert.equal(isDateOpen('2026-08-11', NaN, null), false);
});

test('the offered days are the open ones, soonest first', () => {
  const days = orderableDates(MON_1730, '16:00', 3);
  assert.deepEqual(days, ['2026-08-12', '2026-08-13']);
});

test('with no cutoff the list starts today', () => {
  assert.deepEqual(orderableDates(MON_0900, null, 2), ['2026-08-10', '2026-08-11', '2026-08-12']);
});

test('the picker opens on TOMORROW', () => {
  assert.equal(defaultOrderDate(MON_0900, '16:00'), '2026-08-11');
});

test('…on the next open day once tomorrow has shut', () => {
  assert.equal(defaultOrderDate(MON_1730, '16:00'), '2026-08-12');
});

test('…and never on today, even when today is open', () => {
  // An evening tap would otherwise quietly order for a day that is nearly over.
  assert.equal(defaultOrderDate(MON_1730, null), '2026-08-11');
});

test('nothing open means no default — the page must say so, not show an empty picker', () => {
  assert.equal(defaultOrderDate(MON_1730, '16:00', 1), '');
});

// ── Ids ──────────────────────────────────────────────────────────────────────

test('a client id may not contain an underscore', () => {
  // ⚠️ The security rules recover the client from `{date}_{clientId}` by splitting on
  // the underscore. One inside the id would split into three and compare the wrong
  // half — a rule that fails open or closed depending on the customer's name.
  assert.equal(isValidOrderClientId('c-clubfish'), true);
  assert.equal(isValidOrderClientId('c-club_fish'), false);
  assert.equal(isValidOrderClientId(''), false);
  assert.equal(isValidOrderClientId('-leading'), false);
  assert.equal(isValidOrderClientId('a'.repeat(65)), false);
});

test('an order id is built in one place, and refuses to guess', () => {
  assert.equal(orderDocId('2026-08-11', 'c-clubfish'), '2026-08-11_c-clubfish');
  assert.throws(() => orderDocId('11-08-2026', 'c-clubfish'), /Invalid order date/);
  assert.throws(() => orderDocId('2026-08-11', 'c_bad'), /Invalid client id/);
});

// ── The published menu ───────────────────────────────────────────────────────

const CLIENT = {
  id: 'c-one', name: 'CLIENT A', products: [
    { id: 'p-buns', name: 'Buns', kind: 'number', weight: 71, recipeId: 'brioche' },
    { id: 'p-loaf', name: 'Loaf', kind: 'kg', weight: 905, recipeId: 'sourdough' },
  ],
};

test('a menu carries only what a client needs to order', () => {
  assert.deepEqual(menuFor(CLIENT), {
    clientName: 'CLIENT A',
    products: [
      { id: 'p-buns', name: 'Buns', kind: 'number' },
      { id: 'p-loaf', name: 'Loaf', kind: 'kg' },
    ],
  });
});

test('a PAUSED product is not offered', () => {
  // It leaves the Calculator entirely, so offering it would let a client order
  // something the bakery has decided not to make.
  const paused = { ...CLIENT, products: [CLIENT.products[0], { ...CLIENT.products[1], active: false }] };
  assert.deepEqual(menuFor(paused).products.map(p => p.id), ['p-buns']);
});

test('a menu built from nothing is empty rather than broken', () => {
  assert.deepEqual(menuFor(null), { clientName: '', products: [] });
  assert.deepEqual(menuFor({ name: 'X' }), { clientName: 'X', products: [] });
});

test('a menu is republished only when it really moved', () => {
  const wanted = menuFor(CLIENT);
  assert.equal(menuChanged(wanted, wanted), false);
  assert.equal(menuChanged(null, wanted), true);
  assert.equal(menuChanged({ ...wanted, clientName: 'RENAMED' }, wanted), true);
  assert.equal(menuChanged({ ...wanted, products: [wanted.products[0]] }, wanted), true);
  assert.equal(menuChanged({ ...wanted, products: [wanted.products[1], wanted.products[0]] }, wanted), true);
  const renamed = { ...wanted, products: [{ ...wanted.products[0], name: 'Baps' }, wanted.products[1]] };
  assert.equal(menuChanged(renamed, wanted), true);
  const rekinded = { ...wanted, products: [{ ...wanted.products[0], kind: 'kg' }, wanted.products[1]] };
  assert.equal(menuChanged(rekinded, wanted), true);
});

// ── Quantities ───────────────────────────────────────────────────────────────

test('only real, positive quantities survive', () => {
  assert.deepEqual(
    normalizeQuantities({ a: 5, b: 0, c: -3, d: 'x', e: null, f: '7' }),
    { a: 5, f: 7 },
  );
});

test('a quantity cannot run away', () => {
  assert.deepEqual(normalizeQuantities({ a: 9e9 }), { a: MAX_QTY });
});

test('a corrupt quantity map is empty, never NaN', () => {
  assert.deepEqual(normalizeQuantities(null), {});
  assert.deepEqual(normalizeQuantities('nope'), {});
  assert.deepEqual(normalizeQuantities({ a: NaN, b: Infinity }), {});
});

// ── Building the order ───────────────────────────────────────────────────────

const NOW_ISO = '2026-08-10T09:00:00.000Z';
const MENU = menuFor(CLIENT);

const build = (over = {}) => buildOrder({
  date: '2026-08-11', clientId: 'c-one', clientName: 'CLIENT A',
  quantities: { 'p-buns': 40 }, note: '', menu: MENU, nowIso: NOW_ISO, ...over,
});

test('an order names what was ordered, at the moment it was ordered', () => {
  // ⚠️ Frozen names, same reason orders-history froze its own: a product renamed or
  // deleted afterwards must not turn a received order into a row of raw ids.
  assert.deepEqual(build().names, { 'p-buns': 'Buns' });
});

test('only ORDERED products are named — the freeze is not a copy of the menu', () => {
  assert.deepEqual(Object.keys(build({ quantities: { 'p-loaf': 2 } }).names), ['p-loaf']);
});

test('correcting an order keeps when it was first sent, and moves when it changed', () => {
  const first = build();
  const later = build({ quantities: { 'p-buns': 60 }, nowIso: '2026-08-10T11:00:00.000Z', existing: first });
  assert.equal(later.createdAt, NOW_ISO);
  assert.equal(later.updatedAt, '2026-08-10T11:00:00.000Z');
  assert.deepEqual(later.quantities, { 'p-buns': 60 });
});

test('a correction carries forward the fact that the bakery already used the order', () => {
  // ⚠️ THE RULES REFUSE THE WRITE IF IT DOES NOT. A correction is written WHOLE, so
  // omitting these would erase the record that this order had been put into the
  // Calculator — and the screen would stop warning that it changed afterwards.
  const used = { ...build(), appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: NOW_ISO };
  const corrected = build({ quantities: { 'p-buns': 60 }, nowIso: '2026-08-10T11:00:00.000Z', existing: used });
  assert.equal(corrected.appliedAt, '2026-08-10T10:00:00.000Z');
  assert.equal(corrected.appliedFor, NOW_ISO);
  // …and the correction is then visible AS a change, which is the whole purpose.
  assert.equal(orderChangedSinceApplied(corrected), true);
});

test('a first order carries no applied fields at all — the rules refuse them', () => {
  assert.equal('appliedAt' in build(), false);
  assert.equal('appliedFor' in build(), false);
  assert.equal('appliedAt' in build({ existing: { createdAt: NOW_ISO } }), false);
});

test('a note is kept but cannot become a novel', () => {
  assert.equal(build({ note: '  half cut  ' }).note, '  half cut  ');
  assert.equal(build({ note: 'x'.repeat(9999) }).note.length, MAX_NOTE);
  assert.equal(build({ note: null }).note, '');
});

// ── Changed after it was used ────────────────────────────────────────────────

test('an order nobody has used yet is not "changed"', () => {
  assert.equal(orderChangedSinceApplied(build()), false);
  assert.equal(isApplied(build()), false);
});

test('an order used and then left alone is not "changed"', () => {
  const order = { ...build(), appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: NOW_ISO };
  assert.equal(orderChangedSinceApplied(order), false);
  assert.equal(isApplied(order), true);
});

test('an order CHANGED after it was used says so — this is the one that bakes wrong', () => {
  const order = {
    ...build({ nowIso: '2026-08-10T11:00:00.000Z' }),
    appliedAt: '2026-08-10T10:00:00.000Z',
    appliedFor: NOW_ISO,
  };
  assert.equal(orderChangedSinceApplied(order), true);
});

test('a change inside the same second is still a change', () => {
  // ⚠️ Comparing "applied at" with "updated at" as two CLOCKS would miss this one and
  // would also cry stale whenever the two were written a moment apart. `appliedFor`
  // records WHICH version was used, so neither happens.
  const order = { ...build(), appliedAt: NOW_ISO, appliedFor: '2026-08-10T08:59:59.000Z' };
  assert.equal(orderChangedSinceApplied(order), true);
});

// ── Reading an order back ────────────────────────────────────────────────────

const liveNames = { 'p-buns': 'Burger buns', 'p-loaf': 'Loaf' };
const liveNameOf = id => liveNames[id] || '';

test('the lines read in a stable order, by name', () => {
  const order = build({ quantities: { 'p-loaf': 2, 'p-buns': 40 } });
  assert.deepEqual(orderRows(order, liveNameOf).map(r => r.name), ['Burger buns', 'Loaf']);
  assert.equal(orderTotalLines(order), 2);
});

test('a RENAMED product shows its new name', () => {
  assert.equal(orderRows(build(), liveNameOf)[0].name, 'Burger buns');
});

test('a DELETED product still says what it was, and is flagged', () => {
  const order = build({ quantities: { 'p-gone': 3 }, menu: { products: [{ id: 'p-gone', name: 'Old thing' }] } });
  const [row] = orderRows(order, liveNameOf);
  assert.equal(row.name, 'Old thing');
  assert.equal(row.missing, true);
});

test('…and with nothing frozen either, it never shows a raw id', () => {
  const order = { quantities: { 'p-gone': 3 } };
  assert.equal(orderRows(order, liveNameOf)[0].name, 'Deleted product');
});

// ── Into the Calculator ──────────────────────────────────────────────────────

test('an order becomes the Calculator\'s own quantity keys', () => {
  assert.deepEqual(calculatorPatch(build(), CLIENT.products), {
    'c-one::p-buns': 40,
    'c-one::p-loaf': 0,
  });
});

test('a product the order does NOT mention is set to zero', () => {
  // ⚠️ The order is the client's complete statement. A 5 left over from yesterday in a
  // field they did not ask for today is a wrong number, and it is exactly the kind of
  // leftover that gets baked.
  const patch = calculatorPatch(build({ quantities: { 'p-loaf': 2 } }), CLIENT.products);
  assert.equal(patch['c-one::p-buns'], 0);
  assert.equal(patch['c-one::p-loaf'], 2);
});

test('a paused product has no field, so it gets no entry', () => {
  const products = [CLIENT.products[0], { ...CLIENT.products[1], active: false }];
  assert.deepEqual(Object.keys(calculatorPatch(build(), products)), ['c-one::p-buns']);
});

test('a line for a product the client no longer has is skipped, not invented', () => {
  const order = build({ quantities: { 'p-gone': 3, 'p-buns': 40 } });
  assert.deepEqual(calculatorPatch(order, CLIENT.products), {
    'c-one::p-buns': 40,
    'c-one::p-loaf': 0,
  });
});

test('an order with no client fills nothing at all', () => {
  assert.deepEqual(calculatorPatch({ quantities: { 'p-buns': 40 } }, CLIENT.products), {});
});
