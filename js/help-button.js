// help-button.js — the small "?" in a screen's header, and what it opens.
//
// One module, loaded by every page. It fills any element marked `data-help="<id>"`
// with a round ? button and shows that screen's explanation in the app's own dialog.
//
// ⚠️ THE PAGE SAYS WHERE IT GOES, not this file. Every screen's header is built
// differently — three fixed slots on the catalogue, a flex row on Orders, a plain
// heading on the Home — so a module that tried to guess a position would be wrong
// somewhere and would break the centring of a title somewhere else. The page puts an
// empty host exactly where the button belongs; this fills it. A page with no host
// simply has no button, which is a missing explanation and never a broken header.
//
// It reuses the app's ONE dialog rather than inventing a panel: the explanation
// inherits the focus trap, Escape, the backdrop and the screen-reader naming that
// dialog already has, and there is no second component to keep in step.

import { t } from './i18n.js';
import { alertDialog } from './confirm-dialog.js';
import { helpText, helpTitle, helpFor } from './help-content.js';

// 24×24 box, stroked, 2px, round caps, currentColor — the app's icon convention.
// Built with createElementNS because the page CSP forbids innerHTML here.
const SVG_NS = 'http://www.w3.org/2000/svg';

function questionIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');

  const hook = document.createElementNS(SVG_NS, 'path');
  hook.setAttribute('d', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3');

  const dot = document.createElementNS(SVG_NS, 'path');
  dot.setAttribute('d', 'M12 17h.01');

  svg.append(circle, hook, dot);
  return svg;
}

export function showHelp(id) {
  const entry = helpFor(id);
  if (!entry) return Promise.resolve();
  // "Got it" rather than "OK": nothing has been decided or agreed to, and a button
  // that sounds like a decision on a screen that only explains makes people hesitate.
  return alertDialog(helpText(id), { title: helpTitle(id), okLabel: t('help.gotIt') });
}

function build(id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-btn';
  // The label names the SCREEN, so a screen reader announces "What is Food cost?"
  // rather than a bare question mark repeated on every page.
  button.setAttribute('aria-label', `What is ${helpTitle(id)}?`);
  button.append(questionIcon());
  button.addEventListener('click', () => showHelp(id));
  return button;
}

// Fill every host on the page. Called on load, and exported so a screen that builds
// its header later can ask for its own button when it is ready.
export function mountHelpButtons(root = document) {
  root.querySelectorAll('[data-help]').forEach(host => {
    if (host.querySelector('.help-btn')) return; // already mounted
    const id = host.dataset.help;
    if (!helpFor(id)) {
      // A host naming a screen with no text is a mistake worth seeing in the console
      // rather than a button that opens nothing.
      console.warn(`No help written for "${id}" — see js/help-content.js`);
      return;
    }
    // PREPENDED, not appended. On the catalogue and Pastries the host is the slot
    // that already holds that screen's own action, and the action must keep the far
    // edge it has always had — the "?" goes on the inside of it, so nothing a person
    // already reaches for moves.
    host.prepend(build(id));
  });
}

mountHelpButtons();
