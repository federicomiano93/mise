// reminder-view.js — the banners at the top of the Orders screen.
//
// What to order TODAY, and what is already done. The alert itself is not new
// (computeAlerts has always produced it), but it used to be filtered out of this
// screen because it could only nag: it had no way of knowing what you had already
// ordered. Now that an order is one day and one supplier, it does — so it can
// tick suppliers off instead of repeating itself.
//
// Small on purpose: one line of chips, not a numbered list. A supplier still to
// order is a button — tapping it opens that supplier's card.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { daySpoken, dayWhen } from './day.js';

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

// list: [{ supplier, placed }] from reminders.todayOrders
export function renderTodayOrders(container, list, { onPick } = {}) {
  if (!container) return;
  container.textContent = '';

  // Nothing is ordered today — say nothing at all.
  if (!list.length) return;

  if (list.every(item => item.placed)) {
    container.appendChild(el('div', { class: 'today-banner all-done' }, [
      el('span', { class: 'today-check', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      el('span', { text: t('orders.todaySOrdersAre') }),
    ]));
    return;
  }

  const chips = list.map(({ supplier, placed }) => (placed
    ? el('span', { class: 'today-chip placed' }, [
      el('span', { class: 'today-check', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      el('span', { text: supplier.name }),
    ])
    : el('button', {
      type: 'button',
      class: 'today-chip',
      onClick: () => onPick?.(supplier.id),
    }, supplier.name)));

  container.appendChild(el('div', { class: 'today-banner' }, [
    el('span', { class: 'today-label', text: t('orders.orderToday') }),
    el('div', { class: 'today-chips' }, chips),
  ]));
}

// An order typed on an earlier day and never marked as placed.
//
// A banner, not a dialog: several suppliers can be waiting at once, and a queue
// of modals on app open would be hostile (confirm-dialog is single-instance
// anyway — a second one raised while the first is open resolves false silently).
//
// Three answers, because there are genuinely three cases. It was ordered that day
// and the tap was forgotten (Placed) — the record must be filed under THAT day,
// not today, which is the whole reason the draft carries the day. It was never
// actually ordered and is still wanted (It's today's) — the rows stay, restamped
// to today. It is not wanted at all (Discard) — the rows go, behind a red confirm.
//
// list: [{ supplier, day, itemCount }] from reminders.pendingSuppliers
export function renderPending(container, list, { onPlaced, onToday, onDiscard, now } = {}) {
  if (!container) return;
  container.textContent = '';
  if (!list.length) return;

  list.forEach(({ supplier, day, itemCount }) => {
    const items = t('orders.itemsCount', { n: itemCount });

    container.appendChild(el('div', { class: 'pending-banner' }, [
      el('div', { class: 'pending-main' }, [
        el('span', { class: 'pending-title', text: t('orders.notPlacedFor', { supplier: supplier.name }) }),
        el('span', { class: 'pending-sub', text: t('orders.typedWhen', { items, when: dayWhen(day, now) }) }),
      ]),
      el('div', { class: 'pending-actions' }, [
        el('button', {
          type: 'button', class: 'pending-btn primary',
          onClick: () => onPlaced?.(supplier.id, day),
        }, t('orders.placedWhen', { when: daySpoken(day, now) })),
        el('button', {
          type: 'button', class: 'pending-btn',
          onClick: () => onToday?.(supplier.id),
        }, t('orders.itSTodayS')),
        el('button', {
          type: 'button', class: 'pending-btn danger',
          onClick: () => onDiscard?.(supplier.id),
        }, 'Discard'),
      ]),
    ]));
  });
}
