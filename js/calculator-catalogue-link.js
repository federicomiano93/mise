// calculator-catalogue-link.js — the linked Catalogue recipes, kept fresh.
//
// One small piece of state and one function every screen asks: given a Calculator
// tab, what are its ACTUAL ingredients right now? All the deciding lives in the
// pure js/calculator-recipe-source.js; this is the wiring around it.
//
// ⚠️ THE LINK IS LIVE, NOT A COPY. That is the whole point of the change: correct
// a recipe in the Catalogue and every tab using it is corrected too, instead of
// the two copies that exist today and silently disagree the moment one is fixed.

import { watchCatalogueRecipe } from './firebase.js';
import { getRecipes } from './calculator-config.js';
import { linkedRecipeIds, resolveRecipe } from './calculator-recipe-source.js';

// id → the Catalogue recipe, or null when it cannot be read.
//
// ⚠️ null IS STORED, NOT SKIPPED. "We looked and it is gone" and "we have not
// looked yet" must stay different answers, or a deleted recipe would read as one
// still loading and the tab would wait for ever instead of saying so.
const loaded = new Map();
const stops = new Map();
let notify = () => {};

// Called whenever the config changes. Starts a listener for every newly linked
// recipe and stops the ones nothing points at any more.
export function syncLinkedRecipes(config, onChange) {
  if (onChange) notify = onChange;
  const wanted = new Set(linkedRecipeIds(getRecipes(config)));

  for (const [id, stop] of stops) {
    if (!wanted.has(id)) { stop(); stops.delete(id); loaded.delete(id); }
  }

  for (const id of wanted) {
    if (stops.has(id)) continue;
    stops.set(id, watchCatalogueRecipe(id, recipe => {
      loaded.set(id, recipe);
      notify();
    }));
  }
}

// What a tab's ingredients actually are, right now.
//
// ⚠️ EVERY SCREEN MUST GO THROUGH HERE. A screen reading recipe.ingredients
// directly would see the tab's own leftover copy — which, once a recipe is
// linked, is exactly the stale data this change exists to stop using.
export function effectiveRecipe(recipe) {
  return resolveRecipe(recipe, Object.fromEntries(loaded));
}

// Has the linked recipe arrived yet? Used to tell "still loading" apart from
// "gone", which are two different sentences on screen.
export function isStillLoading(recipe) {
  const id = String(recipe?.catalogueId || '').trim();
  return !!id && !loaded.has(id);
}
