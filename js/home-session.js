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

import { onSession, signOutNow, switchLocation, forgetLocation, openVenuePicker } from './firebase.js';
import { sectionsFor, hasLevelAbove } from './sections.js';
import { confirmDialog } from './confirm-dialog.js';

const logoutHost = document.getElementById('session-logout-host');
const upBtn = document.getElementById('home-up-btn');

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

  // ⚠️ "Back to Misé" HAS LEFT THIS STRIP. The back arrow at the top-left of the
  // header does that job now, in the place this app puts every other way up, and
  // two doors to the same floor — one at the top and one at the bottom — are the
  // muddle Federico spotted here in the first place. The strip is also the wrong
  // place for it in practice: with five cards the Home scrolls, so anything down
  // here is below the edge of the screen until you look for it.
  //
  // ⚠️ "Switch location" STAYS for somebody with venues but no back office, and it
  // is not a leftover. With exactly two venues it jumps STRAIGHT to the other one
  // in a single tap, while the arrow steps up to the picker and costs two — two
  // different errands, "take me to the other one" and "show me everything". With
  // three it already only opens the picker, so nothing is lost by having both.
  if (!session.isAppAdmin && options.length > 1) {
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

  // ⚠️ "Businesses" IS DELIBERATELY NOT HERE ANY MORE. It moved to the Misé home
  // screen, above every venue (js/auth-gate.js hubScreen). This strip belongs to
  // ONE customer's venue — the header above it says that venue's name — and the
  // app's own customer list is not a drawer inside it. "Back to Misé" above is
  // how an administrator reaches it. Putting it back here would restore the
  // three-scopes-in-one-list problem Federico spotted on his own phone.

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

// The way up, in the header. Revealed rather than built, so it can appear the moment
// the session says there is a level above without a repaint of anything else.
//
// ⚠️ ONLY WHERE THERE IS SOMEWHERE TO GO. hasLevelAbove() is the whole guard: an
// employee with one venue has no "all my businesses" screen, and an arrow leading to
// a list of one is a control that appears to be broken.
function renderUpArrow(session) {
  if (!upBtn) return;
  const show = hasLevelAbove({ isAppAdmin: session.isAppAdmin, options: session.options });
  upBtn.hidden = !show;
  if (show && !upBtn.dataset.wired) {
    upBtn.dataset.wired = '1';
    // ⚠️ NO CONFIRMATION, and that is checked rather than assumed: stepping UP clears
    // nothing. The local cache is only wiped when a DIFFERENT venue is entered, which
    // enterLocation decides for itself. "Switch location" warns because it really does
    // clear; warning here would teach people to tap through a dialog that never means
    // anything, which is how the one that matters stops being read.
    upBtn.addEventListener('click', () => openVenuePicker());
  }
}

onSession(session => {
  if (session.status !== 'ready') return;
  filterCards(session.location, session.role);
  renderUpArrow(session);
  renderSessionActions(session);
});
