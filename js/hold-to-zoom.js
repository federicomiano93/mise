// hold-to-zoom.js — whole-app momentary magnifier (loaded on every page).
//
// Pinch anywhere with two fingers to magnify the WHOLE screen — any page, and any
// sub-screen or pop-up on top of it — while you hold; it springs back to normal
// the instant a finger lifts. (The browser's own pinch-zoom stays where you leave
// it; this returns to 1× on release.) Scaling the <body> means every screen and
// every overlay is covered uniformly, including ones the app builds on the fly —
// no per-element marking to keep in sync.
//
// It only reacts while TWO fingers are down, so one-finger scrolling and taps are
// untouched, and it preventDefaults the two-finger gesture (both touch events and
// the iOS `gesture*` events) so the OS pinch-zoom can't fight it.

const MAX_SCALE = 3;          // never magnify past 3×
const SNAP_BACK_MS = 200;     // spring-back duration on release
const stage = document.body;  // the whole app scales; overlays are its children

let pinching = false;
let startDist = 0;
let clearTimer = 0;

const fingerDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();                       // claim the two-finger gesture
  pinching = true;
  clearTimeout(clearTimer);
  startDist = fingerDistance(e.touches[0], e.touches[1]) || 1;
  // Zoom toward the point between the fingers (viewport coords map onto <body>).
  const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  stage.style.transformOrigin = `${mx}px ${my}px`;
  stage.style.transition = 'none';          // follow the fingers with no lag
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  if (!pinching || e.touches.length !== 2) return;
  e.preventDefault();
  const ratio = fingerDistance(e.touches[0], e.touches[1]) / startDist;
  stage.style.transform = `scale(${Math.min(MAX_SCALE, Math.max(1, ratio))})`;
}, { passive: false });

function release(e) {
  if (!pinching || e.touches.length >= 2) return;  // still pinching with 2 fingers
  pinching = false;
  stage.style.transition = `transform ${SNAP_BACK_MS}ms ease`;
  stage.style.transform = 'scale(1)';        // spring back to normal
  // Once settled, drop the inline transform entirely so <body> carries none at
  // rest — a lingering transform would make position:fixed overlays resolve
  // against <body> instead of the viewport.
  clearTimer = setTimeout(() => {
    if (!pinching) {
      stage.style.transform = '';
      stage.style.transformOrigin = '';
      stage.style.transition = '';
    }
  }, SNAP_BACK_MS + 30);
}
document.addEventListener('touchend', release);
document.addEventListener('touchcancel', release);

// iOS Safari fires its own pinch gesture events; block them so only ours runs.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
import { t } from './i18n.js';

