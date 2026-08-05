// pastries-editor.js — edit one day's list.
//
// Everything happens on a WORKING COPY (P20): nothing touches the stored day
// until Save is tapped and confirmed, and leaving with unsaved work asks first.

import { el } from './dom.js';
import {
  cleanItems, findInvalidItems, MAX_NAME_LENGTH, MAX_QTY, WEEKDAYS,
} from './pastries-model.js';

const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
const PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

// What to say when a save is blocked. Plain sentences, naming the pastry where
// there is one — "invalid input" tells nobody what to do next.
function problemMessage(problem, name) {
  if (problem === 'duplicate') return `${name} is on this list twice.`;
  if (problem === 'no-qty') return `How many ${name}?`;
  if (problem === 'too-long') return 'That name is too long.';
  if (problem === 'qty-too-big') return `${MAX_QTY} is the most this can hold.`;
  if (problem === 'too-many') return 'That is more pastries than one day can hold.';
  return 'That cannot be saved yet.';
}

export function renderEditor({ day, items, allDays, app }) {
  // The working copy. Quantities are held as STRINGS while being typed, so a
  // half-typed field is not fighting a number: an empty box stays empty instead
  // of snapping to 0 under the cursor.
  const working = (items || []).map(i => ({ name: i.name, qty: String(i.qty) }));
  if (!working.length) working.push({ name: '', qty: '' });

  let dirty = false;
  let showErrors = false;
  let busy = false;   // a confirm is open; taps keep arriving

  const markDirty = () => { dirty = true; };

  // Names already used on the OTHER six days. The same things prove on several
  // days, and typing "Savoury croissant" seven times is exactly the friction
  // worth removing.
  // ⚠️ allDays[x] is { items, note } — it was the bare items array before the
  // standing note existed. Reading it as an array here throws on .forEach.
  const suggestions = new Set();
  WEEKDAYS.forEach(other => {
    if (other === day) return;
    (((allDays || {})[other] || {}).items || []).forEach(item => {
      if (item && item.name) suggestions.add(item.name);
    });
  });
  const datalist = el('datalist', { id: 'pas-name-options' },
    [...suggestions].sort((a, b) => a.localeCompare(b)).map(n => el('option', { value: n })));

  const rowsContainer = el('div', { class: 'pas-editrows' });
  const countEl = el('span', { class: 'pas-editor-count' });

  function updateCount() {
    const n = cleanItems(working).length;
    countEl.textContent = n === 1 ? '1 pastry' : `${n} pastries`;
  }

  function renderRows() {
    rowsContainer.replaceChildren();
    working.forEach((row, idx) => {
      const nameInput = el('input', {
        class: 'pas-name',
        type: 'text',
        value: row.name,
        placeholder: 'Pastry',
        maxlength: String(MAX_NAME_LENGTH),
        list: 'pas-name-options',
        autocomplete: 'off',
        'aria-label': 'Pastry name',
        oninput: (e) => { row.name = e.target.value; markDirty(); updateCount(); if (showErrors) validate(); },
      });

      const qtyInput = el('input', {
        class: 'pas-qty',
        type: 'number',
        value: row.qty,
        placeholder: '0',
        min: '0',
        max: String(MAX_QTY),
        step: '1',
        inputmode: 'numeric',
        'aria-label': `How many ${row.name || 'pastries'}`,
        oninput: (e) => { row.qty = e.target.value; markDirty(); if (showErrors) validate(); },
      });

      const del = el('button', {
        class: 'pas-del-icon',
        type: 'button',
        'aria-label': `Remove ${row.name || 'this row'}`,
        icon: TRASH_SVG,
        onclick: () => removeRow(idx),
      });

      rowsContainer.appendChild(el('div', { class: 'pas-editrow' }, [nameInput, qtyInput, del]));
    });
    updateCount();
  }

  async function removeRow(idx) {
    if (busy) return;
    const row = working[idx];
    // An untouched row has nothing to lose, so asking about it is noise. A row
    // with something typed in it gets the same low-key confirm every other
    // delete in this app gets.
    const hasContent = (row.name || '').trim() || String(row.qty || '').trim();
    if (hasContent) {
      busy = true;
      const ok = await app.confirm({
        title: 'Remove this pastry?',
        message: `Remove ${row.name.trim() || 'this row'} from ${day}?`,
        okLabel: 'Remove',
        danger: true,
      });
      busy = false;
      if (!ok) return;
    }
    working.splice(idx, 1);
    if (!working.length) working.push({ name: '', qty: '' });
    markDirty();
    renderRows();
    if (showErrors) validate();
  }

  // Mark the offending field and return what is wrong, or null.
  function validate() {
    const problem = findInvalidItems(working);
    const rows = [...rowsContainer.children];
    rows.forEach(r => {
      r.querySelector('.pas-name').classList.remove('pas-invalid');
      r.querySelector('.pas-qty').classList.remove('pas-invalid');
    });
    if (!problem || problem.index < 0) return problem;
    const row = rows[problem.index];
    if (!row) return problem;
    // Highlight the field that is actually wrong, not the whole row: the point
    // is to show where to put the cursor.
    const target = problem.problem === 'no-qty' || problem.problem === 'qty-too-big'
      ? row.querySelector('.pas-qty')
      : row.querySelector('.pas-name');
    target.classList.add('pas-invalid');
    return problem;
  }

  async function onSave() {
    if (busy) return;

    showErrors = true;
    const problem = validate();
    if (problem) {
      app.toast(problemMessage(problem.problem, problem.name));
      const rows = [...rowsContainer.children];
      const bad = rows[problem.index] && rows[problem.index].querySelector('.pas-invalid');
      if (bad) { try { bad.focus(); } catch (e) { /* focus is best-effort */ } }
      return;
    }

    busy = true;
    const clean = cleanItems(working);
    const ok = await app.confirm({
      title: `Save ${day}?`,
      message: clean.length
        ? `Save these ${clean.length === 1 ? 'pastry' : `${clean.length} pastries`} for ${day}?`
        : `${day} will have nothing to prove. Save that?`,
      okLabel: 'Save',
    });
    if (!ok) { busy = false; return; }

    dirty = false;
    app.saveDay(day, clean);
    app.toast(`${day} saved.`);
    app.showDay(day);
  }

  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({
      title: 'Discard changes?',
      message: `You have unsaved changes to ${day}. Discard them?`,
      okLabel: 'Discard',
      danger: true,
    });
  });

  renderRows();

  const addBtn = el('button', {
    class: 'pas-add-row',
    type: 'button',
    onclick: () => {
      working.push({ name: '', qty: '' });
      markDirty();
      renderRows();
      // Put the cursor straight in the new row — the reason for tapping "add"
      // is always to type.
      const last = rowsContainer.lastElementChild;
      if (last) { try { last.querySelector('.pas-name').focus(); } catch (e) { /* best-effort */ } }
    },
  }, [el('span', { icon: PLUS_SVG, 'aria-hidden': 'true' }), 'Add pastry']);

  return el('div', { class: 'pas-view' }, [
    datalist,
    el('div', { class: 'pas-editor-head' }, [
      el('span', { class: 'pas-editor-label', text: `To prove for ${day}` }),
      countEl,
    ]),
    rowsContainer,
    addBtn,
    el('div', { class: 'pas-editor-actions' }, [
      el('button', { class: 'pas-save-btn', type: 'button', text: 'Save', onclick: onSave }),
    ]),
  ]);
}
