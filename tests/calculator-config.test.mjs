// Unit tests for the calculator data model (P15 — the owner cannot read code, so these
// tests are the safety net). A product belongs to the CLIENT that orders it:
// clients[].products[], with quantities per (client, product). These tests lock in:
//   • the shape and its read helpers,
//   • the dough math (Σ qty×weight) still matching the legacy formulas,
//   • two clients ordering the same thing keeping two independent quantities,
//   • the migration off the shared catalogue — and above all that it PRESERVES every
//     product id, because the divisor ticks, the WhatsApp lists, the saved log rows and
//     the typed quantities all key by it,
//   • migration of the oldest per-tab shape,
//   • divisor / crate / WhatsApp resolution.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrderPrefillWindow,
  isFreeLineId,
  ORDER_PREFILL_WINDOWS,
  ORDER_PREFILL_LABELS,
  pairId,
  computeTarget,
  clampWeight,
  doughExtraGrams,
  getTabProducts,
  getClients,
  getClientById,
  getProducts,
  getProductById,
  getAllProducts,
  getWhatsappLists,
  getWhatsappClients,
  resolveListClients,
  resolveDirectClient,
  isExtraDoughEnabled,
  normalizeConfig,
  getDivisorProducts,
  getDivisorIncluded,
  isInDivisor,
  divisorTotal,
  splitDough,
  clampCratePerBox,
  isCrateEnabled,
  getCratePerBox,
  crateCount,
  CRATE_PERBOX_MIN,
  CRATE_PERBOX_MAX,
  CRATE_PERBOX_DEFAULT,
  WEIGHT_MIN,
  WEIGHT_MAX,
  EXTRA_MAX_G,
} from '../js/calculator-config.js';

// ⚠️ THE BAKERY'S DATA IS A FIXTURE NOW, NOT THE APP'S DEFAULT (13 Aug 2026).
// These assertions run through The Italian Club Bakery's own clients, products
// and formulas — including the ones proving the config-driven scaler is
// byte-identical to the three hand-written scalers it replaced. Every number is
// unchanged; only where it is kept has moved, out of js/ and into tests/, so that
// a customer who buys the app no longer opens it holding somebody else's recipes.
import { BAKERY_CONFIG } from './fixtures/bakery-config.mjs';

// Helper: build a getQty(qtyId) function from a plain { qtyId: qty } map.
const qtyFrom = (map) => (id) => map[id] || 0;

// ── Catalogue + tab view ──────────────────────────────────────────────────────

test('the default config gives each client its own products (10 in all)', () => {
  assert.equal(getProducts(BAKERY_CONFIG).length, 10);
  assert.equal(getClients(BAKERY_CONFIG).length, 4);
  // There is no shared catalogue any more: every product sits under exactly one client.
  assert.equal('products' in BAKERY_CONFIG, false);
  for (const p of getProducts(BAKERY_CONFIG)) {
    assert.ok(p.clientId, p.name + ' knows which client orders it');
    assert.ok(p.name && p.recipeId && p.weight > 0, p.name + ' is fully described');
  }
});

test('getTabProducts is a filtered view: one row per (client, product) of that recipe', () => {
  assert.deepEqual(getTabProducts(BAKERY_CONFIG, 'focaccia').map(p => p.id),
    ['f-pizze', 'f-focacce', 'f-ciabatta', 'f-trayfocaccia', 'f-panini']);
  assert.deepEqual(getTabProducts(BAKERY_CONFIG, 'brioche').map(p => p.id),
    ['b-burgerbuns', 'b-subrolls', 'b-bun', 'b-rolls']);
  assert.deepEqual(getTabProducts(BAKERY_CONFIG, 'sourdough').map(p => p.id), ['s-loaf']);
});

test('each tab row carries its client, weight, kind, crate and a per-pair qtyId', () => {
  const ciabatta = getTabProducts(BAKERY_CONFIG, 'focaccia').find(p => p.id === 'f-ciabatta');
  assert.equal(ciabatta.clientName, 'Client 1');
  assert.equal(ciabatta.clientId, 'c-client-1');
  assert.equal(ciabatta.weight, 151);
  assert.equal(ciabatta.kind, 'dropdown');
  assert.equal(ciabatta.crate.show, true);
  assert.equal(ciabatta.qtyId, pairId('c-client-1', 'f-ciabatta'));
});

test('focaccia target matches the legacy hardcoded formula (products only)', () => {
  const q = {
    [pairId('c-bakery', 'f-pizze')]: 10,
    [pairId('c-bakery', 'f-focacce')]: 5,
    [pairId('c-client-1', 'f-ciabatta')]: 40,
    [pairId('c-client-2', 'f-trayfocaccia')]: 3,
    [pairId('c-client-3', 'f-panini')]: 24,
  };
  const legacy = 10 * 201 + 5 * 181 + 40 * 151 + 3 * 1800 + 24 * 131;
  assert.equal(computeTarget(BAKERY_CONFIG, 'focaccia', qtyFrom(q)), legacy);
});

test('brioche target matches the legacy hardcoded formula (products only)', () => {
  const q = {
    [pairId('c-client-1', 'b-burgerbuns')]: 50,
    [pairId('c-client-1', 'b-subrolls')]: 30,
    [pairId('c-client-2', 'b-bun')]: 20,
    [pairId('c-client-2', 'b-rolls')]: 15,
  };
  const legacy = 50 * 81 + 30 * 121 + 20 * 71 + 15 * 71;
  assert.equal(computeTarget(BAKERY_CONFIG, 'brioche', qtyFrom(q)), legacy);
});

test('sourdough target matches loaves × default loaf weight (905 g)', () => {
  const q = { [pairId('c-client-2', 's-loaf')]: 12 };
  assert.equal(computeTarget(BAKERY_CONFIG, 'sourdough', qtyFrom(q)), 12 * 905);
});

test('empty quantities give zero dough', () => {
  assert.equal(computeTarget(BAKERY_CONFIG, 'focaccia', () => 0), 0);
  assert.equal(computeTarget(BAKERY_CONFIG, 'brioche', () => 0), 0);
  assert.equal(computeTarget(BAKERY_CONFIG, 'sourdough', () => 0), 0);
});

test('per-pair quantities: the SAME product on two clients has two independent boxes', () => {
  // The new headline capability: one catalogue product, ordered by two clients, each
  // with its own quantity — two rows, two qtyIds, summed independently.
  // Two clients holding their own copy — deliberately sharing one id, as the migration
  // from the shared catalogue produces.
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'focaccia', weight: 150, kind: 'number' }] },
      { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'focaccia', weight: 150, kind: 'number' }] },
    ],
  };
  const rows = getTabProducts(config, 'focaccia');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.clientName), ['A', 'B']);
  const q = { [pairId('cA', 'p1')]: 10, [pairId('cB', 'p1')]: 4 };
  assert.equal(computeTarget(config, 'focaccia', qtyFrom(q)), 10 * 150 + 4 * 150);
});

test('per-client kind: the same product can be a dropdown for one client, a number for another', () => {
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'dropdown' }] },
      { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'number' }] },
    ],
  };
  const rows = getTabProducts(config, 'focaccia');
  assert.equal(rows.find(r => r.clientId === 'cA').kind, 'dropdown');
  assert.equal(rows.find(r => r.clientId === 'cB').kind, 'number');
});

test('a tab view only includes products of that recipe', () => {
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'Mixed', products: [
      { id: 'pf', name: 'F', recipeId: 'focaccia',  weight: 100, kind: 'number' },
      { id: 'pb', name: 'B', recipeId: 'brioche',   weight: 200, kind: 'number' },
      { id: 'ps', name: 'S', recipeId: 'sourdough', weight: 300, kind: 'number' },
    ] }],
  };
  assert.deepEqual(getTabProducts(config, 'focaccia').map(p => p.id), ['pf']);
  assert.deepEqual(getTabProducts(config, 'brioche').map(p => p.id), ['pb']);
  const q = { [pairId('c1', 'pf')]: 1, [pairId('c1', 'pb')]: 1, [pairId('c1', 'ps')]: 1 };
  assert.equal(computeTarget(config, 'brioche', qtyFrom(q)), 200);
});

test('getTabProducts tolerates a missing or malformed config', () => {
  assert.deepEqual(getTabProducts({}, 'focaccia'), []);
  assert.deepEqual(getTabProducts({ clients: 'oops' }, 'focaccia'), []);
  assert.deepEqual(getTabProducts(null, 'focaccia'), []);
});

test('a client product with no id is dropped rather than shown as a blank row', () => {
  const config = normalizeConfig({
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [
      { id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 },
      { name: 'no id at all', recipeId: 'focaccia', weight: 100 },
    ] }],
  });
  assert.deepEqual(getTabProducts(config, 'focaccia').map(p => p.id), ['p1']);
});

// ── clampWeight / NaN safety ───────────────────────────────────────────────────

test('clampWeight blocks absurd typos and non-numbers', () => {
  assert.equal(clampWeight(150), 150);
  assert.equal(clampWeight(99999), WEIGHT_MAX);
  assert.equal(clampWeight(0), WEIGHT_MIN);
  assert.equal(clampWeight(-5), WEIGHT_MIN);
  assert.equal(clampWeight('abc'), WEIGHT_MIN);
  assert.equal(clampWeight(undefined), WEIGHT_MIN);
});

test('computeTarget never produces NaN even with a corrupt weight', () => {
  const config = {
    products: [{ id: 'p1', name: 'Bad', recipeId: 'focaccia', weight: 'oops' }],
    clients: [{ id: 'c1', name: 'X', items: [{ productId: 'p1', kind: 'number' }] }],
  };
  assert.ok(Number.isFinite(computeTarget(config, 'focaccia', () => 5)));
});

test('doughExtraGrams: kg multiplies, grams pass through, junk is zero, capped', () => {
  assert.equal(doughExtraGrams(1, 'kg'), 1000);
  assert.equal(doughExtraGrams(1.5, 'kg'), 1500);
  assert.equal(doughExtraGrams(1500, 'g'), 1500);
  assert.equal(doughExtraGrams(0, 'g'), 0);
  assert.equal(doughExtraGrams(-5, 'g'), 0);
  assert.equal(doughExtraGrams('abc', 'kg'), 0);
  assert.equal(doughExtraGrams(999999, 'kg'), EXTRA_MAX_G);
});

// ── Catalogue read helpers ─────────────────────────────────────────────────────

test('getProductById finds a catalogue product; getAllProducts tags ordering clients', () => {
  assert.equal(getProductById(BAKERY_CONFIG, 's-loaf').name, 'Loaf');
  assert.equal(getProductById(BAKERY_CONFIG, 'nope'), null);
  const all = getAllProducts(BAKERY_CONFIG);
  assert.equal(all.length, 10);
  const loaf = all.find(p => p.id === 's-loaf');
  assert.deepEqual(loaf.clientNames, ['Client 2']);
  assert.equal(loaf.clientCount, 1);
  const pizze = all.find(p => p.id === 'f-pizze');
  assert.deepEqual(pizze.clientNames, ['Bakery']);
});

test('two clients holding the same product are two separate entries', () => {
  // They may share an id (that is what the migration produces), but each is its own
  // product, owned by its own client — changing one must never move the other.
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] },
      { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] },
    ],
  };
  const all = getAllProducts(config);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(p => p.clientName), ['A', 'B']);
  assert.deepEqual(all.map(p => p.clientCount), [1, 1]);
});

test('getClientById / getWhatsappLists / resolveListClients on the default config', () => {
  assert.equal(getClientById(BAKERY_CONFIG, 'c-client-2').name, 'Client 2');
  assert.equal(getClientById(BAKERY_CONFIG, 'nope'), null);
  const lists = getWhatsappLists(BAKERY_CONFIG);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].title, 'Market order');
  const resolved = resolveListClients(BAKERY_CONFIG, lists[0]);
  assert.deepEqual(resolved.map(r => r.client.id), ['c-client-1', 'c-client-2', 'c-client-3']);
  const client1 = resolved.find(r => r.client.id === 'c-client-1');
  assert.deepEqual(client1.products.map(p => p.id), ['f-ciabatta', 'b-burgerbuns', 'b-subrolls']);
});

test('a WhatsApp list entry can still attach a product another client owns', () => {
  // The lists stay decoupled: what you send a client is chosen by hand, not derived
  // from what it orders. A product it does not own resolves globally rather than
  // silently dropping a line from the message.
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [{ id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 }] },
      { id: 'cB', name: 'B', products: [{ id: 'pB', name: 'Panini', recipeId: 'focaccia', weight: 130 }] },
    ],
    whatsappLists: [{ id: 'wl1', title: 'Order', clients: [{ clientId: 'cB', products: ['pB', 'pA'] }] }],
  };
  const resolved = resolveListClients(config, config.whatsappLists[0]);
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].products.map(p => p.name), ['Panini', 'Loaf']);
});

test('a shared id resolves inside the entry OWN client, not the other copy', () => {
  // Both clients hold id p1, but with different names after one was renamed. The list
  // belongs to B, so it must print B's name.
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'Loaves of bread', recipeId: 'sourdough', weight: 905 }] },
      { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'Sourdough loaf', recipeId: 'sourdough', weight: 905 }] },
    ],
    whatsappLists: [{ id: 'wl1', title: 'Order', clients: [{ clientId: 'cB', products: ['p1'] }] }],
  };
  const resolved = resolveListClients(config, config.whatsappLists[0]);
  assert.deepEqual(resolved[0].products.map(p => p.name), ['Sourdough loaf']);
});

test('direct WhatsApp clients: typed name + products resolved by id', () => {
  assert.deepEqual(getWhatsappClients(BAKERY_CONFIG), []);
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'cA', name: 'A', products: [{ id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 }] }],
    whatsappClients: [{ id: 'wc1', name: 'Walk-in', products: ['pA', 'ghost'] }],
  };
  const resolved = resolveDirectClient(config, getWhatsappClients(config)[0]);
  assert.equal(resolved.name, 'Walk-in');
  assert.deepEqual(resolved.products.map(p => p.name), ['Loaf']); // ghost pruned
});

// ── Normalisation (new catalogue shape) ────────────────────────────────────────

test('normalizeConfig clamps weights, re-homes an unknown recipe, drops junk products', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'X', products: [
      { id: 'p1', name: 'Big', recipeId: 'brioche', weight: 99999 },  // weight capped
      { id: 'p2', name: 'Bad', recipeId: 'weird',   weight: 'oops' }, // recipe re-homed, weight->MIN
      { notAnId: true },                                              // dropped
    ] }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(getProducts(norm).length, 2);
  assert.equal(getProductById(norm, 'p1').weight, WEIGHT_MAX);
  assert.equal(getProductById(norm, 'p1').recipeId, 'brioche', 'a real recipe is left alone');
  assert.equal(getProductById(norm, 'p2').recipeId, 'focaccia', 'an unknown one falls to the first');
  assert.equal(getProductById(norm, 'p2').weight, WEIGHT_MIN);
});

test('a product on a recipe the owner CREATED is not dragged onto Focaccia', () => {
  // The recipe list is configurable, so validating against the three shipped ids
  // silently moved every product on a custom recipe.
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'X', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'r-mine', weight: 150 }] }],
    recipes: [
      { id: 'focaccia', name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 100 }] },
      { id: 'r-mine', name: 'My dough', ingredients: [{ label: 'Flour', grams: 100 }] },
    ],
  };
  const norm = normalizeConfig(raw);
  assert.equal(getProductById(norm, 'p1').recipeId, 'r-mine');
  assert.deepEqual(getTabProducts(norm, 'r-mine').map(p => p.id), ['p1']);
});

test('one client never holds the same product twice (first wins)', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'X', products: [
      { id: 'p1', name: 'First', recipeId: 'focaccia', weight: 100 },
      { id: 'p1', name: 'Dup',   recipeId: 'brioche',  weight: 200 },
    ] }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(getProducts(norm).length, 1);
  assert.equal(getProductById(norm, 'p1').name, 'First');
});

test('a legacy quantity kind is migrated on a client product too', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [
      { id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'ciabatta' },
    ] }],
  };
  const products = getClientById(normalizeConfig(raw), 'c1').products;
  assert.equal(products.length, 1);
  assert.equal(products[0].kind, 'dropdown'); // ciabatta -> dropdown
});

test('a product crate box is kept and clamped', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'number', crate: { show: true, perBox: 0 } }] }],
  };
  const row = getTabProducts(normalizeConfig(raw), 'focaccia')[0];
  assert.equal(isCrateEnabled(row), true);
  assert.equal(getCratePerBox(row), CRATE_PERBOX_MIN); // 0 clamped up
});

test('normalizeConfig keeps direct WhatsApp clients, pruning their dead product ids', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] }],
    whatsappClients: [{ id: 'wc1', name: 'Custom', products: ['p1', 'gone'] }, { notAnObject: true }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(norm.whatsappClients.length, 1);
  assert.equal(norm.whatsappClients[0].name, 'Custom');
  assert.deepEqual(norm.whatsappClients[0].products, ['p1']);
});

test('normalizeConfig prunes WhatsApp list entries for dead clients/products', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] }],
    whatsappLists: [{ id: 'wl1', title: 'L', clients: [
      { clientId: 'c1', products: ['p1', 'ghost'] },
      { clientId: 'gone', products: ['p1'] },
    ] }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(norm.whatsappLists[0].clients.length, 1);
  // `extras` (free lines typed by hand) is always present, empty when there are none.
  assert.deepEqual(norm.whatsappLists[0].clients[0], { clientId: 'c1', products: ['p1'], extras: [] });
});

// ⚠️ REWRITTEN 13 Aug 2026, AND THE NEW EXPECTATION IS THE FEATURE. This used to
// assert that garbage input produced TEN PRODUCTS — The Italian Club Bakery's ten,
// which is what the default held. That is exactly what a customer who bought the
// app used to be shown before their own document arrived.
//
// Nonsense in must still not crash and must still produce a usable shape; it must
// simply produce an EMPTY one. Anything else is inventing somebody's data.
test('missing or garbage input gives an empty config, never somebody else’s', () => {
  for (const bad of [null, 'oops', {}, 42, [], undefined]) {
    const cfg = normalizeConfig(bad);
    assert.equal(getProducts(cfg).length, 0, `${JSON.stringify(bad)} must produce no products`);
    assert.deepEqual(cfg.clients, [], 'and no clients');
    assert.deepEqual(cfg.recipes, [], 'and no recipes');
    // Still a usable shape: the settings are present, so no screen divides by
    // undefined on a brand-new venue.
    assert.equal(cfg.logRetentionHours, 24);
    assert.equal(cfg.orderPrefillWindow, 'both');
  }
});

test('isExtraDoughEnabled defaults to true and honours an explicit false', () => {
  assert.equal(isExtraDoughEnabled(BAKERY_CONFIG, 'focaccia'), true);
  assert.equal(isExtraDoughEnabled({}, 'brioche'), true);
  assert.equal(isExtraDoughEnabled(null, 'sourdough'), true);
  assert.equal(isExtraDoughEnabled({ extraDough: { focaccia: false } }, 'focaccia'), false);
});

// ── Migration: the shared catalogue → products owned by their client ──────────

test('migration: a catalogue document becomes products owned by their client', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    products: [
      { id: 'p1', name: 'Ciabatta', recipeId: 'focaccia',  weight: 151 },
      { id: 'p2', name: 'Panini',   recipeId: 'focaccia',  weight: 131 },
      { id: 'p3', name: 'Loaf',     recipeId: 'sourdough', weight: 905 },
    ],
    clients: [
      { id: 'c1', name: 'A', items: [
        { productId: 'p1', kind: 'ciabatta', crate: { show: true, perBox: 20 } },
        { productId: 'p2', kind: 'panini' },
      ] },
      { id: 'c2', name: 'B', items: [{ productId: 'p3', kind: 'number' }] },
    ],
  };
  const norm = normalizeConfig(raw);
  assert.equal('products' in norm, false, 'the shared catalogue is gone');
  assert.deepEqual(getClientById(norm, 'c1').products.map(p => p.id), ['p1', 'p2']);
  assert.deepEqual(getClientById(norm, 'c2').products.map(p => p.id), ['p3']);
  // Name, recipe and weight came from the catalogue; kind and crate from the item.
  const ciabatta = getClientById(norm, 'c1').products[0];
  assert.equal(ciabatta.name, 'Ciabatta');
  assert.equal(ciabatta.weight, 151);
  assert.equal(ciabatta.recipeId, 'focaccia');
  assert.equal(ciabatta.kind, 'dropdown');       // legacy 'ciabatta' migrated
  assert.equal(ciabatta.crate.show, true);
  assert.equal(getClientById(norm, 'c1').products[1].kind, 'number'); // legacy 'panini'
});

test('migration: a product ordered by TWO clients keeps ONE id in both copies', () => {
  // The load-bearing promise. Four things key by that id — divisor ticks, WhatsApp
  // lists, saved log rows and the typed quantities — and a fresh id for the second
  // client would quietly cut all four.
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'shared', name: 'Loaves of bread', recipeId: 'sourdough', weight: 905 }],
    clients: [
      { id: 'cA', name: 'CLIENT A', items: [{ productId: 'shared', kind: 'number' }] },
      { id: 'cB', name: 'CLIENT B', items: [{ productId: 'shared', kind: 'number' }] },
    ],
    divisorIncluded: { sourdough: ['shared'] },
    whatsappLists: [{ id: 'wl', title: 'Morning list', clients: [{ clientId: 'cB', products: ['shared'] }] }],
  };
  const norm = normalizeConfig(raw);
  assert.deepEqual(getClientById(norm, 'cA').products.map(p => p.id), ['shared']);
  assert.deepEqual(getClientById(norm, 'cB').products.map(p => p.id), ['shared']);
  assert.deepEqual(getDivisorIncluded(norm, 'sourdough'), ['shared']);
  const resolved = resolveListClients(norm, norm.whatsappLists[0]);
  assert.deepEqual(resolved[0].products.map(p => p.name), ['Loaves of bread']);
  // The two quantity boxes keep the SAME keys the app already stored.
  assert.deepEqual(getTabProducts(norm, 'sourdough').map(r => r.qtyId),
    [pairId('cA', 'shared'), pairId('cB', 'shared')]);
});

test('migration: the stale nested copy left by the catalogue era is ignored', () => {
  // v1.5.0 kept clients[].products as a revert window while maintaining items[].
  // Reading it instead of items[] would resurrect long-deleted products.
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'live', name: 'Live', recipeId: 'focaccia', weight: 100 }],
    clients: [{
      id: 'c1', name: 'A',
      items: [{ productId: 'live', kind: 'number' }],
      products: [{ id: 'stale', name: 'Deleted ages ago', recipeId: 'focaccia', weight: 999 }],
    }],
  };
  assert.deepEqual(getClientById(normalizeConfig(raw), 'c1').products.map(p => p.id), ['live']);
});

test('migration: an item pointing at a product that no longer exists is dropped', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }, { productId: 'gone', kind: 'number' }] }],
  };
  assert.deepEqual(getClientById(normalizeConfig(raw), 'c1').products.map(p => p.id), ['p1']);
});

test('migration: re-normalising the migrated config changes nothing', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'p1', name: 'Pizzas', recipeId: 'focaccia', weight: 201 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }] }],
  };
  const once = normalizeConfig(raw);
  const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice.clients, once.clients);
});

test('rollback safety: the saved shape is the one older code migrates FROM', () => {
  // A document written now has clients[].products and no top-level products[] —
  // exactly the pre-catalogue shape, so a phone still on an older version reads it
  // correctly instead of finding an empty address book.
  const saved = normalizeConfig({
    products: [{ id: 'p1', name: 'Pizzas', recipeId: 'focaccia', weight: 201 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }] }],
  });
  assert.equal('products' in saved, false);
  assert.equal(saved.clients[0].products[0].name, 'Pizzas');
  assert.equal(saved.clients[0].products[0].weight, 201);
});

test('migration math equals the legacy formula after migrating', () => {
  const norm = normalizeConfig({
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'f-pizze', name: 'Pizzas', recipeId: 'focaccia', weight: 201 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'f-pizze', kind: 'number' }] }],
  });
  assert.equal(computeTarget(norm, 'focaccia', qtyFrom({ [pairId('c1', 'f-pizze')]: 7 })), 7 * 201);
});

// ── Migration: oldest per-tab + market shape ───────────────────────────

test('migration: the oldest per-tab + market shape becomes client-owned products', () => {
  const legacy = {
    recipes: BAKERY_CONFIG.recipes,
    focaccia: { clients: [
      { id: 'f-c1', name: 'Client 1', products: [{ id: 'f-cia', name: 'Ciabatta', weight: 151, kind: 'ciabatta' }] },
    ] },
    brioche: { clients: [
      { id: 'b-c1', name: 'Client 1', products: [{ id: 'b-bb', name: 'Burger buns', weight: 81, kind: 'number' }] },
    ] },
    market: { lists: [
      { id: 'l1', title: 'Market order', clients: [{ id: 'm-1', name: 'Client 1', products: [{ id: 'om-x', name: 'X' }] }] },
    ] },
  };
  const norm = normalizeConfig(legacy);
  // "Client 1" appears three times -> one merged client holding both products.
  assert.equal(getClients(norm).length, 1);
  const client = getClients(norm)[0];
  assert.equal(client.name, 'Client 1');
  assert.deepEqual(client.products.map(p => p.id).sort(), ['b-bb', 'f-cia']);
  assert.equal(getProductById(norm, 'f-cia').recipeId, 'focaccia');
  assert.equal(getProductById(norm, 'b-bb').recipeId, 'brioche');
  assert.equal(norm.whatsappLists.length, 1);
  assert.equal(norm.whatsappLists[0].clients[0].clientId, client.id);
  assert.deepEqual(norm.whatsappLists[0].clients[0].products.sort(), ['b-bb', 'f-cia']);
});

// ── Divisor (display-only crate split) ─────────────────────────────────────────

test('divisor includes NOTHING by default (opt-in)', () => {
  const q = { [pairId('c-bakery', 'f-pizze')]: 10 };
  assert.equal(divisorTotal(BAKERY_CONFIG, 'focaccia', qtyFrom(q)), 0);
  assert.equal(getDivisorProducts(BAKERY_CONFIG, 'focaccia').length, 0);
  assert.equal(isInDivisor(BAKERY_CONFIG, 'focaccia', 'f-panini'), false);
});

test('divisor sums only ticked products; it sums across every client of a ticked product', () => {
  const config = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [
      { id: 'cA', name: 'A', products: [
        { id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100, kind: 'number' },
        { id: 'p2', name: 'Pizza',  recipeId: 'focaccia', weight: 200, kind: 'number' },
      ] },
      { id: 'cB', name: 'B', products: [
        { id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100, kind: 'number' }, // same id
      ] },
    ],
    divisorIncluded: { focaccia: ['p1'], brioche: [], sourdough: [] },
  };
  const q = {
    [pairId('cA', 'p1')]: 10, [pairId('cA', 'p2')]: 10, [pairId('cB', 'p1')]: 5,
  };
  // p1 ticked -> sum BOTH clients' p1 (10+5)×100; p2 untouched in the divisor.
  assert.equal(divisorTotal(config, 'focaccia', qtyFrom(q)), 15 * 100);
  // The recipe math still sums everything.
  assert.equal(computeTarget(config, 'focaccia', qtyFrom(q)), 10 * 100 + 10 * 200 + 5 * 100);
  assert.deepEqual(getDivisorProducts(config, 'focaccia').map(r => r.id), ['p1', 'p1']);
});

test('splitDough divides into crates, and is safe at the edges', () => {
  assert.equal(splitDough(3000, 2), 1500);
  assert.equal(splitDough(5000, 4), 1250);
  assert.equal(splitDough(3000, 0), 0);
  assert.equal(splitDough(3000, -1), 0);
  assert.equal(splitDough('abc', 2), 0);
  assert.equal(splitDough(3000, 'x'), 0);
});

test('normalizeConfig prunes divisor inclusions for products that no longer exist', () => {
  const raw = {
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'X', products: [{ id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100 }] }],
    divisorIncluded: { focaccia: ['p1', 'ghost'], brioche: ['also-gone'] },
  };
  const norm = normalizeConfig(raw);
  assert.deepEqual(getDivisorIncluded(norm, 'focaccia'), ['p1']);
  assert.deepEqual(getDivisorIncluded(norm, 'brioche'), []);
  assert.deepEqual(getDivisorIncluded(norm, 'sourdough'), []);
});

// ── Crate boxes (display-only, per association) ─────────────────────────────────

test('crateCount = quantity ÷ pieces per box, safe at the edges', () => {
  assert.equal(crateCount(40, 20), 2);
  assert.equal(crateCount(30, 20), 1.5);
  assert.equal(crateCount(0, 20), 0);
  assert.equal(crateCount(40, 0), 0);
  assert.equal(crateCount(-5, 20), 0);
  assert.equal(crateCount('abc', 20), 0);
});

test('clampCratePerBox keeps sane values and defaults on junk', () => {
  assert.equal(clampCratePerBox(20), 20);
  assert.equal(clampCratePerBox(0), CRATE_PERBOX_MIN);
  assert.equal(clampCratePerBox(99999), CRATE_PERBOX_MAX);
  assert.equal(clampCratePerBox('abc'), CRATE_PERBOX_DEFAULT);
  assert.equal(clampCratePerBox(undefined), CRATE_PERBOX_DEFAULT);
});

test('crate box is per association: off by default, on only when explicitly enabled', () => {
  assert.equal(isCrateEnabled({ crate: { show: true, perBox: 20 } }), true);
  assert.equal(isCrateEnabled({ crate: { show: false } }), false);
  assert.equal(isCrateEnabled({}), false);
  assert.equal(isCrateEnabled(null), false);
  assert.equal(getCratePerBox({ crate: { perBox: 24 } }), 24);
  assert.equal(getCratePerBox({}), CRATE_PERBOX_DEFAULT);
});

test('the default ciabatta association has its crate box enabled (20 pieces)', () => {
  const ciabatta = getTabProducts(BAKERY_CONFIG, 'focaccia').find(p => p.id === 'f-ciabatta');
  assert.equal(isCrateEnabled(ciabatta), true);
  assert.equal(getCratePerBox(ciabatta), 20);
});

// ── Names carry invisible spaces (A5) ─────────────────────────────────────────
// A trailing space is invisible in the app AND in the Firebase console, but it shows
// up the moment the name is used inside a sentence: the log printed
// "Seeded burger buns : 40 pz". Normalisation runs on BOTH read and save, so cleaning
// it here fixes what is already stored without touching the database.

test('names are trimmed on the way in, so a stored trailing space stops showing', () => {
  const norm = normalizeConfig({
    products: [{ id: 'p1', name: '  Seeded burger buns ', recipeId: 'brioche', weight: 80 }],
    clients: [{ id: 'c1', name: ' Bakery  ', items: [{ productId: 'p1', kind: 'number' }] }],
    recipes: [{ id: 'r1', name: '  Brioche ', ingredients: [{ label: ' Flour ', grams: 100 }] }],
    whatsappLists: [{ id: 'wl1', title: '  Market order ', clients: [{ clientId: 'c1', products: ['p1'] }] }],
  });
  assert.equal(getProductById(norm, 'p1').name, 'Seeded burger buns');
  assert.equal(getClientById(norm, 'c1').name, 'Bakery');
  assert.equal(norm.recipes[0].name, 'Brioche');
  assert.equal(norm.recipes[0].ingredients[0].label, 'Flour');
  assert.equal(norm.whatsappLists[0].title, 'Market order');
});

test('the row the log prints has no space before the colon any more', () => {
  const norm = normalizeConfig({
    recipes: BAKERY_CONFIG.recipes,
    products: [{ id: 'p1', name: 'Seeded burger buns ', recipeId: 'focaccia', weight: 80 }],
    clients: [{ id: 'c1', name: 'Bakery', items: [{ productId: 'p1', kind: 'number' }] }],
  });
  const row = getTabProducts(norm, 'focaccia')[0];
  assert.equal(row.name + ': 40 pz', 'Seeded burger buns: 40 pz');
});

test('a name of ONLY spaces falls back to the placeholder, never to an empty string', () => {
  // The trim has to happen BEFORE the fallback: String(x || 'Product').trim() would
  // let "   " through as "".
  const norm = normalizeConfig({
    products: [{ id: 'p1', name: '   ', recipeId: 'focaccia', weight: 80 }],
    clients: [{ id: 'c1', name: '  ', items: [{ productId: 'p1', kind: 'number' }] }],
    recipes: [{ id: 'r1', name: ' ', ingredients: [{ label: '  ', grams: 1 }] }],
  });
  assert.equal(getProductById(norm, 'p1').name, 'Product');
  assert.equal(getClientById(norm, 'c1').name, 'Client');
  assert.equal(norm.recipes[0].name, 'Recipe');
  assert.equal(norm.recipes[0].ingredients[0].label, 'Ingredient');
});

test('a missing name still falls back, and nothing throws on junk', () => {
  const norm = normalizeConfig({
    recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', products: [{ id: 'p1', recipeId: 'focaccia', weight: 80 }] }],
  });
  assert.equal(getProductById(norm, 'p1').name, 'Product');
  assert.equal(getClientById(norm, 'c1').name, 'Client');
});

// ── Pausing a product (B2) ────────────────────────────────────────────────────
// A client that stops ordering something for a while should not have to delete it and
// rebuild it later. A paused product keeps everything and simply leaves the calculator.

const paused = (over = {}) => ({
  recipes: BAKERY_CONFIG.recipes,
    clients: [{ id: 'c1', name: 'A', products: [
    { id: 'p1', name: 'Pizzas',    recipeId: 'focaccia', weight: 201, kind: 'number', ...over },
    { id: 'p2', name: 'Focaccias', recipeId: 'focaccia', weight: 181, kind: 'number' },
  ] }],
});

test('a paused product has no row and adds no dough', () => {
  const config = normalizeConfig(paused({ active: false }));
  assert.deepEqual(getTabProducts(config, 'focaccia').map(p => p.id), ['p2']);
  const q = { [pairId('c1', 'p1')]: 100, [pairId('c1', 'p2')]: 2 };
  assert.equal(computeTarget(config, 'focaccia', qtyFrom(q)), 2 * 181, 'the paused 100 is ignored');
});

test('a product with NO active field is active — every document in production lacks it', () => {
  const config = normalizeConfig(paused());
  assert.deepEqual(getTabProducts(config, 'focaccia').map(p => p.id), ['p1', 'p2']);
  assert.equal(getProductById(config, 'p1').active, true);
});

test('pausing survives a save-and-reload round trip', () => {
  const once = normalizeConfig(paused({ active: false }));
  const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
  assert.equal(getProductById(twice, 'p1').active, false);
  assert.deepEqual(getTabProducts(twice, 'focaccia').map(p => p.id), ['p2']);
});

test('a paused product keeps its settings, ready to come back untouched', () => {
  const config = normalizeConfig(paused({ active: false, kind: 'dropdown', crate: { show: true, perBox: 24 } }));
  const p = getProductById(config, 'p1');
  assert.equal(p.name, 'Pizzas');
  assert.equal(p.weight, 201);
  assert.equal(p.kind, 'dropdown');
  assert.deepEqual(p.crate, { show: true, perBox: 24 });
});

test('the divisor ignores a paused product but KEEPS its tick for when it returns', () => {
  const raw = paused({ active: false });
  raw.divisorIncluded = { focaccia: ['p1', 'p2'] };
  const config = normalizeConfig(raw);
  assert.deepEqual(getDivisorIncluded(config, 'focaccia'), ['p1', 'p2'], 'the tick survives');
  assert.deepEqual(getDivisorProducts(config, 'focaccia').map(p => p.id), ['p2'], 'but it does not split');
  const q = { [pairId('c1', 'p1')]: 10, [pairId('c1', 'p2')]: 3 };
  assert.equal(divisorTotal(config, 'focaccia', qtyFrom(q)), 3 * 181);
});

test('a paused product still blocks deleting the recipe it belongs to', () => {
  // getProducts is what the recipe editor counts; a paused product is still a product,
  // or deleting its recipe would leave it homeless.
  const config = normalizeConfig(paused({ active: false }));
  assert.equal(getProducts(config).filter(p => p.recipeId === 'focaccia').length, 2);
});

// ── Which days the WhatsApp order form fills itself from ──────────────────────
// Stored in the shared config, so every phone in the bakery agrees. The default and
// the fallback both widen rather than narrow: a missing or corrupt value must never
// quietly hide a day's work from an order somebody is about to send.

test('the setting defaults to both days', () => {
  assert.equal(BAKERY_CONFIG.orderPrefillWindow, 'both');
  assert.equal(getOrderPrefillWindow(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [] })), 'both');
});

test('each of the three choices survives normalisation', () => {
  for (const w of ORDER_PREFILL_WINDOWS) {
    assert.equal(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], orderPrefillWindow: w }).orderPrefillWindow, w, w);
  }
});

test('a value nobody recognises falls back to both, never to nothing', () => {
  for (const bad of [undefined, null, '', 'ieri', 'BOTH', 42, {}, []]) {
    assert.equal(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], orderPrefillWindow: bad }).orderPrefillWindow,
      'both', String(bad));
  }
});

test('the reader tolerates a missing config entirely', () => {
  assert.equal(getOrderPrefillWindow(null), 'both');
  assert.equal(getOrderPrefillWindow(undefined), 'both');
  assert.equal(getOrderPrefillWindow({}), 'both');
});

test('every choice has wording, or the settings screen shows a blank option', () => {
  for (const w of ORDER_PREFILL_WINDOWS) {
    assert.equal(typeof ORDER_PREFILL_LABELS[w], 'string');
    assert.ok(ORDER_PREFILL_LABELS[w].length > 0, w);
  }
});

// ── Free lines: things a client buys that the bakery does not calculate ───────
// A line that exists ONLY in the WhatsApp message. The real case: a client buys
// loaves cut from the bread baked for ANOTHER client, so the dough is counted once
// and must not be counted twice — but the line still has to reach the message.

const FREE_CFG = {
  recipes: BAKERY_CONFIG.recipes,
    clients: [
    { id: 'cA', name: 'CLIENT A', products: [
      { id: 'p1', name: 'Buns', recipeId: 'brioche', weight: 80, kind: 'number' }] },
  ],
  whatsappLists: [{ id: 'wl', title: 'Morning', clients: [
    { clientId: 'cA', products: ['p1'], extras: [{ id: '', name: 'Loaves of bread' }] }] }],
};

test('a free line survives normalisation and gets a wx- id', () => {
  const cfg = normalizeConfig(FREE_CFG);
  const extras = cfg.whatsappLists[0].clients[0].extras;
  assert.equal(extras.length, 1);
  assert.equal(extras[0].name, 'Loaves of bread');
  assert.ok(isFreeLineId(extras[0].id), extras[0].id);
});

test('a free line NEVER reaches the dough calculation', () => {
  // The point of the whole design: it is not a product, so there is nothing to count.
  const cfg = normalizeConfig(FREE_CFG);
  assert.deepEqual(getTabProducts(cfg, 'brioche').map(p => p.id), ['p1']);
  assert.equal(getProducts(cfg).length, 1);
  assert.equal(getProductById(cfg, cfg.whatsappLists[0].clients[0].extras[0].id), null);
});

test('a free line reaches the message as an ordinary row, after the products', () => {
  const cfg = normalizeConfig(FREE_CFG);
  const [entry] = resolveListClients(cfg, cfg.whatsappLists[0]);
  assert.deepEqual(entry.products.map(p => p.name), ['Buns', 'Loaves of bread']);
  assert.equal(entry.products[1].free, true);
});

test('a free line id can never collide with a product id', () => {
  // The modal keys its quantity boxes by id; a collision would put one client's
  // typed number onto another row.
  const cfg = normalizeConfig(FREE_CFG);
  const ids = new Set(getProducts(cfg).map(p => p.id));
  for (const l of cfg.whatsappLists[0].clients[0].extras) assert.equal(ids.has(l.id), false);
});

test('two free lines with the same name get different ids', () => {
  // Two inputs sharing an id means getElementById returns the first, so one quantity
  // is read twice and the other silently ignored.
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: [], extras: [{ name: 'Bread' }, { name: 'Bread' }] }] }] });
  const extras = cfg.whatsappLists[0].clients[0].extras;
  assert.equal(extras.length, 2);
  assert.notEqual(extras[0].id, extras[1].id);
});

test('an existing free line KEEPS its id when renamed', () => {
  // The id keys a quantity box. Recomputing it from the new name would move a typed
  // number to a different row mid-edit.
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: [], extras: [{ id: 'wx-loaves-of-bread', name: 'Sourdough loaves' }] }] }] });
  assert.equal(cfg.whatsappLists[0].clients[0].extras[0].id, 'wx-loaves-of-bread');
});

test('a blank free line is dropped quietly, not refused', () => {
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: ['p1'], extras: [{ name: '   ' }, { name: '' }, null, 'oops'] }] }] });
  assert.deepEqual(cfg.whatsappLists[0].clients[0].extras, []);
  assert.deepEqual(cfg.whatsappLists[0].clients[0].products, ['p1']);
});

test('a list entry with only free lines is kept, not treated as empty', () => {
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: [], extras: [{ name: 'Loaves of bread' }] }] }] });
  const [entry] = resolveListClients(cfg, cfg.whatsappLists[0]);
  assert.deepEqual(entry.products.map(p => p.name), ['Loaves of bread']);
});

test('a direct client can carry free lines too', () => {
  const cfg = normalizeConfig({ ...FREE_CFG,
    whatsappClients: [{ id: 'wc', name: 'Market stall', products: [], extras: [{ name: 'Bread' }] }] });
  const resolved = resolveDirectClient(cfg, cfg.whatsappClients[0]);
  assert.deepEqual(resolved.products.map(p => p.name), ['Bread']);
});

test('a direct client that is ONLY free lines is not dropped', () => {
  // The old rule dropped an entry with no name and no products; a free line is now
  // something, so dropping it would delete work somebody had just typed.
  const cfg = normalizeConfig({ ...FREE_CFG,
    whatsappClients: [{ id: 'wc', name: '', products: [], extras: [{ name: 'Bread' }] }] });
  assert.equal(cfg.whatsappClients.length, 1);
});

test('free lines are capped, so a stuck finger cannot grow the config for ever', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ name: 'Line ' + i }));
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: [], extras: many }] }] });
  assert.equal(cfg.whatsappLists[0].clients[0].extras.length, 50);
});

test('a config that never heard of free lines normalises to an empty list', () => {
  const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
    { clientId: 'cA', products: ['p1'] }] }] });
  assert.deepEqual(cfg.whatsappLists[0].clients[0].extras, []);
});
