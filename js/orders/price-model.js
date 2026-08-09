// price-model.js — what an ingredient costs, and how a purchase form becomes a
// rate. PURE: no DOM, no Firestore, so every rule below is asserted in a unit test
// instead of being read back out of rendered markup (P15) — the same reason
// archive.js, reminders.js and day.js exist.
//
// WHY A PRICE LIVES ON THE INGREDIENT. A price is not a property of a thing, it is
// a property of the RELATIONSHIP between a thing and the supplier who sells it —
// and in Orders an ingredient document already IS that relationship (it carries a
// supplierId). So the price belongs here, on the document that already knows who
// it is bought from, and no second address book has to exist.
//
// ⚠️ THE COST THIS PRODUCES IS NOMINAL, NOT ACTUAL. It is the price of the usual
// supplier's article, not of the batch that happened to be in the kitchen that
// morning. A one-off substitution (bought elsewhere because the van did not come)
// is deliberately invisible here. That is a known, accepted limitation: the
// alternative is asking someone to record every substitution, which nobody does.
//
// ── HOW A PRICE IS ENTERED ───────────────────────────────────────────────────
// Two numbers and a unit, never a sentence:
//
//     packPrice 180  ·  packSize 25  ·  priceUnit 'kg'   →   pricePerUnit 7.20 £/kg
//
// The purchase form is kept as those three fields rather than as the phrase
// "a 25kg box for £180", so the readable phrase is REBUILT (formatPurchaseForm)
// and can never drift away from the number it is supposed to explain. Reading a
// hand-typed phrase back into numbers would have to cope with "25 kg", "25Kg",
// "box of 25" and "6x4kg", and a misread produces a wrong cost silently — the one
// failure mode this module exists to avoid (P19: do not hand-roll text parsing).

// The one place the currency is written. The business is in the UK — its bank
// holidays come from gov.uk and its phone numbers start +44 — so prices are in
// pounds. Everything that shows money goes through the formatters below.
export const CURRENCY = '£';

// What a price can be quoted PER. Deliberately three, and deliberately not the
// same list as the recipe units (catalogue-model.js): this is how something is
// BOUGHT — by weight, by volume, or by the piece — not how it is measured into a
// bowl. A tighter list is also a smaller thing to keep in step with the rules.
export const PRICE_UNITS = Object.freeze(['kg', 'l', 'pcs']);

// Human wording for each, for labels and for the "not costable" explanations.
export const PRICE_UNIT_LABELS = Object.freeze({
  kg: 'by weight (kg)',
  l: 'by volume (litres)',
  pcs: 'by the piece',
});

// Every field this module owns on an ingredient document. Exported because the
// form, the data layer and the rules test all need the SAME list, and three
// hand-written copies of it would drift the first time one is extended.
export const PRICE_FIELDS = Object.freeze([
  'priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'priceUpdatedAt',
]);

// Money is rounded to the penny; a RATE is not. A rate can legitimately be tiny —
// a gelatine leaf is fractions of a penny — and rounding £0.0035 to £0.00 would
// turn a real cost into a free ingredient. Four decimals is far below anything a
// kitchen can weigh and still keeps the stored number short and comparable.
const MONEY_DECIMALS = 2;
const RATE_DECIMALS = 4;

// Round without the floating-point surprise: 180/25 is exactly 7.2, but plenty of
// ordinary divisions land on 7.199999999999999, and that number would be shown,
// stored, and compared against a later 7.2 as if it were different.
export function roundTo(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  // The +Number.EPSILON nudge fixes the classic 1.005 → 1.00 case, where the
  // stored double is a hair BELOW the value that was typed.
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

// A number that can be a price or a quantity: finite and strictly positive.
// Zero is refused rather than accepted as "free" — in every real case it means the
// box was left empty or half-typed, and a zero cost is worse than no cost at all
// because nothing on screen would look wrong.
export function positiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isPriceUnit(unit) {
  return PRICE_UNITS.includes(unit);
}

// ── Turning a purchase form into a rate ──────────────────────────────────────
// Returns { ok, pricePerUnit, reason }. `reason` names the FIRST thing missing, so
// the screen can say which box to fill rather than a blanket "invalid".
//
// It never throws and never guesses: a form that is not complete simply produces
// ok:false, and an ingredient with no usable price is shown as "no price yet"
// rather than blocking anything (the design's rule throughout — flag, never block).
export function normalizePrice({ priceUnit, packPrice, packSize } = {}) {
  if (!isPriceUnit(priceUnit)) return { ok: false, pricePerUnit: null, reason: 'unit' };

  const price = positiveNumber(packPrice);
  if (price === null) return { ok: false, pricePerUnit: null, reason: 'packPrice' };

  const size = positiveNumber(packSize);
  if (size === null) return { ok: false, pricePerUnit: null, reason: 'packSize' };

  return { ok: true, pricePerUnit: roundTo(price / size, RATE_DECIMALS), reason: null };
}

// ── What one kilogram of this ingredient costs ───────────────────────────────
// The single number every recipe cost is built from. null when it cannot be known,
// which is a normal state and not an error.
//
// ⚠️ VOLUME IS CONVERTED TO WEIGHT 1:1, i.e. one litre is treated as one kilogram.
// True for water, near enough for milk (1.03) and most stocks; wrong for oil
// (0.92) and syrups. It is the standard bakery approximation and the whole app
// already uses it (catalogue-model.js converts recipe rows the same way), so the
// two agree by construction. Declared out loud here because it is the one place a
// cost can be a couple of percent out for a reason that is not a mistake.
export function pricePerKg(ingredient) {
  const ing = ingredient || {};
  const rate = positiveNumber(ing.pricePerUnit);
  if (rate === null) return null;

  if (ing.priceUnit === 'kg' || ing.priceUnit === 'l') return rate;

  if (ing.priceUnit === 'pcs') {
    // Bought by the piece — eggs, vanilla pods, gelatine leaves. It can only enter
    // a recipe written in grams if somebody has said what one piece weighs, and
    // that is a fact nobody can derive: 12 eggs is not a weight.
    const pieceKg = positiveNumber(ing.unitWeightKg);
    return pieceKg === null ? null : roundTo(rate / pieceKg, RATE_DECIMALS);
  }

  return null;
}

// Can this ingredient contribute a cost to a recipe written in weight?
// Returns { costable, reason } — the reason is what the screen shows next to the
// name, so the list of ingredients doubles as the to-do list for filling prices in.
export function costState(ingredient) {
  const ing = ingredient || {};
  if (!isPriceUnit(ing.priceUnit) || positiveNumber(ing.pricePerUnit) === null) {
    return { costable: false, reason: 'no-price' };
  }
  if (ing.priceUnit === 'pcs' && positiveNumber(ing.unitWeightKg) === null) {
    return { costable: false, reason: 'no-piece-weight' };
  }
  return { costable: true, reason: null };
}

export function isCostable(ingredient) {
  return costState(ingredient).costable;
}

// The wording shown when an ingredient cannot be costed. One sentence, saying what
// to do rather than what is wrong.
export const COST_REASON_TEXT = Object.freeze({
  'no-price': 'No price yet',
  'no-piece-weight': 'Add the weight of one piece to use this in a recipe',
});

export function costReasonText(ingredient) {
  const { costable, reason } = costState(ingredient);
  return costable ? '' : (COST_REASON_TEXT[reason] || COST_REASON_TEXT['no-price']);
}

// ── Formatting ───────────────────────────────────────────────────────────────

// An amount of money: always two decimals, always the currency in front.
export function formatMoney(value) {
  const n = Number(value);
  return `${CURRENCY}${(Number.isFinite(n) ? n : 0).toFixed(MONEY_DECIMALS)}`;
}

// A RATE (price per unit). Always at least the two decimals money is read in, and
// up to four when the number needs them — so £7.20 stays £7.20 while a gelatine
// leaf at 3.5p shows as £0.035 rather than being rounded up to £0.04 (a 14% error
// on the only screen anybody checks) or down to £0.00, which reads as free.
//
// Written as "pad to four, then drop the zeros the number does not need" rather
// than as a threshold: a threshold has to be chosen, and any choice is wrong just
// past it.
export function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const padded = n.toFixed(RATE_DECIMALS);
  const trimmed = padded.replace(/0+$/, '');
  const decimals = Math.max(MONEY_DECIMALS, trimmed.split('.')[1].length);
  return `${CURRENCY}${n.toFixed(decimals)}`;
}

// "£7.20 / kg" — the headline number on the ingredient row. Empty when unknown, so
// a caller can put the "no price yet" note in its place.
export function formatPricePerUnit(ingredient) {
  const ing = ingredient || {};
  const rate = positiveNumber(ing.pricePerUnit);
  if (rate === null || !isPriceUnit(ing.priceUnit)) return '';
  return `${formatRate(rate)} / ${ing.priceUnit === 'pcs' ? 'each' : ing.priceUnit}`;
}

// "£180.00 for 25 kg" — the purchase form, rebuilt from the numbers rather than
// stored as a sentence (see the header). Empty when the form is incomplete.
export function formatPurchaseForm(ingredient) {
  const ing = ingredient || {};
  const price = positiveNumber(ing.packPrice);
  const size = positiveNumber(ing.packSize);
  if (price === null || size === null || !isPriceUnit(ing.priceUnit)) return '';
  const unit = ing.priceUnit === 'pcs' ? (size === 1 ? 'piece' : 'pieces') : ing.priceUnit;
  return `${formatMoney(price)} for ${trimNumber(size)} ${unit}`;
}

// 25 → "25", 2.5 → "2.5", 2.50 → "2.5". Pack sizes are typed by hand and a
// trailing zero on every one of them reads like a machine wrote it.
function trimNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(roundTo(n, RATE_DECIMALS));
}

// ── Writing a price ──────────────────────────────────────────────────────────

// The patch written onto the ingredient document. Every field is always present,
// as a number or as null, because these documents are saved with a MERGE: a field
// left out of the payload keeps whatever it had, so clearing a price by omission
// would silently leave the old one in place.
//
// `unitWeightKg` survives an incomplete price — what one piece weighs is a fact
// about the ARTICLE, not about the money, so it is not lost just because the price
// boxes are still half filled. It IS cleared when the unit stops being 'pcs',
// because a leftover piece weight nothing displays is the kind of stale number
// that later gets divided by.
export function pricePatch({ priceUnit, packPrice, packSize, unitWeightKg }, nowIso) {
  const unit = isPriceUnit(priceUnit) ? priceUnit : null;
  const pieceKg = unit === 'pcs' && positiveNumber(unitWeightKg) !== null
    ? roundTo(unitWeightKg, 6)
    : null;

  const result = normalizePrice({ priceUnit: unit, packPrice, packSize });
  if (!result.ok) {
    return {
      priceUnit: unit,
      pricePerUnit: null, packPrice: null, packSize: null,
      unitWeightKg: pieceKg,
      priceUpdatedAt: null,
    };
  }
  return {
    priceUnit: unit,
    pricePerUnit: result.pricePerUnit,
    packPrice: roundTo(positiveNumber(packPrice), MONEY_DECIMALS),
    packSize: roundTo(positiveNumber(packSize), RATE_DECIMALS),
    unitWeightKg: pieceKg,
    priceUpdatedAt: nowIso,
  };
}

// Has the price actually changed? Asked before appending to the history, so that
// re-saving an ingredient to fix a typo in its NAME does not plant a second price
// record identical to the first — a history full of non-events is a history nobody
// can read, and it is what makes "when did this go up?" unanswerable.
//
// The piece weight counts as part of the price: it is a divisor of the £/kg, so
// changing it changes what a recipe costs even though no money moved.
export function priceChanged(before, after) {
  const a = before || {};
  const b = after || {};
  return ['priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg']
    .some(key => (a[key] ?? null) !== (b[key] ?? null));
}

// One entry in the append-only history. It carries the SUPPLIER as well as the
// price, because the whole point of keeping it is to answer "what did we pay, to
// whom, when" long after the ingredient's current supplier has changed.
//
// `recordedAt` is a FIELD and not just the document id. Firestore refuses to order
// a query descending by document id ("does not support descending key scans"), so
// a history that only had its id could never be read newest-first — a trap this
// project has already fallen into twice, in Orders history and in the pastry
// records. Order by the field.
export function priceRecord(ingredient, patch, nowIso, source = 'manual') {
  return {
    recordedAt: nowIso,
    priceUnit: patch.priceUnit,
    pricePerUnit: patch.pricePerUnit,
    packPrice: patch.packPrice,
    packSize: patch.packSize,
    unitWeightKg: patch.unitWeightKg,
    supplierId: (ingredient && ingredient.supplierId) || '',
    source,
  };
}
