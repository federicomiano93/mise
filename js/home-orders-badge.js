// home-orders-badge.js — Orders signals on the Home (landing) screen, so Federico
// is reminded to place an order without opening the Orders page:
//   1. A small count badge on the Orders card whenever an order is due today
//      (persistent, at-a-glance).
//   2. A tappable "Order(s) to place today: …" banner that shows ONCE per day and
//      then stays hidden for the rest of that day (no nagging on every app open),
//      plus the matching browser notification, also once a day.
//
// Best-effort and lightweight: on Home load, the suppliers plus TODAY's orders only
// (a one-day query, never the whole archive — see getHistoryForDay), then the pure
// computeAlerts (reused from the Orders feature) runs against the cached bank-holiday
// list. Nothing shows offline or on any error.
//
// Home is the shared landing screen — the ONE sanctioned place a feature signal
// may surface outside its own folder (see the modularity note in the project docs).
// It reuses the Orders data layer + pure alert engine, so there is no duplicated
// logic to drift out of sync.

import { getCollection, getHistoryForDay } from './orders/firebase-orders.js';
import { computeAlerts, maybeNotify, isReminderDue } from './orders/notifications.js';
import { suppliersStillToOrder } from './orders/reminders.js';
import { onSession } from './firebase.js';
import { isSectionAllowed } from './sections.js';

// Per-device record of the last day the reminder was shown ('YYYY-MM-DD').
const REMINDER_KEY = 'orders-reminder-date';

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function showOrdersHome() {
  try {
    const today = todayISO();
    const [suppliers, todayHistory] = await Promise.all([
      getCollection('suppliers'),
      getHistoryForDay(today),
    ]);

    // Count what is STILL to order, not what the calendar says is due. The badge used
    // to say "3" all day even after all three orders had gone out, so the one number
    // on the Home screen contradicted the Orders screen, which ticks them off — and a
    // reminder that stays lit after you have done the job is a reminder people learn
    // to ignore.
    const stillToOrder = suppliersStillToOrder(suppliers, todayHistory, today);

    // Only the primary "place the order" alert drives the Home — holiday/conflict
    // notices are informational and stay on the Orders page.
    const orderAlert = computeAlerts(stillToOrder).find(a => a.kind === 'order');
    if (!orderAlert) return;

    paintBadge(orderAlert.items.length);   // persistent count on the card
    maybeShowDailyReminder(orderAlert);    // banner + notification, once a day
  } catch (err) {
    // Offline / not signed in / rules — no signal, never blocks the Home screen.
    console.warn('Orders home signal skipped:', err);
  }
}

// Show the banner + browser notification only the first time the Home is opened
// on a given day; a localStorage date flag remembers the last day it was shown.
function maybeShowDailyReminder(orderAlert) {
  let lastShown = null;
  try { lastShown = localStorage.getItem(REMINDER_KEY); } catch (e) { /* no storage */ }
  if (!isReminderDue(lastShown)) return;   // already shown today

  paintReminder(orderAlert);
  maybeNotify([orderAlert]);               // the browser popup, once a day
  try { localStorage.setItem(REMINDER_KEY, todayISO()); } catch (e) { /* no storage */ }
}

// A tappable banner (opens Orders) reusing the Orders alert styling. Title is the
// heading ("Order(s) to place today"), with the supplier names beneath.
function paintReminder(orderAlert) {
  const host = document.getElementById('home-reminder');
  if (!host) return;

  const link = document.createElement('a');
  link.className = 'alert-banner order home-reminder';
  link.href = 'orders.html';

  const title = document.createElement('div');
  title.className = 'alert-title';
  title.textContent = orderAlert.title;

  const names = document.createElement('div');
  names.textContent = orderAlert.text;

  link.appendChild(title);
  link.appendChild(names);
  host.appendChild(link);
}

function paintBadge(count) {
  const card = document.querySelector('.home-card[href="orders.html"]');
  if (!card) return;
  // ⚠️ THIS CARD NOW HAS TWO CANDIDATE SIGNALS, and both are absolutely
  // positioned in the same corner: an order due to a supplier today (here) and an
  // order list a colleague has sent (js/home-order-requests-badge.js). Two badges
  // would sit exactly on top of each other and the one underneath would be a
  // number nobody can read.
  //
  // The rule is deterministic and does NOT depend on which module finishes its
  // read first: this one REPLACES whatever is there, the other one steps aside if
  // anything is there. A supplier's ordering day passes and cannot be caught up;
  // a colleague's list waits. So the deadline wins, whichever arrives first.
  card.querySelector('.home-card-badge')?.remove();
  const badge = document.createElement('span');
  badge.className = 'home-card-badge';
  badge.textContent = String(count);
  badge.setAttribute('aria-label', `${count} order${count === 1 ? '' : 's'} to place today`);
  card.appendChild(badge);
}

// Wait for a location to be open before reading anything — before that there is
// no folder to read from. And a location that does not use Orders must not have
// its Home quietly asking for suppliers it is not allowed to see: that would be a
// permission error in the console on every single app open.
let started = false;
onSession(session => {
  if (started || session.status !== 'ready') return;
  if (!isSectionAllowed(session.location, 'orders')) return;
  started = true;
  showOrdersHome();
});
