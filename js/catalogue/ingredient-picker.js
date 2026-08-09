// ingredient-picker.js — the full-screen chooser that links a recipe row to a
// real ingredient (or to another recipe).
//
// A full-screen overlay with a search box, not a dropdown: there are 65 ingredients
// and hundreds of recipes, and a <select> long enough to hold them is unusable on a
// phone. It follows the app's drill-in pattern and its header spec — Back on the
// LEFT, title CENTRED, nothing on the right.
//
// ⚠️ It deliberately does NOT use the class `.preview-overlay`: that name is in
// BUSY_SELECTORS (js/update-gate.js) and would postpone a compulsory update for as
// long as this stayed open. Nothing here can be lost by closing it, so nothing here
// may hold an update back.

import { el } from './dom.js';
import { linkOptions } from './catalogue-model.js';
import { pricePerKg, formatRate } from '../price-model.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// Open the picker. Resolves with { kind, refId, name } when something is chosen,
// with null when the link is removed, and with undefined when it is dismissed —
// three different answers, because "cancel" must not silently clear a link.
export function openLinkPicker({ ingredients, recipes, suppliers, excludeRecipeId, hasLink }) {
  return new Promise(resolve => {
    let query = '';

    const list = el('div', { class: 'cat-pick-list' });

    const search = el('input', {
      class: 'cat-pick-search', type: 'search', placeholder: 'Search an ingredient…',
      'aria-label': 'Search an ingredient',
      oninput: e => { query = e.target.value; paint(); },
    });

    function close(value) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    }

    // Escape dismisses — the same answer as Back, never "remove the link".
    function onKey(e) { if (e.key === 'Escape') close(undefined); }

    function row(main, meta, onPick) {
      return el('button', { class: 'cat-pick-row', type: 'button', onclick: onPick }, [
        el('span', { class: 'cat-pick-name', text: main }),
        meta ? el('span', { class: 'cat-pick-meta', text: meta }) : null,
      ]);
    }

    function paint() {
      const options = linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId });
      list.replaceChildren();

      if (options.ingredients.length) {
        list.appendChild(el('div', { class: 'cat-pick-head', text: 'Ingredients' }));
        options.ingredients.forEach(opt => {
          // Name · weight · supplier · what a kilo costs — the four things that tell
          // two similar-looking articles apart. "No price yet" is said out loud
          // rather than left blank: linking to an unpriced ingredient is allowed,
          // and the row should not look like it will produce a cost.
          const rate = pricePerKg(opt.ingredient);
          const meta = [opt.weight, opt.supplierName,
            rate === null ? 'No price yet' : `${formatRate(rate)} / kg`]
            .filter(Boolean).join('  ·  ');
          list.appendChild(row(opt.name, meta,
            () => close({ kind: 'ingredient', refId: opt.id, name: opt.name })));
        });
      }

      if (options.recipes.length) {
        list.appendChild(el('div', { class: 'cat-pick-head', text: 'Recipes' }));
        options.recipes.forEach(opt => {
          list.appendChild(row(opt.name, 'Recipe',
            () => close({ kind: 'recipe', refId: opt.id, name: opt.name })));
        });
      }

      if (!options.ingredients.length && !options.recipes.length) {
        list.appendChild(el('p', { class: 'cat-pick-empty', text: query
          ? 'Nothing matches your search.'
          : 'No ingredients yet — add them in Orders, under Settings.' }));
      }
    }

    const overlay = el('div', { class: 'cat-pick-overlay' }, [
      el('header', { class: 'cat-header cat-pick-header' }, [
        el('button', { class: 'cat-icon-btn', type: 'button', 'aria-label': 'Back',
          icon: BACK_ICON, onclick: () => close(undefined) }),
        el('div', { class: 'cat-pick-title' }, [el('h1', { text: 'Link to' })]),
        el('span', { class: 'cat-pick-spacer' }),
      ]),
      el('div', { class: 'cat-pick-body' }, [
        search,
        // Only offered when there IS a link. A "remove" on a row that has none is a
        // button that does nothing, and it sits exactly where the first result will
        // appear a moment later.
        hasLink
          ? el('button', { class: 'cat-pick-unlink', type: 'button', text: 'Remove the link',
            onclick: () => close(null) })
          : null,
        list,
      ]),
    ]);

    paint();
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    try { search.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
  });
}
