// order-requests.js — the two screens for an order list somebody sent you.
//
// The LIST (who sent what, and how far through it anybody is) and one list OPEN:
// its ingredients under their suppliers, each with a tick to mark as bought.
//
// ⚠️ THE TICK IS A WORKING NOTE, NOT AN APPROVAL. It takes nothing out of the
// order and refuses nothing — it is there so somebody working through five
// suppliers on the phone can put it down, be interrupted for twenty minutes, and
// pick it up knowing exactly where they were. That is why it is saved rather than
// held in the page, and why two phones see the same progress.
//
// Every decision about what the numbers MEAN lives in order-request-model.js, so
// it can be tested under Node. This file is the drawing and the taps.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { dayLabel } from './day.js';
import { confirmDialog } from './confirm-dialog.js';
import {
  groupRequest, isRequestDone, remainingIds, waitingRequests, liveDifference,
  splitRequestsByAge, REQUEST_WINDOW_DAYS,
} from './order-request-model.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

const BIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// Whether "Show older" has been tapped, kept for the life of the page — the same
// shape as the History window, and for the same reason: it is one session of work.
let showingOlder = false;

// ── The list of lists ────────────────────────────────────────────────────────

function header(title, onBack, extra = null) {
  return el('header', { class: 'orders-header' }, [
    el('button', {
      type: 'button', class: 'orders-icon-btn', 'aria-label': t('ui.back'),
      icon: BACK_ICON, onClick: onBack,
    }),
    el('div', { class: 'orders-header-title' }, [el('h1', { text: title })]),
    extra || el('span', { style: { width: '36px', flexShrink: '0' } }),
  ]);
}

function requestCard(request, onOpen) {
  const done = isRequestDone(request);
  const total = Object.keys(request.quantities || {}).length;
  const ticked = total - remainingIds(request).length;

  return el('button', {
    type: 'button',
    class: `req-card${done ? ' req-card--done' : ''}`,
    onClick: () => onOpen(request.id),
  }, [
    el('div', { class: 'req-card-main' }, [
      el('span', { class: 'req-card-from', text: t('orders.request.from', { who: request.fromName || t('orders.request.someone') }) }),
      el('span', { class: 'req-card-when', text: dayLabel(request.date) }),
    ]),
    el('span', {
      class: `req-card-count${done ? ' req-card-count--done' : ''}`,
      text: done ? t('orders.request.allOrdered') : t('orders.request.progress', { done: ticked, total }),
    }),
  ]);
}

// requests: the raw list, newest first. callbacks: { onBack, onOpen }.
export function buildRequestListScreen(requests, callbacks) {
  const scroll = el('div', { class: 'preview-scroll' });
  const list = requests || [];

  const { recent, older } = splitRequestsByAge(list, REQUEST_WINDOW_DAYS);
  const shown = showingOlder ? list : recent;

  if (!shown.length) {
    // ⚠️ TWO DIFFERENT EMPTY STATES, because they are two different situations and
    // only one of them is about today's work. "Nobody has sent one" needs to say
    // HOW to send one; "everything sent has been ordered" is a job finished.
    const nothingEverSent = !list.length;
    scroll.appendChild(el('div', { class: 'req-empty' }, [
      el('p', { class: 'req-empty-title', text: nothingEverSent ? t('orders.request.none') : t('orders.request.noneInWindow', { n: REQUEST_WINDOW_DAYS }) }),
      nothingEverSent
        ? el('p', { class: 'req-empty-hint', text: t('orders.request.noneHint') })
        : null,
    ]));
  } else {
    const waiting = waitingRequests(shown);
    const finished = shown.filter(r => isRequestDone(r));
    // Still to do first, always. A finished list is a record; an unfinished one is
    // somebody waiting for their ingredients.
    [...waiting, ...finished].forEach(request => {
      scroll.appendChild(requestCard(request, callbacks.onOpen));
    });
  }

  // ⚠️ IT HIDES, IT NEVER DELETES — and the button says how many are behind it, so
  // "nothing here" can never be mistaken for "they were thrown away".
  if (!showingOlder && older.length) {
    // .history-older-btn, the class History already uses for exactly this — a
    // quiet full-width way back to what the window hides. Reused rather than
    // reinvented so the two screens cannot drift apart, and so this one arrives
    // already measured.
    scroll.appendChild(el('button', {
      type: 'button', class: 'history-older-btn',
      onClick: () => { showingOlder = true; callbacks.onRepaint?.(); },
    }, t('orders.request.showOlder', { n: older.length })));
  }

  return el('div', { class: 'preview-overlay req-overlay' }, [
    header(t('orders.request.title'), callbacks.onBack),
    scroll,
  ]);
}

// ── One list, open ───────────────────────────────────────────────────────────

function itemRow(item, { differsTo, onToggle }) {
  const box = el('input', { type: 'checkbox' });
  box.checked = item.done;
  box.addEventListener('change', () => onToggle(item.id, box.checked, box));

  const lines = [el('span', { class: 'req-item-name', text: item.name })];

  // ⚠️ THE PRICE OF FREEZING THE LIST, PAID OUT LOUD. Recording an order writes
  // what is in the SHARED order today, not what was sent yesterday — so somebody
  // reading "4" here and tapping "Order placed" can record 6. The line has to say
  // so, on the line, where the number is being read.
  if (differsTo !== undefined) {
    lines.push(el('span', {
      class: 'req-item-changed',
      text: t('orders.request.nowInList', { n: differsTo }),
    }));
  }

  return el('label', { class: `req-item${item.done ? ' req-item--done' : ''}` }, [
    box,
    el('span', { class: 'req-item-main' }, lines),
    el('span', { class: 'req-item-qty', text: String(item.qty) }),
  ]);
}

// request: one document. options: { ingredientsById, entries, canManage }.
// callbacks: { onBack, onToggle, onFinish, onDelete, onPlaced }.
export function buildRequestScreen(request, options, callbacks) {
  const { ingredientsById = {}, entries = {}, canManage = false } = options || {};
  const groups = groupRequest(request, ingredientsById);
  const differences = liveDifference(request, entries);
  const scroll = el('div', { class: 'preview-scroll' });

  scroll.appendChild(el('div', { class: 'req-head' }, [
    el('span', { class: 'req-head-from', text: t('orders.request.from', { who: request.fromName || t('orders.request.someone') }) }),
    el('span', { class: 'req-head-when', text: dayLabel(request.date) }),
  ]));

  if (request.note) {
    scroll.appendChild(el('div', { class: 'req-note' }, [
      el('span', { class: 'req-note-label', text: t('orders.request.noteLabel') }),
      el('span', { class: 'req-note-text', text: request.note }),
    ]));
  }

  // One sentence above the rows when anything at all has moved, so the meaning of
  // the per-line marks is explained once rather than guessed at N times.
  if (Object.keys(differences).length) {
    scroll.appendChild(el('p', { class: 'req-changed-note', text: t('orders.request.changedSince') }));
  }

  groups.forEach(group => {
    const allDone = group.doneCount === group.total;
    scroll.appendChild(el('div', { class: 'req-group' }, [
      el('div', { class: 'req-group-head' }, [
        el('span', { class: 'req-group-name', text: group.supplierName }),
        el('span', {
          class: `req-group-count${allDone ? ' req-group-count--done' : ''}`,
          text: t('orders.request.progress', { done: group.doneCount, total: group.total }),
        }),
      ]),
      ...group.items.map(item => itemRow(item, {
        differsTo: differences[item.id],
        onToggle: callbacks.onToggle,
      })),
      // ⚠️ THE HAND-OFF TO THE ROAD EVERYBODY ALREADY WALKS. Recording the order
      // is the app's existing per-supplier flow — it confirms, writes History and
      // clears the rows. Building a second way to record an order here would be a
      // second answer to "what was ordered", and the two would disagree.
      // ⚠️ THE LABEL IS AN INSTRUCTION, NOT A STATEMENT, and the first draft got
      // this wrong in a way only looking at the screen revealed: it read «Order
      // placed — Aldo Legacy Foods», which is exactly how the app would word a
      // line telling you the order HAD been placed. Sitting under a supplier
      // whose rows are all ticked, it looked like a receipt. A manager reading it
      // that way never taps it, and the order is never recorded.
      allDone && group.supplierId ? el('button', {
        type: 'button', class: 'btn-secondary req-place-btn',
        onClick: () => callbacks.onPlaced?.(group.supplierId),
      }, t('orders.request.markPlacedFor', { supplier: group.supplierName })) : null,
    ]));
  });

  const left = remainingIds(request).length;
  const footer = el('div', { class: 'preview-footer preview-footer-stacked' }, [
    left ? el('button', {
      type: 'button', class: 'btn-primary',
      onClick: () => callbacks.onFinish?.(left),
    }, t('orders.request.finish')) : null,
    // ⚠️ LOW-KEY, AND ONLY FOR WHOEVER RUNS THE PLACE (P20 and firestore.rules
    // agree here). Drawing it for an employee would be drawing a button the
    // database refuses — which teaches people the app is broken, not that they
    // lack the permission.
    canManage ? el('button', {
      type: 'button', class: 'req-delete-btn',
      icon: BIN_ICON, onClick: () => callbacks.onDelete?.(),
    }, [el('span', { text: t('orders.request.delete') })]) : null,
  ]);

  const doneMark = isRequestDone(request)
    ? el('span', { class: 'req-done-mark', icon: CHECK_ICON, 'aria-label': t('orders.request.allOrdered') })
    : null;

  // ⚠️ SINGULAR, because this screen is ONE list. Both screens carried the same
  // plural title, so tapping Back changed nothing at the top of the screen and
  // the arrow looked like it had not worked. The body already names the sender in
  // the largest type on the page, which is what actually tells the two apart.
  return el('div', { class: 'preview-overlay req-overlay' }, [
    header(t('orders.request.oneTitle'), callbacks.onBack, doneMark),
    scroll,
    footer,
  ]);
}

// Asked before ticking off lines nobody has looked at, and it SAYS HOW MANY —
// "Finish" on a list with eleven untouched rows is a very different act from
// finishing one with a single row left.
export function confirmFinish(left) {
  return confirmDialog({
    title: t('orders.request.finishTitle'),
    message: t('orders.request.finishMessage', { n: left }),
    okLabel: t('orders.request.finish'),
    cancelLabel: t('ui.cancel'),
  });
}

export function confirmDeleteRequest() {
  return confirmDialog({
    title: t('orders.request.deleteTitle'),
    message: t('orders.request.deleteMessage'),
    okLabel: t('ui.delete'),
    cancelLabel: t('ui.cancel'),
    danger: true,
  });
}

// The page is rebuilt from scratch on every repaint, so the "show older" choice
// has to be reset when the screen is genuinely left rather than merely redrawn.
export function resetRequestWindow() {
  showingOlder = false;
}
