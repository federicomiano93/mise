// order-request-model.js — an order list one person sends to another. PURE.
//
// Until now Orders had ONE list per location (drafts/current, shared and live) and
// ONE way out of it: the WhatsApp button. So whoever wrote the list was necessarily
// whoever passed it to the suppliers. This splits the two — somebody prepares the
// list, sends it inside the app, and a manager works through it and orders.
//
// No DOM and no Firestore here, so every rule below is asserted by a unit test
// rather than read back out of a rendered screen (P15). The numbers this file
// freezes are what somebody will actually buy.
//
// ⚠️ IT LIVES IN js/orders/ AND BELONGS TO ORDERS. The Home imports it for its
// badge, which is the ONE sanctioned place a feature signal surfaces outside its
// own folder (js/home-orders-badge.js already imports from here for the same
// reason). Nothing else may.

import { t } from '../i18n.js';
import { ingredientsOf, ingredientLabel, recordedName, wholeNumber } from './archive.js';
import { toISODate, addDays, isBefore } from './day.js';

// ⚠️ A CAP, BECAUSE THE RULES CANNOT COUNT WHAT THEY CANNOT SEE. firestore.rules
// caps each map's size; this is the same number at this end, so a list too big is
// refused HERE with something a person can read, instead of coming back as a bare
// permission error from Firestore with nothing explaining it.
export const MAX_LINES = 500;

// How far back the screen draws. ⚠️ A WINDOW, NOT A LIFETIME: nothing is ever
// deleted (Federico's rule, 5 Aug 2026). Past this the lists stop being DRAWN and
// stay for ever; "Show older" widens.
export const REQUEST_WINDOW_DAYS = 15;

// ── Who sent it ───────────────────────────────────────────────────────────────

// ⚠️ NEVER THE RAW uid, AND THAT IS THE WHOLE POINT OF THIS FUNCTION. A list
// headed "From Fdx92kQ1nT" tells nobody anything, and the one question the
// receiver has is who it came from. Same reasoning, same order of preference, as
// recordedName() for a deleted ingredient.
//
// The roster row is a LABEL, never an identity (see locations/{lid}/members) — so
// this is only ever what the screen prints, and no decision is ever taken on it.
export function senderName(member, email) {
  const full = [member?.firstName, member?.lastName]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  const address = String(email || '').trim();
  if (address) return address;
  return t('orders.request.someone');
}

// ── Freezing the list ─────────────────────────────────────────────────────────

// Turn the chosen suppliers' slice of the shared draft into the document that is
// sent. Returns null when there is nothing to order — there is no such thing as an
// empty order list, and the rules refuse one too.
//
// ⚠️ FLAT MAPS, NOT A NESTED LIST, AND IT IS NOT A STYLE CHOICE. firestore.rules
// cannot look inside a list (the same reason the WhatsApp free lines needed no
// rules change), so a nested shape could only ever be checked for being a list at
// all. With maps every part gets a type and a size. It is also the exact shape of
// orders-history, which has carried real orders for a year.
//
// ⚠️ ONLY ROWS WITH qty > 0, exactly like buildSupplierArchive. A row somebody
// left at 0 is a row they decided NOT to order; carrying it here would put a line
// on the manager's screen that nobody asked for, and it can never be ticked off
// as bought.
export function buildOrderRequest({
  suppliers, ingredients, entries, date, from, note = '', now = new Date(),
}) {
  const quantities = {};
  const names = {};
  const supplierOf = {};
  const supplierNames = {};

  (suppliers || []).forEach(supplier => {
    if (!supplier || !supplier.id) return;
    let used = false;
    // The SAME lens the archive uses, so a list that is sent and the order that is
    // later recorded can never disagree about what a supplier sells.
    ingredientsOf(supplier.id, ingredients).forEach(ing => {
      const qty = wholeNumber(entries?.[ing.id]?.qty);
      if (qty <= 0) return;
      quantities[ing.id] = qty;
      // Frozen the day it was sent, so a list still names what was asked for after
      // the ingredient is renamed or deleted.
      names[ing.id] = ingredientLabel(ing);
      supplierOf[ing.id] = supplier.id;
      used = true;
    });
    // ⚠️ Only suppliers that CONTRIBUTED a line are named. A supplier ticked on the
    // send screen but whose rows have since gone would otherwise appear on the
    // manager's screen as an empty heading with nothing under it.
    if (used) supplierNames[supplier.id] = supplier.name || '';
  });

  const lines = Object.keys(quantities).length;
  if (!lines || lines > MAX_LINES) return null;

  const timestamp = now.toISOString();
  return {
    date,
    fromUid: from?.uid || '',
    fromName: from?.name || '',
    quantities,
    names,
    supplierOf,
    supplierNames,
    // ⚠️ BORN EMPTY, AND IT IS THE ONLY FIELD THAT EVER CHANGES AFTERWARDS. The
    // rules allow an update to touch `done` and `updatedAt` and nothing else, so a
    // tick can never become the way to rewrite somebody else's quantities.
    done: {},
    note: String(note || '').trim().slice(0, 500),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// ── Is it finished? ───────────────────────────────────────────────────────────

// ⚠️⚠️ THERE IS NO "FINISHED" FIELD, AND THERE MUST NOT BE. A list is finished
// when every line is ticked — deduced, never stored. It is the choice that made
// the pastry lock simple (v1.25.0): ONE fact, so nothing can contradict the ticks,
// every phone agrees because they read the same document, and there is nothing
// extra to keep in step.
//
// ⚠️ A LIST WITH NO LINES READS AS FINISHED, and the direction is deliberate.
// buildOrderRequest refuses to make one and the rules refuse to store one, so this
// is unreachable — but if it ever were reached, "finished" merely means the banner
// stays quiet, whereas "unfinished" would be a banner nobody can ever clear (there
// is nothing to tick, so even "Finish" would leave it stuck). An impossible
// document must not be able to jam a screen for ever.
export function isRequestDone(request) {
  const quantities = request?.quantities || {};
  const done = request?.done || {};
  return Object.keys(quantities).every(id => done[id] === true);
}

// The lines still to order — what "Finish" would tick, and what the counter counts.
export function remainingIds(request) {
  const done = request?.done || {};
  return Object.keys(request?.quantities || {}).filter(id => done[id] !== true);
}

// Every list still waiting, newest first. The one definition of "waiting", shared
// by the banner in Orders and by the badge on the Home, so the two numbers cannot
// disagree — the mistake the client-order badge made and had to be fixed for.
export function waitingRequests(list) {
  return (list || [])
    .filter(r => r && !isRequestDone(r))
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ── What the screen draws ─────────────────────────────────────────────────────

// The list regrouped under its suppliers, in the order they were sent.
//
// ⚠️ THE NAME PREFERS THE LIVE INGREDIENT, falling back to the frozen one — the
// same order of preference as recordedName(), and for the same reason: a rename
// must show through everywhere, and a deleted ingredient must still name itself.
export function groupRequest(request, ingredientsById) {
  const quantities = request?.quantities || {};
  const supplierOf = request?.supplierOf || {};
  const supplierNames = request?.supplierNames || {};
  const done = request?.done || {};

  const bySupplier = new Map();
  Object.keys(supplierNames).forEach(id => bySupplier.set(id, []));

  Object.keys(quantities).forEach(id => {
    // A line whose supplier was never named still has to be drawn: losing it would
    // silently drop something somebody asked to be bought.
    const supplierId = supplierOf[id] || '';
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId).push({
      id,
      name: recordedName(id, ingredientsById, request?.names),
      qty: wholeNumber(quantities[id]),
      done: done[id] === true,
    });
  });

  return [...bySupplier.entries()]
    .filter(([, items]) => items.length)
    .map(([supplierId, items]) => {
      const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
      return {
        supplierId,
        supplierName: supplierNames[supplierId] || t('orders.noSupplier'),
        items: sorted,
        doneCount: sorted.filter(i => i.done).length,
        total: sorted.length,
      };
    });
}

// Which suppliers this list covers — what the "Order placed" hand-off is offered for.
export function supplierIdsOf(request) {
  return Object.keys(request?.supplierNames || {});
}

// ── The list is a photograph, and the shared list moves on ────────────────────

// Where the LIVE order now disagrees with what was sent: { ingredientId: liveQty }.
//
// ⚠️⚠️ THIS IS THE PRICE OF FREEZING THE LIST, AND IT HAS TO BE PAID OUT LOUD.
// Recording an order writes what is in the shared list TODAY, not what was sent
// yesterday. So a manager reading "4" off this screen and tapping "Order placed"
// can record 6 — with nothing saying so. The line has to say so.
//
// ⚠️ ONLY LINES NOT YET TICKED. Recording an order CLEARS the rows it recorded, so
// after doing exactly the right thing every line would otherwise light up with
// "now 0" — an alarm that fires on success is an alarm people learn to ignore. A
// ticked line has already been dealt with, so the warning has no job left on it.
export function liveDifference(request, entries) {
  const quantities = request?.quantities || {};
  const done = request?.done || {};
  const out = {};
  Object.keys(quantities).forEach(id => {
    if (done[id] === true) return;
    const live = wholeNumber(entries?.[id]?.qty);
    if (live !== wholeNumber(quantities[id])) out[id] = live;
  });
  return out;
}

// ── The window on the screen ──────────────────────────────────────────────────

// ⚠️ IT RETURNS THE OLD ONES RATHER THAN DROPPING THEM, exactly like
// splitHistoryByAge. "Show older" needs them, and a function that threw them away
// would make hiding indistinguishable from deleting — which is the one thing this
// app does not do.
export function splitRequestsByAge(requests, windowDays = REQUEST_WINDOW_DAYS, now = new Date()) {
  const list = requests || [];
  const window = Math.floor(Number(windowDays));
  if (!Number.isFinite(window) || window < 1) return { recent: list, older: [] };

  const cutoff = toISODate(addDays(now, -(window - 1)));
  return {
    recent: list.filter(r => !isBefore(String(r?.date || ''), cutoff)),
    older: list.filter(r => isBefore(String(r?.date || ''), cutoff)),
  };
}
