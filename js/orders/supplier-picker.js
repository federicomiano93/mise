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

import { t } from '../i18n.js';
import { el } from './dom.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

export function itemsLabel(count) {
  return count === 1 ? '1 item' : `${count} items`;
}

// The message-format chooser: grouped by supplier (what a supplier receives) or one
// flat shopping list (for yourself).
//
// role="radiogroup", not the "tablist" the order-view switch uses, even though the two
// look identical: this picks a VALUE, it does not swap a panel, and announcing it as
// tabs would tell a screen-reader user to expect content to change.
function buildFormatSwitch({ grouped, onChange }) {
  const group = el('div', { class: 'view-switch', role: 'radiogroup', 'aria-label': t('orders.messageFormat') });
  let current = grouped;

  const buttons = [[t('orders.bySupplier'), true], [t('orders.oneList'), false]].map(([label, value]) => {
    const btn = el('button', {
      type: 'button', class: 'view-switch-btn', role: 'radio',
      onClick: () => {
        if (current === value) return;
        current = value;
        paint();
        onChange?.(value);
      },
    }, label);
    btn.dataset.grouped = String(value);
    group.appendChild(btn);
    return btn;
  });

  function paint() {
    buttons.forEach(btn => {
      const on = (btn.dataset.grouped === 'true') === current;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }
  paint();

  return {
    node: el('div', { class: 'preview-format' }, [
      el('span', { class: 'preview-format-label', text: 'Message' }),
      group,
    ]),
    get grouped() { return current; },
  };
}

// rows:     [{ id, name, items: [...] }] — `items` is opaque here, only counted and
//           handed back; whoever passes it decides what it means.
// options:  { title, actionLabel, emptyText, danger?, format?, preselect? }
//           format:    { grouped } — present only on the flows that SEND a message.
//                      "Order placed" writes to History and sends nothing, so it must
//                      not offer a message format.
//           preselect: whether every row starts ticked. Default true.
// callbacks:{ onBack, onConfirm(selectedRows, { grouped }) }
//
// PRESELECT, and why it differs per flow (Federico, 30 Jul 2026). Recording is "I have
// finished, file all of it", so "Order placed" still opens with everything ticked. The
// two SEND screens open with nothing ticked: a message goes to one chat, and choosing
// who it is for should be a decision rather than the default. "Select all suppliers"
// keeps "send everything" one tap away.
export function buildSupplierPicker(rows, options, callbacks) {
  const {
    title, actionLabel, emptyText, danger = false, format = null, preselect = true,
  } = options;
  const formatSwitch = format ? buildFormatSwitch(format) : null;

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
    selectAllInput.checked = preselect;
    selectAllInput.addEventListener('change', () => {
      checks.forEach(c => { c.input.checked = selectAllInput.checked; });
      sync();
    });
    scroll.appendChild(el('label', { class: 'send-select-all' }, [
      selectAllInput, el('span', { text: t('orders.selectAllSuppliers') }),
    ]));

    rows.forEach(row => {
      const input = el('input', { type: 'checkbox' });
      input.checked = preselect;
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

  // Derive the button's state from the ticks NOW, not only on the first change.
  // It used to be created enabled and only corrected inside sync(), which was fine
  // while every row started ticked — but with nothing ticked it would sit there
  // looking ready and do nothing when tapped.
  sync();

  actionBtn.addEventListener('click', () => {
    const selected = checks.filter(c => c.input.checked).map(c => c.row);
    if (!selected.length) return;
    callbacks.onConfirm(selected, { grouped: formatSwitch ? formatSwitch.grouped : true });
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
    // Stacked, not the footer's default row: the format chooser belongs ABOVE the
    // green button, not beside it competing for the same width.
    el('div', { class: 'preview-footer' + (formatSwitch ? ' preview-footer-stacked' : '') },
      [formatSwitch?.node, actionBtn]),
  ]);

  return overlay;
}
