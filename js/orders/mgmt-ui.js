// mgmt-ui.js — the small pieces the Settings screen and the Fornitori screen BOTH use.
//
// They were local functions inside management.js while that one file held the
// settings AND the supplier/ingredient records. The records moved out to their own
// screen (js/orders/registry.js), and these came here rather than being copied:
// `reportFailure` is called from the settings AND from both record forms, and a
// second copy of "how this app reports a failed write" is a second wording waiting
// to drift. `field`, `mgmtRow` and the day checks are shared by the two forms.
//
// ⚠️ NOTHING HERE READS A ROLE except mgmtRow, and it asks canManageHere() for the
// ONE irreversible action. Everything else in this file is drawn for everybody, which
// is the deliberate design of the records screen (see registry.js).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';

// The weekday keys as STORED on a supplier. ⚠️ English, and it must stay English:
// this is data, not a phrase — a supplier's deliveryDays is matched against these
// strings, so translating them stops a Monday supplier matching a Monday.
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

export function field(labelText, input) {
  return el('label', { class: 'mgmt-field' }, [el('span', { class: 'mgmt-field-label', text: labelText }), input]);
}

// Build one weekday checkbox group (used for both delivery days and order days).
export function makeDayChecks(selectedDays) {
  return WEEKDAYS.map(day => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = (selectedDays || []).includes(day);
    cb.dataset.day = day;
    return el('label', { class: 'day-check' }, [cb, el('span', { text: day.slice(0, 3) })]);
  });
}

export function checkedDays(checks) {
  return checks.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.dataset.day);
}

export function formActions(saveBtn, onCancel) {
  return el('div', { class: 'mgmt-form-actions' }, [
    el('button', { type: 'button', class: 'btn-secondary', onClick: () => onCancel?.() }, t('ui.cancel')),
    saveBtn,
  ]);
}

// Report a failed write. Every write in this panel used to drop its promise, so a
// rejection (network down, or a Firestore rule refusing the payload) left the
// operator looking at an unchanged row with no idea anything had gone wrong.
//
// A dialog, not the Orders status line: these screens are full-screen overlays, so
// #orders-status is BEHIND them and would never be read. alertDialog sits at
// z-index 10000, above the overlay.
export async function reportFailure(action, name, err) {
  console.error(`${action} failed:`, err);
  await alertDialog(
    `Could not ${action} “${name}”. Check your network and try again.`,
    { title: t('orders.notSaved') },
  );
}

// A row with three actions: Edit, Deactivate/Activate (reversible), Delete
// (permanent). Deactivate confirms only when hiding; Delete always confirms with
// a strong, irreversible warning and is styled low-key in danger red (P20).
//
// ⚠️ STAFF GET THE FIRST TWO AND NOT THE THIRD, and the pair is the point.
// Deactivating hides a supplier from the order screen and can be undone in one
// tap; deleting takes it away from everybody, along with every ingredient filed
// under it. So the reversible half of the job stays with whoever is working and
// only the irreversible half needs the owner — the alternative, hiding both,
// would send somebody to find the owner to tidy a list.
export function mgmtRow(name, meta, active, onEdit, onToggle, onDelete) {
  const actions = [
    el('button', { type: 'button', class: 'mgmt-link', onClick: onEdit }, t('ui.edit')),
    el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
      // Confirm before deactivating (guards against accidental taps);
      // reactivating is harmless and needs no confirmation.
      if (active) {
        const ok = await confirmDialog({
          message: `Deactivate “${name}”? It will be hidden from the order screen. You can reactivate it later.`,
          okLabel: t('ui.deactivate'), danger: true,
          cancelLabel: t('ui.cancel'),
        });
        if (!ok) return;
      }
      try { await onToggle(); }
      catch (err) { await reportFailure(active ? 'deactivate' : 'activate', name, err); }
    } }, active ? 'Deactivate' : 'Activate'),
  ];

  if (canManageHere()) {
    actions.push(el('button', { type: 'button', class: 'mgmt-link danger', onClick: async () => {
      const ok = await confirmDialog({
        message: `Permanently delete “${name}”? This cannot be undone.`,
        okLabel: t('ui.delete'), danger: true,
        cancelLabel: t('ui.cancel'),
      });
      if (!ok) return;
      try { await onDelete(); }
      catch (err) { await reportFailure('delete', name, err); }
    } }, t('ui.delete')));
  }

  return el('div', { class: 'mgmt-item' + (active ? '' : ' inactive') }, [
    el('div', { class: 'mgmt-item-main' }, [
      el('span', { class: 'mgmt-item-name', text: name }),
      el('span', { class: 'mgmt-item-meta', text: meta }),
    ]),
    el('div', { class: 'mgmt-item-actions' }, actions),
  ]);
}

// "10 Aug 2026" from an ISO stamp. Anything unreadable falls back to the raw
// value rather than to "Invalid Date", which tells the reader nothing.
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
