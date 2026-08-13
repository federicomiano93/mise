// home-order-requests-badge.js — how many order lists are still waiting, on the
// Orders card of the Home screen.
//
// It exists for the same reason its client-order twin does: the banner inside
// Orders is only seen by somebody who has already opened Orders, and the Home is
// the first screen of the installed app. Without this, a list sent after the
// morning's round is invisible until the next time anybody happens to open that
// page — and the whole risk of this feature is a list that reaches nobody.
//
// The Home is the shared landing screen — the ONE sanctioned place a feature
// signal may surface outside its own folder. It reuses the Orders data layer and
// the SAME pure rule the banner uses, so the two numbers cannot disagree. (The
// client-order badge had to be fixed once for exactly that: it counted by a rule
// of its own and went on nagging after the work was done.)

import { getRecentOrderRequestsOnce } from './orders/firebase-orders.js';
import { waitingRequests } from './orders/order-request-model.js';
import { onSession } from './firebase.js';
import { isSectionAllowed } from './sections.js';
import { t } from './i18n.js';

function paintBadge(count) {
  const card = document.querySelector('.home-card[href="orders.html"]');
  if (!card) return;
  // ⚠️ The Orders card may ALREADY carry a badge — js/home-orders-badge.js puts
  // the "order due today" count there. Two absolutely-positioned badges would sit
  // exactly on top of each other, and the one underneath would be a number nobody
  // can read. When the other signal is already up, this one steps aside: an order
  // due to a supplier today is the more urgent of the two, and Orders itself shows
  // both the moment the card is tapped.
  if (card.querySelector('.home-card-badge')) return;

  const badge = document.createElement('span');
  badge.className = 'home-card-badge';
  badge.textContent = String(count);
  badge.setAttribute('aria-label', t('orders.request.waiting', { n: count }));
  card.appendChild(badge);
}

async function showOrderRequestsHome() {
  try {
    const waiting = waitingRequests(await getRecentOrderRequestsOnce());
    if (!waiting.length) return;
    paintBadge(waiting.length);
  } catch (err) {
    // Offline, not signed in, or a location that has never used this. No signal,
    // and it never blocks the Home screen.
    console.warn('Order-list home signal skipped:', err);
  }
}

// Wait for a location to be open before reading anything — before that there is
// no folder to read from. And a location that does not use Orders must not have
// its Home quietly asking for lists it is not allowed to see: that would be a
// permission error in the console on every single app open.
let started = false;
onSession(session => {
  if (started || session.status !== 'ready') return;
  if (!isSectionAllowed(session.location, 'orders')) return;
  started = true;
  showOrderRequestsHome();
});
