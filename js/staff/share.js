// share.js — the two ways this app hands a link to a person: the clipboard, and
// WhatsApp.
//
// ⚠️ IT EXISTS TO STOP A FOURTH COPY. The raced clipboard write was already
// written out three times (js/calculator-settings.js, and both screens in this
// folder) when "Who can get in" needed it too. The Calculator's copy has to stay
// where it is — a feature must never import from another feature's folder — but
// the three inside js/staff/ are one screen's worth of the same errand, and this
// project already keeps a test whose whole job is watching copies drift
// (tests/copie-allineate.test.mjs). One fewer thing for it to watch.
//
// ⚠️ WHATSAPP AND NOT navigator.share(). The platform API is the right instinct
// (P19) and it is genuinely better where it exists — but this app sends every
// order, every client link and every supplier message through wa.me already, so
// a second mechanism here would behave differently on the same phone for the same
// errand. When the whole app moves, this moves with it.

// ⚠️ RACED AGAINST A CLOCK, NEVER AWAITED ON ITS OWN.
// navigator.clipboard.writeText() can sit there and never settle — the page
// losing focus is enough — and it stands between minting an invitation and the
// owner being shown it. Observed for real on the client ordering link (v1.29.1).
const CLIPBOARD_WAIT_MS = 2000;

export async function copyToClipboard(text) {
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS)),
    ]);
  } catch {
    return false;   // an old browser, a denied permission, an insecure origin
  }
}

// Open WhatsApp with the message already written, and no recipient — the sender
// picks the person in WhatsApp, where their contacts are.
//
// ⚠️ 'noopener' MATTERS EVEN FOR A SITE WE TRUST. Without it the page that opens
// gets a handle on this one through window.opener and can navigate it somewhere
// else, and this app is one an owner is signed into.
export function sendOnWhatsApp(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
