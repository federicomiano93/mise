// ingredient-category.js — THE one place that decides which heading a row sits
// under, and in what order the headings come.
//
// PURE, so it is testable without a browser (P15).
//
// ⚠️ IT EXISTS BECAUSE TWO SCREENS ANSWERED THIS DIFFERENTLY AND ONE WAS WRONG.
// The read-only "what this supplier sells" screen grouped rows carefully; the
// ORDER screen — the one with the quantity boxes, where a misread heading makes
// somebody order the wrong thing — grouped them with a bare `Object.keys().sort()`
// over the raw field. Against real-shaped data that produced three visible faults
// at once:
//
//   Dairy      -> Milk
//   Dairy      -> Cream     two headings, one category, split by a TRAILING SPACE
//   Dry        -> Flour
//                 Yeast     category 'Other', drawn bare UNDER the wrong heading
//   undefined  -> Salt      a heading reading, literally, "undefined"
//
// The trailing space is not hypothetical here: production has already carried
// `sections ` and `calculator ` with invisible trailing spaces, undetectable in
// the Firebase console, and it cost this project a release (v205).
//
// ⚠️ THE ITEMS ARE NOT SORTED HERE, ON PURPOSE. The two screens sort differently
// (one by name, one by label then id as a tie-break) and forcing one order on both
// would silently change the read-only screen to fix the order screen. This module
// owns the CATEGORY question and nothing else.

// The default, no-information category. Rows in it carry no heading at all — a
// heading saying "Other" is a line that tells nobody anything.
export const NO_CATEGORY = '';

// ⚠️ MISSING, EMPTY AND 'Other' ARE THE SAME ANSWER: "nobody said". Reading them
// as three different categories is what put a row called "undefined" on screen.
// The trim is load-bearing, not tidiness — see the note above.
export function categoryOf(ing) {
  const category = String(ing?.category ?? '').trim();
  return category === 'Other' ? NO_CATEGORY : category;
}

// -> [{ category, items: [the original objects, untouched] }]
//
// ORDERING. The uncategorised block comes FIRST and carries no heading; the named
// categories follow A→Z, each under its own.
//
// ⚠️ FIRST IS THE WHOLE POINT, not a preference. A bare row must never sit under a
// heading it does not belong to, and putting the bare block anywhere but the top is
// exactly how that happens — alphabetical order dropped 'Other' into the middle,
// where it read as part of whatever came before it.
export function groupByCategory(ingredients) {
  const groups = new Map();

  (ingredients || []).forEach(ing => {
    if (!ing) return;
    const category = categoryOf(ing);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(ing);
  });

  const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const order = groups.has(NO_CATEGORY) ? [NO_CATEGORY, ...named] : named;

  return order.map(category => ({ category, items: groups.get(category) }));
}
