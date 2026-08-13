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

import { outputLanguage } from '../market.js';
import { t, setLanguage, DEFAULT_LANGUAGE } from '../i18n.js';
import {
  setLocation, signInWithToken, onUser, currentUid, readGrant, readMenu, readOrder, writeOrder,
  readCutoff,
} from './firebase-client-orders.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { el } from './dom.js';
import { mountOrderForm, dayLabel } from './order-form.js';
import {
  orderableDates, defaultOrderDate, orderDocId, buildOrder, normalizeQuantities,
  isDateOpen, isValidOrderClientId, normalizeCutoff,
} from '../client-order-model.js';

const HOST = document.getElementById('order-root');

// ⚠️ THE NAME COMES FROM THE MENU, because the location document is NOT readable
// by a client — staff-only on purpose, since it also lists which sections the
// venue uses. So the name is PUBLISHED onto client-menus/{clientId}, which the
// client may read and which is rewritten every time the address book is saved.
//
// ⚠️ THE FALLBACK IS DELIBERATELY NAMELESS. A menu published before this change
// carries no bakeryName, and putting a real venue's name here as a default would
// tell one bakery's customer they are ordering from a different bakery — which is
// exactly the defect being fixed. "your supplier" is vague and true; a wrong name
// is specific and false.
const FALLBACK_NAME = 'your supplier';
let bakeryName = FALLBACK_NAME;

// ⚠️ WHEN ORDERS CLOSE IS THE BAKERY'S SETTING, READ FROM THE DATABASE, and the
// sentence under the day picker is generated FROM the same value. A fixed sentence
// would start lying the moment the deadline changed — and that sentence is the only
// thing that turns a day quietly missing from the picker into a rule somebody can
// work with.
//
// ⚠️ UNREADABLE MEANS NO DEADLINE, NOT THE DEFAULT ONE. If this page cannot reach the
// setting, imposing a deadline nobody confirmed would refuse orders the bakery would
// have accepted, and the only symptom would be a customer unable to order with
// nothing on screen explaining why. An open door is recoverable; a closed one that
// nobody chose is invisible.
let cutoff = '';

const cutoffNote = () => (cutoff
  ? `Orders for a day close at ${cutoff} the day before. You can change your order until then.`
  : t('co.youCanChangeYour'));

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
    message(t('co.thisLinkIsIncomplete'),
      t('co.askTheBakeryTo'));
    return;
  }

  try {
    setLocation(location);
  } catch (err) {
    message(t('co.thisLinkIsNot'), t('co.askTheBakeryTo'));
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
      message(t('co.thisLinkNoLonger'),
        t('co.itMayHaveBeen'));
      return;
    }
    forgetLink();
  }

  onUser(async user => {
    if (!user) {
      message(t('co.openYourOrderingLink'),
        t('co.useTheLinkThe')
        + t('co.rememberYouOnThis'));
      return;
    }
    await openFor(user.uid);
  });
}

async function openFor(uid) {
  message(t('co.loading'), t('co.fetchingYourProducts'));

  let grant = null;
  try {
    grant = await readGrant(uid);
  } catch (err) {
    console.warn('Could not read the grant:', err);
  }

  if (!grant || !isValidOrderClientId(grant.clientId)) {
    message(t('co.thisLinkIsNot2'),
      t('co.askTheBakeryTo2'));
    return;
  }

  let menu = null;
  try {
    menu = await readMenu(grant.clientId);
  } catch (err) {
    console.warn('Could not read the menu:', err);
    message(t('co.couldNotLoadYour'),
      t('co.thisUsuallyMeansNo'));
    return;
  }

  // Read BEFORE the days are worked out: the deadline decides which of them are open.
  try {
    const settings = await readCutoff();
    cutoff = normalizeCutoff(settings && settings.cutoff);
  } catch (err) {
    console.warn('Could not read the ordering deadline:', err);
    cutoff = '';
  }

  const products = (menu && Array.isArray(menu.products) ? menu.products : [])
    .filter(p => p && p.id && p.name);
  const clientName = String((menu && menu.clientName) || grant.clientName || t('co.yourOrder'));
  // Published with the menu; absent on every menu written before this change, and
  // absent is what FALLBACK_NAME is for.
  bakeryName = String((menu && menu.bakeryName) || '').trim() || FALLBACK_NAME;

  // ⚠️⚠️ THIS PAGE FOLLOWS THE COUNTRY, NEVER THE BAKERY'S INTERFACE SETTING, and
  // the distinction is the same one that governs an allergen label. Whoever is
  // reading this is the bakery's CUSTOMER, in the country the bakery sells in —
  // so the language is a fact about the market, not a preference somebody in the
  // kitchen picked. An Italian bakery whose owner reads the app in English still
  // hands its clients an Italian ordering page, and the reverse.
  //
  // ⚠️ NO COUNTRY MEANS ENGLISH, and here that is right where it would be wrong
  // on a label. A label in the wrong language is not compliant; a page in the
  // wrong language is only awkward, and refusing to draw it would leave a client
  // unable to order at all. Every menu published before today has no country.
  setLanguage(outputLanguage(menu) || DEFAULT_LANGUAGE);

  const dates = orderableDates(Date.now(), cutoff);
  if (!dates.length) {
    message(t('co.orderingIsClosedFor'),
      `Orders for a day close at ${cutoff} the day before. Please try again later.`);
    return;
  }

  await openDay(grant, clientName, products, dates, defaultOrderDate(Date.now(), cutoff));
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
    bakeryName: bakeryName,
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
      t('co.alreadySentFor', { day: dayLabel(date, Date.now()) }),
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
  if (!isDateOpen(date, Date.now(), cutoff)) {
    await alertDialog(
      t('co.ordersClosedFor', { day: dayLabel(date, Date.now()) }));
    openFor(currentUid());
    return;
  }

  // An empty order is a real statement — "nothing this day" — but it is also exactly
  // what a mis-tap produces, so it is the one that gets asked about by name.
  const question = lines === 0
    ? t('co.sendEmptyFor', { day: dayLabel(date, Date.now()) })
    : t('co.sendOrderFor', { day: dayLabel(date, Date.now()) });
  if (!(await confirmDialog({ message: question, okLabel: t('co.send') }))) return;

  form.setBusy(true);
  form.setStatus(t('co.sending'), 'info');

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
      form.setStatus(t('co.thisOrderHasChanged'), 'bad');
      setTimeout(() => openFor(currentUid()), 1200);
      return;
    }
    form.setStatus(t('co.notSentCheckYour'), 'bad');
    return;
  }

  clearDraft(orderId);
  form.setBusy(false);
  show(el('div', { class: 'co-message co-sent' }, [
    el('h1', { class: 'co-message-title' }, t('co.orderSent')),
    el('p', { class: 'co-message-body' },
      t('co.clientAndDay', { client: clientName, day: dayLabel(date, Date.now()) })),
    el('p', { class: 'co-message-body' },
      // ⚠️ ONE PHRASE PER CASE, AND A REAL PLURAL. The automatic pass mangled the
      // nested template this replaced — and it was right to be unable to handle
      // it: a sentence built out of a count, a ternary plural and a second
      // ternary for the deadline cannot be translated in any language whose word
      // order differs. Four whole sentences instead, chosen by two conditions.
      lines === 0
        ? t('co.nothingThatDay')
        : (cutoff
          ? t('co.sent.withCutoff', { n: lines, time: cutoff })
          : t('co.sent.noCutoff', { n: lines }))),
    (() => {
      const again = el('button', { class: 'co-send', type: 'button' }, t('co.changeThisOrder'));
      again.addEventListener('click', () => openFor(currentUid()));
      return again;
    })(),
  ]));
}

start();
