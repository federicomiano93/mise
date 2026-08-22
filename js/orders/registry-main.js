// registry-main.js — entry point for suppliers.html.
//
// The thin half: it opens the listeners, hands the screen live getters, and wires
// the same save/delete calls the Settings panel used to make. Every judgement about
// what the screen LOOKS like is in registry.js and ingredient-form.js.
//
// ⚠️ IT IS A PAGE OF THE ORDERS FEATURE, not a feature of its own. Same collections,
// same `data-section="orders"` gate, same data layer — which is why it lives in
// js/orders/ and imports nothing from another feature's folder.

import { t } from '../i18n.js';
import { withPrices } from '../price-model.js';
import { buildRegistry } from './registry.js';
import {
  COLLECTIONS, watchCollection, watchIngredientPrices,
  saveDoc, createDoc, removeDoc, saveIngredientWithPrice, getPriceHistory,
} from './firebase-orders.js';

const state = {
  suppliers: [],
  rawIngredients: [],
  ingredientPrices: {},
  ingredients: [],
  loaded: { ingredients: false },
};

const host = document.getElementById('registry-host');

const screen = buildRegistry(
  {
    suppliers: () => state.suppliers,
    ingredients: () => state.ingredients,
  },
  {
    saveSupplier: (id, payload) =>
      id ? saveDoc(COLLECTIONS.suppliers, id, payload) : createDoc(COLLECTIONS.suppliers, payload),
    // One call for both create and update, because the ingredient and its price
    // record have to land together or not at all — see saveIngredientWithPrice.
    // `record` is null whenever the price did not actually move.
    // ⚠️ writePrice IS PASSED THROUGH, not decided here. A batch is all-or-nothing:
    // including a write to ingredient-prices for somebody the rules refuse would
    // fail the WHOLE save, so renaming an ingredient — ordinary work — would come
    // back as a permission error with nothing on screen explaining it.
    saveIngredient: (id, payload, record, writePrice) =>
      saveIngredientWithPrice(id, payload, record, writePrice),
    priceHistory: (id) => getPriceHistory(id),
    setSupplierActive: (id, active) => saveDoc(COLLECTIONS.suppliers, id, { active }),
    setIngredientActive: (id, active) => saveDoc(COLLECTIONS.ingredients, id, { active }),
    deleteSupplier: (id) => removeDoc(COLLECTIONS.suppliers, id),
    deleteIngredient: (id) => removeDoc(COLLECTIONS.ingredients, id),
  },
);

host?.appendChild(screen.node);

// ⚠️ THE ERROR IS SAID OUT LOUD. A listener that fails silently leaves an empty
// list, and an empty list on this screen reads as «this bakery has no suppliers» —
// which is exactly the wrong thing to believe while typing an order.
function liveDataLost(what) {
  return (err) => {
    console.error(`Live ${what} failed:`, err);
    const box = document.getElementById('registry-error');
    if (!box) return;
    box.hidden = false;
    box.textContent = t('orders.registry.loadFailed');
  };
}

// Suppliers and ingredients are a handful of documents and every one of them is
// needed to draw the screen, so both are unbounded — the same choice Orders makes.
watchCollection(COLLECTIONS.suppliers, list => {
  state.suppliers = list;
  screen.refresh();
}, liveDataLost('suppliers'));

// ⚠️ THE PRICES ARE A SECOND COLLECTION AND ARRIVE SEPARATELY. They moved off the
// ingredient document because Orders reads every ingredient to work at all, so a
// rate written there is a rate everybody can read (js/price-model.js). Merged in
// here so the form opens on the price it is meant to edit; an employee is refused
// that collection and simply sees no price, which is the same thing they see for
// an ingredient nobody has priced.
watchIngredientPrices(map => {
  state.ingredientPrices = map;
  if (state.loaded.ingredients) {
    state.ingredients = withPrices(state.rawIngredients, map);
    screen.refresh();
  }
});

watchCollection(COLLECTIONS.ingredients, list => {
  state.rawIngredients = list;
  state.ingredients = withPrices(list, state.ingredientPrices);
  state.loaded.ingredients = true;
  screen.refresh();
}, liveDataLost('ingredients'));
