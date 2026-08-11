// allergen-sheet.js — every recipe's allergens on one screen, and the work list
// that says which ingredients to declare first.
//
// Two audiences, and they want opposite things:
//
//   Somebody at the counter, asked "does this contain nuts?", wants an answer NOW
//   and needs to be able to see instantly that a recipe has no answer yet.
//
//   Somebody filling the data in wants to know where to start — and the honest
//   answer is almost never "at the top of a list of 65". A handful of ingredients
//   appear in nearly everything, so declaring six can unblock twenty recipes while
//   the other fifty-nine matter to one recipe each.
//
// The work list comes FIRST on the screen, because until the data is in, the
// second audience is the only one this screen can help.

import { el } from './dom.js';
import { recipeAllergens, canLabel, blockingIngredients, unlinkedRowNames } from './recipe-allergen-model.js';
import { allergenLabel } from '../allergen-model.js';

export function renderAllergenSheet({ recipes, ingredients, recipesById, onOpen }) {
  const list = Array.isArray(recipes) ? recipes : [];
  const tables = { ingredients, recipes: recipesById };

  const rows = list.map(recipe => ({ recipe, result: recipeAllergens(recipe, tables) }));
  const declared = rows.filter(r => canLabel(r.result));
  const blocked = rows.filter(r => !canLabel(r.result));
  const work = blockingIngredients(list, tables);

  const root = el('div', { class: 'cat-view alg-sheet' });

  // ── Where things stand ──────────────────────────────────────────────────────
  root.appendChild(el('div', { class: 'alg-sheet-summary' }, [
    el('p', { class: 'alg-sheet-count', text: `${declared.length} of ${list.length} recipes fully declared` }),
    el('p', { class: 'alg-sheet-sub', text: blocked.length
      ? `${blocked.length} cannot be labelled yet.`
      : 'Every recipe can be labelled.' }),
  ]));

  // ── The work, in the order it has to be done ────────────────────────────────
  //
  // ⚠️ LINKING COMES BEFORE DECLARING, AND THE SCREEN SAYS SO. An ingredient's
  // declaration cannot reach a recipe that does not point at it, so a sheet that
  // only ever said "declare these" was silent on the job that comes first — and on
  // the real data, where nothing was linked at all, it was silent full stop.
  const unlinked = unlinkedRowNames(list);

  // Twelve is about a screenful; beyond that a plan turns back into the flat list
  // it exists to replace.
  const workBox = (title, sub, items, count, unit) => {
    const box = el('div', { class: 'alg-sheet-work' }, [
      el('p', { class: 'alg-sheet-work-title', text: title }),
      el('p', { class: 'alg-sheet-work-sub', text: sub }),
    ]);
    const ul = el('ul', { class: 'alg-sheet-work-list' });
    for (const item of items.slice(0, 12)) {
      const n = count(item);
      ul.appendChild(el('li', {}, [
        el('span', { class: 'alg-sheet-work-name', text: item.name }),
        el('span', { class: 'alg-sheet-work-n', text: `${n} ${n === 1 ? unit : `${unit}s`}` }),
      ]));
    }
    if (items.length > 12) {
      ul.appendChild(el('li', { class: 'alg-sheet-work-more', text: `…and ${items.length - 12} more` }));
    }
    box.appendChild(ul);
    return box;
  };

  if (unlinked.length) {
    root.appendChild(workBox(
      'Link these rows first',
      'A recipe row has to point at an ingredient before anything can be known about it. Link them from the recipe’s own screen — the pencil, then the row.',
      unlinked, item => item.rows, 'row',
    ));
  }

  if (work.length) {
    root.appendChild(workBox(
      unlinked.length ? 'Then declare these' : 'Declare these first',
      'Each one is holding up this many recipes. Fill them in from Orders → Ingredients.',
      work, item => item.blocks, 'recipe',
    ));
  }

  // ── Every recipe ────────────────────────────────────────────────────────────
  //
  // ⚠️ BLOCKED RECIPES COME FIRST. A list in alphabetical order buries the ones
  // with no answer among the ones that have one, and this screen's whole job is
  // making "we do not know" impossible to miss. Within each half, alphabetical.
  const byName = (a, b) => String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''));
  const ordered = [...blocked.sort(byName), ...declared.sort(byName)];

  const panel = el('div', { class: 'cat-list-panel' });
  if (!ordered.length) {
    panel.appendChild(el('p', { class: 'cat-empty', text: 'No recipes yet.' }));
  }
  for (const { recipe, result } of ordered) {
    const okToLabel = canLabel(result);
    // ⚠️ "0 INGREDIENTS TO SORT OUT" IS NONSENSE, AND IT SHIPPED INTO THE FIRST
    // RUN OF THIS SCREEN. An empty recipe is incomplete — nobody has said it
    // contains nothing — but it has no gaps to count, so the sentence said there
    // was a problem and that there were zero things to fix. Found by READING the
    // output of the driven check, not by a check.
    let line;
    if (okToLabel) {
      line = result.allergens.length ? result.allergens.map(allergenLabel).join(', ') : 'None of the 14';
    } else if (!result.gaps.length) {
      line = 'Nothing in it yet';
    } else {
      line = `Not declared — ${result.gaps.length} ${result.gaps.length === 1 ? 'ingredient' : 'ingredients'} to sort out`;
    }

    panel.appendChild(el('button', {
      class: 'alg-sheet-row' + (okToLabel ? '' : ' alg-sheet-row--blocked'),
      type: 'button',
      onclick: () => onOpen(recipe),
    }, [
      el('span', { class: 'alg-sheet-row-main' }, [
        el('span', { class: 'alg-sheet-name', text: recipe.name || '(no name)' }),
        el('span', { class: 'alg-sheet-what', text: line }),
      ]),
      el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
    ]));
  }
  root.appendChild(panel);

  // ⚠️ THE CAVEAT BELONGS ON THIS SCREEN TOO, not only on the recipe. This is the
  // one somebody would photograph and pin up, and a pinned sheet with no caveat
  // outlives every conversation about what it does not cover.
  root.appendChild(el('p', { class: 'alg-sheet-caveat', text:
    'From the suppliers’ specifications. It does not cover what your own kitchen may add — shared benches, shared equipment, flour in the air.' }));

  return { root };
}
