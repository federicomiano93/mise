// pastries-day.js — one day's list, read-only.
//
// This is the screen someone reads standing up at 4am, so it is deliberately
// plain: no fields, no controls, nothing to tap by accident. Name on the left,
// quantity on the right in a column of same-width digits — the note this
// replaces wrote "Cornetti: 24", and a number buried at the end of a name
// cannot be read down a column at a glance.

import { el } from './dom.js';

export function renderDay({ day, items }) {
  const rows = (items || []).map(item => el('div', { class: 'pas-row' }, [
    el('span', { class: 'pas-row-name', text: item.name }),
    el('span', { class: 'pas-row-qty', text: String(item.qty) }),
  ]));

  const body = rows.length
    ? el('div', { class: 'pas-list' }, rows)
    : el('p', { class: 'pas-empty' }, [
      `Nothing to prove for ${day} yet.`,
      el('span', { class: 'pas-empty-hint', text: 'Tap the pencil to add.' }),
    ]);

  return el('div', { class: 'pas-view' }, [body]);
}
