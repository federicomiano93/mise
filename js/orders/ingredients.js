// ingredients.js — builds the ingredient list for one supplier.
//
// Minimal, chef-first: each row shows the ingredient name + unit and two plain
// number inputs side by side — STOCK ON HAND (entered first) and the ORDER
// quantity. Entering stock auto-fills the suggested order quantity from history
// (Phase 5) — the operator can always override it. When enough history exists a
// small line shows the suggestion; otherwise nothing (no countdown noise).
//
// State lives in the shared `entries` object ({ [id]: { qty, stock } }).
// `suggest(ingredientId, stock)` returns the suggestion engine result.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { isUnusualQuantity } from './suggestions.js';
import { wholeNumber } from './archive.js';
import { groupByCategory } from './ingredient-category.js';

// How many of a supplier's ingredients already have a quantity entered — used to
// paint the progress bar correctly on first render (before any typing), so a
// supplier is never stuck on a placeholder. refreshSupplierDerived (suppliers.js)
// keeps it in sync as the operator types.
function countFilled(ingredients, entries) {
  return ingredients.filter(i => (entries[i.id]?.qty || 0) > 0).length;
}

// The row's slice of the shared draft, re-created if it is gone.
//
// It CAN be gone while the row is still on screen: archiving a supplier deletes
// its keys out of `entries`, and so does the same clear arriving from another
// phone — neither rebuilds the rows (they only reset the input values, so the
// operator never loses focus mid-typing). Reaching straight for entries[id].qty
// in a keystroke handler would then throw on a live screen. Always go through
// this.
function entryFor(entries, id) {
  return entries[id] || (entries[id] = { qty: 0, stock: 0 });
}

export function buildIngredientList(supplier, ingredients, suggest, entries, hooks) {
  // A supplier with no ingredients shows a clear empty state, not a progress bar
  // stuck at 0 of 0 (the old "Loading…" bug: nothing ever replaced the placeholder).
  if (!ingredients.length) {
    return el('div', { class: 'ingredient-list' }, [
      el('p', { class: 'ing-empty', text: t('orders.noIngredientsYetAdd') }),
    ]);
  }

  const total = ingredients.length;
  const filled = countFilled(ingredients, entries);

  const fill = el('div', { class: 'progress-fill', id: `progress-fill-${supplier.id}`,
    style: { width: `${Math.round((filled / total) * 100)}%` } });
  // The bar stays (a quick "how full is this order" cue); the "X of Y filled" text
  // was removed — the bar already says it.
  const progress = el('div', { class: 'progress' }, [
    el('div', { class: 'progress-track' }, [fill]),
  ]);

  const body = el('div', { class: 'ingredient-list' }, [progress]);

  // ⚠️ THE GROUPING IS NOT DONE HERE. It used to be, with a bare
  // `Object.keys(groupBy(...)).sort()`, and it produced a heading reading
  // "undefined" for a row whose category field was absent, filed 'Other' bare
  // under whatever heading happened to precede it, and split one category in two
  // when a value carried a trailing space. ingredient-category.js is now the ONE
  // answer, shared with the read-only supplier-items screen — two screens
  // disagreeing about which heading a row belongs under is how somebody orders
  // the wrong thing.
  groupByCategory(ingredients).forEach(({ category, items }) => {
    if (category) body.appendChild(el('div', { class: 'ing-category' }, category));
    items
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach(ing => body.appendChild(buildRow(ing, supplier, suggest, entries, hooks)));
  });

  return body;
}

// One ingredient row. Exported because the flat "All ingredients" view builds the
// very same row — one row implementation, so a fix to the stock/order behaviour can
// never land in one view and not the other.
//
// `meta` is the line under the name (the supplier, in the flat list). It is left out
// entirely in the by-supplier view: the card heading already says whose it is.
export function buildRow(ing, supplier, suggest, entries, hooks, { meta = '' } = {}) {
  const entry = entryFor(entries, ing.id);

  const stockInput = el('input', {
    type: 'number', class: 'ing-stock', min: '0', inputmode: 'numeric',
    'aria-label': `${ing.name} stock on hand`,
  });
  const qtyInput = el('input', {
    type: 'number', class: 'ing-qty', min: '0', inputmode: 'numeric',
    'aria-label': `${ing.name} quantity to order`,
  });
  const hint = el('div', { class: 'ing-suggestion' });

  function setQty(value, fromInput) {
    const qty = wholeNumber(value);
    entryFor(entries, ing.id).qty = qty;
    if (!fromInput) qtyInput.value = qty || '';
    hooks.afterChange(supplier.id);
  }

  // Show the "Suggested: X" hint only when history has produced an active
  // suggestion; otherwise leave the line empty (no "available in N orders" noise).
  //
  // The one thing that outranks the suggestion on that line is a quantity that looks
  // like a typing mistake (300 for 30). It takes the line over rather than adding a
  // second one: the row is 273px on a 320px phone and has no space for another, and
  // "Suggested: 8" sitting beside "much more than usual" would be saying the same
  // thing twice anyway.
  function updateHint() {
    const result = suggest(ing.id, entryFor(entries, ing.id).stock || 0);
    const qty = entryFor(entries, ing.id).qty || 0;

    if (result.active && isUnusualQuantity(qty, result.par)) {
      hint.textContent = `Much more than usual (about ${result.par})`;
      hint.className = 'ing-suggestion warn';
    } else if (result.active) {
      hint.textContent = `Suggested: ${result.suggestion}`;
      hint.className = 'ing-suggestion active';
    } else {
      hint.textContent = '';
      hint.className = 'ing-suggestion';
    }
    return result;
  }

  stockInput.addEventListener('input', () => {
    entryFor(entries, ing.id).stock = wholeNumber(stockInput.value);
    const result = updateHint();
    if (result.active) setQty(result.suggestion); // auto-fill the suggested order (also autosaves)
    else hooks.afterChange(supplier.id);           // still autosave the stock value
    updateHint();                                  // the auto-filled qty may itself be worth a word
  });
  qtyInput.addEventListener('input', () => {
    setQty(qtyInput.value, true);
    updateHint();   // the warning has to appear as the extra digit is typed
  });

  // "name weight" (e.g. "Bacon 2.27kg"); the order unit (e.g. "casse") sits next
  // to the Order box, not by the name. Both are skipped when empty.
  const nameLabel = [ing.name, ing.weight].filter(Boolean).join(' ');

  const row = el('div', { class: 'ing-row', dataset: { ing: ing.id } }, [
    el('div', { class: 'ing-top' }, [
      el('span', { class: 'ing-name', text: nameLabel }),
    ]),
    // Its own block, not a second child of .ing-top: that is a baseline-aligned flex
    // row, so the supplier would sit BESIDE the name instead of under it.
    meta ? el('div', { class: 'ing-supplier', text: meta }) : null,
    el('div', { class: 'ing-fields' }, [
      el('label', { class: 'field order-field' }, [
        el('span', { class: 'field-label', text: t('orders.field.order') }),
        el('div', { class: 'ing-order-input' }, [
          qtyInput,
          ing.unit ? el('span', { class: 'ing-order-unit', text: ing.unit }) : null,
        ]),
      ]),
      el('label', { class: 'field stock-field' }, [
        el('span', { class: 'field-label', text: t('orders.field.stock') }),
        stockInput,
      ]),
    ]),
    hint,
  ]);

  stockInput.value = entry.stock || '';
  qtyInput.value = entry.qty || '';
  updateHint(); // show suggestion without overwriting a restored quantity
  return row;
}
