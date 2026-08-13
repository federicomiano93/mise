// The words written straight into the HTML — page headers, the Home cards, the
// titles of the overlays declared in calculator.html.
//
// ⚠️ THE ENGLISH STAYS IN THE MARKUP AND IS NOT REPLACED BY A KEY. Two reasons,
// and both matter more than tidiness:
//
//   1. If this script never runs — a syntax error somewhere else on the page, a
//      module that fails to load — the screen shows English rather than a row of
//      dotted identifiers. The failure degrades to the old behaviour instead of
//      to nonsense.
//   2. The markup stays readable, and a diff of it stays reviewable.
//
// ⚠️ AND IT RUNS BEFORE THE FIRST PAINT, from the <head>, for the same reason
// splash-init.js does: a heading that changes language a moment after the screen
// appears is worse than one that never changes at all.

import { t, onLanguageChange } from './i18n.js';

// Every element carrying data-i18n gets its text replaced. An element may also
// carry data-i18n-attr="placeholder" (or any attribute name) to have that
// attribute translated instead of the text — a placeholder is read by exactly
// the same person as the label above it.
export function applyStaticText(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    const attr = el.getAttribute('data-i18n-attr');
    const value = t(key);
    // ⚠️ t() answers with the KEY when nothing defines it, on purpose. Writing
    // that into the page would replace a working English heading with
    // "calc.something" — so a key that resolves to itself is left alone and the
    // markup's own English survives.
    if (value === key) continue;
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  }
}

// ⚠️ AND AGAIN WHENEVER THE LANGUAGE CHANGES. These words are written once, at
// load; the venue's own language arrives later, with the session. Without this
// the app switched to Italian everywhere EXCEPT the page header and the Home
// cards — found by driving the switch and reading what came back.
onLanguageChange(() => applyStaticText());

// Run as soon as the DOM has the elements, and never later than that.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyStaticText(), { once: true });
  } else {
    applyStaticText();
  }
}
