// Idle reset: after the app has been in the background longer than the limit,
// send the user back to the home screen on return. Keeps navigation predictable
// after a real break, while a quick app switch leaves the page where it was.
// Saved data (confirmed recipe, autosaved orders) is untouched — only navigation resets.

const IDLE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = 'lastHiddenAt';
const HOME_URL = 'index.html';

function markHidden() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch (e) {
    // localStorage may be unavailable (private mode/quota) — fail safe: do nothing.
  }
}

function resetIfIdle() {
  let hiddenAt;
  try {
    hiddenAt = Number(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return; // storage unreadable — leave the page as is
  }
  if (!hiddenAt) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // ignore
  }

  if (Date.now() - hiddenAt <= IDLE_LIMIT_MS) return;

  // Never navigate out from under an open confirmation. The question on screen was
  // asked BEFORE the app went to the background, so it is waiting for an answer the
  // user has not given yet; replacing the page answers it for them, silently.
  //
  // This is not hypothetical. Sending an order on WhatsApp raises "Order sent — mark
  // as placed?" and opens WhatsApp in the same gesture, so the app goes to the
  // background with that dialog open by design. Spend more than the idle limit
  // writing to the supplier and, without this guard, you come back to the Home screen
  // and the order is never recorded — which is exactly the "sometimes it doesn't ask
  // me" report. Reproduced: 2 minutes away and the dialog survives, 6 minutes and it
  // is gone with the page.
  if (document.querySelector('.app-dialog')) return;

  // replace() so the stale page is not left in history (no "back" to it)
  location.replace(HOME_URL);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    markHidden();
  } else if (document.visibilityState === 'visible') {
    resetIfIdle();
  }
});

// iOS standalone PWAs restore from the back/forward cache on resume — pageshow
// with persisted=true catches the cases visibilitychange can miss.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) resetIfIdle();
});
