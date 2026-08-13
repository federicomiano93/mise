// pastries-day.js — one day's list, and the fast way to correct one number.
//
// This is the screen someone reads standing up at 4am, so it stays plain: the
// names and the numbers are big, and NOTHING IS A FIELD until a row is tapped.
// Name on the left, quantity on the right in a column of same-width digits — the
// note this replaces wrote "Cornetti: 24", and a number buried at the end of a
// name cannot be read down a column at a glance.
//
// ⚠️ BUILT ONCE, THEN UPDATED. It returns { node, update } rather than a node,
// because a rebuild runs swap(), which resets the scroll AND would throw away a
// half-typed number. The weekday strip has worked this way since it was written.
//
// THE SAFETY PROPERTY THAT MAKES A FIELD ACCEPTABLE HERE: the box starts EMPTY
// and the standing quantity stays plain text. Typing is a PROPOSAL; nothing is
// written until the tick. So a stray thumb costs nothing, and the number someone
// will read tonight can never be altered by a tap.

import { t } from '../i18n.js';
import { weekdayLabel } from './pastries-model.js';
import { el } from './dom.js';
import { MAX_QTY } from './pastries-model.js';

const TICK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const DONE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const PENCIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// What this phone has typed but not yet confirmed, keyed by the row's NAME —
// never by index, because a snapshot can reorder the list. Re-applied on every
// update() so an arriving snapshot cannot eat a number mid-typing (the same
// reason the Orders draft keeps a `pending` map).
const typedKey = (day, name) => `${day} ${String(name).trim().toLowerCase()}`;

export function renderDay({ day, items, note, locked = false, app }) {
  const typed = new Map();
  let openName = null;      // at most one row is open at a time
  let isLocked = !!locked;  // confirmed tonight, and no edit granted since

  const list = el('div', { class: 'pas-list' });
  const empty = el('p', { class: 'pas-empty' }, [
    t('past.nothingToProveFor', { day: weekdayLabel(day) }),
    el('span', { class: 'pas-empty-hint', text: t('past.tapThePencilTo') }),
  ]);
  const body = el('div', { class: 'pas-body' });

  const noteText = el('p', { class: 'pas-note-body' });
  const noteBlock = el('div', { class: 'pas-note' }, [
    el('span', { class: 'pas-note-label', text: 'Note' }),
    noteText,
  ]);

  function buildRow(item, index) {
    const key = typedKey(day, item.name);

    const qtyEl = el('span', { class: 'pas-row-qty', text: String(item.qty) });
    // ⚠️ ONE GATE, whichever way the person reaches it. A locked row does not
    // silently ignore the tap — that would read as a broken screen — it asks the
    // same question the Edit button asks. The instruction was "if I want to
    // change it, it asks me", not "it asks me twice".
    const main = el('button', {
      class: 'pas-row-main',
      type: 'button',
      'aria-expanded': (!isLocked && openName === key) ? 'true' : 'false',
      onclick: async () => {
        if (!isLocked) { toggle(key); return; }
        // Said yes: open the row that was tapped, rather than making them find
        // it again. One tap, one question, then the box they were reaching for.
        if (await app.requestEdit(day)) toggle(key);
      },
    }, [
      el('span', { class: 'pas-row-name', text: item.name }),
      qtyEl,
    ]);

    const box = el('input', {
      class: 'pas-quick',
      type: 'number',
      min: '0',
      max: String(MAX_QTY),
      step: '1',
      inputmode: 'numeric',
      placeholder: '0',
      value: typed.get(key) ?? '',
      'aria-label': `New quantity for ${item.name}`,
      oninput: (e) => {
        typed.set(key, e.target.value);
        refreshTick();
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } },
    });

    // ⚠️ BUILT ALWAYS AND HIDDEN, never built only when a number is typed.
    // repaint() runs on a Firestore snapshot, NEVER on a keystroke — so a
    // conditionally built tick would have no element to reveal, and would appear
    // and vanish at random as other phones wrote. tokens.css forces
    // [hidden] { display: none !important }, so hiding is reliable here.
    const tick = el('button', {
      class: 'pas-tick',
      type: 'button',
      hidden: true,
      icon: TICK_SVG,
      'aria-label': `Confirm the new quantity for ${item.name}`,
      onclick: commit,
    });

    const hint = el('span', { class: 'pas-row-hint', text: '' });

    function proposed() {
      const raw = typed.get(key);
      if (raw === undefined || String(raw).trim() === '') return null;
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return null;
      return n;
    }

    function refreshTick() {
      const n = proposed();
      // Nothing to confirm when the box is empty, when the number is the one
      // already there, or when it is not a number this list can hold.
      const usable = n !== null && n > 0 && n <= MAX_QTY && n !== item.qty;
      tick.hidden = !usable;
      if (n === null) hint.textContent = 'type a number';
      else if (n === item.qty) hint.textContent = 'same as now';
      else if (n <= 0) hint.textContent = 'must be at least 1';
      else if (n > MAX_QTY) hint.textContent = 'too many';
      else hint.textContent = '';
    }

    function commit() {
      const n = proposed();
      if (n === null || n <= 0 || n > MAX_QTY || n === item.qty) return;
      // The STORE composes the payload from live state at this instant, and
      // refuses if the row has moved since it was drawn.
      const ok = app.setItemQuantity(day, index, item.name, n);
      typed.delete(key);
      openName = null;
      if (!ok) {
        app.toast(t('past.thatRowHasChanged'));
        return;
      }
      app.toast(`${item.name}: ${n}.`);
    }

    const editRow = el('div', { class: 'pas-row-edit' }, [
      el('span', { class: 'pas-row-arrow', text: `${item.qty} →` }),
      box, tick, hint,
    ]);

    refreshTick();

    const row = el('div', {
      class: 'pas-row',
      dataset: { open: (!isLocked && openName === key) ? 'true' : 'false' },
    }, [main, editRow]);

    return { row, key, box };
  }

  let built = [];

  function toggle(key) {
    openName = openName === key ? null : key;
    paint(currentItems);
    if (!openName) return;
    const opened = built.find(b => b.key === openName);
    if (opened) { try { opened.box.focus(); } catch (e) { /* best-effort */ } }
  }

  let currentItems = items || [];

  function paint(nextItems) {
    currentItems = nextItems || [];
    // A row that is no longer in the list cannot stay open.
    if (openName && !currentItems.some(i => typedKey(day, i.name) === openName)) openName = null;
    built = currentItems.map((item, i) => buildRow(item, i));
    if (built.length) {
      list.replaceChildren(...built.map(b => b.row));
      body.replaceChildren(list);
    } else {
      body.replaceChildren(empty);
    }
  }

  let currentNote = typeof note === 'string' ? note : '';

  function paintNote(nextNote) {
    const text = typeof nextNote === 'string' ? nextNote : '';
    currentNote = text;
    noteText.textContent = text;
    noteBlock.hidden = !text;
  }

  // Confirm keeps tonight's list as a record. It is the end-of-job gesture,
  // unlike the tick on a row: the tick changes a number that can be changed
  // straight back, while this writes something permanent — and, from now on,
  // ticks the day as done.
  //
  // The word is the Calculator's, for the same gesture. Two names for one action
  // in one app is how someone ends up looking for a button that is not there.
  const confirmBtn = el('button', {
    class: 'pas-confirm-btn',
    type: 'button',
    text: t('past.confirm'),
    onclick: async () => {
      if (confirming) return;     // the dialog takes time to read; taps keep arriving
      confirming = true;
      try {
        await app.confirmDay(day, currentItems, currentNote);
      } finally {
        confirming = false;
      }
    },
  });
  let confirming = false;

  // ⚠️ BUILT ALWAYS AND HIDDEN, never built only when the day is confirmed —
  // the same rule as the row tick above, and the same reason: paint() runs on a
  // Firestore snapshot, so a conditionally built control has no element to
  // reveal and appears at random. tokens.css forces [hidden] { display: none
  // !important }, which is what makes hiding reliable against these classes.
  const doneMark = el('span', { class: 'pas-done-mark', icon: DONE_SVG }, ['Confirmed']);
  const editBtn = el('button', {
    class: 'pas-edit-btn',
    type: 'button',
    icon: PENCIL_SVG,
    onclick: () => app.requestEdit(day),
  }, ['Edit']);
  const doneRow = el('div', { class: 'pas-done' }, [doneMark, editBtn]);

  function paintLock() {
    confirmBtn.hidden = isLocked;
    doneRow.hidden = !isLocked;
  }

  paint(items);
  paintNote(note);
  paintLock();

  const node = el('div', { class: 'pas-view' }, [
    body,
    noteBlock,
    el('div', { class: 'pas-confirm-wrap' }, [confirmBtn, doneRow]),
  ]);

  return {
    node,
    // Called when the data changed underneath — a snapshot from another phone,
    // or this device's own optimistic write. It repaints INSIDE the node that is
    // already on screen, so the scroll position survives, and what this phone
    // has typed is put back on top: the server owns every row this phone has not
    // touched, and this phone owns the one it is typing into. The typed value
    // itself is kept in the `typed` map, so buildRow restores it for free.
    //
    // ⚠️ THE CARET IS DELIBERATELY NOT RESTORED, because it CANNOT be:
    // setSelectionRange throws on input[type="number"] ("does not support
    // selection") and selectionStart reads back null. Focus is restored, which
    // puts the caret at the end — the right place after typing anyway. Anything
    // here that pretended to save a caret position would be dead code.
    update(nextItems, nextNote, nextLocked) {
      const active = document.activeElement;
      const wasTyping = active && active.classList && active.classList.contains('pas-quick');
      const openBefore = openName;

      // A day that has just been confirmed — here or on a colleague's phone —
      // closes whatever row was open. Leaving a field open over a locked list
      // would be a box that accepts a number and then refuses to keep it.
      isLocked = !!nextLocked;
      if (isLocked) openName = null;

      paint(nextItems);
      paintNote(nextNote);
      paintLock();

      if (isLocked || !wasTyping || !openBefore || openName !== openBefore) return;
      const again = built.find(b => b.key === openBefore);
      if (!again) return;
      try { again.box.focus(); } catch (e) { /* focus is best-effort */ }
    },
  };
}
