// client-order-history.js — PURE. What a client ORDERED, day by day, after the day
// has been and gone.
//
// The bakery's own screen shows only what is still coming: the query behind it is
// `date >= today`, a deliberate cost decision, because reading every order ever
// received on every app open would be paid for for ever. So the orders were all
// still there and nothing could look at them, which is the gap Federico named:
// «non abbiamo uno storico d'ordine da consultare».
//
// ⚠️⚠️ NOTHING IN THIS FILE DELETES ANYTHING, AND NOTHING EVER MAY.
//
// Federico's rule, in his own words on 5 August 2026: «io posso cancellare dall'app,
// posso cancellare dal database, quello che abbiamo stabilito che si cancella in
// automatico dall'app si cancella ma NIENTE si deve cancellare in automatico dal
// database». So the fifteen days below are a WINDOW ON THE SCREEN. Past that, orders
// stop being drawn and stay in the database for ever; «show older» widens the window.
//
// This app shipped an automatic deletion exactly once — pastry records, v1.24.0 — and
// took it out the following day. It was not switched off but REMOVED, because a delete
// that sits there disabled is one somebody reconnects in six months without knowing
// why it was off. tests/client-order-history.test.mjs pins this module's whole export
// list for that reason: adding anything that decides what to delete turns a test red
// and names it. A rule that lives only in a comment is a rule that comes back.
//
// ⚠️ IT LIVES IN js/ ROOT AND NOT IN js/client-order-model.js, which is shared with
// the CLIENT's own page (js/client-orders/). Putting the bakery's history grouping
// there would ship code to a customer's phone that their page can never use — the same
// reason js/join-link.js is not inside js/join-code.js. And it deliberately does not
// import from js/orders/, where a grouping by day also exists: a feature never imports
// from another feature's folder.

import { t } from './i18n.js';
import { isISODate, toISODate, startOfDayMs } from './client-order-model.js';

// ⚠️ FIFTEEN, the number the other two histories in this app already use (supplier
// orders, pastry records). Not a setting: config/orders has a CLOSED key list in
// firestore.rules, so a new field there would need a rules deploy for a number nobody
// has asked to change yet.
export const HISTORY_WINDOW_DAYS = 15;

// How many orders one call may read, whatever the dates say. A cap that never fires in
// normal use and stops a runaway read if it ever would (P14): with six clients ordering
// daily, fifteen days is about ninety.
export const MAX_HISTORY_READ = 200;

const DAY_MS = 86400000;

// The window to ask the database for: everything before today, back `windows` × 15 days.
//
// ⚠️ `before` IS TODAY AND THE COMPARISON IS STRICTLY LESS THAN. An order for today is
// still to be delivered — it belongs on the other screen. Sharing it between the two
// would have the same order counted twice by a reader, and «still to come» is the one
// that decides today's work.
export function pastWindow(nowMs, windows = 1) {
  const today = toISODate(nowMs);
  const start = startOfDayMs(today);
  const back = Math.max(1, Math.floor(Number(windows) || 1));
  return {
    before: today,
    since: toISODate(start - (HISTORY_WINDOW_DAYS * back * DAY_MS)),
    days: HISTORY_WINDOW_DAYS * back,
  };
}

// Is this order in the past — i.e. does the history own it rather than the other screen?
export function isPast(order, todayISO) {
  const date = order && order.date;
  if (!isISODate(date) || !isISODate(todayISO)) return false;
  return date < todayISO;
}

// One entry per DAY, newest first, with that day's orders inside it.
//
// ⚠️ AN ORDER WITH NO LINES IS KEPT, and it is not an oversight. A client who sent an
// order and asked for nothing is a FACT about that day — possibly the fact somebody is
// looking the day up to check. Dropping it would make the screen say the client never
// ordered, which is a different and wrong statement.
//
// ⚠️ AN UNREADABLE DATE IS DROPPED rather than grouped under its raw value: it cannot
// be placed in time, so there is no honest day to file it under, and a heading of
// 'undefined' teaches nobody anything.
export function groupByDay(orders) {
  const byDate = new Map();
  (Array.isArray(orders) ? orders : []).forEach(order => {
    if (!order || !isISODate(order.date)) return;
    if (!byDate.has(order.date)) byDate.set(order.date, []);
    byDate.get(order.date).push(order);
  });
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))          // newest day first
    .map(([date, list]) => ({
      date,
      // Within a day, the client who ordered EARLIEST first: it reads as the order
      // the morning actually happened in.
      orders: list.slice().sort((a, b) =>
        String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
        || String(a.clientName || '').localeCompare(String(b.clientName || ''))),
    }));
}

// How many lines a client actually asked for, for the one-line summary on a day.
// Only quantities above zero: a row typed and then cleared is not an order line.
export function lineCount(order) {
  const q = order && order.quantities;
  if (!q || typeof q !== 'object') return 0;
  return Object.values(q).filter(v => Number(v) > 0).length;
}

// The words under a day's client: "3 lines", and "nothing" when they asked for none.
export function linesLabel(order) {
  const n = lineCount(order);
  if (n === 0) return 'nothing ordered';
  return `${n} ${n === 1 ? 'line' : 'lines'}`;
}

// What the screen says when the window holds nothing.
//
// ⚠️ TWO DIFFERENT SENTENCES, because "empty" has two meanings and only one of them is
// a reason to widen the window. Told them apart, somebody knows whether to tap «show
// older» or to stop looking.
export function emptyWords(days, everReceived) {
  return everReceived
    ? `No orders in the last ${days} days. Older ones are still kept — nothing is ever deleted.`
    : t('help.noClientHasSent');
}
