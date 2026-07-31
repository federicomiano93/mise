// history.js — past orders view.
//
// One section per DAY (most recent first), and inside it one card per supplier —
// because that is what an order now is. Before, a whole week of every supplier's
// items was crushed into a single card, so the screen could never answer the only
// two questions it is asked: what did I order, and when.
//
// Records written by the old weekly model are still shown, as a "Week of …" card
// that groups its items by supplier the way the old view did. Nothing was
// migrated, so they stay exactly as they were written.
//
// Ingredient names and units are resolved at RENDER time from the current
// ingredient list; one deleted since then falls back to its id rather than
// disappearing from its own order.

import { el, groupBy } from './dom.js';
import { dayLabel } from './day.js';
import { groupHistoryByDay, isLegacyRecord, splitHistoryByAge, countRecords } from './archive.js';
import { isNoSupplier } from './no-supplier.js';

// Whether the operator has asked to see past the recent window. Kept for the life of
// the page on purpose: this view is repainted on EVERY Firestore snapshot, so without
// it another phone recording an order would silently fold the old orders away again
// under the finger of whoever was reading them.
let showingOlder = false;

// The window the list was last painted with. Changing the setting is a deliberate
// statement about how much to show, so it must WIN over an earlier "show me
// everything" — otherwise Settings appears to do nothing until the app is reloaded,
// which is precisely what someone adjusting the number is watching for.
let lastWindow = null;

const PENCIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// The WhatsApp glyph, same path as the header button in orders.html. Filled rather
// than stroked — that is how the brand mark is drawn, and matching the other icons'
// 2px stroke would make it unrecognisable.
const WA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

function indexById(items) {
  return (items || []).reduce((acc, it) => { acc[it.id] = it; return acc; }, {});
}

// What to head a group of items with when no supplier document matches. Bought
// without a supplier is a deliberate, named thing; a genuinely unresolvable id is
// not, and calling that "No supplier" too would hide a real problem.
function supplierHeading(supplierId, supById) {
  if (supById[supplierId]?.name) return supById[supplierId].name;
  return isNoSupplier(supplierId) ? 'No supplier' : 'Unknown supplier';
}

// callbacks: { onEdit(record), onSend(record), onSendDay(date, records) }
// options:   { historyDays, now } — how many days to show at a glance, see archive.js
export function renderHistory(container, history, suppliers, ingredients, callbacks = {}, options = {}) {
  if (!container) return;
  container.textContent = '';

  const days = groupHistoryByDay(history);

  if (!days.length) {
    container.appendChild(el('p', { class: 'history-empty', text: 'No past orders yet.' }));
    return;
  }

  const supById = indexById(suppliers);
  const ingById = indexById(ingredients);

  const appendDay = ({ date, records }) => {
    container.appendChild(dayHeader(date, records, callbacks));
    records.forEach(record => container.appendChild(
      isLegacyRecord(record)
        ? buildLegacyCard(record, supById, ingById, callbacks)
        : buildOrderCard(record, ingById, callbacks),
    ));
  };

  if (options.historyDays !== lastWindow) {
    lastWindow = options.historyDays;
    showingOlder = false;
  }

  const { recent, older } = splitHistoryByAge(days, options.historyDays, options.now);

  (showingOlder ? days : recent).forEach(appendDay);

  if (!older.length || showingOlder) return;

  // The note and the button live in ONE element so revealing the old orders takes the
  // note with it. Left behind, "No orders in the last day" would sit above the orders
  // it just said were not there.
  const foot = el('div', { class: 'history-older' });
  // Nothing recent but plenty older: say so, or the screen reads as "the orders are
  // gone" with a lone button under it.
  if (!recent.length) {
    foot.appendChild(el('p', { class: 'history-empty', text:
      `No orders in the last ${dayCount(options.historyDays)}.` }));
  }
  foot.appendChild(olderButton(older, appendDay, foot));
  container.appendChild(foot);
}

// Reveal the orders older than the window. They are already in memory — the whole
// collection is read when the app opens — so this fetches nothing and cannot fail.
function olderButton(older, appendDay, foot) {
  return el('button', {
    type: 'button',
    class: 'history-older-btn',
    onClick: () => {
      showingOlder = true;
      foot.remove();
      older.forEach(appendDay);
    },
  }, [`Show older orders (${countRecords(older)})`]);
}

// The day heading, with a "Send all" beside it once there is more than one order to
// send. Recording an order clears its rows from the draft, so the archive is the only
// place the message can still be built from — which is exactly why sending has to be
// possible from here and not only before placing.
function dayHeader(date, records, callbacks) {
  const label = el('span', { text: dayLabel(date) });
  if (records.length < 2 || !callbacks.onSendDay) {
    return el('div', { class: 'history-day-label' }, [label]);
  }
  return el('div', { class: 'history-day-label history-day-row' }, [
    label,
    el('button', {
      type: 'button',
      class: 'history-send-day',
      onClick: () => callbacks.onSendDay(date, records),
    }, [
      el('span', { class: 'history-send-icon', icon: WA_SVG, 'aria-hidden': 'true' }),
      'Send all',
    ]),
  ]);
}

// The quiet foot-of-card actions: send this order again, or correct it.
function cardActions(record, callbacks) {
  const actions = [];
  if (callbacks.onSend) {
    actions.push(el('button', {
      type: 'button',
      class: 'history-edit-btn history-send-btn',
      onClick: () => callbacks.onSend(record),
    }, [
      el('span', { class: 'history-edit-icon', icon: WA_SVG, 'aria-hidden': 'true' }),
      'Send on WhatsApp',
    ]));
  }
  actions.push(el('button', {
    type: 'button',
    class: 'history-edit-btn',
    onClick: () => callbacks.onEdit?.(record),
  }, [
    el('span', { class: 'history-edit-icon', icon: PENCIL_SVG, 'aria-hidden': 'true' }),
    'Edit order',
  ]));
  return actions;
}

// The rows of one record: "name weight … qty unit", by name.
function itemRows(quantities, ingById) {
  return Object.keys(quantities || {})
    .map(id => ({
      name: [ingById[id]?.name || id, ingById[id]?.weight].filter(Boolean).join(' '),
      unit: ingById[id]?.unit || '',
      qty: quantities[id],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(r => el('div', { class: 'history-item' }, [
      el('span', { class: 'history-item-name', text: r.name }),
      el('span', { class: 'history-item-qty', text: `${r.qty} ${r.unit}`.trim() }),
    ]));
}

// One order: one supplier, one day.
function buildOrderCard(record, ingById, callbacks) {
  const count = Object.keys(record.quantities || {}).length;
  const rows = itemRows(record.quantities, ingById);

  const body = el('div', { class: 'history-body' }, [
    ...(rows.length ? rows : [el('p', { class: 'history-empty', text: 'No items recorded.' })]),
    ...cardActions(record, callbacks),
  ]);
  body.hidden = true;

  return el('div', { class: 'supplier-card' }, [
    collapsibleHead(record.supplierName || 'Unknown supplier', itemsLabel(count), body),
    body,
  ]);
}

// A record from the old weekly model: a whole week, every supplier in one
// document. Shown the way the old view showed it — grouped by supplier — so
// nothing that was recorded is lost or reinterpreted.
function buildLegacyCard(record, supById, ingById, callbacks) {
  const quantities = record.quantities || {};
  const bySupplier = groupBy(
    Object.keys(quantities).map(id => ({
      supplierId: ingById[id]?.supplierId || 'unknown',
      name: [ingById[id]?.name || id, ingById[id]?.weight].filter(Boolean).join(' '),
      unit: ingById[id]?.unit || '',
      qty: quantities[id],
    })),
    'supplierId',
  );

  const body = el('div', { class: 'history-body' });
  Object.keys(bySupplier).forEach(supplierId => {
    body.appendChild(el('div', { class: 'history-supplier', text: supplierHeading(supplierId, supById) }));
    bySupplier[supplierId]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(r => body.appendChild(el('div', { class: 'history-item' }, [
        el('span', { class: 'history-item-name', text: r.name }),
        el('span', { class: 'history-item-qty', text: `${r.qty} ${r.unit}`.trim() }),
      ])));
  });
  if (!body.childElementCount) {
    body.appendChild(el('p', { class: 'history-empty', text: 'No items recorded.' }));
  }
  cardActions(record, callbacks).forEach(btn => body.appendChild(btn));
  body.hidden = true;

  const count = Object.keys(quantities).length;
  return el('div', { class: 'supplier-card' }, [
    collapsibleHead('Whole week — all suppliers', itemsLabel(count), body),
    body,
  ]);
}

function itemsLabel(count) {
  return `${count} item${count === 1 ? '' : 's'}`;
}

// "1 day" / "15 days" — a window of one is a legal setting, and "the last 1 days"
// reads like a bug to the person who typed it.
function dayCount(days) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

function collapsibleHead(title, meta, body) {
  const chevron = el('span', { class: 'supplier-chevron' }, '▸');
  const head = el('button', { type: 'button', class: 'supplier-head', 'aria-expanded': 'false' }, [
    el('div', { class: 'supplier-head-main' }, [
      el('span', { class: 'supplier-name', text: title }),
      el('span', { class: 'supplier-meta', text: meta }),
    ]),
    el('div', { class: 'supplier-head-right' }, [chevron]),
  ]);
  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    chevron.classList.toggle('open', open);
  });
  return head;
}
