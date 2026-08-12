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

import { onSession, signOutNow, switchLocation, forgetLocation } from './firebase.js';
import { sectionsFor } from './sections.js';
import { confirmDialog } from './confirm-dialog.js';

const logoutHost = document.getElementById('session-logout-host');

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
function filterCards(location, role) {
  // ⚠️ THE ROLE NARROWS THIS TOO, so a card is not drawn for a screen the person
  // would be refused on. It is still only courtesy — the rules refuse the data
  // itself — but a card that opens onto permission errors teaches people the app
  // is broken rather than that they lack the permission.
  const allowed = sectionsFor(location, role);
  document.querySelectorAll('.home-card[data-section]').forEach(card => {
    if (allowed[card.dataset.section] === false) card.remove();
  });
}

// The bottom of the Home, after the cards, in quiet type. Both actions here are
// rare and neither is what anyone opened the app to do — the location's name
// says where you are from the green header, which is the part that has to be
// seen without looking for it.
function renderSessionActions(session) {
  if (!logoutHost) return;
  logoutHost.textContent = '';

  const options = session.options || [];
  if (options.length > 1) {
    logoutHost.append(button('Switch location', 'session-logout', async () => {
      const other = options.filter(id => id !== session.locationId);
      const names = session.optionNames || {};
      const cleared = 'Anything typed but not saved on this device is cleared.';
      // One other location is unambiguous, so name it and go straight there.
      // More than one and the app cannot pick for you: forget the remembered
      // location so the reload comes back to the picker.
      const ok = await confirmDialog({
        title: 'Switch location?',
        message: other.length === 1
          ? `Open ${names[other[0]] || other[0]} instead of ${session.name}?\n\n${cleared}`
          : `Choose a different location?\n\n${cleared}`,
        okLabel: 'Switch',
      });
      if (!ok) return;
      if (other.length === 1) switchLocation(other[0]);
      else forgetLocation();
    }));
  }

  // ⚠️ OWNERS ONLY, and it lives here with Switch location and Log out rather
  // than as a card. It is a rare, administrative errand — nobody opens the app
  // to manage staff — so it belongs in the quiet strip at the bottom, not
  // competing with the work (P20). Drawing it for staff would be an invitation
  // to a screen where every button is refused.
  if (session.isOwner) {
    logoutHost.append(button('Who can get in', 'session-logout', async () => {
      const { openPeople } = await import('./staff/people.js');
      openPeople(session.user && session.user.uid);
    }));
  }

  // ⚠️ A DIFFERENT QUESTION FROM isOwner, and reading one for the other would
  // offer every customer's owner the power to create businesses. This is the
  // APP's administrator — one document in admins/{uid}, which the server checks
  // again on every call and never takes from here.
  //
  // ⚠️ IT LEADS TO A SCREEN RATHER THAN DOING SOMETHING. "New customer" used to
  // act from here, and Federico spotted the problem on his own phone: the Home
  // belongs to a VENUE — its header says the venue's name — so an action about
  // the app's own customers sat between one about this venue and one about your
  // account. Three scopes in one list. One door instead, and what is behind it
  // is about the product.
  if (session.isAppAdmin) {
    logoutHost.append(button('Businesses', 'session-logout', async () => {
      const { openBusinesses } = await import('./staff/businesses.js');
      openBusinesses();
    }));
  }

  logoutHost.append(button('Log out', 'session-logout', async () => {
    const ok = await confirmDialog({
      title: 'Log out?',
      message: 'You will need your email and password to get back in.',
      okLabel: 'Log out',
      danger: true,
    });
    if (ok) signOutNow();
  }));
}

onSession(session => {
  if (session.status !== 'ready') return;
  filterCards(session.location, session.role);
  renderSessionActions(session);
});
