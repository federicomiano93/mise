// home-session.js — the Home screen's session strip, and the card filter.
//
// Two jobs:
//   1. Say WHICH LOCATION you are working on, always, in words. With more than
//      one location, placing an order for the wrong one is the worst mistake
//      this app can let a person make, and it is invisible until the delivery
//      turns up somewhere else.
//   2. Show only the cards that location uses. The rules refuse the rest
//      anyway; this is so nobody taps into a screen that will only ever show
//      permission errors.
//
// Log out sits here too, deliberately quiet next to the location name (P20:
// a destructive action never competes with the thing you actually came to do).

import { onSession, signOutNow, switchLocation } from './firebase.js';
import { allowedSections } from './sections.js';
import { confirmDialog } from './confirm-dialog.js';

const host = document.getElementById('session-host');

function button(label, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

// Hide the cards this location does not use. The cards are static HTML with a
// data-section, so this only ever REMOVES — a location with everything on gets
// the markup exactly as written.
function filterCards(location) {
  const allowed = allowedSections(location);
  document.querySelectorAll('.home-card[data-section]').forEach(card => {
    if (allowed[card.dataset.section] === false) card.remove();
  });
}

function renderSessionBar(session) {
  if (!host) return;
  host.textContent = '';

  const bar = document.createElement('div');
  bar.className = 'session-bar';

  const name = document.createElement('span');
  name.className = 'session-name';
  name.textContent = session.name || session.locationId || '';
  bar.append(name);

  // Only worth showing when there is somewhere else to go.
  if ((session.options || []).length > 1) {
    bar.append(button('Switch location', 'session-action', async () => {
      const other = session.options.filter(id => id !== session.locationId);
      const target = other.length === 1 ? other[0] : null;
      if (!target) { location.reload(); return; }
      // Names, never database ids — this dialog is the last thing between you and
      // working in the wrong location, so it has to read like a sentence.
      const names = session.optionNames || {};
      const ok = await confirmDialog({
        title: 'Switch location?',
        message: `Open ${names[target] || target} instead of ${session.name}?\n\n`
          + 'Anything typed but not saved on this device is cleared.',
        okLabel: 'Switch',
      });
      if (ok) switchLocation(target);
    }));
  }

  bar.append(button('Log out', 'session-action session-action--quiet', async () => {
    const ok = await confirmDialog({
      title: 'Log out?',
      message: 'You will need your email and password to get back in.',
      okLabel: 'Log out',
      danger: true,
    });
    if (ok) signOutNow();
  }));

  host.append(bar);
}

onSession(session => {
  if (session.status !== 'ready') return;
  filterCards(session.location);
  renderSessionBar(session);
});
