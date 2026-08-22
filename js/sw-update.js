// sw-update.js — the ONE place the service worker is registered and updates are
// surfaced, shared by every page (index, calculator, orders, catalogue).
//
// Why this exists: update handling used to live only in the Calculator's app.js,
// so a phone that opened Home/Catalogue/Orders never learned a new version was
// out — and sw.js self-activated on install (skipWaiting), which meant the
// "waiting worker" state the banner relied on almost never happened. The result
// was phones stuck on stale versions with no way to know (the recurring
// "I see the app, they don't see my changes" bug).
//
// The flow follows the standard PWA update-prompt pattern:
//   1. A new sw.js installs in the background and WAITS (no self-activation).
//   2. This module detects the waiting worker and says so.
//   3. The user taps → we message the worker to take over → one reload → fresh.
//
// UPDATING IS NOW COMPULSORY (31 Jul 2026). The banner alone could be ignored for
// ever, and being months behind is not untidiness: rules reach every device the
// instant they deploy while code arrives one device at a time, so an old phone can
// end up with an app that disagrees with the database about what is allowed (it
// happened in v1.11.0). So the banner is now only the first, gentle signal — a
// modal that cannot be dismissed follows.
//
// Two deliberate softenings, both Federico's call, both about a kitchen mid-service:
//   * the modal WAITS while something is half-done (a dialog open, a form being
//     typed into) — see BUSY_SELECTORS in update-gate.js;
//   * after two failed attempts it offers a quiet way to carry on, and asks again
//     next time the app is opened.
// The decision itself is pure and tested in js/update-gate.js; this file is only
// the screen.
//
// Update checks run when the page loads, whenever the app returns to the
// foreground (the case that matters for an installed PWA on a phone), and on a
// slow interval as a fallback for a tablet left open all day.

import { t } from './i18n.js';
import {
  updateGateState, isBusy, readAttempts, bumpAttempts, resetAttempts,
} from './update-gate.js';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
// A keystroke may have queued the Orders draft autosave (800ms debounce). Reloading
// the instant the worker takes over could beat it; a second's grace cannot.
const RELOAD_GRACE_MS = 1000;
// If the takeover stalls (e.g. the waiting worker was already gone), reload anyway.
const TAKEOVER_TIMEOUT_MS = 4000;

let dismissed = false;   // "carry on" chosen — for THIS page only, by design

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(watchForUpdates).catch(err =>
      console.error('Service worker registration failed:', err));
  });
}

function watchForUpdates(reg) {
  if (!reg) return;

  // A banner only makes sense when THIS page is already controlled by an older
  // worker; on the very first visit the new worker is the only one and activates
  // on its own — nothing to announce.
  const isUpdate = () => !!navigator.serviceWorker.controller;

  // Nothing waiting means the last update actually landed: forget any failed
  // attempts, so the next one starts from a clean slate.
  if (!reg.waiting) resetAttempts();

  if (reg.waiting && isUpdate()) announce(reg);

  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'installed' && isUpdate()) announce(reg);
    });
  });

  const check = () => reg.update().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, CHECK_INTERVAL_MS);
}

// The banner first (it is instant and unobtrusive), then the modal as soon as the
// operator is not in the middle of something.
function announce(reg) {
  showBanner(reg);
  scheduleGate(reg);
}

// Take over and reload. Shared by the banner and the modal so there is ONE update
// path — the part that was already working and is not worth reinventing.
function applyUpdate(reg, button) {
  if (button) {
    button.disabled = true;
    button.textContent = t('help.updating');
  }
  bumpAttempts();

  // Reload ONLY once the new worker has taken control, and only because the
  // user asked — an unguarded controllerchange reload can fire on first
  // install (clients.claim) and would yank the page out from under the user.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    setTimeout(() => window.location.reload(), RELOAD_GRACE_MS);
  }, { once: true });

  if (reg.waiting) {
    reg.waiting.postMessage({ action: 'skipWaiting' });
    setTimeout(() => window.location.reload(), TAKEOVER_TIMEOUT_MS);
  } else {
    setTimeout(() => window.location.reload(), RELOAD_GRACE_MS);
  }
}

// ⚠️⚠️ THE BANNER SITS ABOVE THE PAGE'S BOTTOM BAR, AND WITHOUT THIS IT SAT ON TOP OF
// IT. The host is `position: fixed; bottom: 0; z-index: 9999` and every bottom bar in
// this app is the last thing in normal flow, so they land on the same pixels: measured
// on the Recipe catalogue at 390×844, the banner covered all 69px of the bar and a tap
// aimed at «Settings» hit the banner instead. Every feature with a bottom bar had it.
//
// ⚠️ MEASURED, NOT LISTED BY HEIGHT. The four bars differ and would drift from any
// number written here. The geometric test is also what makes the list safe to be
// approximate: a selector that matches something NOT at the foot of the viewport
// simply contributes nothing.
//
// 📌 It is a courtesy, not a rescue: the banner is the first of two signals and the
// compulsory gate (js/update-gate.js) follows it, so nothing is lost if a bar is
// missed here. What IS lost is the one route to a screen while the banner is up —
// which for the catalogue's Settings is the only route there is.
const BOTTOM_BARS = ['.cat-footer', '.pas-footer', '.recipe-footer'];

function bottomBarHeight() {
  let tallest = 0;
  for (const selector of BOTTOM_BARS) {
    for (const bar of document.querySelectorAll(selector)) {
      if (bar.hidden || bar.offsetParent === null) continue;
      const box = bar.getBoundingClientRect();
      // Only a bar actually resting on the foot of the viewport displaces the banner.
      // One that scrolls with the page does not, and must not push the banner up over
      // content for no reason.
      if (box.height > 0 && Math.abs(box.bottom - window.innerHeight) <= 2) {
        tallest = Math.max(tallest, box.height);
      }
    }
  }
  return tallest;
}

function placeAboveBottomBar(host) {
  const height = bottomBarHeight();
  // Cleared rather than set to 0 so the stylesheet keeps ownership of the default.
  host.style.bottom = height ? `${height}px` : '';
}

// ⚠️ IT HAS TO KEEP UP: the catalogue hides its bar on every screen but the list, so a
// banner placed once would float over nothing after one tap, or drop back onto the bar
// after another. The observer is narrow (three attributes) and lives only as long as
// the banner does — which is the short window before the compulsory gate takes over.
// ⚠️ EXPORTED ONLY SO A DRIVER CAN EXERCISE THE REAL ONE. showBanner() runs only when
// a new service worker is waiting, which cannot be arranged from a test; the
// alternative is a driver that re-implements the placement, which would prove the
// driver works and nothing else. Underscored: nothing in the app may call it.
export function __keepAboveBottomBar(host) { keepAboveBottomBar(host); }

function keepAboveBottomBar(host) {
  placeAboveBottomBar(host);
  const reposition = () => {
    if (!host.isConnected) { window.removeEventListener('resize', reposition); observer.disconnect(); return; }
    placeAboveBottomBar(host);
  };
  const observer = new MutationObserver(reposition);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  window.addEventListener('resize', reposition);
}

// The banner is built here (not in each page's HTML) so no page can ship
// without it; its styles live in tokens.css because the CSP (style-src 'self')
// forbids a <style> block or a stylesheet injected from JS. Setting a property
// through the CSSOM, as placeAboveBottomBar does, is NOT what that forbids — the app
// already does it in js/app.js and js/calc.js, in production.
function showBanner(reg) {
  if (document.getElementById('sw-update-banner')) return;

  const banner = document.createElement('button');
  banner.id = 'sw-update-banner';
  banner.type = 'button';
  banner.textContent = t('help.newVersionAvailableTap');

  const host = document.createElement('div');
  host.id = 'sw-update-host';
  host.setAttribute('role', 'status');
  host.appendChild(banner);
  document.body.appendChild(host);
  keepAboveBottomBar(host);

  banner.addEventListener('click', () => applyUpdate(reg, banner));
}

// Show the modal the moment nothing is half-done. While something IS half-done we
// wait on a MutationObserver rather than a timer: the screen changing is exactly
// the event we are waiting for, and polling a kitchen tablet every second for
// hours is waste.
function scheduleGate(reg) {
  if (document.getElementById('sw-update-gate')) return;
  let observer = null;

  const attempt = () => {
    if (dismissed) { observer?.disconnect(); return true; }
    const state = updateGateState({
      waiting: true,
      busy: isBusy(document),
      attempts: readAttempts(),
    });
    if (state === 'hidden') return false;      // busy — try again when the DOM changes
    observer?.disconnect();
    showGate(reg, state === 'blocking-with-escape');
    return true;
  };

  if (attempt()) return;
  observer = new MutationObserver(attempt);
  observer.observe(document.body, { childList: true, subtree: true });
}

// The modal itself. Reuses the .app-dialog styles rather than confirmDialog(),
// because that component offers Escape and a Cancel button — both of which are
// precisely what must not exist here.
function showGate(reg, withEscape) {
  if (document.getElementById('sw-update-gate')) return;
  document.getElementById('sw-update-host')?.remove();   // the banner has done its job

  const title = document.createElement('h2');
  title.className = 'app-dialog-title';
  title.id = 'sw-update-gate-title';
  title.textContent = t('help.updateTheAppTo');

  const message = document.createElement('p');
  message.className = 'app-dialog-msg';
  message.textContent = withEscape
    ? t('help.theUpdateDidNot')
    : t('help.aNewVersionIs');

  const updateBtn = document.createElement('button');
  updateBtn.type = 'button';
  updateBtn.className = 'app-dialog-btn app-dialog-btn-solid';
  updateBtn.textContent = withEscape ? t('help.tryAgain') : t('help.updateNow');
  updateBtn.addEventListener('click', () => applyUpdate(reg, updateBtn));

  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';

  // The seatbelt: only after two failed attempts, and deliberately the quiet
  // button. A kitchen mid-service must never be left with an app it cannot use.
  if (withEscape) {
    const carryOn = document.createElement('button');
    carryOn.type = 'button';
    carryOn.className = 'app-dialog-btn app-dialog-btn-ghost';
    carryOn.textContent = t('help.continueWithoutUpdating');
    carryOn.addEventListener('click', () => {
      dismissed = true;
      gate.remove();
      showBanner(reg);        // still visible, still one tap away
    });
    actions.appendChild(carryOn);
  }
  actions.appendChild(updateBtn);

  const panel = document.createElement('div');
  panel.className = 'app-dialog';
  panel.append(title, message, actions);

  const gate = document.createElement('div');
  gate.id = 'sw-update-gate';
  gate.className = 'app-dialog-backdrop';
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'sw-update-gate-title');
  gate.appendChild(panel);

  // Keep the keyboard inside the modal, and swallow Escape — there is no dismissing
  // this except through one of its buttons (P18: it must still be operable by
  // keyboard, it just must not be escapable).
  gate.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...gate.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const moving = event.shiftKey ? first : last;
    if (document.activeElement === moving) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });

  document.body.appendChild(gate);
  updateBtn.focus();
}
