// calculator-render.js — builds the client/product input cards for a dough tab
// from the configuration. The markup is intentionally identical to the cards
// that used to be hard-coded in calculator.html, so the look and the way the
// user enters quantities do not change. Only the *content* (which clients,
// products and weights) now comes from config instead of being fixed.
//
// A dough tab is a FILTERED VIEW of the single address book: it shows only the
// products whose `dough` matches, grouped back into a card per owning client. A
// client with no product in this dough simply does not appear here.
//
// CSP-safe: elements are created via the DOM API (no innerHTML, no inline style
// attributes), matching the page's strict Content-Security-Policy.

import { getTabProducts, showsLeaveningKnob } from './calculator-config.js';
import { icon } from './calculator-icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// The WhatsApp glyph as a namespaced SVG (createElement can't make SVG, and the page
// forbids innerHTML for markup) — used on each recipe's "share recipe" button.
const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';
function waIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'white');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', WA_PATH);
  svg.appendChild(path);
  return svg;
}

// Small element helper. attrs: { class, id, ... } set as attributes; children
// can be strings or nodes. 'style' is never accepted (CSP forbids style attrs).
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of [].concat(children || [])) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const DROPDOWN_OPTIONS = [0, 20, 40, 60, 80, 100];

// The quantity widget for a product row. A 'dropdown' product picks its quantity
// from a fixed preset list; every other product is a plain number field. Kg products
// take decimals (kilograms). The element id is the row's `qtyId` — the per (client,
// product) quantity key — so the same product ordered by two clients gets its own box.
function quantityControl(product) {
  if (product.kind === 'dropdown') {
    const select = el('select', { id: product.qtyId, class: 'qty-select' });
    for (const v of DROPDOWN_OPTIONS) {
      select.appendChild(el('option', { value: String(v) }, String(v)));
    }
    return select;
  }
  const attrs = { type: 'number', id: product.qtyId, value: '0', min: '0' };
  if (product.kind === 'kg') {
    attrs.step = '0.5';
    attrs.inputmode = 'decimal';
  } else {
    attrs.inputmode = 'numeric';
  }
  return el('input', attrs);
}

// One product row: label (name + weight) on the left, quantity + unit on the
// right. Kg rows show no parenthesised weight, exactly like today.
function productRow(product) {
  const unit = product.kind === 'kg' ? 'kg' : 'pz';
  const label = product.kind === 'kg'
    ? el('span', { class: 'product-label' }, product.name)
    : el('span', { class: 'product-label' }, [
        product.name + ' ',
        el('span', { class: 'product-weight' }, `(${product.weight}g)`),
      ]);
  return el('div', { class: 'product-row' }, [
    label,
    el('div', { class: 'qty-group' }, [quantityControl(product), el('span', { class: 'unit' }, unit)]),
  ]);
}

// Sensible leavening-knob range from a recipe's default %, reproducing the three
// shipped recipes' ranges (focaccia 0.65 → .05/.1–3, brioche 4 → .1/.1–6,
// sourdough 18 → 1/5–40) and giving any new recipe a matching, proportionate scale.
function knobRange(defaultPct) {
  const d = Number(defaultPct) || 0;
  if (d >= 5) return { min: 5, max: 40, step: 1, inputmode: 'numeric' };
  if (d >= 1) return { min: 0.1, max: 6, step: 0.1, inputmode: 'decimal' };
  return { min: 0.1, max: 3, step: 0.05, inputmode: 'decimal' };
}

// Build one recipe's calculator tab panel (a .content div, id `tab-<recipeId>`),
// laid out by the recipe's logic:
//   orders → leavening knob (if shown) + Orders + extra + Confirm/Edit + result
//   total  → "Total dough (g)" + Confirm/Edit + result (no orders/leavening/extra)
//   both   → leavening knob (if shown) + Orders + total + extra + Confirm/Edit + result
// CSP-safe (DOM API, no innerHTML/inline styles). No event listeners here — app.js
// wires them after inserting the panel, exactly like the old static markup.
export function buildRecipePanel(recipe) {
  const id = recipe.id;
  const hasOrders = recipe.logic === 'orders' || recipe.logic === 'both';
  const hasTotalInput = recipe.logic === 'total' || recipe.logic === 'both';
  const content = el('div', { class: 'content', id: 'tab-' + id });

  if (showsLeaveningKnob(recipe)) {
    const lev = (recipe.ingredients || []).find(i => i.key === recipe.leaveningKey);
    const label = (lev ? lev.label : 'Leavening');
    const def = recipe.leaveningDefaultPct;
    const r = knobRange(def);
    const input = el('input', {
      type: 'number', id: id + '-param', value: String(def),
      min: String(r.min), max: String(r.max), step: String(r.step), inputmode: r.inputmode,
    });
    content.appendChild(el('div', { class: 'param-row' }, [
      el('span', { class: 'param-label' }, [
        label + ' % (', el('span', { id: id + '-param-display' }, String(def)), '%)',
      ]),
      el('div', { class: 'qty-group' }, [input, el('span', { class: 'unit' }, '%')]),
    ]));
  }

  if (hasTotalInput) {
    content.appendChild(el('div', { class: 'param-row' }, [
      el('span', { class: 'param-label' }, 'Total dough (g)'),
      el('div', { class: 'qty-group' }, [
        el('input', { type: 'number', id: id + '-total-input', value: '0', min: '0', step: '1', inputmode: 'numeric' }),
        el('span', { class: 'unit' }, 'g'),
      ]),
    ]));
  }

  if (hasOrders) {
    content.appendChild(el('div', { class: 'section-label' }, 'Orders'));
    content.appendChild(el('div', { class: 'orders-cards', id: id + '-orders' }));
    content.appendChild(el('div', { class: 'extra-dough-row' }, [
      el('span', { class: 'extra-dough-label' }, 'Extra dough'),
      el('div', { class: 'qty-group' }, [
        el('input', { type: 'number', id: id + '-extra', value: '0', min: '0', step: '0.1', inputmode: 'decimal' }),
        el('select', { id: id + '-extra-unit', class: 'extra-unit-select', 'aria-label': 'Extra dough unit' }, [
          el('option', { value: 'g' }, 'g'),
          el('option', { value: 'kg', selected: 'selected' }, 'kg'),
        ]),
      ]),
    ]));
  }

  content.appendChild(el('button', { class: 'confirm-btn-primary', id: id + '-day-confirm', type: 'button', 'data-confirm-tab': id }, 'Confirm'));
  content.appendChild(el('button', { class: 'confirm-btn-primary is-edit', id: id + '-edit-btn', type: 'button' }, [icon('pencil', 16), ' Edit']));

  content.appendChild(el('div', { class: 'result-block', id: id + '-result' }, [
    el('div', { class: 'result-card' }, [
      el('div', { class: 'result-header' }, [
        el('h3', {}, recipe.name + ' dough'),
        el('span', { class: 'result-badge', id: id + '-badge' }, ''),
      ]),
      el('div', { id: id + '-ingredients' }),
      el('div', { class: 'ing-separator' }),
      el('div', { class: 'total-dough-row' }, [
        el('span', { class: 'total-dough-label' }, 'Total dough'),
        el('span', {}, [
          el('span', { class: 'total-dough-val', id: id + '-total' }, '0'), ' ',
          el('span', { class: 'total-dough-unit' }, 'g'),
        ]),
      ]),
      el('div', { class: 'copy-row' }, [
        el('button', { class: 'copy-btn', id: id + '-copy-btn' }, 'Copy recipe'),
        el('button', { class: 'copy-wa-btn', id: id + '-wa-recipe-btn', title: 'Share via WhatsApp' }, [waIcon()]),
      ]),
      el('div', { class: 'divisor-box', id: id + '-divisor-box' }),
      el('div', { class: 'crate-boxes', id: id + '-crate-boxes' }),
    ]),
  ]));

  content.appendChild(el('button', { class: 'reset-btn', type: 'button', 'data-reset-tab': id }, 'Reset all fields'));
  return content;
}

// ── The Calculator with nothing in it ─────────────────────────────────────────
// One sentence per reason (see calculatorEmptyReason). Written flat rather than
// assembled from fragments so each one can be read as the customer reads it.
//
// ⚠️ NEUTRAL, NOT AN ALARM. An app that has just been bought is not broken, and a
// warning tone here would say it is. That is also why the block reuses the app's
// dashed `.empty-state` — the same one Orders shows for "No suppliers yet" — and
// not the amber warning card.
const EMPTY_COPY = {
  loading: {
    title: 'Loading…',
    sub: 'Fetching the recipes saved for this venue.',
  },
  'no-recipes': {
    title: 'No recipes yet',
    sub: 'The Calculator works out how much dough to make from what your clients '
      + 'have ordered. Add your first recipe — its ingredients and their '
      + 'amounts — and it becomes a tab up here.',
    action: 'Add a recipe',
  },
  'hidden-recipes': {
    title: 'No recipe is shown here',
    sub: 'You have recipes, but none of them is set to appear as a tab. Choose '
      + 'which ones to show, up to four.',
    action: 'Choose which to show',
  },
};

// The panel shown INSTEAD of the recipe tabs when there are none. `onAction` opens
// the recipe editor; it is passed in rather than imported so this module stays free
// of the Calculator's screens (it is imported by the tests, which have no DOM).
//
// ⚠️ 'loading' DELIBERATELY HAS NO BUTTON. Offering "Add a recipe" while the answer
// is still on its way invites somebody to write a recipe they may already have.
export function buildEmptyPanel(reason, onAction) {
  const copy = EMPTY_COPY[reason] || EMPTY_COPY.loading;
  const block = el('div', { class: 'empty-state' }, [
    el('p', { class: 'empty-title' }, copy.title),
    el('p', { class: 'empty-sub' }, copy.sub),
  ]);
  if (copy.action) {
    const btn = el('button', { class: 'empty-action', type: 'button', id: 'calc-empty-action' }, copy.action);
    if (typeof onAction === 'function') btn.addEventListener('click', onAction);
    block.appendChild(btn);
  }
  return el('div', { class: 'content', id: 'tab-empty' }, [block]);
}

// Render all client cards for a tab into `container`, replacing its contents.
// The tab's products (already filtered to this dough and tagged with their owning
// client) are grouped back into one card per client, preserving address-book order.
export function renderTab(config, tab, container) {
  if (!container) return;
  container.textContent = '';
  const products = getTabProducts(config, tab);
  // ⚠️ The "Orders" heading is drawn by buildRecipePanel whatever happens, so with an
  // empty address book it stood over nothing at all — a heading with a blank space
  // under it, which reads as a screen that failed to load. A recipe made before the
  // first client is the normal order of things, and it says so.
  if (products.length === 0) {
    //
    // ⚠️ It says "no products in this tab", not "no client orders this recipe": a
    // PAUSED product leaves the tab entirely (see getTabProducts), so the second
    // wording would be a flat lie to somebody who paused their only one. The first
    // is true whichever of the three causes it is — no clients, no products on this
    // recipe, or every one of them paused — and it points at the screen that fixes
    // all three. The words are the ones Settings already uses for the same idea.
    container.appendChild(el('div', { class: 'cp-empty-hint' },
      'No products in this tab yet. Add your clients, and the products they buy, '
      + 'in Settings.'));
    return;
  }
  let currentCard = null;
  let currentClientId = null;
  for (const product of products) {
    if (product.clientId !== currentClientId || currentCard === null) {
      currentClientId = product.clientId;
      currentCard = el('div', { class: 'card' }, [
        el('div', { class: 'card-title' }, product.clientName),
      ]);
      container.appendChild(currentCard);
    }
    currentCard.appendChild(productRow(product));
  }
}
