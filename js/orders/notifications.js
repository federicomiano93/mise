// notifications.js — client-side order alerts.
//
// Computes three alerts and shows them as in-app banners; when the user grants
// permission, it also raises a browser notification while the app is open:
//   1. Place the order — a supplier's ORDER day is today (primary reminder)
//   2. Bank holiday ahead — plan orders up to a week before
//   3. Delivery conflict — an upcoming bank holiday falls on a supplier's delivery day
//
// Order timing is a fixed weekday model (per Federico): each supplier has its own
// order days (the days he places the order) and delivery days. No "days-before"
// math. Client-side only: these fire while the app is open. Pushing to staff with
// the app closed needs the server step (Firebase Cloud Functions), deferred for
// now — see js/firebase.example.js.

import { el } from './dom.js';
import { isBankHoliday } from './bank-holidays.js';

// Static SVG (same 24×24 stroked convention as BACK_ICON in management.js) — an
// emoji bell renders as a different picture on every OS and ignores currentColor.
const BELL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CONFLICT_WINDOW_DAYS = 14;
const notified = new Set(); // browser notifications already raised this session

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Bank-holiday ISO dates within the next `days` days (from tomorrow).
function upcomingHolidays(from, days) {
  const result = [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    if (isBankHoliday(iso)) result.push(iso);
  }
  return result;
}

// The first bank holiday within the next `days` days (from tomorrow), as
// { iso, days }, or null. Gives an exact "in N days" countdown for the banner.
function nextHolidayWithin(from, days) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    if (isBankHoliday(iso)) return { iso, days: i };
  }
  return null;
}

// The supplier's NEXT delivery relative to `now`, as a friendly label:
// 'tomorrow' when it lands on the very next day, otherwise the weekday name
// (e.g. 'Thursday'). Empty string when the supplier has no delivery days. Only
// the next delivery is returned — never the full list of delivery weekdays.
function nextDeliveryLabel(supplier, now) {
  const days = supplier.deliveryDays || [];
  if (!days.length) return '';
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const wd = WEEKDAYS[d.getDay()];
    if (days.includes(wd)) return i === 1 ? 'tomorrow' : wd;
  }
  return '';
}

export function computeAlerts(suppliers, now = new Date()) {
  const alerts = [];
  const active = (suppliers || []).filter(s => s.active !== false);
  const todayWd = WEEKDAYS[now.getDay()];

  // 1. Place the order — every supplier whose ORDER day is today, in ONE grouped,
  //    numbered banner (the primary reminder). Each line notes when they deliver.
  const toOrder = active.filter(s => (s.orderDays || []).includes(todayWd));
  if (toOrder.length) {
    const items = toOrder.map(s => {
      const when = nextDeliveryLabel(s, now);
      return when ? `${s.name} — ${when}` : s.name;
    });
    alerts.push({
      kind: 'order',
      key: `order-${toISODate(now)}`,
      title: toOrder.length === 1 ? 'Order to place today' : 'Orders to place today',
      items,
      // Notification body: supplier names only. The title carries the action and
      // the phone already shows "from Misé", so the app name is never
      // repeated here.
      text: toOrder.map(s => s.name).join(', '),
    });
  }

  // 2. Bank holiday ahead — warn up to 7 days before so orders can be planned.
  const holiday = nextHolidayWithin(now, 7);
  if (holiday) {
    const when = holiday.days === 1 ? 'tomorrow' : `in ${holiday.days} days`;
    alerts.push({ kind: 'holiday', key: `bh-${holiday.iso}`, text: `UK bank holiday ${when} (${holiday.iso}). Plan your orders ahead.` });
  }

  // 3. Delivery conflict — an upcoming holiday lands on a supplier's delivery day.
  upcomingHolidays(now, CONFLICT_WINDOW_DAYS).forEach(iso => {
    const wd = WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];
    active.forEach(s => {
      if ((s.deliveryDays || []).includes(wd)) {
        alerts.push({ kind: 'conflict', key: `conf-${s.id}-${iso}`, text: `Heads up: ${s.name} delivers on ${wd}, but ${iso} is a bank holiday — check the delivery.` });
      }
    });
  });

  return alerts;
}

// True when the daily "place the order" reminder has not yet been shown today.
// `lastShownIso` is the last date it was shown on this device ('YYYY-MM-DD') or
// null/undefined if never. Pure and date-based so it is unit-testable.
export function isReminderDue(lastShownIso, now = new Date()) {
  return lastShownIso !== toISODate(now);
}

// Raise a browser notification for each new alert (only when permission granted).
// The title is the alert's own heading (e.g. "Order to place today"); the phone
// already labels the popup "from Misé", so we never repeat the app
// name here. Alerts without a heading fall back to the app name.
export function maybeNotify(alerts) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  alerts.forEach(a => {
    if (notified.has(a.key)) return;
    notified.add(a.key);
    try { new Notification(a.title || 'Misé', { body: a.text, tag: a.key }); }
    catch (err) { console.warn('Notification failed:', err); }
  });
}

// Build one banner. A grouped alert (with items[]) renders a title + numbered list;
// a plain alert renders its text. Both use the same .alert-banner colouring by kind.
function renderAlert(a) {
  if (Array.isArray(a.items) && a.items.length) {
    return el('div', { class: `alert-banner ${a.kind}` }, [
      el('div', { class: 'alert-title', text: a.title || '' }),
      el('ol', { class: 'alert-list' }, a.items.map(t => el('li', { text: t }))),
    ]);
  }
  return el('div', { class: `alert-banner ${a.kind}`, text: a.text });
}

// Render the alert banners into `container`, and raise browser notifications for
// new alerts. The "Enable notifications" control lives in Settings (see
// renderNotificationSettings), not here — it must not clutter the main Order screen.
export function renderAlerts(container, suppliers, now = new Date()) {
  if (!container) return;
  container.textContent = '';

  // The "place the order" alert is not rendered here. On the Home it is the
  // once-a-day badge (js/home-orders-badge.js); on the Orders screen itself it is
  // the compact chip row at the top (reminder-view.js renderTodayOrders), which
  // also knows which of today's orders are already placed and ticks them off —
  // something this function cannot do, as it never sees the history. What is left
  // here is the informational holiday / delivery-clash alerts.
  const alerts = computeAlerts(suppliers, now).filter(a => a.kind !== 'order');
  alerts.forEach(a => container.appendChild(renderAlert(a)));
  maybeNotify(alerts);
}

// Render the "Enable notifications" control + status into a settings container
// (the management panel), so it no longer clutters the main Order screen. Shows a
// short explanation, then either the enable button, an "on" status, or a "blocked"
// hint depending on the current browser permission.
export function renderNotificationSettings(container) {
  if (!container) return;
  container.textContent = '';

  if (!('Notification' in window)) {
    container.appendChild(el('p', { class: 'notif-note', text: 'This device does not support notifications.' }));
    return;
  }

  container.appendChild(el('p', { class: 'notif-desc', text:
    'Get an alert when an order is due (on a supplier’s order day), when a UK bank holiday is coming up, or when a holiday clashes with a supplier delivery day. Note: alerts only show while the app is open.' }));

  const perm = Notification.permission;
  if (perm === 'granted') {
    container.appendChild(el('p', { class: 'notif-status on' }, [
      el('span', { icon: BELL_SVG, 'aria-hidden': 'true' }),
      ' Notifications are on for this device.',
    ]));
  } else if (perm === 'denied') {
    container.appendChild(el('p', { class: 'notif-status off', text:
      'Notifications are blocked. Turn them on for this app in your browser/site settings, then reload.' }));
  } else {
    container.appendChild(el('button', { type: 'button', class: 'enable-notifs', onClick: async () => {
      try { await Notification.requestPermission(); } catch (err) { console.warn('Permission request failed:', err); }
      renderNotificationSettings(container);
    } }, [
      el('span', { icon: BELL_SVG, 'aria-hidden': 'true' }),
      ' Enable notifications',
    ]));
  }
}
