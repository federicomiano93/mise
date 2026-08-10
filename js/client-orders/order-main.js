// order-main.js — the client ordering page, from the link to a sent order.
//
// THE WHOLE FLOW: read the link → sign in → find out which client this is → show that
// client's products → let them type → send. After the first visit the link is not
// needed again, because the session lives on the device: an order must never depend
// on finding an old WhatsApp message.
//
// ⚠️ THE SECRET IS REMOVED FROM THE ADDRESS BAR AS SOON AS IT IS READ. It arrives in
// the fragment (after the #), which browsers never send to a server, so it is not in
// any web-server log — but it would sit in the address bar over the customer's
// shoulder and in their browser history for ever. Stripping it costs one line.

import {
  setLocation, signInWithToken, onUser, currentUid, readGrant, readMenu, readOrder, writeOrder,
} from './firebase-client-orders.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { el } from './dom.js';
import { mountOrderForm, dayLabel } from './order-form.js';
import {
  orderableDates, defaultOrderDate, orderDocId, buildOrder, normalizeQuantities,
  isDateOpen, isValidOrderClientId,
} from '../client-order-model.js';

const HOST = document.getElementById('order-root');

// The bakery's own name is not readable by a client (the location document is staff
// only, deliberately — it also lists which sections the venue uses). The page says
// who it is in plain words instead, and the client's own name comes from their grant.
const BAKERY_NAME = 'The Italian Club';

// ⚠️ THE CUTOFF THE PAGE APPLIES. It is not yet a setting: PR 3 puts it in Settings
// beside the other Calculator options. Until then it is one value, in one place, and
// the sentence under the day picker is generated FROM it — so the two can never say
// different things, which is the only way this stays honest.
const CUTOFF = '16:00';

const cutoffNote = () =>
  `Orders for a day close at ${CUTOFF} the day before. You can change your order until then.`;

function show(node) {
  HOST.textContent = '';
  HOST.appendChild(node);
}

// A dead end with no way out is worse than an error: every message screen says what
// to do next, and none of them offer a button that reloads into the same screen.
function message(title, body) {
  show(el('div', { class: 'co-message' }, [
    el('h1', { class: 'co-message-title' }, title),
    el('p', { class: 'co-message-body' }, body),
  ]));
}

// ── The link ─────────────────────────────────────────────────────────────────

function readLink() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { location: params.get('b') || '', token: params.get('k') || '' };
}

function forgetLink() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// The location has to survive the fragment being wiped, and a returning visit that
// has no fragment at all. It is not a secret — it is the name of a folder — and
// without it the page cannot build a single path.
const LOCATION_KEY = 'client-order-location';

function rememberLocation(id) {
  try { localStorage.setItem(LOCATION_KEY, id); } catch (e) { /* private mode */ }
}

function rememberedLocation() {
  try { return localStorage.getItem(LOCATION_KEY) || ''; } catch (e) { return ''; }
}

// ── The in-progress order, kept on the device ────────────────────────────────
// Typed quantities survive a reload, a dropped connection and a phone locking itself
// (P20). Keyed by the order it belongs to, so switching day does not carry one day's
// numbers into another's.

const draftKey = orderId => `client-order-draft:${orderId}`;

function readDraft(orderId) {
  try {
    const raw = localStorage.getItem(draftKey(orderId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeDraft(orderId, draft) {
  try { localStorage.setItem(draftKey(orderId), JSON.stringify(draft)); } catch (e) { /* full */ }
}

function clearDraft(orderId) {
  try { localStorage.removeItem(draftKey(orderId)); } catch (e) { /* nothing to do */ }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  const link = readLink();
  const location = link.location || rememberedLocation();

  if (!location) {
    message('This link is incomplete',
      'Ask the bakery to send you your ordering link again.');
    return;
  }

  try {
    setLocation(location);
  } catch (err) {
    message('This link is not valid', 'Ask the bakery to send you your ordering link again.');
    return;
  }
  rememberLocation(location);

  if (link.token) {
    try {
      await signInWithToken(link.token);
    } catch (err) {
      console.warn('Sign-in from the link failed:', err);
      // A revoked or replaced link is the ordinary case, not a crash. It gets a
      // sentence a shopkeeper can act on rather than a Firebase error code.
      forgetLink();
      message('This link no longer works',
        'It may have been replaced by a newer one. Ask the bakery for your current link.');
      return;
    }
    forgetLink();
  }

  onUser(async user => {
    if (!user) {
      message('Open your ordering link',
        'Use the link the bakery sent you. Once you have opened it once, this page will '
        + 'remember you on this device.');
      return;
    }
    await openFor(user.uid);
  });
}

async function openFor(uid) {
  message('Loading…', 'Fetching your products.');

  let grant = null;
  try {
    grant = await readGrant(uid);
  } catch (err) {
    console.warn('Could not read the grant:', err);
  }

  if (!grant || !isValidOrderClientId(grant.clientId)) {
    message('This link is not set up yet',
      'Ask the bakery to send you a new ordering link.');
    return;
  }

  let menu = null;
  try {
    menu = await readMenu(grant.clientId);
  } catch (err) {
    console.warn('Could not read the menu:', err);
    message('Could not load your products',
      'This usually means no connection. Check it and try again.');
    return;
  }

  const products = (menu && Array.isArray(menu.products) ? menu.products : [])
    .filter(p => p && p.id && p.name);
  const clientName = String((menu && menu.clientName) || grant.clientName || 'Your order');

  const dates = orderableDates(Date.now(), CUTOFF);
  if (!dates.length) {
    message('Ordering is closed for now',
      `Orders for a day close at ${CUTOFF} the day before. Please try again later.`);
    return;
  }

  await openDay(grant, clientName, products, dates, defaultOrderDate(Date.now(), CUTOFF));
}

async function openDay(grant, clientName, products, dates, date) {
  const orderId = orderDocId(date, grant.clientId);

  // What was already sent for this day, so the form opens on the client's own last
  // answer rather than making them remember it.
  let existing = null;
  try {
    existing = await readOrder(orderId);
  } catch (err) {
    // A refusal here is not fatal — it only means the form starts empty.
    console.warn('Could not read the existing order:', err);
  }

  const draft = readDraft(orderId);
  const quantities = draft ? draft.quantities : ((existing && existing.quantities) || {});
  const note = draft ? draft.note : ((existing && existing.note) || '');

  const form = mountOrderForm(HOST, {
    clientName,
    bakeryName: BAKERY_NAME,
    products,
    dates,
    selectedDate: date,
    quantities,
    note,
    nowMs: Date.now(),
    cutoffNote: cutoffNote(),

    onChange(state) {
      if (state.date !== date) {
        // Changing day is changing which order you are editing, so the whole screen
        // is rebuilt around the other day's own saved answer.
        openDay(grant, clientName, products, dates, state.date);
        return;
      }
      writeDraft(orderId, { quantities: state.quantities, note: state.note });
    },

    onSubmit(state) {
      submit(grant, clientName, products, dates, date, orderId, existing, state, form);
    },
  });

  if (existing) {
    form.setStatus(
      `You have already sent an order for ${dayLabel(date, Date.now())}. Sending again replaces it.`,
      'info');
  }
}

async function submit(grant, clientName, products, dates, date, orderId, existing, state, form) {
  const quantities = normalizeQuantities(state.quantities);
  const lines = Object.keys(quantities).length;

  // ⚠️ CHECKED AGAIN AT THE MOMENT OF SENDING, not only when the page was drawn. A
  // phone left open on this screen all afternoon would otherwise send an order for a
  // day whose door shut two hours ago, and the refusal would arrive as a database
  // error nobody can act on.
  if (!isDateOpen(date, Date.now(), CUTOFF)) {
    await alertDialog(
      `Orders for ${dayLabel(date, Date.now())} have closed. Please choose another day.`);
    openFor(currentUid());
    return;
  }

  // An empty order is a real statement — "nothing this day" — but it is also exactly
  // what a mis-tap produces, so it is the one that gets asked about by name.
  const question = lines === 0
    ? `Send an order with nothing in it for ${dayLabel(date, Date.now())}?`
    : `Send this order for ${dayLabel(date, Date.now())}?`;
  if (!(await confirmDialog({ message: question, okLabel: 'Send' }))) return;

  form.setBusy(true);
  form.setStatus('Sending…', 'info');

  // ⚠️ RE-READ THE ORDER IMMEDIATELY BEFORE WRITING IT. `existing` was fetched when
  // this screen opened, and in between the BAKERY may have put the order into the
  // Calculator — which stamps two fields onto the document that a correction has to
  // carry forward untouched, or the rules refuse the write.
  //
  // Found by driving the app, and the shape of the failure is why it matters: the
  // refusal arrived as a generic error and the page said "check your connection",
  // which is a lie. A client would sit there with a working connection, resending an
  // order that can never land, while the bakery makes yesterday's quantities.
  let latest = existing;
  try {
    latest = await readOrder(orderId);
  } catch (err) {
    // Could not check. Fall through with what we have rather than refusing to send:
    // the write may still succeed, and if it does not, the message below says so.
    console.warn('Could not re-read the order before sending:', err);
  }

  const order = buildOrder({
    date,
    clientId: grant.clientId,
    clientName,
    quantities,
    note: state.note,
    menu: { products },
    nowIso: new Date().toISOString(),
    existing: latest || existing,
  });

  try {
    await writeOrder(orderId, order);
  } catch (err) {
    console.error('Could not send the order:', err);
    form.setBusy(false);
    // ⚠️ THE DRAFT IS DELIBERATELY LEFT ALONE. What was typed is still on the device,
    // so a failed send costs a retry and never the order itself (P17, P20).
    //
    // ⚠️ AND A REFUSAL IS NOT A CONNECTION PROBLEM. Telling somebody with full signal
    // to check their connection sends them to fix the one thing that is working.
    // A refusal here means the order moved underneath this screen or its day closed,
    // and both are fixed by starting again from what the database now says.
    if (err && err.code === 'permission-denied') {
      form.setStatus('This order has changed since you opened it. Reloading…', 'bad');
      setTimeout(() => openFor(currentUid()), 1200);
      return;
    }
    form.setStatus('Not sent — check your connection and try again.', 'bad');
    return;
  }

  clearDraft(orderId);
  form.setBusy(false);
  show(el('div', { class: 'co-message co-sent' }, [
    el('h1', { class: 'co-message-title' }, 'Order sent'),
    el('p', { class: 'co-message-body' },
      `${clientName} — ${dayLabel(date, Date.now())}.`),
    el('p', { class: 'co-message-body' },
      lines === 0
        ? 'You have told the bakery you need nothing that day.'
        : `${lines} ${lines === 1 ? 'item' : 'items'}. You can change it until ${CUTOFF} the day before.`),
    (() => {
      const again = el('button', { class: 'co-send', type: 'button' }, 'Change this order');
      again.addEventListener('click', () => openFor(currentUid()));
      return again;
    })(),
  ]));
}

start();
