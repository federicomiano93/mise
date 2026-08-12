// price-model.js — what an ingredient costs, and how a purchase form becomes a
// rate. PURE: no DOM, no Firestore, so every rule below is asserted in a unit test
// instead of being read back out of rendered markup (P15) — the same reason
// archive.js, reminders.js and day.js exist.
//
// ⚠️ IT LIVES IN js/ ROOT, NOT IN js/orders/, AND THAT IS DELIBERATE. Orders owns
// ingredients and enters their prices; the Recipe catalogue reads those prices to
// cost a recipe. A feature folder must never import from another feature folder
// (CLAUDE.md, "Modular by feature") — that rule is what keeps each feature liftable
// into its own app — so the alternative was a second copy of this maths, kept in
// step by a sentinel test. A copy of a CALCULATION is worse than a copy of a
// dialog: two files that quietly disagree about what a kilo costs produce two
// different food-cost percentages and nothing on screen says which is right.
// So it sits in the shared base instead, beside location.js and sections.js, which
// both features already import for exactly the same reason.
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
// One number and a unit, never a sentence:
//
//     priceUnit 'kg'  ·  pricePerUnit 7.20   →   £7.20 / kg
//
// The RATE is typed. It used to be derived, from a pack price divided by a pack
// size — two boxes whose only job was one division, and whose second box asked
// again for the pack weight the ingredient already carries in its own `weight`
// field a few lines higher in the same form ("2.27kg"). Two places holding one
// fact drift, and the one nobody updates is the one every recipe cost is built
// from.
//
// ⚠️ SO THE DIVISION MOVED TO THE PERSON, DELIBERATELY. An invoice reading
// "£180 for a 25kg sack" is entered as 7.20, not as 180. One box that always
// means the same thing, instead of two and a rule about which one the invoice
// total goes in. Whoever enters prices has to know that — the form says it on
// the field, which is the only place it can be said, because a number cannot be
// inspected for what it is a price OF.
//
// ⚠️ PRICES ARE NET OF VAT. The business reclaims input VAT, so what an
// ingredient really costs is the ex-VAT figure. Entering the gross one inflates
// every recipe cost and every food-cost percentage by the VAT rate, and nothing
// on any screen would look wrong. Same class of silent error, same remedy: it is
// written on the label.
//
// `packPrice` and `packSize` are RETIRED rather than renamed — see PRICE_FIELDS.
// `pricePerUnit` already held exactly this rate, so every price entered before
// the change opens showing the right number and nothing had to be migrated.

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
//
// ⚠️ `packPrice` and `packSize` ARE RETIRED AND ARE STILL LISTED ON PURPOSE.
// Prices entered before the rate became a typed field carry both, and an
// ingredient is saved with a MERGE — a field left out of the payload keeps
// whatever it had. So the patch sets them to null EXPLICITLY, which is the only
// way to remove them, and they drain out of production as prices get edited.
// Drop them from this list and an old document keeps a pack price for ever that
// contradicts its own rate: 180 and 25 sitting under a rate somebody has since
// corrected to 7.50.
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

// ── Reading what was typed into the price boxes ──────────────────────────────
// Returns { ok, pricePerUnit, reason }. `reason` names the FIRST thing missing, so
// the screen can say which box to fill rather than a blanket "invalid".
//
// It never throws and never guesses: a form that is not complete simply produces
// ok:false, and an ingredient with no usable price is shown as "no price yet"
// rather than blocking anything (the design's rule throughout — flag, never block).
export function normalizePrice({ priceUnit, pricePerUnit } = {}) {
  if (!isPriceUnit(priceUnit)) return { ok: false, pricePerUnit: null, reason: 'unit' };

  const rate = positiveNumber(pricePerUnit);
  if (rate === null) return { ok: false, pricePerUnit: null, reason: 'price' };

  // Rounded even though it was typed: a rate pasted from a spreadsheet arrives as
  // 7.199999999999999 often enough, and that number would be stored, shown, and
  // then compared against a later 7.2 as if the price had moved.
  return { ok: true, pricePerUnit: roundTo(rate, RATE_DECIMALS), reason: null };
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
export function pricePatch({ priceUnit, pricePerUnit, unitWeightKg }, nowIso) {
  const unit = isPriceUnit(priceUnit) ? priceUnit : null;
  const pieceKg = unit === 'pcs' && positiveNumber(unitWeightKg) !== null
    ? roundTo(unitWeightKg, 6)
    : null;

  const result = normalizePrice({ priceUnit: unit, pricePerUnit });
  return {
    priceUnit: unit,
    pricePerUnit: result.ok ? result.pricePerUnit : null,
    // Retired, and cleared on every save so an old document stops carrying a pack
    // price that disagrees with its own rate. See PRICE_FIELDS.
    packPrice: null,
    packSize: null,
    unitWeightKg: pieceKg,
    priceUpdatedAt: result.ok ? nowIso : null,
  };
}

// Has the price actually changed? Asked before appending to the history, so that
// re-saving an ingredient to fix a typo in its NAME does not plant a second price
// record identical to the first — a history full of non-events is a history nobody
// can read, and it is what makes "when did this go up?" unanswerable.
//
// The piece weight counts as part of the price: it is a divisor of the £/kg, so
// changing it changes what a recipe costs even though no money moved.
//
// ⚠️ THE RETIRED PACK FIELDS ARE DELIBERATELY NOT COMPARED. Every save now clears
// them, so an ingredient priced under the old form differs on them the first time
// it is opened and saved — and comparing them would read that as a price change
// and plant a history entry recording a rate that never moved.
export function priceChanged(before, after) {
  const a = before || {};
  const b = after || {};
  return ['priceUnit', 'pricePerUnit', 'unitWeightKg']
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
    unitWeightKg: patch.unitWeightKg,
    supplierId: (ingredient && ingredient.supplierId) || '',
    source,
  };
}

// ── Where a price LIVES, which is not where an ingredient lives ──────────────
//
// ⚠️ THE PRICE MOVED OUT OF THE INGREDIENT DOCUMENT, and the reason is not tidiness.
// Orders must read every ingredient to work at all — that is the order screen —
// so a rate written on the ingredient is a rate every person in the building can
// read. Hiding the Food Cost screen hid the MARGIN and left "what a sack of flour
// costs" in plain view, which is half an answer pretending to be a whole one.
//
// It is a PARALLEL collection keyed by the ingredient's own id, not a
// subcollection: Food Cost and the recipe costing want them ALL, and one
// collection read costs far less than one read per ingredient (P14).
//
// ⚠️ AND THE FIELDS STAY IN THE ingredients WHITELIST IN firestore.rules, written
// null on every save so they drain out. Removing a field from a whitelist while
// production still carries it makes those documents permanently unwritable — the
// notifyHoursBefore / weekId trap, twice learnt.

// Split a saved form into the part that belongs to the ingredient and the part
// that belongs beside it. Both objects are always returned; the caller decides
// whether it is allowed to write the second.
export function splitPriceFields(data) {
  const ingredient = {};
  const price = {};
  Object.keys(data || {}).forEach(key => {
    if (PRICE_FIELDS.includes(key)) price[key] = data[key];
    else ingredient[key] = data[key];
  });
  // ⚠️ The ingredient KEEPS the keys, set to null. That is what drains the old
  // values out of documents written before this change; omitting them would
  // leave a stale rate on the ingredient for ever, readable by everybody, which
  // is the exact thing this change exists to stop.
  PRICE_FIELDS.forEach(key => { ingredient[key] = null; });
  return { ingredient, price };
}

// Put an ingredient back together with its price, for the screens that may see
// one. `prices` is a map of ingredient id → the price document.
//
// ⚠️ A MISSING PRICE IS NOT AN ERROR AND MUST NOT BE. An employee cannot read
// that collection at all, so for them this returns the ingredient untouched —
// and every consumer already knows what to do with an unpriced ingredient,
// because most ingredients have never had a price. The screens say "not priced
// yet" and carry on, which is exactly the right thing for somebody who is not
// allowed to know. No new failure mode, no error to handle.
export function withPrices(ingredients, prices) {
  const map = prices || {};
  return (ingredients || []).map(ing => {
    const price = ing && map[ing.id];
    return price ? { ...ing, ...price } : ing;
  });
}
