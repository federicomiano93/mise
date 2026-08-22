// catalogue-list.js — the recipe list view: a name search plus the recipes as
// clean name-only cards, most-used first. Returns { root, refresh } so the live
// Firestore listener can update the cards without rebuilding (and losing) the
// search box.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { sortByUsage, filterByName } from './catalogue-model.js';

const SEARCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

export function renderList({ recipes, usageMap, initialQuery = '', onQueryChange, onOpen, onAllergenSheet, onPhotoRecipe }) {
  let query = initialQuery;
  let currentRecipes = recipes;
  let currentUsage = usageMap;
  let debounceTimer = null;

  const listContainer = el('div', { class: 'cat-list' });

  const input = el('input', {
    type: 'search',
    placeholder: t('cat.searchARecipe'),
    'aria-label': t('cat.searchARecipeBy'),
    autocomplete: 'off',
    value: query,
    oninput: (e) => {
      query = e.target.value;
      if (onQueryChange) onQueryChange(query);
      // Debounce so a large catalogue isn't re-rendered on every keystroke.
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(paint, 140);
    },
  });

  const search = el('div', { class: 'cat-search' }, [
    el('span', { icon: SEARCH_SVG, 'aria-hidden': 'true' }),
    input,
  ]);

  function paint() {
    listContainer.replaceChildren();
    const visible = sortByUsage(filterByName(currentRecipes, query), currentUsage);
    if (!visible.length) {
      listContainer.appendChild(el('div', {
        class: 'cat-empty',
        text: currentRecipes.length
          ? t('cat.noRecipeMatchesYour')
          : t('cat.noRecipesYetTap'),
      }));
      return;
    }
    for (const recipe of visible) {
      listContainer.appendChild(el('button', {
        class: 'cat-card',
        type: 'button',
        onclick: () => onOpen(recipe),
      }, [
        el('span', { class: 'name', text: recipe.name || t('cat.noName') }),
        el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
      ]));
    }
  }

  paint();
  const listPanel = el('div', { class: 'cat-list-panel' }, [listContainer]);
  // The way in to the allergen sheet. Below the search rather than in the header:
  // the header's two side slots are 84px each and already full, and a fifth button
  // there is exactly the change that has cost this project a release before.
  const sheetBtn = el('button', {
    class: 'cat-alg-sheet-btn', type: 'button', onclick: () => onAllergenSheet(),
  }, [t('cat.allergenSheet'), el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' })]);
  // The way in to reading a recipe from a photograph. A SIBLING of the allergen
  // sheet button and for the same reason: the header's two side slots are 84px
  // each and already full. It sits above the list because it is a way of ADDING a
  // recipe, not a way of reading the ones already there.
  const photoBtn = el('button', {
    class: 'cat-alg-sheet-btn cat-photo-btn', type: 'button', onclick: () => onPhotoRecipe(),
  }, [t('cat.photo.entry'), el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' })]);
  const root = el('div', { class: 'cat-view' }, [search, photoBtn, sheetBtn, listPanel]);

  return {
    root,
    refresh(newRecipes, newUsage) {
      currentRecipes = newRecipes;
      currentUsage = newUsage;
      paint();
    },
  };
}
