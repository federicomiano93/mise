// location-title.js — put the LOCATION's name in the green header band.
//
// The app used to be one bakery, so its own name was hardcoded in the header of
// every page. With a second place joining, a header that says "The Italian Club"
// above The Italian Club Bakery's data is at best noise and at worst a reason to
// order for the wrong place.
//
// Opt-in per page, via `data-location-title` on the heading: the Home and the
// Calculator name the place, while Orders says "Orders" and the Catalogue says
// "Recipes" — those headings describe the SCREEN, and replacing them would lose
// what the page is.
//
// There is no flash of the old text: the sign-in cover is opaque over the whole
// page until a location is open, and this runs on that same signal.

import { onSession } from './firebase.js';

onSession(session => {
  if (session.status !== 'ready') return;
  const name = session.name || session.locationId;
  if (!name) return;
  document.querySelectorAll('[data-location-title]').forEach(el => {
    el.textContent = name;
  });
});
