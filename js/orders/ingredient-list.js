// ingredient-list.js — the "All ingredients" view: one alphabetical list of
// everything that can be ordered, with a search box on top and a filter that narrows
// it to just what is being ordered right now.
//
// Two rules shape this file, both learnt the hard way elsewhere in the app:
//
//   1. MOUNT ONCE, REPAINT THE ROWS. The Orders screen re-renders on every
//      suppliers / ingredients / history snapshot, and those arrive from other
//      phones too. Rebuilding the search box on each one would wipe the text being
//      typed, mid-search, for no reason the operator could see. So the box, the
//      filter and the counter are built once and only the row list is repainted —
//      the pattern renderSearchableList already uses in management.js.
//
//   2. RENDER INSIDE #suppliers-list. orders.css scopes the fix for the .ing-row
//      class the Calculator and Orders share to "#suppliers-list .ing-row". A row
//      built anywhere else quietly falls back to the Calculator's flex layout, which
//      on a 320px phone puts the Order box outside the card where it cannot be
//      tapped. The caller passes that container; this file never makes its own.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { buildRow } from './ingredients.js';
import { flatRows } from './ingredient-search.js';
import { buildSearchBox } from './search-box.js';

// container: the #suppliers-list element (see rule 2 above).
// ctx: { query, onQuery(text), onFilter(active), suggest(id, stock), entries, hooks }
//
// Returns { repaint({ ingredients, suppliers, only, inOrderCount }) } — the caller
// owns the data and hands in a fresh snapshot whenever one arrives. `only` is null
// (show everything) or a FROZEN Set of ingredient ids; see the note in
// ingredient-search.js for why it must not be recomputed as the operator types.
export function mountIngredientList(container, ctx) {
  let data = { ingredients: [], suppliers: [], only: null, inOrderCount: 0 };
  let query = ctx.query || '';
  let lastTotal = 0;            // remembered so the counts can refresh without a repaint

  const search = buildSearchBox({
    value: query,
    placeholder: t('orders.searchAnIngredient'),
    // Stored immediately so a snapshot landing mid-keystroke finds the current text;
    // the repaint is the debounced half.
    onInput: text => { query = text; ctx.onQuery?.(text); },
    onChange: paint,
  });

  // All / In this order. A radiogroup rather than tabs: it picks how the one list is
  // filtered, it does not swap between two panels.
  const allBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => ctx.onFilter?.(false),
  });
  const orderBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => ctx.onFilter?.(true),
  });
  const filterSwitch = el('div', {
    class: 'view-switch ing-filter', role: 'radiogroup', 'aria-label': 'Which ingredients to show',
  }, [allBtn, orderBtn]);

  const count = el('p', { class: 'ing-count' });
  const listEl = el('div', { class: 'ing-flat-list' });

  function paintFilterSwitch(total, filtering) {
    lastTotal = total;
    allBtn.textContent = `All (${total})`;
    orderBtn.textContent = `Ordering (${data.inOrderCount})`;
    // Nothing typed yet — there is no "just what I'm ordering" to show.
    filterSwitch.hidden = data.inOrderCount === 0 && !filtering;
    [[allBtn, !filtering], [orderBtn, filtering]].forEach(([btn, on]) => {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }

  function paint() {
    const filtering = Boolean(data.only);
    const { rows, total } = flatRows({
      ingredients: data.ingredients, suppliers: data.suppliers, query, only: data.only,
    });

    paintFilterSwitch(total, filtering);

    const scope = filtering ? data.only.size : total;
    const scopeText = filtering ? ' in this order' : '';
    count.textContent = rows.length === scope
      ? `${scope} ingredient${scope === 1 ? '' : 's'}${scopeText}`
      : `${rows.length} of ${scope}${scopeText}`;

    listEl.replaceChildren();

    if (!total) {
      listEl.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noIngredientsYetAdd') }));
      return;
    }
    if (!rows.length) {
      listEl.appendChild(el('p', {
        class: 'mgmt-empty',
        text: filtering
          ? t('orders.nothingInThisOrder')
          : t('orders.noIngredientMatchesYour'),
      }));
      return;
    }

    rows.forEach(row => {
      if (row.letter) listEl.appendChild(el('div', { class: 'ing-letter', text: row.letter }));
      listEl.appendChild(buildRow(
        row.ingredient, row.supplier, ctx.suggest, ctx.entries, ctx.hooks,
        { meta: row.supplierName },
      ));
    });
  }

  container.appendChild(search.node);
  container.appendChild(filterSwitch);
  container.appendChild(count);
  container.appendChild(listEl);

  return {
    repaint(next) {
      data = next;
      paint();
    },

    // Refresh ONLY the two filter-button counts. Called on every keystroke, so it
    // must not touch the rows: repainting them would rip the very input being typed
    // out of the DOM. A count can move freely; a list cannot.
    updateCounts(inOrderCount) {
      data.inOrderCount = inOrderCount;
      paintFilterSwitch(lastTotal, Boolean(data.only));
    },
  };
}
