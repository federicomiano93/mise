// catalogue-list.js — the recipe list view: a name search plus the recipes as
// clean name-only cards, most-used first. Returns { root, refresh } so the live
// Firestore listener can update the cards without rebuilding (and losing) the
// search box.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { sortByUsage, filterByName } from './catalogue-model.js';
import { buildCatalogueSearch } from './search-box.js';

export function renderList({ recipes, usageMap, initialQuery = '', onQueryChange, onOpen }) {
  let query = initialQuery;
  let currentRecipes = recipes;
  let currentUsage = usageMap;

  const listContainer = el('div', { class: 'cat-list' });

  // The field itself moved to search-box.js so the allergen sheet gets the same
  // one. Same behaviour: the query is stored on every keystroke, the repaint is
  // debounced.
  const { node: search } = buildCatalogueSearch({
    value: query,
    placeholder: t('cat.searchARecipe'),
    ariaLabel: t('cat.searchARecipeBy'),
    onInput: (text) => {
      query = text;
      if (onQueryChange) onQueryChange(query);
    },
    onChange: () => paint(),
  });

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
  // ⚠ THE ALLERGEN SHEET IS NO LONGER HERE. It was a full-width row between the
  // search and the recipes, which put a screen nobody opens daily above the one
  // thing this page exists for. Federico, 22 Aug 2026: it belongs in the bottom bar
  // beside Settings — see catalogue.html and setHeader() in catalogue-main.js, where
  // each button carries its own permission.
  const root = el('div', { class: 'cat-view' }, [search, listPanel]);

  return {
    root,
    refresh(newRecipes, newUsage) {
      currentRecipes = newRecipes;
      currentUsage = newUsage;
      paint();
    },
  };
}
