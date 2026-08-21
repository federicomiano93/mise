// Keep a PHONE upright; let a TABLET turn.
//
// The manifest used to say `"orientation": "portrait"`, which is a single global
// answer: it kept phones upright and, in exchange, made the app unusable in the
// one position a tablet actually lives in — flat on a stand in a kitchen, landscape.
// Federico's instruction (21 Aug 2026): phone portrait only, tablet free to rotate,
// "and on a tablet it will mostly be used in landscape".
//
// A manifest cannot tell the two apart, so the manifest now says nothing and the
// distinction is made here, once, at startup.
//
// ⚠️ WHAT THIS CANNOT DO, AND WHY THAT IS SAFE.
// `screen.orientation.lock()` DOES NOT EXIST on iOS Safari — not on iPhone and not
// on iPad. It also throws outside an installed/fullscreen context on Android. So on
// an iPhone this call does nothing at all and the phone WILL be able to rotate.
// That is acceptable — and it is why the width work shipped in the same change:
// a phone in landscape is 844px wide and gets the same centred column a tablet
// gets (see --app-max-width in tokens.css), so the layout is correct either way.
// This lock is a courtesy where the platform allows it, never something the layout
// depends on. If it silently fails, nothing breaks.

// The short side of the screen, in CSS pixels, at or below which we treat the
// device as a phone. Derived, not invented: the widest phone sold (iPhone 16 Pro
// Max) is 440px, and the narrowest common tablet (iPad mini) is 744px. 600 sits in
// the empty space between the two, and is the same boundary the CSS uses to decide
// that the content column has room to be capped.
export const PHONE_MAX_SHORT_SIDE = 600;

// PURE: given the screen's short side, should this device be held upright?
// Anything unreadable is treated as a tablet — i.e. we do NOT lock. Failing this
// way round is deliberate: a wrongly locked tablet is a device somebody cannot use
// on its stand, while an unlocked phone merely rotates and still lays out correctly.
export function shouldLockPortrait(shortSideCssPx) {
  const n = Number(shortSideCssPx);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n <= PHONE_MAX_SHORT_SIDE;
}

// PURE: the screen's short side, from whatever the platform reports.
export function shortSideOf(screenLike) {
  if (!screenLike) return NaN;
  const w = Number(screenLike.width), h = Number(screenLike.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return NaN;
  return Math.min(w, h);
}

export function applyOrientationLock(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || !win.screen || !win.screen.orientation) return 'unsupported';
  if (typeof win.screen.orientation.lock !== 'function') return 'unsupported';
  if (!shouldLockPortrait(shortSideOf(win.screen))) return 'tablet';
  try {
    const result = win.screen.orientation.lock('portrait');
    // Chromium returns a promise that REJECTS outside an installed context. Left
    // unhandled that is an "Uncaught (in promise)" in the console of every phone
    // browsing the site normally, which is noise that hides real errors.
    if (result && typeof result.catch === 'function') result.catch(() => {});
    return 'locked';
  } catch (e) {
    return 'refused'; // not installed, or the platform simply says no
  }
}

applyOrientationLock();
