// install-version.js — tells somebody when their INSTALLED app was built from an older
// manifest, and therefore has to be deleted and added again.
//
// ⚠️⚠️ WHY THIS EXISTS, AND IT COST A REAL EVENING. On 21 Aug 2026 the manifest lost
// `"orientation": "portrait"`, so a tablet could finally be used on its stand. The
// change went live, the tablet updated its CODE — and stayed locked upright anyway.
//
// **A MANIFEST IS READ WHEN THE APP IS INSTALLED, NOT WHEN IT UPDATES.** Android builds
// a small wrapper around the site at install time and applies `orientation`, `display`,
// `name`, `start_url` and the icons from the manifest it saw THEN. Publishing a new
// manifest changes what a NEW installation gets; an existing one keeps what it has,
// however many updates it receives. Chrome does eventually rebuild that wrapper on its
// own — but it takes days and cannot be asked to hurry.
//
// So the app has no way to fix itself, and the only cure is a re-install. What it CAN
// do is notice, and say so, instead of leaving somebody to discover it by turning their
// tablet and finding the screen sideways.
//
// ⚠️ WHAT THIS IS NOT. It does not detect "your app is out of date" — js/sw-update.js
// already does that for the CODE, and does it properly. This is only about the wrapper,
// which no update can touch.

const KEY = 'installed-manifest-fingerprint';

// ⚠️ ONLY THE FIELDS THAT A RE-INSTALL IS REQUIRED FOR. `description` and
// `background_color` can change freely — they cost nothing and must never raise a
// notice, or the notice becomes noise and stops being read.
export const FIELDS_NEEDING_REINSTALL = Object.freeze([
  'name', 'short_name', 'start_url', 'display', 'orientation', 'scope',
]);

// PURE: a short, stable fingerprint of exactly those fields plus the icon sources.
// Stable means: the same manifest always gives the same string, whatever order the keys
// arrive in — a JSON file re-saved by a different tool must not look like a change.
export function fingerprint(manifest) {
  if (!manifest || typeof manifest !== 'object') return '';
  const parts = FIELDS_NEEDING_REINSTALL.map(f => `${f}=${manifest[f] === undefined ? '' : String(manifest[f])}`);
  const icons = Array.isArray(manifest.icons)
    ? manifest.icons.map(i => `${i && i.src || ''}|${i && i.sizes || ''}|${i && i.purpose || ''}`).sort()
    : [];
  return [...parts, `icons=${icons.join(',')}`].join(';');
}

// PURE: should this device be told to re-install?
//
// ⚠️ THE FIRST RUN NEVER WARNS, and that is the whole design. With no stored
// fingerprint there is nothing to compare against: the honest answer is "record it and
// say nothing". Warning on a blank would fire on every fresh install, on every phone
// whose storage was cleared, and on the first run after this feature ships — three
// populations who have nothing to fix. A notice that is sometimes wrong is worse than
// no notice, because the next one is not believed either.
export function shouldWarn({ stored, current, standalone }) {
  if (!standalone) return false;          // in a browser tab the manifest does not apply
  if (!current) return false;             // could not read it — never guess
  if (!stored) return false;              // first run: nothing to compare
  return stored !== current;
}

export function readStored(storage) {
  try { return storage.getItem(KEY) || ''; } catch { return ''; }
}

export function writeStored(storage, value) {
  try { storage.setItem(KEY, value); return true; } catch { return false; }
}

// Is this the installed app rather than a browser tab? Both spellings are needed:
// `standalone` is Safari's, the media query is everybody else's.
export function isStandalone(win) {
  if (!win) return false;
  if (win.navigator && win.navigator.standalone === true) return true;
  try { return !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches); }
  catch { return false; }
}

// The whole decision, with the pieces passed in so it can be asserted under Node.
//
// ⚠️ IT DECIDES; IT DOES NOT ANNOUNCE, AND IT ONLY RECORDS WHEN THERE IS NOTHING TO
// SAY. The caller has to wait for the sign-in cover to come down before it can show
// anything (see install-version-boot.js), and recording the new fingerprint before
// that wait would throw the notice away unread — the person closes the app on the
// sign-in screen, and the one message telling them to re-install is spent. Exactly the
// trap js/whats-new-boot.js documents at its own writeSeen() call.
//
// When there is nothing to say the record is made here, immediately: silent adoption
// has nothing to lose. When there IS, `adopt()` comes back for the caller to run at
// the moment the dialog opens.
export async function checkInstall({ win, storage, fetchManifest }) {
  const standalone = isStandalone(win);
  let current = '';
  try {
    const manifest = await fetchManifest();
    current = fingerprint(manifest);
  } catch {
    return { warn: false, reason: 'unreadable', adopt: () => {} };
  }
  if (!current) return { warn: false, reason: 'unreadable', adopt: () => {} };

  const stored = readStored(storage);
  const warn = shouldWarn({ stored, current, standalone });

  // ⚠️ ADOPTED WHATEVER HAPPENS, INCLUDING WHEN WARNING — just not necessarily yet.
  // Leaving the old value would repeat the notice on every single open until the
  // person re-installs, which is nagging, and the surest way to get it ignored.
  const adopt = () => { if (standalone) writeStored(storage, current); };
  if (!warn) adopt();

  return { warn, reason: warn ? 'manifest-changed' : (stored ? 'same' : 'first-run'), stored, current, adopt };
}
