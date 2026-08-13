// order-form.js — the screen a client actually sees: their own products, a day, a
// note, and one button.
//
// It builds the DOM and reports what was typed. It decides nothing about which days
// are open or what an order becomes — that is js/client-order-model.js, which is pure
// and tested. This file's job is that a busy person in a shop can send tomorrow's
// order in fifteen seconds without being taught anything.

import { t } from '../i18n.js';
import { el } from './dom.js';

const MAX_LINE_QTY = 100000;

// A readable day: "Tomorrow — Tuesday 11 August". The weekday is what people actually
// check, and the date is what settles an argument.
export function dayLabel(iso, nowMs) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(nowMs);
  const days = Math.round(
    (date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const full = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (days === 0) return `Today — ${full}`;
  if (days === 1) return `Tomorrow — ${full}`;
  return full;
}

// One product: its name, and a box for how many. The label is tied to the input, so a
// tap on the name focuses the box and a screen reader announces the two together (P18).
function productRow(product, value, onInput) {
  const inputId = `q-${product.id}`;

  const input = el('input', {
    class: 'co-qty', id: inputId, type: 'number', inputmode: 'numeric',
    min: '0', max: String(MAX_LINE_QTY), step: '1',
    // ⚠️ EMPTY, NOT ZERO. A form pre-filled with zeros reads as "already answered" and
    // is the fastest way to have somebody send an order they never checked (P20). An
    // empty box is a question.
    placeholder: '0',
    value: value === undefined || value === null || value === 0 ? '' : String(value),
  });

  // Clearing a leading zero on focus, the same behaviour as the Calculator's own
  // quantity fields — the people using both should not have to learn two habits.
  input.addEventListener('focus', function () {
    if (this.value === '0') this.value = '';
    else this.select();
  });
  input.addEventListener('input', () => onInput(product.id, input.value));

  return el('div', { class: 'co-row' }, [
    el('label', { class: 'co-row-name', for: inputId }, product.name),
    input,
  ]);
}

// The whole form. Returns a small handle so the page can read what was typed and say
// what happened, without this file knowing anything about Firestore.
export function mountOrderForm(host, {
  clientName, bakeryName, products, dates, selectedDate, quantities, note, nowMs,
  cutoffNote, onChange, onSubmit,
}) {
  host.textContent = '';

  const state = {
    date: selectedDate,
    quantities: { ...quantities },
    note: note || '',
  };

  const report = () => onChange && onChange(state);

  host.appendChild(el('header', { class: 'co-header' }, [
    el('p', { class: 'co-bakery' }, bakeryName),
    el('h1', { class: 'co-client' }, clientName),
  ]));

  const body = el('main', { class: 'co-body' });

  // ── Which day ──
  const daySelect = el('select', { class: 'co-day', id: 'co-day' });
  dates.forEach(iso => {
    const option = el('option', { value: iso }, dayLabel(iso, nowMs));
    if (iso === state.date) option.selected = true;
    daySelect.appendChild(option);
  });
  daySelect.addEventListener('change', () => { state.date = daySelect.value; report(); });

  body.appendChild(el('section', { class: 'co-field' }, [
    el('label', { class: 'co-label', for: 'co-day' }, t('co.deliveryDay')),
    daySelect,
    // ⚠️ THE DEADLINE IS WRITTEN OUT, not merely enforced. A day silently missing from
    // the list looks like a bug; a sentence saying when orders close is the difference
    // between a rule and a mystery.
    cutoffNote ? el('p', { class: 'co-hint' }, cutoffNote) : null,
  ].filter(Boolean)));

  // ── What they want ──
  const list = el('div', { class: 'co-list' });
  if (products.length) {
    products.forEach(product => list.appendChild(
      productRow(product, state.quantities[product.id], (id, value) => {
        state.quantities[id] = value;
        report();
      })));
  } else {
    // Not an error, and it must not read like one: it means the bakery has not
    // finished setting the client up.
    list.appendChild(el('p', { class: 'co-empty' },
      t('co.yourProductListIs')));
  }
  body.appendChild(el('section', { class: 'co-field' }, [
    el('label', { class: 'co-label' }, t('co.howMany')),
    list,
  ]));

  // ── Anything else ──
  const noteInput = el('textarea', {
    class: 'co-note', id: 'co-note', rows: '3', maxlength: '500',
    placeholder: t('co.anythingTheBakeryShould'),
  });
  noteInput.value = state.note;
  noteInput.addEventListener('input', () => { state.note = noteInput.value; report(); });
  body.appendChild(el('section', { class: 'co-field' }, [
    el('label', { class: 'co-label', for: 'co-note' }, 'Note'),
    noteInput,
  ]));

  host.appendChild(body);

  // ── Send ──
  const status = el('p', { class: 'co-status', role: 'status' });
  const send = el('button', { class: 'co-send', type: 'button' }, t('co.sendOrder'));
  send.addEventListener('click', () => onSubmit(state));

  host.appendChild(el('footer', { class: 'co-footer' }, [status, send]));

  return {
    state,
    setStatus(text, kind = 'info') {
      status.textContent = text;
      status.className = `co-status co-status--${kind}`;
    },
    setBusy(busy) {
      send.disabled = busy;
      send.textContent = busy ? t('co.sending') : t('co.sendOrder');
    },
  };
}
