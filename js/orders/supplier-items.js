// supplier-items.js — everything one supplier sells, to LOOK AT.
//
// Opened by the list icon on a supplier's row. Its whole point is what it does NOT
// have: no quantity box, no stock box, no button that saves anything. Until now the
// only way to remind yourself what you buy from a supplier was to open its ORDER,
// a screen where a mistyped tap goes straight into a real order.
//
// It is strictly read-only. It writes nothing, anywhere — which is why it can be
// opened mid-order without a second thought.
//
// The set of products shown is the SAME lens the order screen uses (the caller
// passes it): a deactivated product is invisible here exactly as it is there. Two
// screens disagreeing about what a supplier sells would be worse than no screen.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { ingredientLabel } from './archive.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// The default, no-information category. Carrying a heading for it would add a line
// that says nothing, so those rows are shown bare — see the ordering note below.
const NO_CATEGORY = '';

function categoryOf(ing) {
  const category = (ing?.category || '').trim();
  return category === 'Other' ? NO_CATEGORY : category;
}

// PURE — the whole reason this is testable without a browser (P15).
//
// -> [{ category, items: [{ id, label, unit }] }]
//
// ORDERING. The uncategorised block comes FIRST and carries no heading; the named
// categories follow A→Z, each under its own. Bare rows must never sit UNDER a
// heading they do not belong to, and putting them anywhere but the top is exactly
// how that happens.
export function itemGroups(ingredients) {
  const groups = new Map();

  (ingredients || []).forEach(ing => {
    if (!ing) return;
    const category = categoryOf(ing);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({
      id: ing.id,
      // Never the raw document id: "Fdx92kQ1" tells nobody what it is. Same
      // reasoning, and the same helper, as the names in History.
      label: ingredientLabel(ing) || t('orders.unnamedProduct'),
      unit: ing.unit || '',
    });
  });

  // By label, then by id as a tie-break: without it two products with identical
  // labels can swap places between repaints and the rows jump under the eye.
  groups.forEach(items => items.sort((a, b) =>
    a.label.localeCompare(b.label) || String(a.id).localeCompare(String(b.id))));

  const named = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const order = groups.has(NO_CATEGORY) ? [NO_CATEGORY, ...named] : named;

  return order.map(category => ({ category, items: groups.get(category) }));
}

export function countLabel(total) {
  return total === 1 ? '1 ingredient' : `${total} ingredients`;
}

// supplier: { id, name }; ingredients: that supplier's products (already lensed).
// ctx: { onBack }
// -> { overlay, repaint(ingredients) }
//
// `repaint` rebuilds only the BODY, never the header — a snapshot from another phone
// must not make the title flicker. Nothing here holds typing, so rebuilding the body
// costs nothing: there is no field to rip out from under a finger.
export function buildSupplierItems(supplier, ingredients, ctx) {
  const body = el('div', { class: 'supplier-items-body' });

  const overlay = el('div', { class: 'supplier-items' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: () => ctx.onBack?.(),
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: supplier.name })]),
      // Keeps the title centred: the back button on the left needs a counterweight.
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    body,
  ]);

  function repaint(next) {
    const list = next || [];
    body.replaceChildren();

    if (!list.length) {
      // The same sentence the supplier's order screen shows, for the same situation.
      body.appendChild(el('p', { class: 'ing-empty', text: t('orders.noIngredientsYetAdd') }));
      return;
    }

    body.appendChild(el('p', { class: 'ing-count', text: countLabel(list.length) }));

    const rows = el('div', { class: 'supplier-items-list' });
    itemGroups(list).forEach(group => {
      if (group.category) rows.appendChild(el('div', { class: 'ing-category' }, group.category));
      group.items.forEach(item => rows.appendChild(el('div', { class: 'supplier-item' }, [
        el('span', { class: 'supplier-item-name', text: item.label }),
        item.unit ? el('span', { class: 'supplier-item-unit', text: item.unit }) : null,
      ])));
    });
    body.appendChild(rows);
  }

  repaint(ingredients);
  return { overlay, repaint };
}
