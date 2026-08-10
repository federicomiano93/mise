// calculator-client-orders.js — the bakery's side of a client's own order: the banner
// that says one arrived, the screen that shows what was asked for, and the one button
// that puts it into the quantity fields.
//
// ⚠️ NOTHING HERE MOVES A NUMBER BY ITSELF. The whole point of the feature is to stop
// a person copying quantities out of a message, so it would be tempting to fill the
// fields the moment an order lands. It must not: an order can be corrected, can arrive
// while a dough is already being calculated, and can be wrong. The owner reads it and
// taps. Everything below exists to make that tap safe and that reading honest.
//
// The three things that must never be silent:
//   1. an order that CHANGED after it was used — the one that bakes the wrong amount;
//   2. a field that already holds a different number, before it is overwritten;
//   3. a tab that has been confirmed, whose fields are locked and will not move.

import { el } from './calculator-render.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { getConfig } from './calculator-config-store.js';
import { getClientById } from './calculator-config.js';
import { watchUpcomingOrders, markOrderApplied } from './client-orders-data.js';
import {
  orderRows, orderChangedSinceApplied, isApplied, calculatorPatch, toISODate,
} from './client-order-model.js';

// Injected by app.js rather than imported from it: app.js is the entry point, and
// importing it back would be a cycle. It owns the quantity fields, so it is the only
// thing that may write them.
let fields = null;

let orders = [];
let unsubscribe = null;

const BANNER = () => document.getElementById('client-orders-banner');
const OVERLAY = () => document.getElementById('clientorders-overlay');
const CONTENT = () => document.getElementById('clientorders-content');

// ── When the order is for ────────────────────────────────────────────────────

// "Tomorrow · Tuesday 11 August". The weekday is what a baker checks; the date is
// what settles an argument about which one was meant.
function dayLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round(
    (date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const full = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (days === 0) return `Today · ${full}`;
  if (days === 1) return `Tomorrow · ${full}`;
  return full;
}

// When it arrived, in the words a person uses. An exact timestamp answers a question
// nobody asked; "20 minutes ago" answers the one they did.
function arrivedLabel(order) {
  const at = Date.parse(order && order.updatedAt);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Soonest delivery first, and within a day the client who has been waiting longest.
function sortOrders(list) {
  return list.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

// ── The banner ───────────────────────────────────────────────────────────────

// What still needs the owner's attention: an order never used, or one changed since.
// An order already used and untouched since is DONE, and a banner that stays lit
// after the job is a banner people learn to ignore (the lesson of the Home badge,
// which said "3" all day after all three orders had gone out).
function needsAttention(order) {
  return !isApplied(order) || orderChangedSinceApplied(order);
}

function paintBanner() {
  const host = BANNER();
  if (!host) return;
  host.textContent = '';

  const waiting = orders.filter(needsAttention);
  host.hidden = waiting.length === 0;
  if (!waiting.length) return;

  const changed = waiting.filter(orderChangedSinceApplied).length;
  const label = changed
    ? `${changed} ${changed === 1 ? 'order has' : 'orders have'} CHANGED since you used ${changed === 1 ? 'it' : 'them'}`
    : `${waiting.length} ${waiting.length === 1 ? 'order' : 'orders'} received from your clients`;

  const button = el('button', {
    class: `co-banner${changed ? ' co-banner--changed' : ''}`,
    type: 'button',
  }, [
    el('span', { class: 'co-banner-text' }, label),
    el('span', { class: 'co-banner-go' }, '›'),
  ]);
  button.addEventListener('click', openScreen);
  host.appendChild(button);
}

// ── The screen ───────────────────────────────────────────────────────────────

export function openScreen() {
  render();
  OVERLAY().classList.add('visible');
}

export function closeScreen() {
  OVERLAY().classList.remove('visible');
}

function render() {
  const content = CONTENT();
  if (!content) return;
  content.textContent = '';

  if (!orders.length) {
    content.appendChild(el('p', { class: 'co-none' },
      'No orders have come in yet. When a client sends one from their link, it appears here.'));
    return;
  }
  sortOrders(orders).forEach(order => content.appendChild(orderCard(order)));
}

function orderCard(order) {
  const changed = orderChangedSinceApplied(order);
  const used = isApplied(order) && !changed;
  const config = getConfig();
  const client = getClientById(config, order.clientId);
  // The live product name wins (a rename should show); the name frozen into the order
  // is the fallback, so a product deleted since is still named rather than shown as an id.
  const liveNameOf = id => {
    const product = (client && client.products || []).find(p => p && p.id === id);
    return product ? product.name : '';
  };
  const rows = orderRows(order, liveNameOf);

  const card = el('div', { class: `co-card${changed ? ' co-card--changed' : ''}${used ? ' co-card--used' : ''}` }, [
    el('div', { class: 'co-card-head' }, [
      el('span', { class: 'co-card-client' }, order.clientName || (client && client.name) || 'Client'),
      el('span', { class: 'co-card-when' }, dayLabel(order.date)),
    ]),
    el('p', { class: 'co-card-arrived' },
      `Sent ${arrivedLabel(order)}${used ? ' · already in the calculator' : ''}`),
  ]);

  // ⚠️ THE LOUDEST THING ON THE CARD, because it is the one that bakes the wrong
  // amount. Somebody who used this order twenty minutes ago has no other way to know.
  if (changed) {
    card.appendChild(el('p', { class: 'co-card-alert' },
      'This client changed their order AFTER you put it in the calculator. The numbers below are the new ones.'));
  }

  const list = el('div', { class: 'co-card-lines' });
  if (!rows.length) {
    list.appendChild(el('p', { class: 'co-card-empty' },
      'Nothing this day — the client sent an empty order.'));
  }
  rows.forEach(row => {
    list.appendChild(el('div', { class: `co-line${row.missing ? ' co-line--missing' : ''}` }, [
      el('span', { class: 'co-line-name' }, row.name),
      el('span', { class: 'co-line-qty' }, String(row.qty)),
    ]));
  });
  card.appendChild(list);

  // A product this client no longer has cannot be put anywhere: there is no field for
  // it. Said here rather than discovered as a line that quietly did not arrive.
  if (rows.some(r => r.missing)) {
    card.appendChild(el('p', { class: 'co-card-note co-card-note--warn' },
      'A line above is for a product this client no longer has, so it cannot go into the calculator. Add it back, or handle it yourself.'));
  }

  if (order.note) {
    card.appendChild(el('p', { class: 'co-card-note' }, [
      el('span', { class: 'co-card-note-label' }, 'Note: '),
      order.note,
    ]));
  }

  // ⚠️ THREE DIFFERENT LABELS, because the tap means three different things and the
  // difference is what stops the wrong bake. On a CHANGED order the button has to say
  // that the numbers about to go in are new ones — "Put in the calculator", on a card
  // the owner may already have acted on this morning, reads as a button he has
  // finished with.
  const apply = el('button', { class: 'co-apply', type: 'button' },
    changed ? 'Put the NEW order in' : (used ? 'Put in the calculator again' : 'Put in the calculator'));
  apply.addEventListener('click', () => applyOrder(order, apply));
  card.appendChild(apply);

  return card;
}

// ── Putting it in the calculator ─────────────────────────────────────────────

async function applyOrder(order, button) {
  const config = getConfig();
  const client = getClientById(config, order.clientId);
  if (!client) {
    await alertDialog(
      `${order.clientName || 'This client'} is no longer in your address book, so there are no fields to fill in.`);
    return;
  }

  const patch = calculatorPatch(order, client.products);
  const targets = fields.inspect(patch);

  if (!targets.length) {
    await alertDialog('None of this client\'s products are on a calculator tab at the moment, so there is nothing to fill in.');
    return;
  }

  // ⚠️ A CONFIRMED TAB DOES NOT MOVE, and saying so beforehand is the difference
  // between "the app ignored me" and "I know what to do". Its fields are locked until
  // Edit is tapped, exactly as they are for a person typing.
  const locked = [...new Set(targets.filter(t => t.locked).map(t => t.recipeName))];
  if (locked.length === targets.length) {
    await alertDialog(
      `${locked.join(' and ')} ${locked.length === 1 ? 'has' : 'have'} already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.`);
    return;
  }

  // ⚠️ THE OVERWRITE WARNING NAMES THE ROWS. "Some values will change" is a sentence
  // nobody can check; a list of what is about to be replaced is one they can.
  const clashes = targets.filter(t => !t.locked && t.current > 0 && t.current !== t.next);
  const parts = [];
  if (clashes.length) {
    parts.push('These already have a different number typed in:');
    parts.push(clashes.map(t => `  ${t.productName}: ${t.current} → ${t.next}`).join('\n'));
  }
  if (locked.length) {
    parts.push(`${locked.join(' and ')} ${locked.length === 1 ? 'is' : 'are'} confirmed and will be left alone.`);
  }

  const message = parts.length
    ? `${parts.join('\n\n')}\n\nPut ${client.name}'s order in the calculator?`
    : `Put ${client.name}'s order in the calculator?`;

  if (!(await confirmDialog({
    title: clashes.length ? 'This will replace what is typed' : undefined,
    message,
    okLabel: 'Put it in',
    danger: clashes.length > 0,
  }))) return;

  fields.apply(targets.filter(t => !t.locked));

  // ⚠️ RECORDED ONLY AFTER THE FIELDS REALLY MOVED, and a failure here is reported
  // rather than swallowed: if the app cannot remember that this order was used, it can
  // no longer tell you when the client changes it — which is the whole safety net.
  button.disabled = true;
  try {
    await markOrderApplied(order);
  } catch (err) {
    console.error('Could not record that the order was used:', err);
    await alertDialog(
      'The numbers are in the calculator, but the app could not record that you used this order. '
      + 'It will keep showing as new, and it will NOT warn you if the client changes it. Check your connection.');
  }
  button.disabled = false;

  closeScreen();
}

// ── Boot ─────────────────────────────────────────────────────────────────────

export function initClientOrders(injected) {
  fields = injected;

  const back = document.querySelector('.clientorders-back-btn');
  if (back) back.addEventListener('click', closeScreen);

  watchUpcomingOrders(list => {
    // Only what is still to come. The query already bounds it by date, but a page left
    // open across midnight would otherwise keep yesterday's on screen for ever.
    const today = toISODate(Date.now());
    orders = list.filter(o => o && String(o.date) >= today);
    paintBanner();
    if (OVERLAY() && OVERLAY().classList.contains('visible')) render();
  }, () => {
    // A refused or dropped stream must not leave a stale banner claiming orders are
    // waiting. Silence is the honest state: the Calculator itself still works.
    orders = [];
    paintBanner();
  }).then(fn => { unsubscribe = fn; })
    .catch(err => console.warn('Client orders not watched:', err));
}

export function stopClientOrders() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
