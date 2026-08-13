// foodcost-store.js — the live product list, plus the two borrowed lookups the
// costing needs (recipes and ingredient prices).
//
// Resilience (P17) + cost (P14): everything is held in memory and mirrored to
// localStorage, so the screen paints instantly and works offline. The listeners
// are attached only when this page initialises, never at app boot. Writes are
// LOCAL-FIRST: memory + cache + UI update immediately, the Firestore write is
// best-effort, and a REJECTED write is rolled back and surfaced.

import { normalizeProduct, normalizeProducts } from './foodcost-model.js';
import {
  watchProducts, watchRecipes, watchIngredients,
  saveProductWithSnapshot, removeProduct, newProductId,
} from './firebase-foodcost.js';

const PRODUCTS_KEY = 'foodcost-products';
const RECIPES_KEY = 'foodcost-recipes';
const INGREDIENTS_KEY = 'foodcost-ingredients';

// ⚠️ FUNCTION DECLARATIONS, NOT const ARROWS, for everything called from the
// initialisation below. A declaration is hoisted; a const arrow is in the temporal
// dead zone and throws "Cannot access before initialization", which kills the whole
// module and leaves the page blank with no screen and no error a user can see.
// That exact mistake shipped into the catalogue store and was only found by opening
// the page — this file touches Firestore, so no unit test reaches it either.
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // Corrupt/unavailable cache — the listener will fill it in.
  }
  return fallback;
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage full/unavailable — the in-memory copy still works this session.
  }
}

function indexById(list) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (item && item.id) out[item.id] = item;
  });
  return out;
}

let products = normalizeProducts(readJson(PRODUCTS_KEY, []));
let recipes = indexById(readJson(RECIPES_KEY, []));
let ingredients = indexById(readJson(INGREDIENTS_KEY, []));
let notify = null;
let onSyncError = null;

export function getProducts() { return products; }
export function getRecipes() { return recipes; }
export function getIngredients() { return ingredients; }

// The two lookup tables, in the shape both cost models expect.
export function tables() {
  return { recipes, ingredients };
}

export function setSyncErrorHandler(fn) {
  onSyncError = typeof fn === 'function' ? fn : null;
}

export function initFoodCost(onUpdate, onError) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;

  watchProducts(
    remote => {
      products = normalizeProducts(remote);
      writeJson(PRODUCTS_KEY, remote);
      if (notify) notify();
    },
    err => { if (onError) onError(err); },
  ).catch(err => { console.error('Food Cost live sync failed to start:', err); if (onError) onError(err); });

  // Borrowed from the catalogue and from Orders. Quiet on failure: they belong to
  // other sections, and a venue may legitimately not use them.
  watchRecipes(remote => {
    recipes = indexById(remote);
    writeJson(RECIPES_KEY, remote);
    if (notify) notify();
  }, () => {}).catch(() => {});

  watchIngredients(remote => {
    ingredients = indexById(remote);
    writeJson(INGREDIENTS_KEY, remote);
    if (notify) notify();
  }, () => {}).catch(() => {});

  return products;
}

function upsertLocal(product) {
  const norm = normalizeProduct(product);
  if (!norm) return;
  const idx = products.findIndex(p => p.id === norm.id);
  const next = products.slice();
  if (idx >= 0) next[idx] = norm; else next.push(norm);
  products = next;
  writeJson(PRODUCTS_KEY, products);
  if (notify) notify();
}

function removeLocal(id) {
  products = products.filter(p => p.id !== id);
  writeJson(PRODUCTS_KEY, products);
  if (notify) notify();
}

// Save a product LOCAL-FIRST, appending its margin when the change is worth
// recording. Returns the id immediately; a rejected write is rolled back and
// surfaced, so the screen never shows a save that did not happen.
//
// The FIELDS ARE LISTED BY HAND because this object becomes the Firestore
// document, and the rules whitelist exactly these — spreading the product would
// send `id` as a field and have every save refused.
export function saveProduct(product, snapshot) {
  const id = product.id || newProductId();
  const data = {
    name: product.name,
    components: product.components || [],
    packaging: product.packaging || [],
    sellingMode: product.sellingMode ?? null,
    piecesPerBatch: product.piecesPerBatch ?? null,
    sellingPrice: product.sellingPrice ?? null,
    vatRate: product.vatRate ?? null,
    foodCostTarget: product.foodCostTarget ?? null,
  };
  const prev = products.find(p => p.id === id) || null;

  upsertLocal({ id, ...data });
  // ⚠️ ALWAYS the id, never null. The id was minted above so the product could
  // appear instantly; letting the data layer mint its own for a new product would
  // write the document under a DIFFERENT id from the one already on screen — two
  // products, one of them invisible, and the rollback would then remove the wrong
  // one.
  saveProductWithSnapshot(id, data, snapshot).catch(err => {
    console.warn('Product did not sync to Firestore:', err);
    if (prev) upsertLocal(prev); else removeLocal(id);
    if (onSyncError) onSyncError(`Couldn’t save “${product.name || 'product'}” — check your connection.`);
  });
  return id;
}

export function deleteProduct(id) {
  const prev = products.find(p => p.id === id) || null;
  removeLocal(id);
  removeProduct(id).catch(err => {
    console.warn('Product delete did not sync to Firestore:', err);
    if (prev) upsertLocal(prev);
    if (onSyncError) onSyncError('Couldn’t delete the product — check your connection.');
  });
}
