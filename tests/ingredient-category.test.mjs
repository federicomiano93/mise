// Which heading a row sits under, and in what order the headings come.
//
// ⚠️ THE THREE TESTS THAT MATTER MOST ARE THE THREE REAL FAULTS. This module was
// written because the ORDER screen — the one with the quantity boxes — grouped
// rows with a bare `Object.keys(groupBy(...)).sort()` and produced, against
// real-shaped data, a heading reading "undefined", a bare 'Other' row filed under
// the wrong heading, and one category split in two by an invisible trailing space.
// Each of those has a test below that goes red if the old behaviour comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_CATEGORY, categoryOf, groupByCategory } from '../js/orders/ingredient-category.js';

const headings = ingredients => groupByCategory(ingredients).map(g => g.category);
const namesUnder = (ingredients, category) =>
  (groupByCategory(ingredients).find(g => g.category === category)?.items || []).map(i => i.name);

// ── ⚠️ THE THREE FAULTS ──────────────────────────────────────────────────────

// ⚠️ A field that is simply absent is normal in Firestore — every ingredient field
// is OPTIONAL in the rules on purpose. Reading it through `groupBy` turned it into
// the STRING "undefined", which is truthy, so it was drawn as a heading.
test('⚠️ a missing category never becomes a heading reading "undefined"', () => {
  const groups = groupByCategory([{ name: 'Salt' }]);
  assert.deepEqual(headings([{ name: 'Salt' }]), [NO_CATEGORY]);
  assert.equal(groups[0].category, '');
  assert.notEqual(groups[0].category, 'undefined');
});

// ⚠️ 'Other' carries no heading, so sorting it alphabetically dropped it into the
// MIDDLE of the list where it read as part of whatever came before it. On the order
// screen that is somebody ordering the wrong thing.
test('⚠️ an "Other" row is never drawn under a heading it does not belong to', () => {
  const list = [
    { name: 'Flour', category: 'Dry' },
    { name: 'Yeast', category: 'Other' },
    { name: 'Milk', category: 'Dairy' },
  ];
  assert.deepEqual(headings(list), [NO_CATEGORY, 'Dairy', 'Dry']);
  assert.deepEqual(namesUnder(list, NO_CATEGORY), ['Yeast']);
  assert.deepEqual(namesUnder(list, 'Dry'), ['Flour'], 'Yeast must NOT be under Dry');
});

// ⚠️ NOT HYPOTHETICAL. Production has already carried `sections ` and `calculator `
// with trailing spaces, invisible in the Firebase console, and it cost a release.
test('⚠️ a trailing space does not split one category into two headings', () => {
  const list = [
    { name: 'Milk', category: 'Dairy' },
    { name: 'Cream', category: 'Dairy ' },
    { name: 'Butter', category: ' Dairy' },
  ];
  assert.deepEqual(headings(list), ['Dairy']);
  assert.equal(namesUnder(list, 'Dairy').length, 3);
});

// ── The uncategorised block comes FIRST ──────────────────────────────────────

// ⚠️ FIRST IS THE RULE, not alphabetical placement. A bare row must never sit under
// a heading, and the top is the only position where that is guaranteed.
test('the uncategorised block is first, the named ones follow A→Z', () => {
  const list = [
    { name: 'Zest', category: 'Zest tins' },
    { name: 'Salt' },
    { name: 'Apple', category: 'Ambient' },
    { name: 'Yeast', category: 'Other' },
    { name: 'Milk', category: 'Dairy' },
  ];
  assert.deepEqual(headings(list), [NO_CATEGORY, 'Ambient', 'Dairy', 'Zest tins']);
});

test('with no uncategorised rows at all, no empty block is invented', () => {
  const list = [{ name: 'Milk', category: 'Dairy' }, { name: 'Flour', category: 'Dry' }];
  assert.deepEqual(headings(list), ['Dairy', 'Dry']);
});

// ── categoryOf: missing, empty and 'Other' are ONE answer ────────────────────

test('missing, empty and "Other" all mean "nobody said"', () => {
  assert.equal(categoryOf({}), NO_CATEGORY);
  assert.equal(categoryOf({ category: '' }), NO_CATEGORY);
  assert.equal(categoryOf({ category: '   ' }), NO_CATEGORY);
  assert.equal(categoryOf({ category: 'Other' }), NO_CATEGORY);
  assert.equal(categoryOf({ category: ' Other ' }), NO_CATEGORY);
  assert.equal(categoryOf({ category: null }), NO_CATEGORY);
  assert.equal(categoryOf(null), NO_CATEGORY);
});

// ⚠️ 'other' lower-case is NOT folded, deliberately. It is a category somebody
// typed, and quietly erasing a typed word is a worse failure than showing it: the
// heading is at least visible and can be corrected.
test('a real category is kept exactly as typed, once trimmed', () => {
  assert.equal(categoryOf({ category: ' Dairy ' }), 'Dairy');
  assert.equal(categoryOf({ category: 'other' }), 'other');
  assert.equal(categoryOf({ category: 'Others' }), 'Others');
});

// ── Nothing at all is refused rather than throwing ───────────────────────────

test('junk in, no throw out', () => {
  assert.deepEqual(groupByCategory(null), []);
  assert.deepEqual(groupByCategory([]), []);
  assert.deepEqual(groupByCategory([null, undefined]), []);
});

// ⚠️ THE CALLER'S ARRAY MUST NOT BE REORDERED UNDER IT. Both screens sort their own
// items afterwards, and the order screen repaints on every Firestore snapshot — a
// module that mutated the array it was handed would shuffle rows under a finger
// that is mid-keystroke.
test('the input array is left untouched', () => {
  const list = [{ name: 'Milk', category: 'Dairy' }, { name: 'Salt' }];
  const before = list.map(i => i.name);
  groupByCategory(list);
  assert.deepEqual(list.map(i => i.name), before);
});
