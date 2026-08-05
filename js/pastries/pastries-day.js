// pastries-day.js — one day's list.
//
// This is the screen someone reads standing up at 4am, so it stays plain: the
// names and the numbers are big, and nothing is a field until it is asked to be.
// Name on the left, quantity on the right in a column of same-width digits — the
// note this replaces wrote "Cornetti: 24", and a number buried at the end of a
// name cannot be read down a column at a glance.
//
// ⚠️ BUILT ONCE, THEN UPDATED — it returns { node, update } rather than a node.
// It used to be rebuilt wholesale on every Firestore snapshot, which threw away
// the scroll position (swap() sets scrollTop = 0) several times a minute. That
// was merely annoying while the screen was read-only. It becomes destructive the
// moment there is something on it to type into, so the pattern changes first and
// on its own. The weekday strip has worked this way since it was written.

import { el } from './dom.js';

export function renderDay({ day, items, note }) {
  const list = el('div', { class: 'pas-list' });
  const empty = el('p', { class: 'pas-empty' }, [
    `Nothing to prove for ${day} yet.`,
    el('span', { class: 'pas-empty-hint', text: 'Tap the pencil to add.' }),
  ]);

  const body = el('div', { class: 'pas-body' });

  function paint(nextItems) {
    const rows = (nextItems || []).map(item => el('div', { class: 'pas-row' }, [
      el('span', { class: 'pas-row-name', text: item.name }),
      el('span', { class: 'pas-row-qty', text: String(item.qty) }),
    ]));
    if (rows.length) {
      list.replaceChildren(...rows);
      body.replaceChildren(list);
    } else {
      body.replaceChildren(empty);
    }
  }

  paint(items);

  const node = el('div', { class: 'pas-view' }, [body]);

  return {
    node,
    // Called when the data changed underneath — a snapshot from another phone,
    // or this device's own optimistic write. It repaints the rows INSIDE the
    // node that is already on screen, so the scroll position survives.
    update(nextItems) {
      paint(nextItems);
    },
  };
}
