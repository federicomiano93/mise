// supplier-detail.js — one supplier's order, on its own screen.
//
// Replaces the card that used to expand in place. The app's rule is "list → detail,
// one level at a time, with a Back arrow that steps up a level" and every other
// full-screen part of Orders already follows it. The practical win is that the
// supplier's name stays pinned in the header instead of scrolling away above the rows
// you are typing into.
//
// The rows themselves are still built by ingredients.js — one row implementation for
// the supplier screen, the flat list and the History editor, so a fix to how a
// quantity behaves cannot land in one of them and not the others.

import { el } from './dom.js';
import { buildIngredientList } from './ingredients.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

// ctx: { ingredients, entries, suggest, hooks, onBack }
// -> { overlay, repaint(ctx) }
//
// `repaint` rebuilds only the BODY, never the header — a live snapshot from another
// phone must not make the screen flicker or lose its title. Keystrokes never come
// through here at all: those reach the inputs via syncInputsFromState, which sets
// values without touching the DOM structure.
export function buildSupplierDetail(supplier, ctx) {
  const body = el('div', { class: 'supplier-detail-body' });

  const overlay = el('div', { class: 'supplier-detail' }, [
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
    const { ingredients, entries, suggest, hooks } = next;
    body.replaceChildren();
    body.appendChild(buildIngredientList(supplier, ingredients, suggest, entries, hooks));

    // No products, nothing to record — the empty state inside the list already says so.
    if (!ingredients.length) return;

    const { filled } = ingredients.reduce((acc, i) => (
      (entries[i.id]?.qty || 0) > 0 ? { filled: acc.filled + 1 } : acc), { filled: 0 });

    const placeBtn = el('button', {
      type: 'button',
      class: 'btn-primary supplier-place-btn',
      id: `place-btn-${supplier.id}`,
      onClick: () => hooks.onPlaced(supplier.id),
    }, [
      el('span', { class: 'supplier-place-icon', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      'Order placed',
    ]);
    placeBtn.disabled = filled === 0;
    body.appendChild(placeBtn);
  }

  repaint(ctx);
  return { overlay, repaint };
}
