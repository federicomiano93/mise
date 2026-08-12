// calculator-client-orders.js — the bakery's side of a client's own order: the banner
// that says one arrived, the screen that shows what was asked for, and the one button
// that puts it into the quantity fields.
//
// ⚠️ NOTHING HERE MOVES A NUMBER BY ITSELF. The whole point of the feature is to stop
// a person copying quantities out of a message, so it would be tempting to fill the
// fields the moment an order lands. It must not: an order can be corrected, can arrive
// while a dough is already being calculated, and can be wrong. The owner reads it and
// taps. Everything below exists to make that tap safe and that reading honest.
//
// The three things that must never be silent:
//   1. an order that CHANGED after it was used — the one that bakes the wrong amount;
//   2. a field that already holds a different number, before it is overwritten;
//   3. a tab that has been confirmed, whose fields are locked and will not move.

import { el } from './calculator-render.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { getConfig } from './calculator-config-store.js';
import { getClientById } from './calculator-config.js';
import {
  watchUpcomingOrders, markOrderApplied, watchClientCutoff, saveClientCutoff,
  getPastOrders, hasAnyClientOrder,
} from './client-orders-data.js';
import {
  orderRows, orderChangedSinceApplied, isApplied, calculatorPatch, toISODate,
  arrivedLate, normalizeCutoff, CUTOFF_DEFAULT, CUTOFF_PATTERN,
} from './client-order-model.js';
import {
  pastWindow, groupByDay, linesLabel, emptyWords, HISTORY_WINDOW_DAYS,
} from './client-order-history.js';

// Injected by app.js rather than imported from it: app.js is the entry point, and
// importing it back would be a cycle. It owns the quantity fields, so it is the only
// thing that may write them.
let fields = null;

let orders = [];
let cutoff = '';
let unsubscribe = null;
let unsubscribeCutoff = null;

// ── The history half ─────────────────────────────────────────────────────────
// Which of the two views is on screen, how many 15-day windows back the reader has
// asked for, and what the last read returned. All page-lifetime state: the history is
// read on demand, never watched, because a past order does not change.
let view = 'upcoming';          // 'upcoming' | 'history'
let windowsBack = 1;
let past = [];
let pastState = 'idle';         // 'idle' | 'loading' | 'ready' | 'failed'
let everReceived = false;

const BANNER = () => document.getElementById('client-orders-banner');
const OVERLAY = () => document.getElementById('clientorders-overlay');
const CONTENT = () => document.getElementById('clientorders-content');

// ── When the order is for ────────────────────────────────────────────────────

// "Tomorrow · Tuesday 11 August". The weekday is what a baker checks; the date is
// what settles an argument about which one was meant.
function dayLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round(
    (date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const full = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (days === 0) return `Today · ${full}`;
  if (days === 1) return `Tomorrow · ${full}`;
  return full;
}

// When it arrived, in the words a person uses. An exact timestamp answers a question
// nobody asked; "20 minutes ago" answers the one they did.
function arrivedLabel(order) {
  const at = Date.parse(order && order.updatedAt);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Soonest delivery first, and within a day the client who has been waiting longest.
function sortOrders(list) {
  return list.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

// ── The banner ───────────────────────────────────────────────────────────────

// What still needs the owner's attention: an order never used, or one changed since.
// An order already used and untouched since is DONE, and a banner that stays lit
// after the job is a banner people learn to ignore (the lesson of the Home badge,
// which said "3" all day after all three orders had gone out).
function needsAttention(order) {
  return !isApplied(order) || orderChangedSinceApplied(order);
}

function paintBanner() {
  const host = BANNER();
  if (!host) return;
  host.textContent = '';

  const waiting = orders.filter(needsAttention);
  host.hidden = waiting.length === 0;
  if (!waiting.length) return;

  const changed = waiting.filter(orderChangedSinceApplied).length;
  const label = changed
    ? `${changed} ${changed === 1 ? 'order has' : 'orders have'} CHANGED since you used ${changed === 1 ? 'it' : 'them'}`
    : `${waiting.length} ${waiting.length === 1 ? 'order' : 'orders'} received from your clients`;

  const button = el('button', {
    class: `co-banner${changed ? ' co-banner--changed' : ''}`,
    type: 'button',
  }, [
    el('span', { class: 'co-banner-text' }, label),
    el('span', { class: 'co-banner-go' }, '›'),
  ]);
  button.addEventListener('click', openScreen);
  host.appendChild(button);
}

// ── The screen ───────────────────────────────────────────────────────────────

export function openScreen() {
  // Always opens on what is still coming — that is the screen about today's work.
  // The history is a place you go deliberately.
  view = 'upcoming';
  render();
  OVERLAY().classList.add('visible');
}

export function closeScreen() {
  OVERLAY().classList.remove('visible');
}

// The two views, chosen above the list.
//
// ⚠️ THE HISTORY LIVES HERE AND NOT BEHIND A FOURTH FOOTER BUTTON. The Calculator's
// bottom bar holds exactly three (Log · Orders · Settings), and a fourth is precisely
// the change that cost this project a release when a tab wrapped by 3px (v256). It
// also belongs here on merit: the empty state below USED to apologise for the history
// not existing — "orders already delivered are not shown here" — and that apology is
// now the door.
function viewSwitch() {
  const row = el('div', { class: 'co-views' });
  [['upcoming', 'Still coming'], ['history', 'History']].forEach(([name, label]) => {
    const btn = el('button', {
      class: `co-view${view === name ? ' co-view--on' : ''}`,
      type: 'button',
    }, label);
    btn.setAttribute('aria-pressed', view === name ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (view === name) return;
      view = name;
      render();
      if (name === 'history' && pastState === 'idle') loadHistory();
    });
    row.appendChild(btn);
  });
  return row;
}

function render() {
  const content = CONTENT();
  if (!content) return;
  content.textContent = '';
  content.appendChild(viewSwitch());
  if (view === 'history') renderHistory(content);
  else renderUpcoming(content);
}

function renderUpcoming(content) {
  if (!orders.length) {
    // ⚠️ IT SAYS WHAT IS MISSING AND WHY, because "no orders" has two very different
    // meanings here: nobody has sent one, or the ones they sent were for days that
    // have already been. Only the first is about today's work, and a screen that
    // cannot tell you which is leaving you to guess whether something was lost.
    content.appendChild(el('p', { class: 'co-none' },
      'Nothing for today or the days ahead. Orders a client has already been delivered '
      + 'are under History.'));
    return;
  }
  sortOrders(orders).forEach(order => content.appendChild(orderCard(order)));
}

// ── The history ──────────────────────────────────────────────────────────────

async function loadHistory() {
  pastState = 'loading';
  render();
  try {
    const window = pastWindow(Date.now(), windowsBack);
    past = await getPastOrders(window);
    // Only asked when the window came back empty: it is one document read, and it
    // decides between two sentences that mean opposite things to the reader.
    if (!past.length) everReceived = await hasAnyClientOrder().catch(() => false);
    pastState = 'ready';
  } catch (err) {
    console.error('Could not read past client orders:', err);
    pastState = 'failed';
  }
  render();
}

function renderHistory(content) {
  if (pastState === 'loading') {
    content.appendChild(el('p', { class: 'co-none' }, 'Loading…'));
    return;
  }
  if (pastState === 'failed') {
    // ⚠️ Says what went wrong rather than showing an empty list: an empty list and a
    // failed read look identical, and one means "nothing was ordered" while the other
    // means "ask again in a minute".
    content.appendChild(el('p', { class: 'co-none' },
      'Could not load the past orders. Check your connection and try again.'));
    return;
  }

  const days = groupByDay(past);
  if (!days.length) {
    content.appendChild(el('p', { class: 'co-none' },
      emptyWords(HISTORY_WINDOW_DAYS * windowsBack, everReceived)));
  } else {
    days.forEach(day => {
      content.appendChild(el('div', { class: 'co-day' }, dayLabel(day.date)));
      day.orders.forEach(order => content.appendChild(historyCard(order)));
    });
  }

  // ⚠️ ALWAYS OFFERED, even on an empty window: the whole point of the sentence above
  // is that older orders are still there, and a promise with no way to act on it is
  // worse than no promise. Widening is one more read of at most 200 documents.
  const more = el('button', { class: 'co-older', type: 'button' },
    `Show older orders (before the last ${HISTORY_WINDOW_DAYS * windowsBack} days)`);
  more.addEventListener('click', () => {
    windowsBack += 1;
    pastState = 'idle';
    loadHistory();
  });
  content.appendChild(more);
}

// A past order, read-only.
//
// ⚠️⚠️ NO "PUT IN THE CALCULATOR" BUTTON, and it is the safety decision of this
// screen. That button on a three-week-old order would fill TODAY's quantity fields
// with old numbers, silently, and nobody would find out until the bake. The history is
// a record of what a client asked for, not a thing to do.
function historyCard(order) {
  const config = getConfig();
  const client = getClientById(config, order.clientId);
  const liveNameOf = id => {
    const product = (client && client.products || []).find(p => p && p.id === id);
    return product ? product.name : '';
  };
  const rows = orderRows(order, liveNameOf);

  const card = el('div', { class: 'co-card co-card--past' }, [
    el('div', { class: 'co-card-head' }, [
      el('span', { class: 'co-card-client' },
        order.clientName || (client && client.name) || 'Client'),
      el('span', { class: 'co-card-when' }, linesLabel(order)),
    ]),
  ]);

  // Whether it was ever used is a fact worth keeping: an order that arrived and was
  // never put in is exactly the thing somebody looks a past day up to check.
  card.appendChild(el('p', { class: 'co-card-arrived' },
    isApplied(order) ? 'Went into the calculator' : 'Never put into the calculator'));

  const list = el('div', { class: 'co-card-lines' });
  if (!rows.length) {
    list.appendChild(el('p', { class: 'co-card-empty' },
      'The client sent this day empty — they asked for nothing.'));
  }
  // ⚠️ NO `co-line--missing` HERE, and it is deliberate — that class strikes the line
  // through. On an order still to be used it is a warning worth shouting: the product
  // is gone, so this line cannot go into the calculator. On a RECORD it is a lie by
  // typography — the client DID ask for that thing on that day, and a product deleted
  // or renamed since does not change what was ordered. The name frozen into the order
  // is what keeps the record readable, and striking it out undoes exactly that.
  // Found by looking at the rendered screen; every check was green.
  rows.forEach(row => {
    list.appendChild(el('div', { class: 'co-line' }, [
      el('span', { class: 'co-line-name' }, row.name),
      el('span', { class: 'co-line-qty' }, String(row.qty)),
    ]));
  });
  card.appendChild(list);

  if (order.note) {
    card.appendChild(el('p', { class: 'co-card-note' }, [
      el('span', { class: 'co-card-note-label' }, 'Note: '),
      order.note,
    ]));
  }
  return card;
}

function orderCard(order) {
  const changed = orderChangedSinceApplied(order);
  const used = isApplied(order) && !changed;
  const config = getConfig();
  const client = getClientById(config, order.clientId);
  // The live product name wins (a rename should show); the name frozen into the order
  // is the fallback, so a product deleted since is still named rather than shown as an id.
  const liveNameOf = id => {
    const product = (client && client.products || []).find(p => p && p.id === id);
    return product ? product.name : '';
  };
  const rows = orderRows(order, liveNameOf);

  const card = el('div', { class: `co-card${changed ? ' co-card--changed' : ''}${used ? ' co-card--used' : ''}` }, [
    el('div', { class: 'co-card-head' }, [
      el('span', { class: 'co-card-client' }, order.clientName || (client && client.name) || 'Client'),
      el('span', { class: 'co-card-when' }, dayLabel(order.date)),
    ]),
    el('p', { class: 'co-card-arrived' },
      `Sent ${arrivedLabel(order)}${used ? ' · already in the calculator' : ''}`),
  ]);

  // ⚠️ A LATE ARRIVAL IS SHOWN, NOT REFUSED. The security rules keep only a coarse
  // floor on dates — they cannot express a local clock time without being an hour
  // wrong for half the year — so the deadline is really enforced by the client's page,
  // which is code on somebody else's phone. Making a late one VISIBLE is what turns
  // that from a hole into a thing the bakery can decide about.
  if (arrivedLate(order, cutoff)) {
    card.appendChild(el('p', { class: 'co-card-note co-card-note--warn' },
      `This arrived after ${cutoff}, the deadline for that day. You can still use it — but it came in late.`));
  }

  // ⚠️ THE LOUDEST THING ON THE CARD, because it is the one that bakes the wrong
  // amount. Somebody who used this order twenty minutes ago has no other way to know.
  if (changed) {
    card.appendChild(el('p', { class: 'co-card-alert' },
      'This client changed their order AFTER you put it in the calculator. The numbers below are the new ones.'));
  }

  const list = el('div', { class: 'co-card-lines' });
  if (!rows.length) {
    list.appendChild(el('p', { class: 'co-card-empty' },
      'Nothing this day — the client sent an empty order.'));
  }
  rows.forEach(row => {
    list.appendChild(el('div', { class: `co-line${row.missing ? ' co-line--missing' : ''}` }, [
      el('span', { class: 'co-line-name' }, row.name),
      el('span', { class: 'co-line-qty' }, String(row.qty)),
    ]));
  });
  card.appendChild(list);

  // A product this client no longer has cannot be put anywhere: there is no field for
  // it. Said here rather than discovered as a line that quietly did not arrive.
  if (rows.some(r => r.missing)) {
    card.appendChild(el('p', { class: 'co-card-note co-card-note--warn' },
      'A line above is for a product this client no longer has, so it cannot go into the calculator. Add it back, or handle it yourself.'));
  }

  if (order.note) {
    card.appendChild(el('p', { class: 'co-card-note' }, [
      el('span', { class: 'co-card-note-label' }, 'Note: '),
      order.note,
    ]));
  }

  // ⚠️ THREE DIFFERENT LABELS, because the tap means three different things and the
  // difference is what stops the wrong bake. On a CHANGED order the button has to say
  // that the numbers about to go in are new ones — "Put in the calculator", on a card
  // the owner may already have acted on this morning, reads as a button he has
  // finished with.
  const apply = el('button', { class: 'co-apply', type: 'button' },
    changed ? 'Put the NEW order in' : (used ? 'Put in the calculator again' : 'Put in the calculator'));
  apply.addEventListener('click', () => applyOrder(order, apply));
  card.appendChild(apply);

  return card;
}

// ── Putting it in the calculator ─────────────────────────────────────────────

async function applyOrder(order, button) {
  const config = getConfig();
  const client = getClientById(config, order.clientId);
  if (!client) {
    await alertDialog(
      `${order.clientName || 'This client'} is no longer in your address book, so there are no fields to fill in.`);
    return;
  }

  const patch = calculatorPatch(order, client.products);
  const targets = fields.inspect(patch);

  if (!targets.length) {
    await alertDialog('None of this client\'s products are on a calculator tab at the moment, so there is nothing to fill in.');
    return;
  }

  // ⚠️ A CONFIRMED TAB DOES NOT MOVE, and saying so beforehand is the difference
  // between "the app ignored me" and "I know what to do". Its fields are locked until
  // Edit is tapped, exactly as they are for a person typing.
  const locked = [...new Set(targets.filter(t => t.locked).map(t => t.recipeName))];
  if (locked.length === targets.length) {
    await alertDialog(
      `${locked.join(' and ')} ${locked.length === 1 ? 'has' : 'have'} already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.`);
    return;
  }

  // ⚠️ THE OVERWRITE WARNING NAMES THE ROWS. "Some values will change" is a sentence
  // nobody can check; a list of what is about to be replaced is one they can.
  const clashes = targets.filter(t => !t.locked && t.current > 0 && t.current !== t.next);
  const parts = [];
  if (clashes.length) {
    parts.push('These already have a different number typed in:');
    parts.push(clashes.map(t => `  ${t.productName}: ${t.current} → ${t.next}`).join('\n'));
  }
  if (locked.length) {
    parts.push(`${locked.join(' and ')} ${locked.length === 1 ? 'is' : 'are'} confirmed and will be left alone.`);
  }

  const message = parts.length
    ? `${parts.join('\n\n')}\n\nPut ${client.name}'s order in the calculator?`
    : `Put ${client.name}'s order in the calculator?`;

  if (!(await confirmDialog({
    title: clashes.length ? 'This will replace what is typed' : undefined,
    message,
    okLabel: 'Put it in',
    danger: clashes.length > 0,
  }))) return;

  fields.apply(targets.filter(t => !t.locked));

  // ⚠️ RECORDED ONLY AFTER THE FIELDS REALLY MOVED, and a failure here is reported
  // rather than swallowed: if the app cannot remember that this order was used, it can
  // no longer tell you when the client changes it — which is the whole safety net.
  button.disabled = true;
  try {
    await markOrderApplied(order);
  } catch (err) {
    console.error('Could not record that the order was used:', err);
    await alertDialog(
      'The numbers are in the calculator, but the app could not record that you used this order. '
      + 'It will keep showing as new, and it will NOT warn you if the client changes it. Check your connection.');
  }
  button.disabled = false;

  closeScreen();
}

// ── Boot ─────────────────────────────────────────────────────────────────────

// ── When orders close ────────────────────────────────────────────────────────

export function openCutoffSettings() {
  renderCutoffSettings();
  document.getElementById('cosettings-overlay').classList.add('visible');
}

function closeCutoffSettings() {
  document.getElementById('cosettings-overlay').classList.remove('visible');
}

function renderCutoffSettings() {
  const content = document.getElementById('cosettings-content');
  if (!content) return;
  content.textContent = '';

  content.appendChild(el('p', { class: 'cp-hint' },
    'An order for a day can be sent, and changed, until this time on the day before. '
    + 'Clients see this time on their own screen.'));

  const input = el('input', {
    class: 'co-cutoff', id: 'co-cutoff', type: 'time', value: cutoff,
  });

  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label', for: 'co-cutoff' }, 'Orders close at'),
    input,
    // ⚠️ SAID OUT LOUD, because it is the one consequence nobody guesses: with a
    // deadline set, TODAY can never be ordered for — its own door shut yesterday.
    el('p', { class: 'cp-hint' },
      'Leave it empty for no deadline. With a deadline, clients can order for tomorrow '
      + 'onwards but never for the current day, because its deadline has already passed.'),
  ]));

  const save = el('button', { class: 'cp-add-prod', type: 'button' }, 'Save');
  save.addEventListener('click', async () => {
    const wanted = normalizeCutoff(input.value);
    if (input.value && !CUTOFF_PATTERN.test(input.value)) {
      await alertDialog('That is not a time. Use the clock, or leave it empty for no deadline.');
      return;
    }
    if (!(await confirmDialog({
      message: wanted
        ? `Close orders at ${wanted} the day before? Every client sees this straight away.`
        : 'Remove the deadline? Clients will be able to order for any day, including today.',
      okLabel: 'Save',
    }))) return;
    save.disabled = true;
    try {
      await saveClientCutoff(wanted);
      closeCutoffSettings();
    } catch (err) {
      console.error('Could not save the ordering deadline:', err);
      await alertDialog('Not saved. Check your connection and try again.');
    }
    save.disabled = false;
  });
  content.appendChild(save);
}

export function initClientOrders(injected) {
  fields = injected;

  const back = document.querySelector('.clientorders-back-btn');
  if (back) back.addEventListener('click', closeScreen);

  // ⚠️ THE DOOR THAT IS ALWAYS THERE, and it exists because of a real defect: the
  // banner above the tabs was the ONLY way in, and it hides itself once every order
  // has been used. So the moment the last order went into the calculator there was no
  // way back to look at what a client had actually asked for — the orders were still
  // on the screen and the screen had become unreachable.
  //
  // The banner stays what it is: an ALARM that goes quiet at the end of the job,
  // because a reminder still lit after the work is done is one people stop seeing.
  // A doorway is a different thing and belongs where this app puts the ones that are
  // always available — the bottom bar, beside Log and Settings.
  const footerBtn = document.getElementById('clientorders-footer-btn');
  if (footerBtn) footerBtn.addEventListener('click', openScreen);
  const settingsBack = document.querySelector('.cosettings-back-btn');
  if (settingsBack) settingsBack.addEventListener('click', closeCutoffSettings);
  const openSettingsBtn = document.getElementById('open-clientorders-btn');
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openCutoffSettings);

  // ⚠️ A MISSING SETTINGS DOCUMENT MEANS THE DEFAULT, NOT "NO DEADLINE" — the opposite
  // of what the CLIENT page does with an unreadable one, and both directions are
  // deliberate. Here it only decides what a screen SAYS, so the sensible default is
  // the useful answer; there it decides whether somebody can order at all, and a
  // deadline nobody confirmed would refuse orders the bakery would have accepted.
  watchClientCutoff(value => {
    cutoff = value === null ? CUTOFF_DEFAULT : normalizeCutoff(value);
    paintBanner();
    if (OVERLAY() && OVERLAY().classList.contains('visible')) render();
  }, () => { cutoff = ''; })
    .then(fn => { unsubscribeCutoff = fn; })
    .catch(err => console.warn('Ordering deadline not watched:', err));

  watchUpcomingOrders(list => {
    // Only what is still to come. The query already bounds it by date, but a page left
    // open across midnight would otherwise keep yesterday's on screen for ever.
    const today = toISODate(Date.now());
    orders = list.filter(o => o && String(o.date) >= today);
    paintBanner();
    if (OVERLAY() && OVERLAY().classList.contains('visible')) render();
  }, () => {
    // A refused or dropped stream must not leave a stale banner claiming orders are
    // waiting. Silence is the honest state: the Calculator itself still works.
    orders = [];
    paintBanner();
  }).then(fn => { unsubscribe = fn; })
    .catch(err => console.warn('Client orders not watched:', err));
}

export function stopClientOrders() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubscribeCutoff) { unsubscribeCutoff(); unsubscribeCutoff = null; }
}
