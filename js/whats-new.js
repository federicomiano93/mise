// whats-new.js — what to tell the operator after an update, and whether to tell
// them anything at all. PURE: no DOM, no storage, so the decision can be asserted
// in a test instead of being reasoned about (P15). The wiring lives in
// whats-new-boot.js.
//
// WHY THE NOTES LIVE IN THE CODE. They describe the version that is running, so
// they ship in the SAME commit as the change they describe. Kept in Firestore
// instead they would cost a read on every app open (P14), stop working offline,
// and — worst — could describe a version the phone has not installed yet, because
// data updates instantly while code rolls out per device.
//
// WHAT EARNS AN ENTRY. Only a change to how the app is USED. Fixes, speed-ups and
// internal work get none, and then nothing interrupts anybody. An entry that says
// "improved reliability" is worse than no entry: it costs a tap and says nothing.

// Newest FIRST. `id` is a stamp that never changes once released — it is what a
// phone remembers having read, so editing one would re-show that notice to
// everyone. To correct a released note, add a new entry.
export const RELEASES = [
  {
    id: '2026-07-31-history-window',
    title: 'Orders',
    points: [
      'History opens on the last 15 days, so this week\'s orders are the ones on screen.',
      'Nothing has been deleted: tap "Show older orders" at the bottom of the list.',
      'Change how far back it opens in Settings → General.',
    ],
  },
  {
    id: '2026-07-30-sign-in',
    title: 'Sign in',
    points: [
      'The app now asks for an email and a password. You stay signed in — it is not every day.',
      'Forgot it? Tap "Forgot your password?" on the sign-in screen and check your email.',
      'The Home screen shows which location you are working on, above the cards.',
      'Each location sees only its own suppliers, ingredients, orders and recipes.',
    ],
  },
  {
    id: '2026-07-29-orders-search',
    title: 'Orders',
    // Short on purpose. A notice is read standing up, once — anything that needs
    // scrolling to finish will not be finished.
    points: [
      'Find an ingredient by name: tap "All ingredients". No need to know its supplier.',
      'Ingredients with no supplier (supermarket, cash & carry) can now be added and ordered.',
      'Send the order as one flat shopping list, or split by supplier as before.',
      'The bar at the bottom shows what is in the order — tap it to review just those items.',
    ],
  },
];

export function newestId(releases = RELEASES) {
  return releases?.[0]?.id || '';
}

// Which notices this phone has not read yet, newest first.
//
// `returning` answers "has this app been opened on this device before?" and is
// consulted ONLY when there is no stamp, which is the one genuinely ambiguous case:
//
//   * a phone that has used the app for months and simply never had this feature —
//     it should see the latest note, otherwise the very first release of the
//     feature would tell nobody anything and the notices would not begin until the
//     release after that;
//   * a phone opening the app for the FIRST time — it must see nothing, because a
//     list of changes to an app you have never used is noise, not news.
//
// The other two rules:
//   * everything missed, not just the last one — two releases skipped while a phone
//     sat unopened must not silently swallow the older note;
//   * a stamp nobody recognises (a rolled-back release, a hand-edited value) shows
//     the latest note only, never the whole history.
export function pickNotices(releases, seenId, returning = false) {
  const list = releases || [];
  if (!list.length) return [];
  if (!seenId) return returning ? [list[0]] : [];

  const index = list.findIndex(r => r.id === seenId);
  if (index === -1) return [list[0]];
  return list.slice(0, index);          // index 0 = already up to date = []
}

// The notices as the one block of text the dialog shows. The area heading is kept
// even for a single notice: knowing the change is in Orders is half the message.
// Plain text with real newlines — .app-dialog-msg renders them (white-space:
// pre-line) and the dialog sets it with textContent, so nothing here is markup.
export function noticeText(notices) {
  return (notices || [])
    .filter(n => n && (n.points || []).length)
    .map(n => [n.title, ...n.points.map(p => `• ${p}`)].filter(Boolean).join('\n'))
    .join('\n\n');
}
