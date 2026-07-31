// Unit tests for the read-only "what this supplier sells" screen (P15).
//
// Only the grouping/ordering decision is tested — that is the part with rules in it.
// The screen itself needs a real document and is checked by driving the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemGroups, countLabel } from '../js/orders/supplier-items.js';

const ing = (id, name, extra = {}) => ({ id, name, active: true, ...extra });

test('an empty supplier yields no groups at all', () => {
  assert.deepEqual(itemGroups([]), []);
  assert.deepEqual(itemGroups(null), []);
});

test('a product with no category is shown bare, with no heading to sit under', () => {
  const groups = itemGroups([ing('a', 'Olive oil')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, '');
  assert.deepEqual(groups[0].items, [{ id: 'a', label: 'Olive oil', unit: '' }]);
});

test('"Other" is treated as no category — it is the default, not information', () => {
  const groups = itemGroups([ing('a', 'Olive oil', { category: 'Other' })]);
  assert.equal(groups[0].category, '');
});

test('named categories come A-Z, each with its own heading', () => {
  const groups = itemGroups([
    ing('c', 'Milk', { category: 'Fresh' }),
    ing('a', 'Flour', { category: 'Dry' }),
    ing('b', 'Butter', { category: 'Fresh' }),
  ]);
  assert.deepEqual(groups.map(g => g.category), ['Dry', 'Fresh']);
  assert.deepEqual(groups[1].items.map(i => i.label), ['Butter', 'Milk']);
});

// The whole reason the uncategorised block is not left in alphabetical position:
// rows with no heading must never appear UNDER a heading they do not belong to.
test('the uncategorised block comes FIRST, above every heading', () => {
  const groups = itemGroups([
    ing('a', 'Flour', { category: 'Dry' }),
    ing('b', 'Cling film'),
    ing('c', 'Milk', { category: 'Fresh' }),
  ]);
  assert.deepEqual(groups.map(g => g.category), ['', 'Dry', 'Fresh']);
  assert.deepEqual(groups[0].items.map(i => i.label), ['Cling film']);
});

test('rows sort by the label a person reads, not by the name alone', () => {
  const groups = itemGroups([
    ing('a', 'Flour', { weight: '25kg' }),
    ing('b', 'Flour', { weight: '1kg' }),
  ]);
  assert.deepEqual(groups[0].items.map(i => i.label), ['Flour 1kg', 'Flour 25kg']);
});

// Without the tie-break, two identical labels can swap places between repaints and
// the rows jump under the eye reading them.
test('identical labels keep a stable order, broken by id', () => {
  const forwards = itemGroups([ing('z', 'Salt'), ing('a', 'Salt')]);
  const backwards = itemGroups([ing('a', 'Salt'), ing('z', 'Salt')]);
  assert.deepEqual(forwards[0].items.map(i => i.id), ['a', 'z']);
  assert.deepEqual(backwards[0].items.map(i => i.id), ['a', 'z']);
});

test('a missing weight leaves no trailing space in the label', () => {
  assert.equal(itemGroups([ing('a', 'Semolina')])[0].items[0].label, 'Semolina');
});

test('a nameless product is named honestly, never by its document id', () => {
  const label = itemGroups([{ id: 'Fdx92kQ1' }])[0].items[0].label;
  assert.equal(label, 'Unnamed product');
  assert.ok(!label.includes('Fdx92kQ1'));
});

test('a missing unit is an empty string, so the screen can leave it out', () => {
  assert.equal(itemGroups([ing('a', 'Semolina')])[0].items[0].unit, '');
  assert.equal(itemGroups([ing('a', 'Semolina', { unit: 'bag' })])[0].items[0].unit, 'bag');
});

test('nothing in the list is dropped, whatever the shape', () => {
  const groups = itemGroups([ing('a', 'Flour'), null, ing('b', 'Salt', { category: 'Dry' })]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, 2);
});

test('the count reads as English, singular and plural', () => {
  assert.equal(countLabel(1), '1 ingredient');
  assert.equal(countLabel(12), '12 ingredients');
  assert.equal(countLabel(0), '0 ingredients');
});
