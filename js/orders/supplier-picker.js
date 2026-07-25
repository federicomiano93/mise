// supplier-picker.js — the full-screen "tick the suppliers, then do the thing" list.
//
// Lifted out of preview.js, which had the only master-checkbox in the app, because
// three different actions now need exactly this screen:
//   1. send the order in progress on WhatsApp        (preview.js)
//   2. record several suppliers' orders at once      (orders-main.js)
//   3. re-send a whole day of placed orders          (history.js)
//
// It is deliberately source-agnostic: it takes plain rows, not suppliers or history
// records, so the draft and the archive can both feed it without either of them
// leaking into the other.

import { el } from './dom.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

export function itemsLabel(count) {
  return count === 1 ? '1 item' : `${count} items`;
}

// rows:     [{ id, name, items: [...] }] — `items` is opaque here, only counted and
//           handed back; whoever passes it decides what it means.
// options:  { title, actionLabel, emptyText, danger? }
// callbacks:{ onBack, onConfirm(selectedRows) }
//
// Every row starts ticked: the common case is "yes, all of them", and the checkboxes
// are there so the uncommon case is possible, not so the common one is laborious.
export function buildSupplierPicker(rows, options, callbacks) {
  const { title, actionLabel, emptyText, danger = false } = options;

  const scroll = el('div', { class: 'preview-scroll' });
  const actionBtn = el('button', {
    type: 'button',
    class: danger ? 'btn-primary picker-danger' : 'btn-primary',
  }, actionLabel);
  const checks = [];                 // { row, input }
  let selectAllInput = null;

  // One function, both directions: the master drives the children, and the children
  // drive the master (all ticked → master ticked). The action button is derived from
  // the children, never set by hand, so it can never disagree with what is selected.
  function sync() {
    actionBtn.disabled = !checks.some(c => c.input.checked);
    if (selectAllInput) {
      selectAllInput.checked = checks.length > 0 && checks.every(c => c.input.checked);
    }
  }

  if (!rows.length) {
    scroll.appendChild(el('p', { class: 'preview-empty', text: emptyText }));
    actionBtn.disabled = true;
  } else {
    selectAllInput = el('input', { type: 'checkbox' });
    selectAllInput.checked = true;
    selectAllInput.addEventListener('change', () => {
      checks.forEach(c => { c.input.checked = selectAllInput.checked; });
      sync();
    });
    scroll.appendChild(el('label', { class: 'send-select-all' }, [
      selectAllInput, el('span', { text: 'Select all suppliers' }),
    ]));

    rows.forEach(row => {
      const input = el('input', { type: 'checkbox' });
      input.checked = true;
      input.addEventListener('change', sync);
      checks.push({ row, input });
      scroll.appendChild(el('label', { class: 'send-supplier-row' }, [
        input,
        el('div', { class: 'send-supplier-main' }, [
          el('span', { class: 'send-supplier-name', text: row.name }),
          el('span', { class: 'send-supplier-count', text: itemsLabel(row.items.length) }),
        ]),
      ]));
    });
  }

  actionBtn.addEventListener('click', () => {
    const selected = checks.filter(c => c.input.checked).map(c => c.row);
    if (!selected.length) return;
    callbacks.onConfirm(selected);
  });

  const overlay = el('div', { class: 'preview-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: () => callbacks.onBack(),
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: title })]),
      // Keeps the title centred: the back button on the left needs a counterweight.
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    scroll,
    el('div', { class: 'preview-footer' }, [actionBtn]),
  ]);

  return overlay;
}
