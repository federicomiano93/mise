// calculator-config.js — pure data model for the calculator's catalogue.
//
// This module is intentionally FREE of any Firebase / DOM imports so the dough
// math and the data model can be unit-tested in isolation (see
// tests/calculator-config.test.mjs). The owner cannot read code, so these tests
// are the safety net (P15).
//
// THE MODEL — a product belongs to the client that orders it:
//   • config.clients[] is the address book, and each client carries its own
//     `products[]`: { id, name, recipeId, weight, kind, crate }. There is no shared
//     catalogue: what a client orders is described in one place, on one screen.
//   • A recipe tab is a FILTERED VIEW: getTabProducts(config, recipeId) walks every
//     client's products and emits one row per product belonging to that recipe.
//     Quantities are per (client, product), keyed by `qtyId` = pairId(clientId, id).
//
// Why the shared catalogue was dropped (Aug 2026): it existed so two clients could
// order the SAME product and its weight be changed in one place. In the real data only
// one product out of ten was shared, and the price was two screens and seven steps to
// add a product. Two clients ordering the same thing now hold their own independent
// copy, which is also what the owner asked for: changing one must not move the other.
//
// ⚠️ Two clients migrated from one catalogue product KEEP THE SAME id. Four things key
// by it — divisor ticks, WhatsApp lists, saved log rows, and typed quantities — and
// minting a fresh id would quietly cut all four. Where the client is known, resolve a
// product inside THAT client's list (see resolveListClients).
//
// item.kind drives the INPUT WIDGET in the calculator, NOT the math:
//   'number'   → plain numeric quantity field (default)
//   'dropdown' → quantity picked from a fixed preset dropdown (0/20/40/60/80/100)
//   'kg'       → quantity entered directly in kilograms (weight 1000 g/kg)
// Legacy kinds are migrated on load: 'ciabatta' → 'dropdown', 'panini' → 'number'.
// An association can opt into a "crate box" (item.crate = { show, perBox }): a
// display-only helper showing how many crates its order fills.
//
// WhatsApp orders are INDEPENDENT of the recipe tabs. There are two kinds, both sent
// from the WhatsApp button and edited in the WhatsApp settings screen:
//   • `whatsappLists` — a list has a title and a set of client entries; each entry
//     references an address-book client (by id, for its name) and an explicitly
//     chosen set of catalogue product ids.
//   • `whatsappClients` — a standalone "direct client": a TYPED name plus catalogue
//     product ids. Sent on its own, without a list.
// Product ids are resolved live from the catalogue (a rename propagates; a deleted
// product is pruned). The dough math never reads this — it is purely for the order
// message.

import { t } from './i18n.js';

export const TABS = ['focaccia', 'brioche', 'sourdough'];

// Allowed weight range, in grams. Guards against a typo turning 150 into 15000
// and silently producing ten times the intended dough.
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 5000;

// Separator for a per (client, product) quantity key. Chosen so it cannot occur in
// generated ids (which are lowercase letters, digits and single hyphens).
const PAIR_SEP = '::';

// The quantity key for a (client, product) association: the id of the input/select
// the calculator renders for that pair, and the localStorage key it persists under.
export function pairId(clientId, productId) {
  return String(clientId) + PAIR_SEP + String(productId);
}

// Default configuration. It reproduces today's exact products, weights, ids and
// associations, reorganised into the catalogue + items shape, so with defaults the
// calculator behaves identically. The four real wholesale client names are
// intentionally NOT shipped here (business data, P1/P8): they are entered once in
// Settings and stored in Firestore. Generic placeholders are used until the real
// configuration is loaded. Product ids are kept identical to the old ones so cached
// quantities keep working; the ciabatta association ships with its crate box on.
export const DEFAULT_CONFIG = {
  // ⚠️ EMPTY, AND THAT IS THE FEATURE (13 Aug 2026). Until this date the default
  // held The Italian Club Bakery's own address book: four clients, ten products
  // with their weights, three recipes with their real formulas and thirteen
  // ingredient names. It was never written to anybody's database — it is what the
  // app SHOWS until a real document arrives — so every customer who bought the
  // Calculator opened it holding one bakery's recipes, with nothing saying they
  // were somebody else's. Federico: «quelle ricette sono solo di The Italian Club
  // Bakery», and «il Calcolatore deve essere vuoto perché non è detto che gli
  // serva come funzione».
  //
  // ⚠️ THE NUMBERS BELOW STAY, and they are not data: they are how the screens
  // behave before anybody has chosen anything. A window of days, a retention in
  // hours and a set of switches describe no business and name no client.
  //
  // 📌 The bakery's own copy is safe: it lives in its Firestore document, which
  // always wins over this. The formulas are kept as a TEST fixture —
  // tests/fixtures/bakery-config.mjs — because fifty-one assertions prove the
  // dough maths through them.
  clients: [],
  recipes: [],
  ingredients: [],
  whatsappLists: [],
  whatsappClients: [],
  // Per-recipe switches. Empty maps, not maps of the three recipes that used to be
  // here: normalizeConfig fills in a default for any recipe id it does not find,
  // so naming ids nobody has would only be three dead entries.
  extraDough: {},
  divisorIncluded: {},
  logVisibility: {},
  logRetentionHours: 24,
  logRetentionByDough: {},
  // Which days the WhatsApp order form fills itself from. Default: both, because a
  // day's order is normally assembled from two days' work.
  orderPrefillWindow: 'both',
};

const KINDS = ['number', 'dropdown', 'kg'];

// Migrate a stored kind to the current taxonomy. The old 'ciabatta'/'panini' values
// conflated the input widget with a helper box; they now map to their pure input
// widget. Anything unknown falls back to a plain number field.
const LEGACY_KIND = { ciabatta: 'dropdown', panini: 'number' };
function normalizeKind(kind) {
  const migrated = LEGACY_KIND[kind] || kind;
  return KINDS.includes(migrated) ? migrated : 'number';
}

// Deep clone via JSON — config is plain data (no functions/dates), so this is safe
// and keeps callers from mutating shared defaults.
export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

// "Extra dough" is a free amount of dough to make, NOT tied to any product — entered
// directly in each tab and added on top of the products' total. Capped to guard
// against an extreme typo (e.g. 1 kg mistyped as 1000 kg).
export const EXTRA_MAX_G = 500000; // 500 kg

// Convert an extra-dough entry to grams. unit 'kg' multiplies by 1000; anything
// non-numeric or negative becomes 0 so the math never sees NaN.
export function doughExtraGrams(value, unit) {
  let g = Number(value);
  if (!Number.isFinite(g) || g < 0) return 0;
  if (unit === 'kg') g *= 1000;
  return Math.min(g, EXTRA_MAX_G);
}

// The divisor box splits dough into up to this many crates (a 0–4 dropdown, 0 = no
// split shown). Display-only — it never affects the dough math.
export const DIVISOR_MAX = 4;

// The per-association "crate box" helper: how many pieces fit in one crate.
export const CRATE_PERBOX_MIN = 1;
export const CRATE_PERBOX_MAX = 1000;
export const CRATE_PERBOX_DEFAULT = 20;

// Clamp a weight to the allowed range and coerce to a finite number. Returns
// WEIGHT_MIN for anything non-numeric so the math never sees NaN.
export function clampWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return WEIGHT_MIN;
  if (n < WEIGHT_MIN) return WEIGHT_MIN;
  if (n > WEIGHT_MAX) return WEIGHT_MAX;
  return n;
}

// Clamp the pieces-per-crate to a sane range, defaulting on anything non-numeric.
export function clampCratePerBox(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return CRATE_PERBOX_DEFAULT;
  if (n < CRATE_PERBOX_MIN) return CRATE_PERBOX_MIN;
  if (n > CRATE_PERBOX_MAX) return CRATE_PERBOX_MAX;
  return n;
}

// ── Read helpers (used by the calculator, settings and WhatsApp) ──────────────

// The whole address book (empty array for a missing/garbage config).
export function getClients(config) {
  return (config && Array.isArray(config.clients)) ? config.clients : [];
}

export function getClientById(config, id) {
  return getClients(config).find(c => c && c.id === id) || null;
}

// Every product of every client, flattened and tagged with its owner. A product now
// belongs to exactly one client, so this is the whole set of products in the app.
export function getProducts(config) {
  const out = [];
  for (const client of getClients(config)) {
    for (const p of (client.products || [])) {
      if (p) out.push({ ...p, clientId: client.id, clientName: client.name });
    }
  }
  return out;
}

// Find a product by id, or null. Two clients that order the same product keep the SAME
// id (see migrateCatalogue), so this can be ambiguous; use it only where the client is
// unknown and the name is all that matters — the WhatsApp message. Where the client IS
// known, look inside that client's own products instead (see resolveListClients).
export function getProductById(config, id) {
  return getProducts(config).find(p => p && p.id === id) || null;
}

// The pool the WhatsApp editor picks from. Kept named `clientNames`/`clientCount` for
// the callers; with products owned by a client there is exactly one of each.
export function getAllProducts(config) {
  return getProducts(config).map(p => ({ ...p, clientNames: [p.clientName], clientCount: 1 }));
}

// ── Recipes (the base) + ingredient registry ──────────────────────────────────

// The three calc logics a recipe can use:
//   'orders' → quantities from clients (+ leavening knob) — today's behaviour
//   'total'  → one typed total in grams, ingredients pro-rata (no clients/leavening)
//   'both'   → orders + a typed total + leavening; the two totals are summed
export const LOGICS = ['orders', 'total', 'both'];

// The maximum number of recipes that can be visible as calculator tabs at once.
export const MAX_VISIBLE_RECIPES = 4;

// All recipes (empty array for a missing/garbage config).
export function getRecipes(config) {
  return (config && Array.isArray(config.recipes)) ? config.recipes : [];
}

export function getRecipeById(config, id) {
  return getRecipes(config).find(r => r && r.id === id) || null;
}

// The recipes shown as calculator tabs: those flagged visible, in their chosen
// order, capped at MAX_VISIBLE_RECIPES (screen space). Stage 5 builds the tabs from
// this; in Stage 4 all three ship visible, so it returns the three as today.
export function getVisibleRecipes(config) {
  return getRecipes(config)
    .filter(r => r && r.visible !== false)
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .slice(0, MAX_VISIBLE_RECIPES);
}

// The ingredient registry (empty array for a missing/garbage config).
export function getIngredients(config) {
  return (config && Array.isArray(config.ingredients)) ? config.ingredients : [];
}

// ── Why the Calculator has nothing to show ────────────────────────────────────
// Since the default config was emptied (13 Aug 2026) a brand-new customer opens a
// Calculator with no tabs at all. Before this, the screen simply fell through to
// the Log: a blank tab bar, no explanation and no way to start — which reads as a
// broken app rather than a new one.
//
// Returns null when there IS something to draw, otherwise which sentence to say:
//   'loading'        → nothing yet, and the server has not answered
//   'no-recipes'     → answered: this venue has no recipes at all
//   'hidden-recipes' → answered: recipes exist, but none is set to show as a tab
//
// ⚠️ 'loading' IS THE POINT OF THE serverAnswered ARGUMENT, and leaving it out
// would make the screen lie. A phone with no cached copy — a new device, or any
// device that has just entered a location, since clearLocalData() wipes the cache
// on the way in — starts on the empty DEFAULT_CONFIG while Firestore is still
// being asked. Saying "you have no recipes" there tells a customer with a full
// address book that their work is gone, for as long as the network takes.
//
// ⚠️ AND 'hidden-recipes' IS NOT THE SAME SENTENCE AS 'no-recipes'. Sending
// somebody to "add your first recipe" when they have ten, all hidden, sets them
// creating a duplicate of something they already own.
export function calculatorEmptyReason(config, serverAnswered) {
  if (getVisibleRecipes(config).length > 0) return null;
  if (!serverAnswered) return 'loading';
  return getRecipes(config).length > 0 ? 'hidden-recipes' : 'no-recipes';
}

// Whether a recipe's calculator tab shows a leavening knob: only logics that order
// or sum ('orders'/'both'), and only when the recipe designates a leavening with the
// "show the knob" flag on. A 'total' recipe never shows it (pure pro-rata).
export function showsLeaveningKnob(recipe) {
  if (!recipe || (recipe.logic !== 'orders' && recipe.logic !== 'both')) return false;
  return !!(recipe.leaveningKey && recipe.showLeavening);
}

// Build the scaleRecipe spec from a config recipe: the ordered {key: grams} amounts,
// which ingredient is the leavening, and the stored baseline %. The dough math
// (calc.js, log) feeds this straight into scaleRecipe — see calculator-dough-math.js.
export function recipeSpec(recipe) {
  const amounts = {};
  for (const ing of (recipe && Array.isArray(recipe.ingredients) ? recipe.ingredients : [])) {
    if (ing && ing.key) amounts[ing.key] = Number(ing.grams) || 0;
  }
  const leaveningKey = (recipe && recipe.leaveningKey && amounts[recipe.leaveningKey] != null)
    ? recipe.leaveningKey : null;
  const baselinePct = (recipe && Number.isFinite(Number(recipe.baselinePct))) ? Number(recipe.baselinePct) : null;
  return { amounts, leaveningKey, baselinePct };
}

// The saved independent WhatsApp lists (empty array for a missing/garbage config).
export function getWhatsappLists(config) {
  return (config && Array.isArray(config.whatsappLists)) ? config.whatsappLists : [];
}

// The saved direct WhatsApp clients (empty array for a missing/garbage config).
export function getWhatsappClients(config) {
  return (config && Array.isArray(config.whatsappClients)) ? config.whatsappClients : [];
}

// Resolve a WhatsApp list to the data the order message needs: for each client
// entry, the live client object plus the chosen catalogue product objects, with
// dangling references (deleted client or product) skipped.
export function resolveListClients(config, list) {
  if (!list || !Array.isArray(list.clients)) return [];
  const out = [];
  for (const entry of list.clients) {
    if (!entry) continue;
    const client = getClientById(config, entry.clientId);
    if (!client) continue; // a deleted client drops out of the list
    // Resolve inside THIS client's own products first. Two clients ordering the same
    // product share an id, so a global lookup could return the other one's copy and
    // print its name. The global fallback keeps an older reference working rather than
    // silently dropping a line from the message.
    const own = new Map((client.products || []).map(p => [p.id, p]));
    const productIds = Array.isArray(entry.products) ? entry.products : [];
    const products = productIds
      .map(id => own.get(id) || getProductById(config, id))
      .filter(Boolean)
      .concat(freeLineRows(entry.extras));
    out.push({ client, products });
  }
  return out;
}

// Free lines join the resolved rows as ordinary ones, so the order modal, the
// prefill and the message builder need to know nothing about them: a row is a row.
// They come LAST, after the products, because they are the additions to an order
// rather than the body of it.
//
// `free: true` is carried for the settings screen, which is the only place that has
// to tell the two apart — it lets you rename a free line and not a product.
function freeLineRows(extras) {
  return (Array.isArray(extras) ? extras : [])
    .filter(l => l && l.id && l.name)
    .map(l => ({ id: l.id, name: l.name, free: true }));
}

// Resolve a direct WhatsApp client to the order message's data: its typed name plus
// the chosen catalogue product objects, skipping ids whose product was deleted.
export function resolveDirectClient(config, dc) {
  if (!dc) return null;
  const productIds = Array.isArray(dc.products) ? dc.products : [];
  const products = productIds.map(id => getProductById(config, id)).filter(Boolean)
    .concat(freeLineRows(dc.extras));
  return { name: dc.name || 'Client', products };
}

// Whether the per-tab "Extra dough" box is shown for a given tab. Defaults to shown.
export function isExtraDoughEnabled(config, tab) {
  return !(config && config.extraDough && config.extraDough[tab] === false);
}

// ── Log display settings (visibility + retention) ─────────────────────────────
// Both are DISPLAY-only filters for the app's Log list. Logs are always written to
// Firestore; these only decide what the list shows.

export const LOG_RETENTION_OPTIONS = [24, 48];
export const LOG_RETENTION_DEFAULT = 24;

export function isLogVisible(config, tab) {
  return !(config && config.logVisibility && config.logVisibility[tab] === false);
}

export function getLogRetentionHours(config) {
  return normalizeLogRetention(config && config.logRetentionHours);
}

export function getLogRetentionForDough(config, tab) {
  const m = config && config.logRetentionByDough;
  const n = m && Number(m[tab]);
  return LOG_RETENTION_OPTIONS.includes(n) ? n : getLogRetentionHours(config);
}

// ── Which days the WhatsApp order form fills itself from ──────────────────────
// A day's order is normally assembled from TWO days' work: some products are made
// the day before it goes out, some the same morning. That is why 'both' is the
// default — but which days apply is the bakery's own rhythm, not a fact the app can
// derive, so it is a setting.
//
// ⚠️ 'yesterday' means yesterday ONLY, not "yesterday onwards". Someone who bakes
// everything the day before wants today's half-finished calculations kept OUT of the
// message, and an option that quietly included them would be the same as 'both'.
export const ORDER_PREFILL_WINDOWS = ['both', 'yesterday', 'today'];
export const ORDER_PREFILL_DEFAULT = 'both';

// Wording for the setting, and for the sentence above the order form. Kept beside the
// values so the two can never drift apart.
// ⚠️ KEYS, resolved at draw time — see js/calculator-render.js.
export const ORDER_PREFILL_LABELS = {
  both: 'help.yesterdayAndToday',
  yesterday: 'help.yesterdayOnly',
  today: 'help.todayOnly',
};

export function orderPrefillLabel(window) {
  return t(ORDER_PREFILL_LABELS[window] || ORDER_PREFILL_LABELS.both);
}

export function getOrderPrefillWindow(config) {
  const v = config && config.orderPrefillWindow;
  return ORDER_PREFILL_WINDOWS.includes(v) ? v : ORDER_PREFILL_DEFAULT;
}

// ── Tab view (catalogue + items → per-association rows) ────────────────────────

// A recipe tab's rows: for every client's item whose catalogue product belongs to
// `recipeId`, one row carrying the product's name/weight/recipe plus the
// association's kind/crate and its owning client. The SAME product ordered by two
// clients yields two rows. Each row's `qtyId` is the per (client, product) quantity
// key; `id` stays the product id (so divisor/crate/whatsapp keep keying by product).
export function getTabProducts(config, recipeId) {
  const out = [];
  for (const client of getClients(config)) {
    if (!client || !Array.isArray(client.products)) continue;
    for (const product of client.products) {
      if (!product || product.recipeId !== recipeId) continue;
      // A paused product keeps its settings but leaves the calculator entirely: no row,
      // no dough, no divisor, no log. This is the ONE place that decides it — every
      // consumer builds its rows from here.
      if (product.active === false) continue;
      out.push({
        id: product.id,
        qtyId: pairId(client.id, product.id),
        name: product.name,
        recipeId: product.recipeId,
        weight: product.weight,
        kind: normalizeKind(product.kind),
        crate: normalizeCrate(product.crate),
        clientId: client.id,
        clientName: client.name,
      });
    }
  }
  return out;
}

// Core dough math: total raw grams = Σ (quantity × unit weight) over every
// (client, product) association in a tab. getQty(qtyId) returns the quantity entered
// for that pair (pieces, or kilograms for a 'kg' product — its weight is 1000 g/kg).
export function computeTarget(config, tab, getQty) {
  let total = 0;
  for (const row of getTabProducts(config, tab)) {
    const qty = Number(getQty(row.qtyId)) || 0;
    total += qty * clampWeight(row.weight);
  }
  return total;
}

// The target raw weight for a recipe, by its calc logic (pure — the DOM-reading
// calc.js feeds in the entered quantities, extra and typed total):
//   'orders' → Σ(qty×weight) over the recipe's products + extra
//   'total'  → the typed total only
//   'both'   → Σ(qty×weight) + the typed total + extra
// All inputs are coerced so the result is always a finite number ≥ 0.
export function computeRecipeTarget(config, recipe, { getQty, extraGrams = 0, totalInput = 0 } = {}) {
  if (!recipe) return 0;
  const extra = Math.max(0, Number(extraGrams) || 0);
  const typed = Math.max(0, Number(totalInput) || 0);
  if (recipe.logic === 'total') return typed;
  const orders = (typeof getQty === 'function') ? computeTarget(config, recipe.id, getQty) : 0;
  if (recipe.logic === 'both') return orders + typed + extra;
  return orders + extra; // 'orders'
}

// ── Divisor (display-only crate split) ────────────────────────────────────────
// The divisor box sums the dough of the SELECTED products of a tab and divides it
// into N crates. It NEVER touches the recipe or the log. Selection is by product id,
// so ticking a product splits its dough across every client that orders it.

export function getDivisorIncluded(config, tab) {
  const inc = config && config.divisorIncluded;
  return inc && Array.isArray(inc[tab]) ? inc[tab] : [];
}

export function isInDivisor(config, tab, productId) {
  return getDivisorIncluded(config, tab).includes(productId);
}

// The tab's rows currently in the divisor (every association of a ticked product).
export function getDivisorProducts(config, tab) {
  const included = getDivisorIncluded(config, tab);
  return getTabProducts(config, tab).filter(row => included.includes(row.id));
}

// Total raw grams the divisor splits: Σ (quantity × unit weight) over the INCLUDED
// associations only. Same shape as computeTarget but limited to the divisor selection.
export function divisorTotal(config, tab, getQty) {
  let total = 0;
  for (const row of getDivisorProducts(config, tab)) {
    const qty = Number(getQty(row.qtyId)) || 0;
    total += qty * clampWeight(row.weight);
  }
  return total;
}

// Grams per crate = total ÷ n, or 0 when n is 0/invalid. Never returns NaN.
export function splitDough(total, n) {
  const parts = Number(n);
  if (!Number.isFinite(parts) || parts <= 0) return 0;
  const grams = Number(total);
  if (!Number.isFinite(grams) || grams < 0) return 0;
  return grams / parts;
}

// ── Crate boxes (display-only, per association) ────────────────────────────────
// A per-association helper that tells the baker how many crates an order fills. The
// crate config (show, perBox) lives on the client↔product item; getTabProducts merges
// it onto each row, so these operate on a row exactly as before.

export function isCrateEnabled(row) {
  return !!(row && row.crate && row.crate.show);
}

export function getCratePerBox(row) {
  return clampCratePerBox(row && row.crate ? row.crate.perBox : undefined);
}

export function crateCount(qty, perBox) {
  const n = Number(qty);
  const per = Number(perBox);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (!Number.isFinite(per) || per <= 0) return 0;
  return n / per;
}

// ── Normalisation & migration ─────────────────────────────────────────────────

// An association's optional crate box: shown only when explicitly enabled; perBox
// always clamped so the math never sees a zero/garbage divisor.
function normalizeCrate(raw) {
  return {
    show: !!(raw && raw.show),
    perBox: clampCratePerBox(raw && raw.perBox),
  };
}

// One of a client's products: what it is called, which recipe it belongs to, its unit
// weight, how its quantity is typed and its optional crate box.
//
// ⚠️ recipeId is NOT validated here: recipes are configurable, so the only list that can
// say whether one exists is config.recipes, which normalizeConfig assembles afterwards.
// It used to be checked against the three shipped ids, which silently moved a product
// assigned to any recipe the owner had created onto Focaccia. homeProducts() below does
// the check properly, once the recipes are known.
function normalizeProduct(p) {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const recipe = p.recipeId != null ? p.recipeId : p.dough; // tolerate the old field name
  return {
    id: String(p.id),
    name: cleanName(p.name, 'Product'),
    recipeId: String(recipe == null ? '' : recipe),
    weight: clampWeight(p.weight),
    kind: normalizeKind(p.kind),
    crate: normalizeCrate(p.crate),
    // Paused: kept in the client's list but out of the calculator until it comes back.
    // ⚠️ Missing means ACTIVE. No document in production carries this field, and a
    // default of "paused" would empty every tab at once. Same convention as `visible`
    // on recipes and `active` on the Orders suppliers.
    active: p.active !== false,
  };
}

// A client: id, name, and the products it orders. Junk is dropped and ids are unique
// WITHIN the client (the same client never orders the same product twice).
function normalizeClient(client) {
  if (!client || typeof client !== 'object') return null;
  const products = [];
  const seen = new Set();
  for (const raw of (Array.isArray(client.products) ? client.products : [])) {
    const p = normalizeProduct(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    products.push(p);
  }
  return {
    id: String(client.id || ''),
    name: cleanName(client.name, 'Client'),
    products,
  };
}

// Point every product at a recipe that actually exists. A product whose recipe was
// deleted would otherwise belong to no tab at all, which means it could never be seen
// or edited again — so it is re-homed onto the first recipe rather than lost.
function homeProducts(clients, recipes) {
  const known = new Set(recipes.map(r => r.id));
  const fallback = recipes[0] ? recipes[0].id : '';
  for (const c of clients) {
    for (const p of c.products) if (!known.has(p.recipeId)) p.recipeId = fallback;
  }
  return clients;
}

// ── Free lines: things a client buys that the bakery does not calculate ───────
// A line that exists ONLY in the WhatsApp message. It carries its own name and is
// not a product at all, which is the entire point:
//
//   • it can never reach the dough calculation, structurally — not by a flag being
//     respected in every place that counts a product, but because there is nothing
//     to count;
//   • it can never be pruned away, because there is no reference to resolve;
//   • the order form always leaves it at 0, because no production log can ever name
//     it — which is right, since nobody logs what they did not make.
//
// It exists because of a real case: a client buys loaves that are cut from the bread
// baked for ANOTHER client, so the dough is already counted once and must not be
// counted twice — but the line still has to appear in the message, or the client is
// sent an order missing what they asked for. Until now the only way was to borrow
// the other client's product, which worked and was fragile: delete that product
// everywhere and this line vanished from the message in silence.
//
// ⚠️ THE ID IS PREFIXED `wx-`, AND THAT PREFIX IS LOAD-BEARING. The order modal keys
// its inputs by product id and the prefill keys its lookups the same way, so a free
// line must never collide with a real `p-…` id — a collision would put a client's
// typed quantity onto somebody else's row.
export const FREE_LINE_PREFIX = 'wx-';
const MAX_FREE_LINES = 50;

export function isFreeLineId(id) {
  return String(id || '').startsWith(FREE_LINE_PREFIX);
}

// Keep the ones that still have a name. A blank line is not an error — it is a row
// somebody started and abandoned — so it is dropped quietly rather than refused.
//
// ⚠️ IDS ARE MADE UNIQUE WITHIN THE ENTRY. Two lines named the same would otherwise
// slug to the same id, and the modal would render two inputs sharing one id:
// getElementById returns the first, so one quantity would be read twice and the
// other silently ignored. Suffixed rather than dropped — a client really can be sold
// two things with the same name.
function normalizeFreeLines(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const used = new Set();
  for (const line of raw) {
    if (!line || typeof line !== 'object') continue;
    const name = String(line.name == null ? '' : line.name).trim();
    if (!name) continue;

    const wanted = isFreeLineId(line.id) ? String(line.id) : FREE_LINE_PREFIX + (slug(name) || 'line');
    let id = wanted;
    for (let n = 2; used.has(id); n++) id = `${wanted}-${n}`;
    used.add(id);

    out.push({ id, name });
    if (out.length >= MAX_FREE_LINES) break;
  }
  return out;
}

// One WhatsApp list client entry, validated against the catalogue + address book.
function normalizeListClient(raw, validClientIds, validProductIds) {
  if (!raw || typeof raw !== 'object') return null;
  const clientId = String(raw.clientId || '');
  if (!validClientIds.has(clientId)) return null;
  const products = Array.isArray(raw.products)
    ? raw.products.map(String).filter(id => validProductIds.has(id))
    : [];
  return { clientId, products, extras: normalizeFreeLines(raw.extras) };
}

function normalizeWhatsappList(raw, validClientIds, validProductIds) {
  if (!raw || typeof raw !== 'object') return null;
  const clients = Array.isArray(raw.clients)
    ? raw.clients.map(c => normalizeListClient(c, validClientIds, validProductIds)).filter(Boolean)
    : [];
  return { id: String(raw.id || 'wl'), title: cleanName(raw.title, 'Order'), clients };
}

function normalizeWhatsappLists(raw, clients, validProductIds) {
  if (!Array.isArray(raw)) return [];
  const validClientIds = new Set(clients.map(c => c.id));
  return raw.map(l => normalizeWhatsappList(l, validClientIds, validProductIds)).filter(Boolean);
}

// A direct WhatsApp client: typed name (kept as-is) plus product ids pruned to ones
// that still exist. A fully empty entry (no name AND no products) is dropped.
function normalizeWhatsappClient(raw, validProductIds) {
  if (!raw || typeof raw !== 'object') return null;
  const products = Array.isArray(raw.products)
    ? raw.products.map(String).filter(id => validProductIds.has(id))
    : [];
  const extras = normalizeFreeLines(raw.extras);
  const name = String(raw.name || '').trim();
  if (name === '' && products.length === 0 && extras.length === 0) return null;
  return { id: String(raw.id || 'wc'), name, products, extras };
}

function normalizeWhatsappClients(raw, validProductIds) {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => normalizeWhatsappClient(c, validProductIds)).filter(Boolean);
}

// Convert the OLD `groups` shape (a group = a title + client ids, implicitly carrying
// each client's whole product list) into the new independent-list shape. Each client
// entry is seeded with all the products that client currently orders.
function groupsToLists(groups, clients) {
  if (!Array.isArray(groups)) return [];
  const byId = new Map(clients.map(c => [c.id, c]));
  return groups.map((g, gi) => {
    const clientIds = Array.isArray(g && g.clientIds) ? g.clientIds : [];
    const entries = clientIds.map(cid => {
      const client = byId.get(String(cid));
      if (!client) return null;
      return { clientId: client.id, products: (client.products || []).map(p => p.id) };
    }).filter(Boolean);
    return { id: String((g && g.id) || 'wl-' + gi), title: cleanName(g && g.title, 'Order'), clients: entries };
  });
}

// Per-recipe "show Extra dough box" flags. Default shown (true) unless explicitly
// false. Keyed by every recipe id so a new recipe can carry its own setting.
function normalizeExtraDough(raw, ids) {
  const out = {};
  for (const id of ids) out[id] = !(raw && raw[id] === false);
  return out;
}

// Per-recipe "show this recipe's logs" flags. Default shown (true) unless explicitly false.
function normalizeLogVisibility(raw, ids) {
  const out = {};
  for (const id of ids) out[id] = !(raw && raw[id] === false);
  return out;
}

function normalizeLogRetention(raw) {
  const n = Number(raw);
  return LOG_RETENTION_OPTIONS.includes(n) ? n : LOG_RETENTION_DEFAULT;
}

function normalizeLogRetentionByDough(raw, legacyGlobal, ids) {
  const fallback = normalizeLogRetention(legacyGlobal);
  const out = {};
  for (const id of ids) {
    const n = raw && Number(raw[id]);
    out[id] = LOG_RETENTION_OPTIONS.includes(n) ? n : fallback;
  }
  return out;
}

// The set of product ids that belong to a given recipe, across every client.
function recipeProductIds(clients, recipeId) {
  const ids = new Set();
  for (const c of clients) {
    for (const p of (c.products || [])) if (p.recipeId === recipeId) ids.add(p.id);
  }
  return ids;
}

// Which product ids each recipe's divisor includes, pruned to ids that still exist in
// that recipe so a deleted product never lingers. Defaults to none. Keyed by product
// id, not per client, so ticking a product splits it across every client that orders
// it — unchanged from before.
function normalizeDivisorIncluded(raw, clients, recipeIds) {
  const out = {};
  for (const rid of recipeIds) {
    const validIds = recipeProductIds(clients, rid);
    const stored = raw && Array.isArray(raw[rid]) ? raw[rid].map(String) : [];
    out[rid] = stored.filter(id => validIds.has(id));
  }
  return out;
}

// Every name in this config is typed by hand, so it collects stray spaces at either
// end. A trailing one is invisible — in the app AND in the Firebase console — until the
// name is used inside a sentence, where it reads as "Seeded burger buns : 40 pz" in the
// log and in the WhatsApp message. The same invisible-space trap already cost this
// project a debugging session on the `sections` field (v205).
//
// ⚠️ Trim BEFORE applying the fallback: `String(x || 'Product').trim()` would let a name
// made only of spaces through as an empty string.
function cleanName(value, fallback) {
  const s = String(value == null ? '' : value).trim();
  return s || fallback;
}

// A slug suitable for a stable-ish id derived from a name (lowercase, hyphenated).
function slug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// One recipe ingredient row: a stable key (its identity within the recipe), a label
// (the displayed name) and grams. Keys are made unique within a recipe by the caller.
function normalizeIngredientRow(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const label = cleanName(raw.label || raw.name, 'Ingredient');
  const key = raw.key ? String(raw.key) : (slug(label) || ('ing' + index));
  return { key, label, grams: Number(raw.grams) || 0 };
}

// One recipe: id, name, logic, ordered ingredients (unique keys), optional designated
// leavening with its default % / show flag, the stored baseline %, order and
// visibility. Anything invalid falls back to a safe value so the math always runs.
function normalizeRecipe(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name, 'Recipe');
  const id = String(raw.id || ('r-' + (slug(name) || index)));
  const logic = LOGICS.includes(raw.logic) ? raw.logic : 'orders';

  const ingredients = [];
  const usedKeys = new Set();
  const rawIngs = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  rawIngs.forEach((ri, i) => {
    const row = normalizeIngredientRow(ri, i);
    if (!row) return;
    let key = row.key;
    while (usedKeys.has(key)) key = key + '-' + i; // keep keys unique within the recipe
    usedKeys.add(key);
    ingredients.push({ key, label: row.label, grams: row.grams });
  });

  const leaveningKey = (raw.leaveningKey && usedKeys.has(String(raw.leaveningKey)))
    ? String(raw.leaveningKey) : null;
  const leaveningDefaultPct = Math.max(0, Number(raw.leaveningDefaultPct) || 0);
  const showLeavening = raw.showLeavening !== false;
  const baselinePct = Number.isFinite(Number(raw.baselinePct)) && Number(raw.baselinePct) > 0
    ? Number(raw.baselinePct)
    : (leaveningKey && leaveningDefaultPct > 0 ? leaveningDefaultPct : null);

  return {
    id, name, logic, ingredients,
    leaveningKey, leaveningDefaultPct, showLeavening, baselinePct,
    order: Number(raw.order) || 0,
    visible: raw.visible !== false,
  };
}

// The recipe list. Ids are de-duplicated (first wins).
//
// ⚠️ NO RECIPES IS A REAL ANSWER, AND UNTIL 13 Aug 2026 IT WAS OVERWRITTEN. Both
// lines here used to fall back to "the three shipped recipes so the calculator
// always has something to scale" — which was reasonable while the only user was
// the bakery those three belong to, and became two separate defects the moment
// the app had customers:
//
//   · a brand-new customer opened the Calculator holding one bakery's formulas;
//   · and a customer who DELETED all their own recipes got those formulas back,
//     out of nowhere, with nothing on screen explaining where they came from.
//
// An empty list now stays empty. The screen says so and offers the way to make
// the first one (js/app.js) — which is the honest answer to "you have none".
function normalizeRecipes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((r, i) => {
    const nr = normalizeRecipe(r, i);
    if (nr && !seen.has(nr.id)) { seen.add(nr.id); out.push(nr); }
  });
  return out;
}

// The ingredient registry: every saved registry name PLUS every label used by a
// recipe (so the autocomplete pool is always a superset of what is in use), de-duped
// case-insensitively. Independent of the recipes — a name can exist here unused.
function normalizeIngredients(raw, recipes) {
  const byName = new Map(); // lowercased name -> { id, name }
  function add(name, idHint) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, { id: String(idHint || ('ing-' + (slug(clean) || byName.size))), name: clean });
  }
  if (Array.isArray(raw)) for (const r of raw) if (r && typeof r === 'object') add(r.name, r.id);
  for (const recipe of recipes) for (const ing of (recipe.ingredients || [])) add(ing.label);
  return [...byName.values()];
}

// Assemble the normalised config from already-normalised clients plus the raw
// document's remaining sections. Shared by the current-shape and migration paths.
function assemble(clients, raw) {
  const recipes = normalizeRecipes(raw.recipes);
  homeProducts(clients, recipes);
  const recipeIds = recipes.map(r => r.id);
  const validProductIds = new Set();
  for (const c of clients) for (const p of c.products) validProductIds.add(p.id);
  const rawLists = Array.isArray(raw.whatsappLists)
    ? raw.whatsappLists
    : groupsToLists(raw.groups, clients);
  return {
    // Optimistic-concurrency revision (see saveCalculatorConfig): preserved across
    // load/edit/save so a concurrent write (e.g. a catalogue import) is detected.
    configRev: Number(raw.configRev) || 0,
    clients,
    recipes,
    ingredients: normalizeIngredients(raw.ingredients, recipes),
    whatsappLists: normalizeWhatsappLists(rawLists, clients, validProductIds),
    whatsappClients: normalizeWhatsappClients(raw.whatsappClients, validProductIds),
    extraDough: normalizeExtraDough(raw.extraDough, recipeIds),
    divisorIncluded: normalizeDivisorIncluded(raw.divisorIncluded, clients, recipeIds),
    logVisibility: normalizeLogVisibility(raw.logVisibility, recipeIds),
    logRetentionHours: normalizeLogRetention(raw.logRetentionHours),
    logRetentionByDough: normalizeLogRetentionByDough(raw.logRetentionByDough, raw.logRetentionHours, recipeIds),
    // An unknown or missing value falls back to 'both' — the widest window, so a
    // corrupt setting never silently narrows what the order form offers.
    orderPrefillWindow: getOrderPrefillWindow(raw),
  };
}

// Migrate the shared-catalogue shape (a top-level products[] plus clients[].items[],
// live from v1.5.0 to v1.21.x) into products owned by their client. Each item is
// resolved to its catalogue product and carries its own kind/crate.
//
// ⚠️ THE ID IS PRESERVED, even when two clients order the same product and the two
// copies therefore end up sharing one. Four things key by that id — the divisor ticks,
// the WhatsApp lists, the rows of every saved log, and the typed quantities in
// localStorage (qty-<client>::<product>) — and minting a new one for the second client
// would quietly cut all four. Quantities were ALREADY per (client, product), so sharing
// an id costs nothing; where the client is known, look inside its own products.
function migrateCatalogue(raw) {
  const catalogue = new Map();
  for (const p of (Array.isArray(raw.products) ? raw.products : [])) {
    const np = normalizeProduct(p);
    if (np && !catalogue.has(np.id)) catalogue.set(np.id, np);
  }
  const clients = [];
  for (const c of (Array.isArray(raw.clients) ? raw.clients : [])) {
    if (!c || typeof c !== 'object') continue;
    const products = [];
    const seen = new Set();
    for (const item of (Array.isArray(c.items) ? c.items : [])) {
      if (!item || !item.productId) continue;
      const base = catalogue.get(String(item.productId));
      if (!base || seen.has(base.id)) continue; // an item pointing at a deleted product
      seen.add(base.id);
      products.push({ ...base, kind: normalizeKind(item.kind), crate: normalizeCrate(item.crate) });
    }
    clients.push({ id: String(c.id || ''), name: cleanName(c.name, 'Client'), products });
  }
  return clients;
}

// Migrate the OLDEST per-tab shape ({focaccia,brioche,sourdough}.clients + market)
// into the catalogue + items shape. Clients with the same name across tabs/market are
// merged; each market list becomes a group referencing those clients. Best-effort:
// market-only product names cannot become catalogue products and are dropped — safe
// because no real data exists yet (placeholders only).
function migrateLegacy(raw) {
  const byName = new Map(); // lowercased name -> client object { id, name, products }
  const order = [];

  function findOrCreateClient(name, idHint) {
    const key = String(name || 'Client').trim().toLowerCase();
    let client = byName.get(key);
    if (!client) {
      client = { id: String(idHint || 'c-' + (key.replace(/\s+/g, '-') || 'client')), name: cleanName(name, 'Client'), products: [] };
      byName.set(key, client);
      order.push(client);
    }
    return client;
  }

  for (const tab of TABS) {
    const tabConf = raw[tab];
    if (!tabConf || !Array.isArray(tabConf.clients)) continue;
    for (const legacyClient of tabConf.clients) {
      if (!legacyClient || typeof legacyClient !== 'object') continue;
      const client = findOrCreateClient(legacyClient.name, legacyClient.id);
      for (const p of (Array.isArray(legacyClient.products) ? legacyClient.products : [])) {
        const np = normalizeProduct({ ...p, recipeId: tab });
        if (np && !client.products.some(x => x.id === np.id)) client.products.push(np);
      }
    }
  }

  const groups = legacyMarketLists(raw.market).map((list, li) => {
    const clientIds = [];
    for (const mc of (Array.isArray(list.clients) ? list.clients : [])) {
      const client = findOrCreateClient(mc && mc.name, mc && mc.id);
      if (!clientIds.includes(client.id)) clientIds.push(client.id);
    }
    return { id: String(list.id || 'g-' + li), title: cleanName(list.title, t('help.marketOrder')), clientIds };
  });

  return assemble(order, { ...raw, whatsappLists: undefined, groups });
}

// Pull the legacy market section into a flat list of {id,title,clients} shapes.
function legacyMarketLists(market) {
  if (!market || typeof market !== 'object') return [];
  if (Array.isArray(market.lists)) return market.lists;
  if (Array.isArray(market.clients)) {
    return [{ id: 'list-market', title: market.title || t('help.marketOrder'), clients: market.clients }];
  }
  return [];
}

// Produce a safe, well-formed config from arbitrary (e.g. Firestore) input. A
// shared-catalogue document (with a top-level `products`) is migrated into the current
// shape; a current document (clients[].products) is validated; an oldest per-tab
// document is migrated; missing/garbage input falls back to the default so the app
// always renders.
//
// ⚠️ The catalogue branch must come FIRST: a document written by v1.5.0–v1.21.x carries
// BOTH a top-level products[] AND a stale clients[].products[] left behind as a revert
// window back then. The stale copy is deliberately ignored — `items` is what those
// versions actually maintained.
//
// ⚠️ Rollback safety: a document in the CURRENT shape has clients[].products and no
// top-level products[], which is exactly the shape the pre-v1.5.0 code migrated from.
// A phone still running an older version therefore reads it correctly instead of
// finding an empty address book.
export function normalizeConfig(raw) {
  const base = cloneConfig(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return base;

  if (Array.isArray(raw.products)) return assemble(migrateCatalogue(raw), raw);

  // Current shape: each client owns the products it orders.
  if (Array.isArray(raw.clients)) {
    return assemble(raw.clients.map(normalizeClient).filter(Boolean), raw);
  }

  // Oldest per-tab + market shape.
  if (raw.focaccia || raw.brioche || raw.sourdough || raw.market) {
    return migrateLegacy(raw);
  }

  return base;
}

// Reconcile a config about to be written against the freshest server copy, for the
// optimistic-concurrency save (see saveCalculatorConfig). Pure and testable.
// If the server changed since `config` was loaded (its configRev differs), any
// IMPORTED (cat-*) recipes present on the server but missing from `config` are
// preserved, so a blind overwrite can't silently drop a recipe another writer (a
// catalogue import) just added. Normal edits — including deleting a recipe — are
// untouched when there is no concurrent writer (the revisions match). Returns the
// recipes to write and the next revision (always server + 1, so it climbs monotonically).
export function reconcileConfigWrite(config, server) {
  const expectedRev = Number(config && config.configRev) || 0;
  const serverRev = Number(server && server.configRev) || 0;
  let recipes = Array.isArray(config && config.recipes) ? config.recipes : [];
  if (server && serverRev !== expectedRev) {
    const have = new Set(recipes.map(r => r && r.id));
    const importedMissing = (Array.isArray(server.recipes) ? server.recipes : [])
      .filter(r => r && typeof r.id === 'string' && r.id.indexOf('cat-') === 0 && !have.has(r.id));
    if (importedMissing.length) recipes = recipes.concat(importedMissing);
  }
  return { recipes, configRev: serverRev + 1 };
}
