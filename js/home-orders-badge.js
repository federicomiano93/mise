// home-orders-badge.js — Orders signals on the Home (landing) screen, so Federico
// is reminded to place an order without opening the Orders page:
//   1. A small count badge on the Orders card whenever an order is due today
//      (persistent, at-a-glance).
//   2. A tappable "Order(s) to place today: …" banner that shows ONCE per day and
//      then stays hidden for the rest of that day (no nagging on every app open),
//      plus the matching browser notification, also once a day.
//
// Best-effort and lightweight: ONE small suppliers read on Home load, then the
// pure computeAlerts (reused from the Orders feature) runs against the cached
// bank-holiday list. Nothing shows offline or on any error.
//
// Home is the shared landing screen — the ONE sanctioned place a feature signal
// may surface outside its own folder (see the modularity note in the project docs).
// It reuses the Orders data layer + pure alert engine, so there is no duplicated
// logic to drift out of sync.

import { getCollection } from './orders/firebase-orders.js';
import { computeAlerts, maybeNotify, isReminderDue } from './orders/notifications.js';
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
    const suppliers = await getCollection('suppliers');
    // Only the primary "place the order" alert drives the Home — holiday/conflict
    // notices are informational and stay on the Orders page.
    const orderAlert = computeAlerts(suppliers).find(a => a.kind === 'order');
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
