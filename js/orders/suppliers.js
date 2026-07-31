// suppliers.js — the supplier LIST on the Order tab.
//
// A plain list of rows, one per supplier: name, category · delivery days, how many
// items are already typed for them, and a chevron. Tapping a row opens that
// supplier's own screen (supplier-detail.js).
//
// It used to be collapsible cards that expanded in place. The app's own rule is
// "list → detail, one level at a time, with a Back arrow that steps up" — Catalogue,
// the management panel, the History editor and the send screens all work that way, so
// the accordion was the odd one out. A dedicated screen also keeps the supplier's name
// pinned in the header instead of letting it scroll away while you type.
//
// MOUNTED ONCE, ROWS REPAINTED. The Orders screen re-renders on every suppliers /
// ingredients / history snapshot, including ones caused by another phone. If the
// search box were rebuilt each time, the text being typed would be wiped mid-search.
// So the box and the filter are built once and only the rows are repainted — the same
// arrangement as the flat ingredient list.

import { el } from './dom.js';
import { buildSearchBox } from './search-box.js';
import { filterSuppliers } from './ingredient-search.js';
import { itemsLabel } from './supplier-picker.js';

const DAY_SHORT = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// How many of a supplier's products have a quantity entered.
export function supplierStats(ingredients, entries) {
  const total = ingredients.length;
  const filled = ingredients.filter(i => (entries[i.id]?.qty || 0) > 0).length;
  return { total, filled };
}

// Refresh everything derived from the entries for one supplier, WITHOUT rebuilding
// anything — so an input keeps its focus while it is being typed into. Each piece
// guards on presence, because the count lives on the list row while the progress bar
// and the "Order placed" button live on the detail screen, and only one of the two is
// ever on screen.
export function refreshSupplierDerived(supplier, ingredients, entries) {
  const { total, filled } = supplierStats(ingredients, entries);

  const count = document.getElementById(`count-${supplier.id}`);
  if (count) {
    count.textContent = filled ? itemsLabel(filled) : '';
    count.hidden = filled === 0;
  }

  const fill = document.getElementById(`progress-fill-${supplier.id}`);
  if (fill) fill.style.width = `${total ? Math.round((filled / total) * 100) : 0}%`;

  const placeBtn = document.getElementById(`place-btn-${supplier.id}`);
  if (placeBtn) placeBtn.disabled = filled === 0;

  // "Clear quantities" is HIDDEN rather than disabled: with nothing typed there is
  // nothing to start again, and a permanently dead red button under the green one is
  // just noise. Hiding works here only because tokens.css forces
  // `[hidden] { display: none !important }` — .supplier-clear-btn's own
  // `display: block` would otherwise beat the browser's rule and paint a button every
  // script on the page believed was gone.
  const clearBtn = document.getElementById(`clear-btn-${supplier.id}`);
  if (clearBtn) clearBtn.hidden = filled === 0;
}

// container: #suppliers-list.
// ctx: { query, filterActive, onQuery(text), onFilter(active), onOpen(supplierId) }
// -> { repaint({ suppliers, ingredientsBySupplier, entries }) }
export function mountSupplierList(container, ctx) {
  let data = { suppliers: [], ingredientsBySupplier: {}, entries: {} };
  let query = ctx.query || '';
  let filtering = Boolean(ctx.filterActive);

  const search = buildSearchBox({
    value: query,
    placeholder: 'Search a supplier…',
    onInput: text => { query = text; ctx.onQuery?.(text); },
    onChange: paint,
  });

  // All / Ordering. A radiogroup rather than tabs: it picks how one list is filtered,
  // it does not swap between two panels.
  const allBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => setFilter(false),
  });
  const orderingBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => setFilter(true),
  });
  const filterSwitch = el('div', {
    class: 'view-switch ing-filter', role: 'radiogroup', 'aria-label': 'Which suppliers to show',
  }, [allBtn, orderingBtn]);

  function setFilter(active) {
    if (filtering === active) return;
    filtering = active;
    ctx.onFilter?.(active);
    paint();
  }

  const list = el('div', { class: 'supplier-list' });

  // How many suppliers currently have something typed. Unlike the ingredient filter,
  // this needs no freezing: you cannot type a quantity on this screen, you tap into a
  // supplier — so no row can vanish under the finger that is editing it.
  function orderingCount(suppliers) {
    return suppliers.filter(s =>
      supplierStats(data.ingredientsBySupplier[s.id] || [], data.entries).filled > 0).length;
  }

  function paint() {
    const all = data.suppliers;
    const ordering = orderingCount(all);

    allBtn.textContent = `All (${all.length})`;
    orderingBtn.textContent = `Ordering (${ordering})`;
    // Nothing typed anywhere — there is no "just what I'm ordering" to offer.
    filterSwitch.hidden = ordering === 0 && !filtering;
    [[allBtn, !filtering], [orderingBtn, filtering]].forEach(([btn, on]) => {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });

    const inScope = filtering
      ? all.filter(s => supplierStats(data.ingredientsBySupplier[s.id] || [], data.entries).filled > 0)
      : all;
    const rows = filterSuppliers(inScope, query);

    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(el('p', {
        class: 'mgmt-empty',
        text: query ? 'No supplier matches your search.' : 'Nothing is being ordered yet.',
      }));
      return;
    }
    rows.forEach(s => list.appendChild(buildSupplierRow(s, data, ctx)));
  }

  container.appendChild(search.node);
  container.appendChild(filterSwitch);
  container.appendChild(list);

  return {
    repaint(next) {
      data = next;
      paint();
    },
    // The counts move on every keystroke inside a supplier's screen; the ROW list must
    // not be rebuilt for that, so refreshSupplierDerived updates the numbers in place
    // and this only refreshes the two filter labels.
    updateCounts() {
      const ordering = orderingCount(data.suppliers);
      orderingBtn.textContent = `Ordering (${ordering})`;
      filterSwitch.hidden = ordering === 0 && !filtering;
    },
  };
}

function buildSupplierRow(supplier, data, ctx) {
  const days = (supplier.deliveryDays || []).map(d => DAY_SHORT[d] || d).join(', ');
  const { filled } = supplierStats(data.ingredientsBySupplier[supplier.id] || [], data.entries);

  const count = el('span', { class: 'supplier-row-count', id: `count-${supplier.id}` },
    filled ? itemsLabel(filled) : '');
  count.hidden = filled === 0;

  return el('button', {
    type: 'button',
    class: 'supplier-row',
    dataset: { supplier: supplier.id },
    onClick: () => ctx.onOpen?.(supplier.id),
  }, [
    el('div', { class: 'supplier-row-main' }, [
      el('span', { class: 'supplier-name', text: supplier.name }),
      el('span', { class: 'supplier-meta', text: [supplier.category, days].filter(Boolean).join(' · ') }),
    ]),
    count,
    el('span', { class: 'supplier-row-chevron', icon: CHEVRON_SVG, 'aria-hidden': 'true' }),
  ]);
}
