// search-box.js — the one search field used across the Orders feature.
//
// There were two identical copies of this before (the management panel's
// renderSearchableList and the flat ingredient list): same inline SVG, same
// debounce, same markup. A third was about to be written for the supplier list, so
// it became one.
//
// TWO CALLBACKS, and the distinction matters. `onInput` fires on every keystroke and
// is where the caller STORES the text — it has to be immediate, because a live
// Firestore snapshot can repaint the screen at any moment and must find the current
// text, not the text from before the last 140ms. `onChange` is debounced and is where
// the caller REPAINTS, so a fast typist does not rebuild the list per character.

import { el } from './dom.js';

const SEARCH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

const DEBOUNCE_MS = 140;

// { value, placeholder, ariaLabel?, onInput?, onChange?, debounceMs? }
//   -> { node, input }
//
// The caller mounts `node` ONCE and repaints only its list; rebuilding this element
// on a data snapshot would wipe the text — and the focus — out from under the person
// typing it.
export function buildSearchBox({
  value = '', placeholder = '', ariaLabel = '', onInput, onChange, debounceMs = DEBOUNCE_MS,
} = {}) {
  const input = el('input', {
    type: 'search',
    class: 'mgmt-search-input',
    placeholder,
    'aria-label': ariaLabel || placeholder,
    autocomplete: 'off',
    value,
  });

  let timer = null;
  input.addEventListener('input', () => {
    onInput?.(input.value);
    clearTimeout(timer);
    timer = setTimeout(() => onChange?.(input.value), debounceMs);
  });

  const node = el('div', { class: 'mgmt-search' }, [
    el('span', { class: 'mgmt-search-icon', icon: SEARCH_ICON, 'aria-hidden': 'true' }),
    input,
  ]);

  return { node, input };
}
