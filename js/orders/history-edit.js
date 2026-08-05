// history-edit.js — correct or remove one recorded order.
//
// The safety valve behind "a second order to the same supplier on the same day
// ADDS to the first" (archive.js mergeArchives). Adding is the non-destructive
// choice — it can never silently lose the first order — but it is the wrong
// arithmetic when the operator meant to CORRECT a quantity. So the recorded
// order has to be editable, and a record made by mistake has to be removable.
//
// Full-screen overlay with the app's standard header: Back on the left, title
// centred, Save on the right. Delete is deliberately quiet — a small red text
// button at the bottom, never competing with Save (P20) — and it is the one
// action in the Orders feature that destroys data for good, so it is spelt out.

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { dayLabel, dayPhrase, spellDay } from './day.js';
import { isLegacyRecord, recordDate, recordedName, wholeNumber as num } from './archive.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// A legacy record is a whole week, every supplier merged, so it has no supplier
// name to show — it names its week instead.
export function recordTitle(record) {
  return isLegacyRecord(record)
    ? `Week of ${spellDay(recordDate(record))}`
    : record.supplierName || 'Order';
}

// record: a history document; ingredients: the full list (for names and units);
// actions: { onClose, onSave(id, record), onDelete(id) }.
export function buildHistoryEditor(record, ingredients, actions) {
  const ingById = (ingredients || []).reduce((acc, i) => { acc[i.id] = i; return acc; }, {});
  const quantities = record.quantities || {};
  const stock = record.stock || {};

  // One row per ORDERED item. An ingredient deleted since then still shows — under
  // the name the order was placed with, or "Deleted ingredient" for an order recorded
  // before names were kept — rather than vanishing from its own order.
  const rows = Object.keys(quantities)
    .map(id => ({
      id,
      name: recordedName(id, ingById, record.names),
      unit: ingById[id]?.unit || '',
      qty: num(quantities[id]),
      stock: num(stock[id]),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const inputs = new Map(); // id -> { qty, stock }

  const list = el('div', { class: 'hist-edit-list' }, rows.map(row => {
    const qtyInput = el('input', {
      type: 'number', class: 'ing-qty', min: '0', inputmode: 'numeric',
      'aria-label': `${row.name} quantity ordered`,
    });
    const stockInput = el('input', {
      type: 'number', class: 'ing-stock', min: '0', inputmode: 'numeric',
      'aria-label': `${row.name} stock on hand`,
    });
    qtyInput.value = row.qty;
    stockInput.value = row.stock;
    inputs.set(row.id, { qty: qtyInput, stock: stockInput });

    return el('div', { class: 'ing-row' }, [
      el('div', { class: 'ing-top' }, [
        el('span', { class: 'ing-name', text: row.name }),
      ]),
      el('div', { class: 'ing-fields' }, [
        el('label', { class: 'field order-field' }, [
          el('span', { class: 'field-label', text: 'Order' }),
          el('div', { class: 'ing-order-input' }, [
            qtyInput,
            row.unit ? el('span', { class: 'ing-order-unit', text: row.unit }) : null,
          ]),
        ]),
        el('label', { class: 'field stock-field' }, [
          el('span', { class: 'field-label', text: 'Stock' }), stockInput,
        ]),
      ]),
    ]);
  }));

  // Setting a quantity to 0 removes that item from the order — the plain way to
  // fix "I recorded something I never ordered", without a second delete control.
  const hint = el('p', { class: 'hist-edit-hint', text:
    'Set a quantity to 0 to remove that item from the order.' });

  const deleteBtn = el('button', {
    type: 'button', class: 'hist-edit-delete', onClick: remove,
  }, [
    el('span', { class: 'hist-edit-delete-icon', icon: TRASH_ICON, 'aria-hidden': 'true' }),
    'Delete this order',
  ]);

  const saveBtn = el('button', {
    type: 'button', class: 'orders-icon-btn hist-edit-save', 'aria-label': 'Save', onClick: save,
  }, 'Save');

  const overlay = el('div', { class: 'mgmt-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: () => actions.onClose(),
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'Edit order' })]),
      saveBtn,
    ]),
    el('div', { class: 'mgmt-content' }, [
      el('p', { class: 'hist-edit-what', text:
        `${recordTitle(record)} · ${dayLabel(recordDate(record))}` }),
      rows.length ? list : el('p', { class: 'history-empty', text: 'No items recorded.' }),
      rows.length ? hint : null,
      deleteBtn,
    ]),
  ]);

  function collect() {
    const nextQuantities = {};
    const nextStock = {};
    inputs.forEach(({ qty, stock: stockInput }, id) => {
      const q = num(qty.value);
      if (q > 0) {
        nextQuantities[id] = q;
        nextStock[id] = num(stockInput.value);
      }
    });
    return { nextQuantities, nextStock };
  }

  async function save() {
    const { nextQuantities, nextStock } = collect();

    // An order with nothing in it is not an order. Rather than quietly writing an
    // empty record, point at the action that actually means "this never happened".
    if (!Object.keys(nextQuantities).length) {
      await alertDialog(
        'This order would have no items left. Use "Delete this order" if it should not be there at all.',
        { title: 'Nothing left to save' },
      );
      return;
    }

    const ok = await confirmDialog({
      title: 'Save changes',
      message: `Update ${recordTitle(record)}'s order ${dayPhrase(recordDate(record))}?`,
      okLabel: 'Save',
    });
    if (!ok) return;

    // `record` comes from watchCollection, which injects the document id as a
    // FIELD ({ id: d.id, ...d.data() }). saveHistoryRecord overwrites the document
    // WHOLE, so spreading `record` straight through wrote that id back in as a
    // redundant top-level field. Worse, watchCollection puts ...d.data() LAST, so a
    // stored `id` shadows the real document id — if the two ever diverged, the next
    // save would target the wrong document. The id is the first argument; it never
    // belongs in the payload.
    const { id, ...fields } = record;
    actions.onSave(id, {
      ...fields,
      quantities: nextQuantities,
      stock: nextStock,
      updatedAt: new Date().toISOString(),
    });
  }

  async function remove() {
    const ok = await confirmDialog({
      title: 'Delete this order',
      message: `Delete ${recordTitle(record)}'s order ${dayPhrase(recordDate(record))}?\n\nIt is removed from History for good and cannot be recovered. The suggested order quantities learn from these records, so they will change.`,
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    actions.onDelete(record.id);
  }

  return overlay;
}
