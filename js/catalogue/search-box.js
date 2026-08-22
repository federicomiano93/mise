// search-box.js — THE catalogue's search field. One builder, so the recipe list
// and the allergen sheet cannot drift into two fields that look and behave
// differently on the same feature.
//
// ⚠️ IT DELIBERATELY MIRRORS js/orders/search-box.js WITHOUT IMPORTING IT. A
// feature may never import from another feature's folder (the whole point of
// keeping each one liftable), and Orders' `.mgmt-search*` classes belong to the
// Orders token set anyway. The duplication is accepted here for the same reason
// catalogue-model.js accepts a second copy of the text normaliser: two copies of
// a SEARCH find one row more or fewer, which is a shrug. Two copies of a
// calculation produce a wrong number. This is the first kind.
//
// ⚠️ TWO CALLBACKS, AND THE SPLIT IS LOAD-BEARING. `onInput` fires on every
// keystroke so the caller's stored query is never stale; `onChange` is debounced
// so a large catalogue is not rebuilt letter by letter. A Firestore snapshot
// landing mid-keystroke must find the CURRENT text, not the text from 140ms ago.
//
// ⚠️ MOUNT THE NODE ONCE AND REPAINT ONLY THE LIST BELOW IT. Rebuilding this
// element on a data snapshot wipes the text and the keyboard out from under the
// person typing.

import { el } from './dom.js';

const SEARCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

export function buildCatalogueSearch({
  value = '',
  placeholder = '',
  ariaLabel = '',
  onInput,
  onChange,
  debounceMs = 140,
} = {}) {
  let debounceTimer = null;

  const input = el('input', {
    type: 'search',
    placeholder,
    'aria-label': ariaLabel,
    autocomplete: 'off',
    value,
    oninput: (e) => {
      const text = e.target.value;
      if (onInput) onInput(text);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { if (onChange) onChange(text); }, debounceMs);
    },
  });

  const node = el('div', { class: 'cat-search' }, [
    el('span', { icon: SEARCH_SVG, 'aria-hidden': 'true' }),
    input,
  ]);

  return { node, input };
}
