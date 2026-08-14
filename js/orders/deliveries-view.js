// deliveries-view.js — the "Incoming" tab, the arrival confirmation, and the
// "still to re-order" banner.
//
// All the DECIDING lives in the pure js/orders/deliveries.js; this is the screen.
//
// ⚠️ AN ORDER LEAVES THIS SCREEN ONLY WHEN SOMEBODY SAYS IT ARRIVED. Nothing here
// deduces a delivery from the supplier's delivery days — that would drop an order off
// the list the day it was due, so the one that NEVER came would be the only one
// nobody sees, on a screen that looks perfectly healthy because it is empty.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { spellDay, dayLabel } from './day.js';
import { recordedName, wholeNumber } from './archive.js';
import {
  pendingDeliveries, shortfall, stillToReorder, applyReorder,
} from './deliveries.js';

const CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// ── The "Incoming" tab ───────────────────────────────────────────────────────

// host: the element to fill. `ctx` supplies the data and the one write.
//   { history, suppliersById, ingredientsById, today, onConfirm(order, missingIds) }
export function renderDeliveries(host, ctx) {
  if (!host) return;
  host.textContent = '';

  const groups = pendingDeliveries(ctx.history, ctx.suppliersById, ctx.today);
  const total = groups.late.length + groups.dueToday.length + groups.coming.length;

  if (!total) {
    // ⚠️ TWO DIFFERENT SILENCES, TOLD APART. "Nothing has been ordered" and
    // "everything ordered has arrived" look identical on a screen that only shows
    // what is still coming, and only the first is a reason to go and order.
    const everSent = (ctx.history || []).length > 0;
    host.appendChild(el('p', {
      class: 'ing-empty',
      text: everSent ? t('orders.deliveries.allArrived') : t('orders.deliveries.noneYet'),
    }));
    return;
  }

  section(host, groups.late, 'orders.deliveries.late', 'late', ctx);
  section(host, groups.dueToday, 'orders.deliveries.dueToday', 'due', ctx);
  section(host, groups.coming, 'orders.deliveries.coming', '', ctx);
}

function section(host, entries, headingKey, tone, ctx) {
  if (!entries.length) return;
  host.appendChild(el('div', { class: 'ing-category', text: t(headingKey) }));
  entries.forEach(entry => host.appendChild(deliveryRow(entry, tone, ctx)));
}

function deliveryRow({ order, supplier, expected }, tone, ctx) {
  const name = supplier?.name || order.supplierName || t('orders.deliveries.unknownSupplier');
  const count = Object.keys(order.quantities || {}).length;

  // ⚠️ AN ORDER WITH NO EXPECTED DATE SAYS SO, rather than showing a blank where a
  // date belongs. "We do not know" is an answer; an empty gap is a bug people report.
  const when = expected
    ? t('orders.deliveries.expectedOn', { day: dayLabel(expected, new Date(`${ctx.today}T12:00:00`)) })
    : t('orders.deliveries.noExpectedDay');

  return el('button', {
    class: `supplier-row-open delivery-row${tone ? ' delivery-row--' + tone : ''}`,
    type: 'button',
    onclick: () => openArrival({ order, supplier, expected }, ctx),
  }, [
    el('div', { class: 'delivery-main' }, [
      el('span', { class: 'delivery-name', text: name }),
      el('span', { class: 'delivery-meta', text: when }),
      el('span', {
        class: 'delivery-meta',
        // ⚠️ `n` AS A NUMBER, not a string: Intl.PluralRules picks the form from
        // it, and '1' is not 1.
        text: t('orders.deliveries.orderedOn', { day: spellDay(order.date), n: count }),
      }),
    ]),
    el('span', { class: 'delivery-chevron', icon: CHEVRON }),
  ]);
}

// ── Confirming an arrival ────────────────────────────────────────────────────

// ⚠️ TWO STRAIGHT ANSWERS, NOT A LIST TO TICK. A list that starts unticked means
// twenty taps on every delivery, so nobody would use it and the feature would die
// quietly. A list that starts ticked is a declaration made by not looking. Answering
// a question is neither: "everything arrived" is one tap for the normal case, and
// "something is missing" is the only path that opens the rows.
async function openArrival(entry, ctx) {
  const { order } = entry;
  const name = entry.supplier?.name || order.supplierName || '';

  const answer = await confirmDialog({
    title: t('orders.deliveries.arrivedTitle', { supplier: name }),
    message: t('orders.deliveries.arrivedMessage', { day: spellDay(order.date) }),
    okLabel: t('orders.deliveries.allArrivedBtn'),
    cancelLabel: t('orders.deliveries.somethingMissing'),
  });

  if (answer) return confirm(entry, [], ctx);
  return openMissingPicker(entry, ctx);
}

// The rows of one order, every one considered arrived until told otherwise.
function openMissingPicker(entry, ctx) {
  const { order } = entry;
  const ids = Object.keys(order.quantities || {}).sort((a, b) =>
    label(a, order, ctx).localeCompare(label(b, order, ctx)));
  const missing = new Set();

  const list = el('div', { class: 'missing-list' });
  ids.forEach(id => {
    const box = el('input', { type: 'checkbox', class: 'missing-check', checked: 'checked' });
    box.addEventListener('change', () => {
      if (box.checked) missing.delete(id); else missing.add(id);
    });
    // ⚠️ THE WHOLE ROW IS THE TARGET, and it is 44px tall — not the 31px a bare
    // checkbox gives. A mis-tap here does not cost a keystroke: it says something
    // arrived that never did, and that ingredient then never reaches the re-order list.
    list.appendChild(el('label', { class: 'missing-row' }, [
      box,
      el('span', { class: 'missing-name', text: label(id, order, ctx) }),
      el('span', { class: 'missing-qty', text: String(wholeNumber(order.quantities[id])) }),
    ]));
  });

  const overlay = el('div', { class: 'missing-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        class: 'orders-icon-btn', type: 'button', 'aria-label': t('ui.back'),
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
        onclick: () => overlay.remove(),
      }),
      el('h1', { text: t('orders.deliveries.whatArrived') }),
    ]),
    el('div', { class: 'scroll-area' }, [
      el('p', { class: 'missing-hint', text: t('orders.deliveries.untickHint') }),
      list,
      el('button', {
        class: 'btn-primary missing-save', type: 'button',
        text: t('orders.deliveries.saveArrival'),
        onclick: async () => {
          overlay.remove();
          await confirm(entry, [...missing], ctx);
        },
      }),
    ]),
  ]);

  document.body.appendChild(overlay);
}

function label(id, order, ctx) {
  return recordedName(id, ctx.ingredientsById || {}, order.names || {});
}

async function confirm(entry, missingIds, ctx) {
  try {
    await ctx.onConfirm(entry.order, missingIds);
  } catch (err) {
    // ⚠️ A FAILED WRITE IS SAID OUT LOUD. Five write paths in this feature once
    // failed in silence (v186); the order would simply still be there next time,
    // looking like the tap had not registered.
    await alertDialog(t('orders.deliveries.couldNotSave'));
  }
}

// ── "Still to re-order" ──────────────────────────────────────────────────────

// ⚠️ IT LIVES AT THE TOP OF THE ORDER TAB, WHERE THE WORK HAPPENS. A list on a screen
// nobody opens does not answer "so I do not forget to order them".
export function renderReorderBanner(host, ctx) {
  if (!host) return;
  host.textContent = '';
  const items = stillToReorder(ctx.history, ctx.entries);
  host.hidden = !items.length;
  if (!items.length) return;

  // ⚠️ `today-banner` IS THE APP'S EXISTING BANNER, not a new look invented here.
  // The reminders directly below it already use it, and two banners on one screen
  // that are dressed differently read as two different KINDS of thing.
  host.appendChild(el('button', {
    class: 'today-banner reorder-banner', type: 'button',
    // ⚠️ A PLURAL ENTRY, not two keys picked by an `if`. Which forms a language has
    // is the language's business, not the caller's — Italian and English agree on
    // two, and a language with three would need the code changed rather than the
    // dictionary. Intl.PluralRules already does this for every other count here.
    text: t('orders.reorder.count', { n: items.length }),
    onclick: () => openReorder(items, ctx),
  }));
}

async function openReorder(items, ctx) {
  const lines = items.map(i => `• ${recordedName(i.id, ctx.ingredientsById || {}, {})} — ${i.qty}`);

  const go = await confirmDialog({
    title: t('orders.reorder.title'),
    message: `${t('orders.reorder.message')}\n\n${lines.join('\n')}`,
    okLabel: t('orders.reorder.putBack'),
    cancelLabel: t('ui.cancel'),
  });
  if (!go) return;

  const { applied, skipped } = applyReorder(items, ctx.entries);
  try {
    await ctx.onReorder(applied);
  } catch {
    await alertDialog(t('orders.deliveries.couldNotSave'));
    return;
  }

  // ⚠️ A SKIP IS REPORTED, NEVER SWALLOWED. A row already carrying a quantity was
  // typed by a person — possibly seconds ago on another phone — so it is left alone;
  // saying nothing would look exactly like the button having failed.
  if (skipped.length) {
    await alertDialog(t('orders.reorder.someSkipped', { n: String(skipped.length) }));
  }
}
