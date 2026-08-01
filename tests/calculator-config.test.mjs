// Unit tests for the calculator data model (P15 — the owner cannot read code, so
// these tests are the safety net). Stage 3 moved to a shared product CATALOGUE
// (config.products[]) with per-client ASSOCIATIONS (clients[].items[]) and
// per (client, product) quantities. These tests lock in:
//   • the catalogue + items shape and its read helpers,
//   • the dough math (Σ qty×weight) still matching the legacy formulas,
//   • per-pair quantities (same product, two clients, two independent quantities),
//   • the additive, lossless migration from the previous nested shape,
//   • migration of the oldest per-tab shape,
//   • divisor / crate / WhatsApp resolution against the catalogue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
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

// Helper: build a getQty(qtyId) function from a plain { qtyId: qty } map.
const qtyFrom = (map) => (id) => map[id] || 0;

// ── Catalogue + tab view ──────────────────────────────────────────────────────

test('the default config is a catalogue of 10 products with per-client items', () => {
  assert.equal(getProducts(DEFAULT_CONFIG).length, 10);
  assert.equal(getClients(DEFAULT_CONFIG).length, 4);
  // Every item references an existing catalogue product.
  const ids = new Set(getProducts(DEFAULT_CONFIG).map(p => p.id));
  for (const c of getClients(DEFAULT_CONFIG)) {
    for (const it of c.items) assert.ok(ids.has(it.productId), 'item ' + it.productId + ' resolves');
  }
});

test('getTabProducts is a filtered view: one row per (client, product) of that recipe', () => {
  assert.deepEqual(getTabProducts(DEFAULT_CONFIG, 'focaccia').map(p => p.id),
    ['f-pizze', 'f-focacce', 'f-ciabatta', 'f-trayfocaccia', 'f-panini']);
  assert.deepEqual(getTabProducts(DEFAULT_CONFIG, 'brioche').map(p => p.id),
    ['b-burgerbuns', 'b-subrolls', 'b-bun', 'b-rolls']);
  assert.deepEqual(getTabProducts(DEFAULT_CONFIG, 'sourdough').map(p => p.id), ['s-loaf']);
});

test('each tab row carries its client, weight, kind, crate and a per-pair qtyId', () => {
  const ciabatta = getTabProducts(DEFAULT_CONFIG, 'focaccia').find(p => p.id === 'f-ciabatta');
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
  assert.equal(computeTarget(DEFAULT_CONFIG, 'focaccia', qtyFrom(q)), legacy);
});

test('brioche target matches the legacy hardcoded formula (products only)', () => {
  const q = {
    [pairId('c-client-1', 'b-burgerbuns')]: 50,
    [pairId('c-client-1', 'b-subrolls')]: 30,
    [pairId('c-client-2', 'b-bun')]: 20,
    [pairId('c-client-2', 'b-rolls')]: 15,
  };
  const legacy = 50 * 81 + 30 * 121 + 20 * 71 + 15 * 71;
  assert.equal(computeTarget(DEFAULT_CONFIG, 'brioche', qtyFrom(q)), legacy);
});

test('sourdough target matches loaves × default loaf weight (905 g)', () => {
  const q = { [pairId('c-client-2', 's-loaf')]: 12 };
  assert.equal(computeTarget(DEFAULT_CONFIG, 'sourdough', qtyFrom(q)), 12 * 905);
});

test('empty quantities give zero dough', () => {
  assert.equal(computeTarget(DEFAULT_CONFIG, 'focaccia', () => 0), 0);
  assert.equal(computeTarget(DEFAULT_CONFIG, 'brioche', () => 0), 0);
  assert.equal(computeTarget(DEFAULT_CONFIG, 'sourdough', () => 0), 0);
});

test('per-pair quantities: the SAME product on two clients has two independent boxes', () => {
  // The new headline capability: one catalogue product, ordered by two clients, each
  // with its own quantity — two rows, two qtyIds, summed independently.
  const config = {
    products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'focaccia', weight: 150 }],
    clients: [
      { id: 'cA', name: 'A', items: [{ productId: 'p1', kind: 'number' }] },
      { id: 'cB', name: 'B', items: [{ productId: 'p1', kind: 'number' }] },
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
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [
      { id: 'cA', name: 'A', items: [{ productId: 'p1', kind: 'dropdown' }] },
      { id: 'cB', name: 'B', items: [{ productId: 'p1', kind: 'number' }] },
    ],
  };
  const rows = getTabProducts(config, 'focaccia');
  assert.equal(rows.find(r => r.clientId === 'cA').kind, 'dropdown');
  assert.equal(rows.find(r => r.clientId === 'cB').kind, 'number');
});

test('a tab view only includes products of that recipe', () => {
  const config = {
    products: [
      { id: 'pf', name: 'F', recipeId: 'focaccia',  weight: 100 },
      { id: 'pb', name: 'B', recipeId: 'brioche',   weight: 200 },
      { id: 'ps', name: 'S', recipeId: 'sourdough', weight: 300 },
    ],
    clients: [{ id: 'c1', name: 'Mixed', items: [
      { productId: 'pf', kind: 'number' }, { productId: 'pb', kind: 'number' }, { productId: 'ps', kind: 'number' },
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

test('an item pointing at a non-existent product is ignored by the tab view', () => {
  const config = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }, { productId: 'ghost', kind: 'number' }] }],
  };
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
  assert.equal(getProductById(DEFAULT_CONFIG, 's-loaf').name, 'Loaf');
  assert.equal(getProductById(DEFAULT_CONFIG, 'nope'), null);
  const all = getAllProducts(DEFAULT_CONFIG);
  assert.equal(all.length, 10);
  const loaf = all.find(p => p.id === 's-loaf');
  assert.deepEqual(loaf.clientNames, ['Client 2']);
  assert.equal(loaf.clientCount, 1);
  const pizze = all.find(p => p.id === 'f-pizze');
  assert.deepEqual(pizze.clientNames, ['Bakery']);
});

test('getAllProducts lists every client that orders a shared product', () => {
  const config = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [
      { id: 'cA', name: 'A', items: [{ productId: 'p1', kind: 'number' }] },
      { id: 'cB', name: 'B', items: [{ productId: 'p1', kind: 'number' }] },
    ],
  };
  const p = getAllProducts(config)[0];
  assert.deepEqual(p.clientNames, ['A', 'B']);
  assert.equal(p.clientCount, 2);
});

test('getClientById / getWhatsappLists / resolveListClients on the default config', () => {
  assert.equal(getClientById(DEFAULT_CONFIG, 'c-client-2').name, 'Client 2');
  assert.equal(getClientById(DEFAULT_CONFIG, 'nope'), null);
  const lists = getWhatsappLists(DEFAULT_CONFIG);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].title, 'Market order');
  const resolved = resolveListClients(DEFAULT_CONFIG, lists[0]);
  assert.deepEqual(resolved.map(r => r.client.id), ['c-client-1', 'c-client-2', 'c-client-3']);
  const client1 = resolved.find(r => r.client.id === 'c-client-1');
  assert.deepEqual(client1.products.map(p => p.id), ['f-ciabatta', 'b-burgerbuns', 'b-subrolls']);
});

test('a WhatsApp list entry can attach ANY catalogue product (decoupled from the client)', () => {
  const config = {
    products: [
      { id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 },
      { id: 'pB', name: 'Panini', recipeId: 'focaccia', weight: 130 },
    ],
    clients: [
      { id: 'cA', name: 'A', items: [{ productId: 'pA', kind: 'number' }] },
      { id: 'cB', name: 'B', items: [{ productId: 'pB', kind: 'number' }] },
    ],
    whatsappLists: [{ id: 'wl1', title: 'Order', clients: [{ clientId: 'cB', products: ['pB', 'pA'] }] }],
  };
  const resolved = resolveListClients(config, config.whatsappLists[0]);
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].products.map(p => p.name), ['Panini', 'Loaf']);
});

test('direct WhatsApp clients: typed name + products resolved from the catalogue', () => {
  assert.deepEqual(getWhatsappClients(DEFAULT_CONFIG), []);
  const config = {
    products: [{ id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 }],
    clients: [],
    whatsappClients: [{ id: 'wc1', name: 'Walk-in', products: ['pA', 'ghost'] }],
  };
  const resolved = resolveDirectClient(config, getWhatsappClients(config)[0]);
  assert.equal(resolved.name, 'Walk-in');
  assert.deepEqual(resolved.products.map(p => p.name), ['Loaf']); // ghost pruned
});

// ── Normalisation (new catalogue shape) ────────────────────────────────────────

test('normalizeConfig (catalogue): clamps weights, repairs recipeId, drops junk products', () => {
  const raw = {
    products: [
      { id: 'p1', name: 'Big', recipeId: 'brioche', weight: 99999 },  // weight capped
      { id: 'p2', name: 'Bad', recipeId: 'weird',   weight: 'oops' }, // recipe->focaccia, weight->MIN
      { notAnId: true },                                               // dropped
    ],
    clients: [{ id: 'c1', name: 'X', items: [{ productId: 'p1', kind: 'number' }] }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(getProducts(norm).length, 2);
  assert.equal(getProductById(norm, 'p1').weight, WEIGHT_MAX);
  assert.equal(getProductById(norm, 'p2').recipeId, 'focaccia');
  assert.equal(getProductById(norm, 'p2').weight, WEIGHT_MIN);
});

test('normalizeConfig (catalogue): de-duplicates products by id (first wins)', () => {
  const raw = {
    products: [
      { id: 'p1', name: 'First', recipeId: 'focaccia', weight: 100 },
      { id: 'p1', name: 'Dup',   recipeId: 'brioche',  weight: 200 },
    ],
    clients: [],
  };
  const norm = normalizeConfig(raw);
  assert.equal(getProducts(norm).length, 1);
  assert.equal(getProductById(norm, 'p1').name, 'First');
});

test('normalizeConfig (catalogue): prunes client items pointing at missing products', () => {
  const raw = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'A', items: [
      { productId: 'p1', kind: 'ciabatta' }, // legacy kind migrated
      { productId: 'gone', kind: 'number' }, // pruned
    ] }],
  };
  const norm = normalizeConfig(raw);
  const items = getClientById(norm, 'c1').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].productId, 'p1');
  assert.equal(items[0].kind, 'dropdown'); // ciabatta -> dropdown
});

test('normalizeConfig (catalogue): an association crate box is kept and clamped', () => {
  const raw = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number', crate: { show: true, perBox: 0 } }] }],
  };
  const row = getTabProducts(normalizeConfig(raw), 'focaccia')[0];
  assert.equal(isCrateEnabled(row), true);
  assert.equal(getCratePerBox(row), CRATE_PERBOX_MIN); // 0 clamped up
});

test('normalizeConfig (catalogue): keeps direct clients, prunes their dead product ids', () => {
  const raw = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [],
    whatsappClients: [{ id: 'wc1', name: 'Custom', products: ['p1', 'gone'] }, { notAnObject: true }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(norm.whatsappClients.length, 1);
  assert.equal(norm.whatsappClients[0].name, 'Custom');
  assert.deepEqual(norm.whatsappClients[0].products, ['p1']);
});

test('normalizeConfig (catalogue): prunes WhatsApp list entries for dead clients/products', () => {
  const raw = {
    products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }] }],
    whatsappLists: [{ id: 'wl1', title: 'L', clients: [
      { clientId: 'c1', products: ['p1', 'ghost'] },
      { clientId: 'gone', products: ['p1'] },
    ] }],
  };
  const norm = normalizeConfig(raw);
  assert.equal(norm.whatsappLists[0].clients.length, 1);
  assert.deepEqual(norm.whatsappLists[0].clients[0], { clientId: 'c1', products: ['p1'] });
});

test('normalizeConfig falls back to the default for missing/garbage input', () => {
  assert.equal(getProducts(normalizeConfig(null)).length, 10);
  assert.equal(getProducts(normalizeConfig('oops')).length, 10);
  assert.equal(getProducts(normalizeConfig({})).length, 10);
});

test('isExtraDoughEnabled defaults to true and honours an explicit false', () => {
  assert.equal(isExtraDoughEnabled(DEFAULT_CONFIG, 'focaccia'), true);
  assert.equal(isExtraDoughEnabled({}, 'brioche'), true);
  assert.equal(isExtraDoughEnabled(null, 'sourdough'), true);
  assert.equal(isExtraDoughEnabled({ extraDough: { focaccia: false } }, 'focaccia'), false);
});

// ── Migration: previous NESTED shape → catalogue (additive, lossless) ───────────

test('migration: nested clients[].products become a catalogue + items', () => {
  const raw = { clients: [
    { id: 'c1', name: 'A', items: undefined, products: [
      { id: 'p1', name: 'Ciabatta', dough: 'focaccia', weight: 151, kind: 'ciabatta', crate: { show: true, perBox: 20 } },
      { id: 'p2', name: 'Panini',   dough: 'focaccia', weight: 131, kind: 'panini' },
    ] },
    { id: 'c2', name: 'B', products: [
      { id: 'p3', name: 'Loaf', dough: 'sourdough', weight: 905, kind: 'number' },
    ] },
  ] };
  const norm = normalizeConfig(raw);
  // Catalogue built from the nested products (dough -> recipeId).
  assert.deepEqual(getProducts(norm).map(p => p.id).sort(), ['p1', 'p2', 'p3']);
  assert.equal(getProductById(norm, 'p1').recipeId, 'focaccia');
  assert.equal(getProductById(norm, 'p3').recipeId, 'sourdough');
  // Items reference them, with the legacy kinds migrated and crate kept.
  const items = getClientById(norm, 'c1').items;
  assert.deepEqual(items.map(i => i.productId), ['p1', 'p2']);
  assert.equal(items[0].kind, 'dropdown'); // ciabatta
  assert.equal(items[1].kind, 'number');   // panini
  assert.equal(items[0].crate.show, true);
  // The tab view and math work end to end.
  const ciabatta = getTabProducts(norm, 'focaccia').find(p => p.id === 'p1');
  assert.equal(ciabatta.clientName, 'A');
  assert.equal(ciabatta.kind, 'dropdown');
});

test('migration: the original nested products are kept as a revert safety window', () => {
  const raw = { clients: [
    { id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', dough: 'focaccia', weight: 100, kind: 'number' }] },
  ] };
  const norm = normalizeConfig(raw);
  // The new code reads the catalogue + items; the old nested array is left untouched
  // on the client so a code revert can still read it.
  assert.ok(Array.isArray(getClientById(norm, 'c1').products));
  assert.equal(getClientById(norm, 'c1').products[0].id, 'p1');
});

test('migration: a re-saved catalogue document drops the nested safety copy', () => {
  // First migrate, then feed the migrated (now catalogue) shape back in: because it
  // carries products[], the new-shape path runs and no nested copy is retained.
  const once = normalizeConfig({ clients: [
    { id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', dough: 'focaccia', weight: 100, kind: 'number' }] },
  ] });
  const twice = normalizeConfig(once);
  assert.equal(getClientById(twice, 'c1').products, undefined);
  assert.deepEqual(getClientById(twice, 'c1').items.map(i => i.productId), ['p1']);
});

test('migration math equals the legacy formula after migrating nested data', () => {
  const raw = { clients: [
    { id: 'c1', name: 'A', products: [
      { id: 'f-pizze', name: 'Pizzas', dough: 'focaccia', weight: 201, kind: 'number' },
    ] },
  ] };
  const norm = normalizeConfig(raw);
  assert.equal(computeTarget(norm, 'focaccia', qtyFrom({ [pairId('c1', 'f-pizze')]: 7 })), 7 * 201);
});

// ── Migration: oldest per-tab + market shape → catalogue ───────────────────────

test('migration: the oldest per-tab + market shape becomes a catalogue', () => {
  const legacy = {
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
  // "Client 1" appears three times -> one merged client; both products in the catalogue.
  assert.equal(getClients(norm).length, 1);
  const client = getClients(norm)[0];
  assert.equal(client.name, 'Client 1');
  assert.deepEqual(getProducts(norm).map(p => p.id).sort(), ['b-bb', 'f-cia']);
  assert.equal(getProductById(norm, 'f-cia').recipeId, 'focaccia');
  assert.equal(getProductById(norm, 'b-bb').recipeId, 'brioche');
  assert.deepEqual(client.items.map(i => i.productId).sort(), ['b-bb', 'f-cia']);
  // The market list became an independent WhatsApp list seeded with the client's products.
  assert.equal(norm.whatsappLists.length, 1);
  assert.equal(norm.whatsappLists[0].clients[0].clientId, client.id);
  assert.deepEqual(norm.whatsappLists[0].clients[0].products.sort(), ['b-bb', 'f-cia']);
});

// ── Divisor (display-only crate split) ─────────────────────────────────────────

test('divisor includes NOTHING by default (opt-in)', () => {
  const q = { [pairId('c-bakery', 'f-pizze')]: 10 };
  assert.equal(divisorTotal(DEFAULT_CONFIG, 'focaccia', qtyFrom(q)), 0);
  assert.equal(getDivisorProducts(DEFAULT_CONFIG, 'focaccia').length, 0);
  assert.equal(isInDivisor(DEFAULT_CONFIG, 'focaccia', 'f-panini'), false);
});

test('divisor sums only ticked products; it sums across every client of a ticked product', () => {
  const config = {
    products: [
      { id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100 },
      { id: 'p2', name: 'Pizza',  recipeId: 'focaccia', weight: 200 },
    ],
    clients: [
      { id: 'cA', name: 'A', items: [{ productId: 'p1', kind: 'number' }, { productId: 'p2', kind: 'number' }] },
      { id: 'cB', name: 'B', items: [{ productId: 'p1', kind: 'number' }] }, // p1 shared
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
    products: [{ id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100 }],
    clients: [{ id: 'c1', name: 'X', items: [{ productId: 'p1', kind: 'number' }] }],
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
  const ciabatta = getTabProducts(DEFAULT_CONFIG, 'focaccia').find(p => p.id === 'f-ciabatta');
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
    products: [{ id: 'p1', recipeId: 'focaccia', weight: 80 }],
    clients: [{ id: 'c1', items: [] }],
  });
  assert.equal(getProductById(norm, 'p1').name, 'Product');
  assert.equal(getClientById(norm, 'c1').name, 'Client');
});
