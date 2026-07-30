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
// Three rules, and the first is the one that is easy to get wrong:
//
//   1. NOTHING ON A FIRST RUN. With no stamp stored we cannot tell a brand-new
//      phone from one that has been here for months, so we say nothing and let the
//      caller record the current stamp. Guessing wrong the other way greets someone
//      opening the app for the first time with a list of changes to an app they
//      have never seen.
//   2. Everything missed, not just the last one. Skipping two releases while a
//      phone sat unopened must not silently swallow the older note.
//   3. A stamp we do not recognise (a rolled-back release, a hand-edited value)
//      shows the latest note only — never the whole history.
export function pickNotices(releases, seenId) {
  const list = releases || [];
  if (!list.length || !seenId) return [];

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
