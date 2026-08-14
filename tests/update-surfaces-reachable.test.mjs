// The update must stay tappable while the sign-in cover is up.
//
// ⚠️ THIS IS A SOURCE-LEVEL TEST ON PURPOSE, and it is the only kind that can
// catch this. The fault lives in the agreement between TWO files — js/sw-update.js
// decides what it puts on the page, js/auth-gate.js decides what survives `inert`
// — and each half is correct on its own. No behaviour test reaches it either:
// the trap only appears when a real service-worker update meets a real sign-in
// cover, which needs a browser and a second version of the app.
//
// WHAT IT PREVENTS, reported from a phone: "it goes back to the update screen but
// the button will not click, I have to close the app completely." Measured on the
// rendered page, the button was visible, enabled, pointer-events auto, at z-index
// 10001 and fully on screen — and carrying `inert`, so the tap went straight to
// the sign-in form underneath. The banner had been exempted; the modal that
// REPLACES the banner had not.
//
// ⚠️ It was intermittent, because setBehindInert() walks the body's children at
// the moment it runs — so whether the modal is caught depends on a race. A test
// that only ever saw the lucky ordering would have stayed green for ever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const authGate = readFileSync(new URL('../js/auth-gate.js', import.meta.url), 'utf8');
const swUpdate = readFileSync(new URL('../js/sw-update.js', import.meta.url), 'utf8');

function exemptIds() {
  const m = authGate.match(/const ALWAYS_REACHABLE\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'ALWAYS_REACHABLE not found in js/auth-gate.js — has it been renamed?');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

// Every element js/sw-update.js attaches directly to <body>, by the id it gives it.
// Anything nested inside one of those is covered by its parent's exemption.
function idsAttachedToBody() {
  const vars = [...swUpdate.matchAll(/document\.body\.appendChild\((\w+)\)/g)].map(x => x[1]);
  assert.ok(vars.length > 0, 'nothing is appended to document.body — has the file changed shape?');
  return vars.map(name => {
    const m = swUpdate.match(new RegExp(`\\b${name}\\.id\\s*=\\s*'([^']+)'`));
    assert.ok(m, `js/sw-update.js appends "${name}" to <body> but never gives it an id`);
    return m[1];
  });
}

// ── ⚠️ THE ONE THAT MATTERS ──────────────────────────────────────────────────

test('⚠️ everything the update puts on the page survives the sign-in cover', () => {
  const exempt = exemptIds();
  for (const id of idsAttachedToBody()) {
    assert.ok(
      exempt.includes(id),
      `js/sw-update.js attaches #${id} to <body>, but js/auth-gate.js does not exempt it ` +
      `from inert (ALWAYS_REACHABLE = ${JSON.stringify(exempt)}). It will be drawn on top ` +
      `of the sign-in cover and be completely untappable — the exact trap reported from a ` +
      `phone as "the button will not click".`
    );
  }
});

// ⚠️ NAMED EXPLICITLY AS WELL, so that gutting sw-update.js cannot make the check
// above pass by finding nothing to check. A test that is satisfied by an empty
// list is a test that stops working the day the code it guards is refactored.
test('both update surfaces are named, banner AND modal', () => {
  const exempt = exemptIds();
  assert.ok(exempt.includes('sw-update-host'), 'the banner must stay reachable');
  assert.ok(exempt.includes('sw-update-gate'), 'the modal must stay reachable');
});

// ⚠️ THE MODAL REPLACES THE BANNER — that is what turned one exemption into none.
// If this line ever goes away the coupling is looser and the test above is enough;
// while it is here, both ids are load-bearing together.
test('the modal really does remove the banner, which is why both must be exempt', () => {
  assert.match(
    swUpdate,
    /getElementById\('sw-update-host'\)\?\.remove\(\)/,
    'showGate no longer removes the banner — re-read whether both exemptions are still needed'
  );
});

// ── The exemption is a door in the cover, so it stays deliberately small ─────

// ⚠️ THE COVER EXISTS SO A LOCATION'S DATA IS NEVER PAINTED FOR WHOEVER IS HOLDING
// THE PHONE. Anything exempted from inert sits in front of the sign-in form and can
// take a tap, so the list may only hold things whose single action is to reload.
// A screen that shows or asks for anything must WAIT instead (js/whats-new-boot.js).
test('the exemption list stays small and deliberate', () => {
  const exempt = exemptIds();
  assert.deepEqual(
    [...exempt].sort(),
    ['auth-gate', 'sw-update-gate', 'sw-update-host'],
    'ALWAYS_REACHABLE changed. Every entry sits IN FRONT of the sign-in form and can ' +
    'be tapped before anybody has signed in, so adding one is a security decision, ' +
    'not a layout one.'
  );
});
