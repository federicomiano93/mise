// Unit tests for the third question about a session (P15): a location says which
// parts of the app it bought, a role says which of those THIS person sees.
//
// ⚠️ THE TWO DEFAULTS POINT IN OPPOSITE DIRECTIONS AND BOTH ARE RIGHT. A missing
// `sections` field must never empty a working app, so allowedSections defaults to
// ALLOWED. A role nobody recognises must never open the screen that shows what the
// business pays and earns, so this one defaults to REFUSED. Most of the tests
// below are one of those two sentences, checked from a different direction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, sectionsFor, isSectionAllowedFor, allowedSections,
} from '../js/sections.js';

const venue = extra => ({ name: 'A place', sections: extra || {} });

// ── Who sees Food Cost ───────────────────────────────────────────────────────

test('an owner and a manager see Food Cost', () => {
  for (const role of ['owner', 'manager']) {
    assert.equal(isSectionAllowedFor(venue(), role, 'foodcost'), true, role);
  }
});

// ⚠️ THE POINT OF THE WHOLE FEATURE. Food Cost is what the business pays for its
// ingredients and earns on each product; everything else in the app is what to
// make and how much of it.
test('an ordinary employee does not', () => {
  assert.equal(isSectionAllowedFor(venue(), 'staff', 'foodcost'), false);
});

test('a role nobody recognises does not either', () => {
  for (const role of ['head-chef', 'Owner', 'MANAGER', '', null, undefined, 1, {}]) {
    assert.equal(isSectionAllowedFor(venue(), role, 'foodcost'), false, String(role));
  }
});

// ── Everything else is unchanged for everybody ───────────────────────────────

test('the other four sections are open to every role', () => {
  for (const role of ['owner', 'manager', 'staff', 'nonsense']) {
    for (const name of SECTIONS.filter(s => s !== 'foodcost')) {
      assert.equal(isSectionAllowedFor(venue(), role, name), true, `${role}/${name}`);
    }
  }
});

// ⚠️ A baker who cannot open the Calculator has no app. The role narrows exactly
// one screen, and this is what says so if a future change widens it.
test('an employee keeps every screen the daily work needs', () => {
  const seen = sectionsFor(venue(), 'staff');
  assert.deepEqual(seen, {
    orders: true, calculator: true, catalogue: true, pastries: true, foodcost: false,
  });
});

// ── A role narrows, it never widens ──────────────────────────────────────────

// ⚠️ THE DIRECTION THAT MATTERS. Being an owner cannot turn on a section the
// venue does not have — otherwise the Orders-only restaurant would grow a Food
// Cost screen the moment its owner signed in.
test('an owner cannot see a section the location does not have', () => {
  const ordersOnly = venue({ calculator: false, catalogue: false, pastries: false, foodcost: false });
  assert.equal(isSectionAllowedFor(ordersOnly, 'owner', 'foodcost'), false);
  assert.equal(isSectionAllowedFor(ordersOnly, 'owner', 'calculator'), false);
  assert.equal(isSectionAllowedFor(ordersOnly, 'owner', 'orders'), true);
});

test('the result is the location set narrowed, never anything new', () => {
  const ordersOnly = venue({ calculator: false, catalogue: false, pastries: false, foodcost: false });
  for (const role of ['owner', 'manager', 'staff']) {
    const seen = sectionsFor(ordersOnly, role);
    const bought = allowedSections(ordersOnly);
    for (const name of SECTIONS) {
      if (seen[name]) assert.equal(bought[name], true, `${role} saw ${name} the venue lacks`);
    }
  }
});

// ── The awkward documents ────────────────────────────────────────────────────

// ⚠️ A missing or corrupt location document must not empty the app — that
// default has been in place since v205 and is deliberately UNCHANGED here. Only
// the money screen is narrowed, and only by role.
test('a missing location document still leaves an owner everything', () => {
  for (const broken of [null, undefined, {}, { sections: null }, { sections: 'yes' }, []]) {
    const seen = sectionsFor(broken, 'owner');
    assert.equal(seen.orders, true, String(broken));
    assert.equal(seen.foodcost, true, String(broken));
  }
});

test('a missing location document still hides Food Cost from an employee', () => {
  for (const broken of [null, undefined, {}, { sections: null }]) {
    assert.equal(sectionsFor(broken, 'staff').foodcost, false, String(broken));
  }
});

// The stray-space forgiveness of allowedSections survives the narrowing.
test('a section name typed with a stray space is still honoured', () => {
  const doc = { 'sections ': { 'foodcost ': false } };
  assert.equal(isSectionAllowedFor(doc, 'owner', 'foodcost'), false);
});

test('every section name gets an answer, and it is always a boolean', () => {
  for (const role of ['owner', 'manager', 'staff', 'nonsense']) {
    const seen = sectionsFor(venue(), role);
    assert.deepEqual(Object.keys(seen).sort(), [...SECTIONS].sort(), role);
    for (const name of SECTIONS) assert.equal(typeof seen[name], 'boolean', `${role}/${name}`);
  }
});
