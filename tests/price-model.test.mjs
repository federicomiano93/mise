// price-model.test.mjs — the ingredient price maths.
//
// The owner cannot read code, so these tests are the safety net (P15). What they
// are really guarding is a specific kind of silent wrongness: a cost that looks
// perfectly plausible on screen and is out by a factor of a thousand, or a zero
// that reads as "free" when it means "nobody has filled this in yet".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENCY, PRICE_UNITS, PRICE_FIELDS,
  roundTo, positiveNumber, isPriceUnit,
  normalizePrice, pricePerKg, costState, isCostable, costReasonText,
  formatMoney, formatRate, formatPricePerUnit, formatPurchaseForm,
  pricePatch, priceChanged, priceRecord,
} from '../js/orders/price-model.js';

const AT = '2026-08-10T09:00:00.000Z';

// ── The purchase form becomes a rate ─────────────────────────────────────────

test('a box of 25 kg for £180 is £7.20 a kilo', () => {
  const r = normalizePrice({ priceUnit: 'kg', packPrice: 180, packSize: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.pricePerUnit, 7.2);
  assert.equal(r.reason, null);
});

test('a division that does not come out round is rounded, not left floating', () => {
  // 10/3 is 3.3333333333333335 in binary floating point. Stored raw it would show
  // as that, and would never compare equal to a later 3.3333.
  const r = normalizePrice({ priceUnit: 'kg', packPrice: 10, packSize: 3 });
  assert.equal(r.pricePerUnit, 3.3333);
});

test('a rate below a penny keeps its precision instead of rounding to zero', () => {
  // 100 gelatine leaves for £3.50 — a third of a penny each. Rounded to the penny
  // this ingredient would cost nothing at all.
  const r = normalizePrice({ priceUnit: 'pcs', packPrice: 3.5, packSize: 100 });
  assert.equal(r.pricePerUnit, 0.035);
});

test('an incomplete form names the first box that is missing', () => {
  assert.equal(normalizePrice({}).reason, 'unit');
  assert.equal(normalizePrice({ priceUnit: 'litres' }).reason, 'unit');
  assert.equal(normalizePrice({ priceUnit: 'kg' }).reason, 'packPrice');
  assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: 180 }).reason, 'packSize');
});

test('zero and negative numbers are refused, never treated as free', () => {
  assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: 0, packSize: 25 }).ok, false);
  assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: 180, packSize: 0 }).ok, false);
  assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: -180, packSize: 25 }).ok, false);
});

test('rubbish in a number box does not produce a rate', () => {
  for (const bad of ['', ' ', 'abc', null, undefined, NaN, Infinity, {}]) {
    assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: bad, packSize: 25 }).ok, false, String(bad));
    assert.equal(normalizePrice({ priceUnit: 'kg', packPrice: 180, packSize: bad }).ok, false, String(bad));
  }
});

test('a number typed as text still works — every input arrives as a string', () => {
  const r = normalizePrice({ priceUnit: 'kg', packPrice: '180', packSize: '25' });
  assert.equal(r.ok, true);
  assert.equal(r.pricePerUnit, 7.2);
});

// ── What a kilo costs ────────────────────────────────────────────────────────

test('priced by weight, the rate IS the price per kilo', () => {
  assert.equal(pricePerKg({ priceUnit: 'kg', pricePerUnit: 7.2 }), 7.2);
});

test('priced by volume, one litre is treated as one kilo', () => {
  // The declared 1:1 approximation, and the same one catalogue-model.js uses when
  // it converts a recipe row in millilitres into grams. The two must agree.
  assert.equal(pricePerKg({ priceUnit: 'l', pricePerUnit: 1.2 }), 1.2);
});

test('priced by the piece, the weight of one piece turns it into a price per kilo', () => {
  // A vanilla pod at £2.10 weighing 3.5 g → £600/kg. This is the number that makes
  // vanilla worth writing in grams in a recipe rather than as "1 pod".
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 }), 600);
});

test('priced by the piece with no piece weight, a price per kilo cannot be known', () => {
  // The important half: it returns null rather than falling back to the raw rate,
  // which would say a 55g egg costs £0.30 a KILO.
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3 }), null);
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0 }), null);
});

test('an ingredient with no price at all has no price per kilo', () => {
  assert.equal(pricePerKg({}), null);
  assert.equal(pricePerKg(null), null);
  assert.equal(pricePerKg({ priceUnit: 'kg' }), null);
  assert.equal(pricePerKg({ pricePerUnit: 7.2 }), null);           // no unit
  assert.equal(pricePerKg({ priceUnit: 'crate', pricePerUnit: 7.2 }), null);
});

// ── Costable or not — flagged, never blocked ─────────────────────────────────

test('an ingredient with a complete price is costable', () => {
  assert.deepEqual(costState({ priceUnit: 'kg', pricePerUnit: 7.2 }), { costable: true, reason: null });
  assert.equal(isCostable({ priceUnit: 'kg', pricePerUnit: 7.2 }), true);
  assert.equal(costReasonText({ priceUnit: 'kg', pricePerUnit: 7.2 }), '');
});

test('the 65 ingredients that exist today are simply "no price yet"', () => {
  // The real shape in production before this feature: a name, a supplier, a
  // free-text weight. Nothing about them may look broken — they are just unpriced.
  const live = { name: 'Bacon', supplierId: 'BRAKES', weight: '2.27kg', unit: 'casse', active: true };
  assert.deepEqual(costState(live), { costable: false, reason: 'no-price' });
  assert.equal(costReasonText(live), 'No price yet');
});

test('priced by the piece without a piece weight says exactly what is missing', () => {
  const egg = { priceUnit: 'pcs', pricePerUnit: 0.3 };
  assert.deepEqual(costState(egg), { costable: false, reason: 'no-piece-weight' });
  assert.match(costReasonText(egg), /weight of one piece/);
});

// ── Formatting ───────────────────────────────────────────────────────────────

test('money is shown in pounds, to the penny', () => {
  assert.equal(CURRENCY, '£');
  assert.equal(formatMoney(180), '£180.00');
  assert.equal(formatMoney(7.2), '£7.20');
  assert.equal(formatMoney(0), '£0.00');
  assert.equal(formatMoney('nonsense'), '£0.00');
});

test('a rate keeps the decimals it needs, and never fewer than two', () => {
  assert.equal(formatRate(7.2), '£7.20');
  assert.equal(formatRate(600), '£600.00');
  assert.equal(formatRate(0.3), '£0.30');
  // The two that matter: rounded to the penny these read as 4p and as free.
  assert.equal(formatRate(0.035), '£0.035');
  assert.equal(formatRate(0.0035), '£0.0035');
  assert.equal(formatRate('nonsense'), '');
});

test('the headline rate reads "£7.20 / kg", and "each" for pieces', () => {
  assert.equal(formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 7.2 }), '£7.20 / kg');
  assert.equal(formatPricePerUnit({ priceUnit: 'l', pricePerUnit: 1.2 }), '£1.20 / l');
  assert.equal(formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 }), '£0.30 / each');
  assert.equal(formatPricePerUnit({}), '');
});

test('the purchase form is rebuilt from the numbers, never from a stored sentence', () => {
  assert.equal(formatPurchaseForm({ priceUnit: 'kg', packPrice: 180, packSize: 25 }), '£180.00 for 25 kg');
  assert.equal(formatPurchaseForm({ priceUnit: 'l', packPrice: 6, packSize: 5 }), '£6.00 for 5 l');
  assert.equal(formatPurchaseForm({ priceUnit: 'pcs', packPrice: 3.5, packSize: 100 }), '£3.50 for 100 pieces');
  assert.equal(formatPurchaseForm({ priceUnit: 'pcs', packPrice: 2.1, packSize: 1 }), '£2.10 for 1 piece');
  assert.equal(formatPurchaseForm({ priceUnit: 'kg', packPrice: 180 }), '');
});

test('a pack size keeps its decimals but loses the trailing zeros', () => {
  assert.equal(formatPurchaseForm({ priceUnit: 'kg', packPrice: 9, packSize: 2.5 }), '£9.00 for 2.5 kg');
  assert.equal(formatPurchaseForm({ priceUnit: 'kg', packPrice: 9, packSize: 2.50 }), '£9.00 for 2.5 kg');
});

// ── The patch written to Firestore ───────────────────────────────────────────

test('a complete form produces every field, so nothing stale is left behind', () => {
  const patch = pricePatch({ priceUnit: 'kg', packPrice: '180', packSize: '25' }, AT);
  assert.deepEqual(patch, {
    priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25,
    unitWeightKg: null, priceUpdatedAt: AT,
  });
  // Every field this module owns is present in the patch — a merge write leaves
  // out what it does not mention, so an omitted field would keep its old value.
  assert.deepEqual(Object.keys(patch).sort(), [...PRICE_FIELDS].sort());
});

test('clearing the price boxes really clears the stored price', () => {
  const patch = pricePatch({ priceUnit: 'kg', packPrice: '', packSize: '' }, AT);
  assert.equal(patch.pricePerUnit, null);
  assert.equal(patch.packPrice, null);
  assert.equal(patch.packSize, null);
  assert.equal(patch.priceUpdatedAt, null);
  assert.deepEqual(Object.keys(patch).sort(), [...PRICE_FIELDS].sort());
});

test('the weight of one piece survives a half-filled price', () => {
  // It describes the article, not the money. Losing it while someone is still
  // typing the price would mean typing it again.
  const patch = pricePatch({ priceUnit: 'pcs', unitWeightKg: 0.0035 }, AT);
  assert.equal(patch.unitWeightKg, 0.0035);
  assert.equal(patch.pricePerUnit, null);
});

test('switching away from pieces clears the piece weight', () => {
  // A leftover divisor nothing shows on screen is the kind of number that later
  // gets divided by without anyone knowing it is there.
  const patch = pricePatch({ priceUnit: 'kg', packPrice: 180, packSize: 25, unitWeightKg: 0.0035 }, AT);
  assert.equal(patch.unitWeightKg, null);
});

test('a piece weight keeps enough decimals for a gelatine leaf', () => {
  // 1.7 g. At four decimals this would be 0.0017 — a 2% error; six keeps it exact.
  const patch = pricePatch({ priceUnit: 'pcs', packPrice: 3.5, packSize: 100, unitWeightKg: 0.0017 }, AT);
  assert.equal(patch.unitWeightKg, 0.0017);
});

// ── When a history entry is worth writing ────────────────────────────────────

test('re-saving an ingredient without touching its price writes no history', () => {
  const before = { priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25, unitWeightKg: null };
  const after = pricePatch({ priceUnit: 'kg', packPrice: 180, packSize: 25 }, AT);
  assert.equal(priceChanged(before, after), false);
});

test('a real price change is recorded', () => {
  const before = { priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25, unitWeightKg: null };
  const after = pricePatch({ priceUnit: 'kg', packPrice: 190, packSize: 25 }, AT);
  assert.equal(priceChanged(before, after), true);
});

test('a first price on an ingredient that never had one is recorded', () => {
  const after = pricePatch({ priceUnit: 'kg', packPrice: 180, packSize: 25 }, AT);
  assert.equal(priceChanged({ name: 'Flour' }, after), true);
  assert.equal(priceChanged(null, after), true);
});

test('changing only the piece weight counts as a price change', () => {
  // No money moved, but every recipe using it just changed cost, so the history
  // has to be able to explain the step.
  const before = { priceUnit: 'pcs', pricePerUnit: 2.1, packPrice: 2.1, packSize: 1, unitWeightKg: 0.0035 };
  const after = pricePatch({ priceUnit: 'pcs', packPrice: 2.1, packSize: 1, unitWeightKg: 0.004 }, AT);
  assert.equal(priceChanged(before, after), true);
});

test('a missing field and a null field are the same absence', () => {
  // The stored document omits a field it never had; the patch writes null. Without
  // this, every first save after the feature ships would look like a change.
  assert.equal(priceChanged({ priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25 },
                            { priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25, unitWeightKg: null }),
               false);
});

// ── The history entry ────────────────────────────────────────────────────────

test('a history entry carries the supplier and a date FIELD', () => {
  const ing = { name: 'Flour', supplierId: 'SALVO' };
  const patch = pricePatch({ priceUnit: 'kg', packPrice: 180, packSize: 25 }, AT);
  const record = priceRecord(ing, patch, AT);

  assert.equal(record.supplierId, 'SALVO');
  assert.equal(record.source, 'manual');
  assert.equal(record.pricePerUnit, 7.2);
  // recordedAt must be a field: Firestore refuses to order a query descending by
  // document id, so a history without it could never be read newest-first.
  assert.equal(record.recordedAt, AT);
});

test('a history entry for an ingredient with no supplier still records', () => {
  const patch = pricePatch({ priceUnit: 'kg', packPrice: 180, packSize: 25 }, AT);
  assert.equal(priceRecord({}, patch, AT).supplierId, '');
  assert.equal(priceRecord(null, patch, AT).supplierId, '');
});

// ── Small guards ─────────────────────────────────────────────────────────────

test('the list of price units is closed and frozen', () => {
  assert.deepEqual([...PRICE_UNITS], ['kg', 'l', 'pcs']);
  assert.throws(() => { PRICE_UNITS.push('crate'); });
  assert.equal(isPriceUnit('kg'), true);
  assert.equal(isPriceUnit('casse'), false);
  assert.equal(isPriceUnit(''), false);
});

test('rounding survives the classic floating-point traps', () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo('nonsense', 2), 0);
});

test('positiveNumber accepts only a real number above zero', () => {
  assert.equal(positiveNumber('7.2'), 7.2);
  assert.equal(positiveNumber(0), null);
  assert.equal(positiveNumber(-1), null);
  assert.equal(positiveNumber(''), null);
  assert.equal(positiveNumber(null), null);
  assert.equal(positiveNumber(Infinity), null);
});
