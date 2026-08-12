// client-order-model.js — PURE: what a client may order, for which day, and what
// their order becomes once it reaches the Calculator.
//
// No DOM, no Firebase, no storage, so every rule below can be unit-tested under Node
// (P15 — the owner cannot read code, and these numbers decide how much dough is made).
//
// ⚠️ IT LIVES IN js/ ROOT, NOT IN A FEATURE FOLDER, and must stay there. Two features
// read it: the CLIENT page (js/client-orders/, which is a separate app on a separate
// Firebase instance) and the CALCULATOR (which receives the orders). A feature folder
// must never import from another feature folder, and the alternative — a second copy —
// is worse here than for a dialog: two files that disagree about which day is still
// open, or about how an order maps onto the quantity fields, produce two different
// doughs with nothing on screen saying which is right. Same reasoning, same place, as
// js/price-model.js.

import { pairId } from './calculator-config.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Dates ────────────────────────────────────────────────────────────────────
// A delivery date is a LOCAL calendar day — the day the client wants the bread in
// their hands. It is deliberately NOT the bakery's 4am work day (workDayIndex): that
// one exists so a night shift counts as one shift, which is a fact about baking, not
// about when a shop opens. Mixing the two would tell a client ordering at 01:00 that
// they are ordering for the previous day.

export const ORDER_HORIZON_DAYS = 14;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  // Rejects 2026-02-31, which passes the pattern and then silently becomes 3 March.
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

// A local timestamp → 'YYYY-MM-DD' in the LOCAL calendar. Built by hand rather than
// with toISOString(), which converts to UTC first and therefore names the wrong day
// for anyone east of Greenwich in the small hours.
export function toISODate(ms) {
  const d = new Date(num(ms));
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 'YYYY-MM-DD' → the local millisecond at which that day begins.
export function startOfDayMs(date) {
  if (!isISODate(date)) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// ── The cutoff ───────────────────────────────────────────────────────────────
// An order for day D may be sent — and corrected — until HH:MM on the day BEFORE D.
// One time for the whole bakery, because a different deadline per client is a second
// thing to keep in step with reality and nobody has asked for it.
//
// ⚠️ IT FOLLOWS FROM THIS THAT "TODAY" IS NEVER ORDERABLE while a cutoff is set: its
// door shut yesterday. That is what a deadline MEANS, and it is the honest reading —
// an app that quietly let today through would be an app with no deadline at all. A
// bakery that wants same-day orders clears the cutoff, and then today is offered.

export const CUTOFF_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The bakery's default when nobody has chosen one. Late enough that a shop can decide
// after its own lunchtime, early enough to be a real deadline for a night shift.
export const CUTOFF_DEFAULT = '16:00';

// ⚠️ EMPTY MEANS "NO DEADLINE", AND IT IS A REAL ANSWER, NOT A MISSING ONE. A bakery
// that takes same-day orders clears the box, and then today is offered like any other
// day. Treating empty as "not filled in" and substituting a default would impose a
// deadline nobody asked for, and the only symptom would be customers quietly unable
// to order for today — the same trap as a VAT rate of 0 in Food Cost.
export function normalizeCutoff(value) {
  if (value === '' || value === null) return '';
  return cutoffMinutes(value) === null ? '' : String(value).trim();
}

// Did this order arrive (or change) after its own day's door had shut? Only possible
// through a stale page or a determined client: the security rules keep a coarse floor
// but cannot express a local clock time, so this is the thing that makes a late
// arrival VISIBLE rather than silently accepted. Seen, it can be acted on.
export function arrivedLate(order, cutoff) {
  if (!order || !order.updatedAt) return false;
  const closes = closesAtMs(order.date, cutoff);
  if (closes === null) return false;
  const at = Date.parse(order.updatedAt);
  return Number.isFinite(at) && at > closes;
}

// 'HH:MM' → minutes past midnight, or null for "no cutoff". Anything unparseable is
// null: a corrupt setting must leave the door OPEN, never silently shut a client out
// of ordering with nothing on screen to explain it.
export function cutoffMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = CUTOFF_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// The local moment the door shuts for day D, or null when there is no cutoff.
export function closesAtMs(date, cutoff) {
  const minutes = cutoffMinutes(cutoff);
  if (minutes === null) return null;
  const start = startOfDayMs(date);
  if (!Number.isFinite(start)) return null;
  // Built with the local Date constructor rather than by subtracting 24h, so it lands
  // on the real local time even across a clock change (a day is not always 24 hours).
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d - 1, 0, minutes, 0, 0).getTime();
}

// Can an order for this day still be written? With no cutoff, any day from today
// onwards; with one, only while its door is open.
export function isDateOpen(date, nowMs, cutoff) {
  const now = num(nowMs);
  if (!isISODate(date) || now <= 0) return false;
  const start = startOfDayMs(date);
  if (start < startOfDayMs(toISODate(now))) return false; // never the past
  const closes = closesAtMs(date, cutoff);
  return closes === null ? true : now < closes;
}

// Every day a client may still order for, soonest first. An empty list is a real
// answer (a cutoff long past with a short horizon) and the page must say so rather
// than showing an empty picker.
export function orderableDates(nowMs, cutoff, horizonDays = ORDER_HORIZON_DAYS) {
  const now = num(nowMs);
  if (now <= 0) return [];
  const out = [];
  const today = new Date(now);
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = toISODate(d.getTime());
    if (isDateOpen(iso, now, cutoff)) out.push(iso);
  }
  return out;
}

// What the picker opens on: TOMORROW, because that is how this bakery's clients order.
// If tomorrow's door has already shut, the next open day — never a closed one, and
// never today by default even when today is open, or an evening tap would quietly
// order for a day that is nearly over.
export function defaultOrderDate(nowMs, cutoff, horizonDays = ORDER_HORIZON_DAYS) {
  const open = orderableDates(nowMs, cutoff, horizonDays);
  if (!open.length) return '';
  const tomorrow = toISODate(num(nowMs) + 86400000);
  return open.find(d => d >= tomorrow) || open[0];
}

// ── Ids ──────────────────────────────────────────────────────────────────────

// ⚠️ AN UNDERSCORE IS FORBIDDEN IN A CLIENT ID, and this is not tidiness. An order
// document is named `{date}_{clientId}`, and the security rules recover the client
// from that id by splitting on the underscore. A client id containing one would split
// into three pieces and the rule would compare against the wrong half — which fails
// open or closed depending on the name, the worst kind of security bug.
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export function isValidOrderClientId(id) {
  return typeof id === 'string' && CLIENT_ID.test(id);
}

// The one place an order's document id is built. Throws rather than guessing: a
// malformed id would put a client's order where another client's rules can reach it.
export function orderDocId(date, clientId) {
  if (!isISODate(date)) throw new Error(`Invalid order date: ${JSON.stringify(date)}`);
  if (!isValidOrderClientId(clientId)) throw new Error(`Invalid client id: ${JSON.stringify(clientId)}`);
  return `${date}_${clientId}`;
}

// ── The account behind an ordering link ──────────────────────────────────────

// ⚠️ THE ADDRESS IS BUILT HERE, IN ONE PLACE, AND BOTH SIDES IMPORT IT. The link
// minter creates the account with this address and the client page signs in with it;
// they are different files in different folders, and a second copy of this template
// would mean a change in one silently locking every client out of the other. That is
// the same reasoning that keeps price-model.js out of a feature folder — a copy of a
// RULE is worse than a copy of a dialog.
//
// ⚠️ LOWERCASED EXPLICITLY. Firebase Auth stores an email folded to lower case, so a
// mixed-case token produces an account whose address does not match the string that
// created it. Sign-in happens to fold it the same way, which means this works by
// accident today and would break the day that behaviour changed — with every existing
// link dying at once and nothing in the code explaining why.
//
// `.invalid` is the TLD reserved by RFC 2606 for exactly this: an address that can
// never receive mail and can never collide with a real one. The leading letter keeps
// the local part valid whatever the token happens to start with.
export function linkEmailFor(token) {
  return `c${String(token || '').toLowerCase()}@orders.theitalianclub.invalid`;
}

// ── The published menu ───────────────────────────────────────────────────────
// The thin slice of the address book a client is allowed to see. It exists so the
// client NEVER reads config/calculator, which holds every client, every product,
// every recipe and every setting in one document.

// ⚠️ `bakeryName` TRAVELS WITH THE MENU BECAUSE THE CLIENT PAGE CANNOT READ THE
// LOCATION. locations/{lid} is staff-only on purpose — it also lists which
// sections the venue uses — so the only way a client's screen can say who it is
// ordering from is for the name to be published onto something the client may
// read. This document already is that thing, and it is republished whenever the
// address book is saved, so a venue that renames itself corrects every client's
// page by itself.
export function menuFor(client, bakeryName) {
  const products = (client && Array.isArray(client.products) ? client.products : [])
    // A paused product leaves the Calculator entirely (getTabProducts), so offering it
    // here would let a client order something the bakery has decided not to make.
    .filter(p => p && p.id && p.active !== false)
    .map(p => ({ id: String(p.id), name: String(p.name || ''), kind: String(p.kind || 'number') }));
  const menu = { clientName: String((client && client.name) || ''), products };
  // Omitted rather than written empty: the rules accept it either way, and an
  // absent field is what every menu published before today looks like.
  const name = String(bakeryName || '').trim();
  if (name) menu.bakeryName = name.slice(0, 200);
  return menu;
}

// Whether a published menu still matches the address book. Republishing every client's
// menu on every save would be a write per client per keystroke-batch; republishing none
// leaves a client unable to order a product that exists (and nobody finds out until
// they telephone). So: compare, and write only what moved.
export function menuChanged(published, wanted) {
  if (!published || !wanted) return true;
  if (String(published.clientName || '') !== String(wanted.clientName || '')) return true;
  // ⚠️ COMPARED, so a venue that renames itself republishes. Without this line the
  // new name would sit in the address book and never reach a single client page,
  // and nothing would say why.
  if (String(published.bakeryName || '') !== String(wanted.bakeryName || '')) return true;
  const a = Array.isArray(published.products) ? published.products : [];
  const b = Array.isArray(wanted.products) ? wanted.products : [];
  if (a.length !== b.length) return true;
  return a.some((p, i) =>
    String(p && p.id) !== String(b[i].id)
    || String(p && p.name) !== String(b[i].name)
    || String(p && p.kind) !== String(b[i].kind));
}

// ── An order ─────────────────────────────────────────────────────────────────

export const MAX_NOTE = 500;
export const MAX_LINES = 200;
export const MAX_QTY = 100000;

// Keep only real, positive quantities. A row at zero is not an order for nothing — it
// is a row the client left alone — so it is dropped, exactly as orders-history drops
// them. Values are clamped so a stuck key cannot ask for a million loaves, and NaN can
// never reach the dough total.
export function normalizeQuantities(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!id || typeof id !== 'string') continue;
    const qty = num(value);
    if (qty <= 0) continue;
    out[id] = Math.min(qty, MAX_QTY);
    if (Object.keys(out).length >= MAX_LINES) break;
  }
  return out;
}

// The document a client sends. `names` freezes each product's label as it read the day
// it was ordered — the same reason orders-history froze its own (v209): a product that
// is renamed or deleted afterwards must not turn a received order into a row of raw
// ids, on screen or in the Calculator.
//
// `createdAt` survives a correction; `updatedAt` moves. That pair is what lets the
// Calculator notice an order that CHANGED after it was used.
export function buildOrder({ date, clientId, clientName, quantities, note, menu, nowIso, existing }) {
  const qty = normalizeQuantities(quantities);
  const names = {};
  for (const product of (menu && Array.isArray(menu.products) ? menu.products : [])) {
    if (product && product.id && qty[product.id] !== undefined) names[product.id] = String(product.name || '');
  }
  const order = {
    date: String(date),
    clientId: String(clientId),
    clientName: String(clientName || ''),
    quantities: qty,
    names,
    note: String(note || '').slice(0, MAX_NOTE),
    createdAt: String((existing && existing.createdAt) || nowIso),
    updatedAt: String(nowIso),
  };

  // ⚠️ THE CLIENT MUST CARRY THESE FORWARD, AND THE RULES REFUSE THE WRITE IF IT
  // DOES NOT. A correction is written WHOLE — a merge could never remove a row the
  // client deleted — so simply leaving them out would ERASE the bakery's record that
  // this order had already been put into the Calculator, and the screen would stop
  // warning that it changed afterwards. That warning is the one thing standing
  // between a late correction and the wrong amount of bread.
  if (existing && existing.appliedAt) order.appliedAt = String(existing.appliedAt);
  if (existing && existing.appliedFor) order.appliedFor = String(existing.appliedFor);

  return order;
}

// Has the client changed this order since Federico put it in the Calculator?
//
// ⚠️ THIS IS THE ONE THAT BAKES THE WRONG AMOUNT IF IT IS WRONG. `appliedFor` records
// WHICH version was used, not merely that one was: comparing "applied at" against
// "updated at" as two clocks would call an order stale whenever the two timestamps
// were written a second apart, and would miss a change made inside the same second.
export function orderChangedSinceApplied(order) {
  if (!order || !order.appliedAt) return false;
  return String(order.appliedFor || '') !== String(order.updatedAt || '');
}

export function isApplied(order) {
  return Boolean(order && order.appliedAt);
}

// The lines to show, sorted by name so the same order always reads the same way.
// `liveNameOf(id)` is injected rather than imported so this stays pure: the live
// product name wins (a rename should show), the frozen one is the fallback, and a
// product that has been deleted still says what it was instead of showing an id.
export function orderRows(order, liveNameOf) {
  const quantities = (order && order.quantities) || {};
  const frozen = (order && order.names) || {};
  const rows = Object.keys(quantities).map(id => ({
    id,
    name: (typeof liveNameOf === 'function' && liveNameOf(id))
      || frozen[id]
      || 'Deleted product',
    qty: num(quantities[id]),
    // The row is still shown, but the screen can mark it: a product nobody sells any
    // more cannot be put into the Calculator, because there is no field for it.
    missing: typeof liveNameOf === 'function' && !liveNameOf(id),
  }));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function orderTotalLines(order) {
  return Object.keys((order && order.quantities) || {}).length;
}

// What the Calculator's quantity fields should say for this client once the order is
// applied: one entry per product the client CURRENTLY has, keyed exactly as the
// calculator keys its inputs and its localStorage (`qty-<clientId>::<productId>`).
//
// ⚠️ PRODUCTS THE ORDER DOES NOT MENTION ARE SET TO ZERO, deliberately. The order is
// the client's complete statement of what they want, so a 5 left over from yesterday
// in a field they did not ask for today is a wrong number — and it is exactly the kind
// of leftover that gets baked. The screen confirms before overwriting anything already
// typed, which is what makes zeroing safe rather than surprising.
//
// A row for a product the client no longer has is skipped: there is no field to fill.
export function calculatorPatch(order, clientProducts) {
  const quantities = (order && order.quantities) || {};
  const clientId = String((order && order.clientId) || '');
  const patch = {};
  if (!clientId) return patch;
  for (const product of (Array.isArray(clientProducts) ? clientProducts : [])) {
    if (!product || !product.id || product.active === false) continue;
    patch[pairId(clientId, product.id)] = num(quantities[product.id]);
  }
  return patch;
}
