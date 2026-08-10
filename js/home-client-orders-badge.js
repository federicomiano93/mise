// home-client-orders-badge.js — the count of client orders still waiting, on the
// Calculator card of the Home screen.
//
// It exists because the Calculator's own banner is only seen by somebody who has
// already opened the Calculator, and the Home is the first screen of the installed
// app. Without this, an order that arrives after the morning's dough is calculated is
// invisible until the next time anybody happens to open that page.
//
// The Home is the shared landing screen — the ONE sanctioned place a feature signal
// may surface outside its own folder (see the modularity note in the project docs).
// It reuses the same data layer and the same pure rule as the Calculator's banner, so
// the two numbers can never disagree.
//
// ⚠️ ONE BOUNDED QUERY, NOT THE WHOLE COLLECTION (P14). The Home is opened many times
// a day on every phone; reading every order ever placed each time would bill for the
// whole archive for ever. `where('date','>=',today)` is a range on a single field, so
// it needs no composite index and no console setup.

import { getUpcomingOrdersOnce } from './client-orders-data.js';
import { isApplied, orderChangedSinceApplied } from './client-order-model.js';
import { onSession } from './firebase.js';
import { isSectionAllowed } from './sections.js';

// The same rule the Calculator's banner uses: an order never used, or one changed
// since it was. An order used and untouched since is DONE — a badge that stays lit
// after the job is one people learn to ignore.
function stillWaiting(orders) {
  return orders.filter(o => o && (!isApplied(o) || orderChangedSinceApplied(o)));
}

function paintBadge(count, changed) {
  const card = document.querySelector('.home-card[href="calculator.html"]');
  if (!card) return;
  const badge = document.createElement('span');
  badge.className = `home-card-badge${changed ? ' home-card-badge--alert' : ''}`;
  badge.textContent = String(count);
  badge.setAttribute('aria-label', changed
    ? `${changed} client ${changed === 1 ? 'order has' : 'orders have'} changed since you used ${changed === 1 ? 'it' : 'them'}`
    : `${count} client ${count === 1 ? 'order' : 'orders'} waiting`);
  card.appendChild(badge);
}

async function showClientOrdersHome() {
  try {
    const waiting = stillWaiting(await getUpcomingOrdersOnce());
    if (!waiting.length) return;
    paintBadge(waiting.length, waiting.filter(orderChangedSinceApplied).length);
  } catch (err) {
    // Offline, not signed in, or a location that has never used this. No signal, and
    // it never blocks the Home screen.
    console.warn('Client orders home signal skipped:', err);
  }
}

// Wait for a location to be open before reading anything — before that there is no
// folder to read from. And a location that does not use the Calculator must not have
// its Home quietly asking for orders it is not allowed to see: that would be a
// permission error in the console on every single app open.
let started = false;
onSession(session => {
  if (started || session.status !== 'ready') return;
  if (!isSectionAllowed(session.location, 'calculator')) return;
  started = true;
  showClientOrdersHome();
});
