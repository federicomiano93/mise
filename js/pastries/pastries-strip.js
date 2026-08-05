// pastries-strip.js — the seven weekday chips above the list.
//
// Built ONCE and then only updated: setActive and setCounts change classes and
// attributes on chips that already exist. Rebuilding the row on every tap would
// drop focus off the chip just tapped — which breaks the arrow keys, because
// there would be nothing focused for them to move from — and would flicker.

import { el } from './dom.js';
import { WEEKDAYS, WEEKDAY_SHORT } from './pastries-model.js';

// Render the strip into `host`. `openingDay` is the day the screen opened on
// (tomorrow); it keeps a marker so it stays findable after browsing away.
// Returns { setActive, setCounts }.
export function renderStrip({ host, active, openingDay, counts, onPick }) {
  const chips = new Map();

  WEEKDAYS.forEach((day, i) => {
    const chip = el('button', {
      class: 'pas-chip',
      type: 'button',
      role: 'tab',
      id: `pas-tab-${day}`,
      // A screen reader announcing "Mon" seven times says nothing useful, so
      // the full name is the accessible name and the abbreviation is only what
      // is drawn.
      'aria-label': day,
      'aria-selected': day === active ? 'true' : 'false',
      // Only the selected chip is in the tab order; the arrow keys move within
      // the strip. That is what makes a tablist one stop instead of seven.
      tabindex: day === active ? '0' : '-1',
      dataset: { day },
      onclick: () => onPick(day),
      onkeydown: (e) => handleKey(e, i),
    }, [
      el('span', { text: WEEKDAY_SHORT[i], 'aria-hidden': 'true' }),
      day === openingDay ? el('span', { class: 'pas-chip-dot', 'aria-hidden': 'true' }) : null,
    ]);
    chips.set(day, chip);
    host.appendChild(chip);
  });

  function handleKey(e, index) {
    let next = null;
    if (e.key === 'ArrowRight') next = (index + 1) % 7;
    else if (e.key === 'ArrowLeft') next = (index + 6) % 7;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 6;
    else return;
    e.preventDefault();
    const day = WEEKDAYS[next];
    onPick(day);
    // Focus follows selection, so the next arrow press moves on from where the
    // person actually is.
    const chip = chips.get(day);
    if (chip) { try { chip.focus(); } catch (err) { /* focus is best-effort */ } }
  }

  function setActive(day) {
    chips.forEach((chip, name) => {
      const on = name === day;
      chip.setAttribute('aria-selected', on ? 'true' : 'false');
      chip.tabIndex = on ? 0 : -1;
    });
  }

  // A day with nothing in it is drawn quieter, so "have I done Thursday yet?"
  // is answered from here rather than by opening it.
  function setCounts(map) {
    chips.forEach((chip, name) => {
      chip.classList.toggle('pas-chip--empty', !((map || {})[name] > 0));
    });
  }

  setCounts(counts);
  return { setActive, setCounts };
}
