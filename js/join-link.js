// join-link.js — how a join code TRAVELS: as six digits read aloud, or as a link.
//
// ⚠️ WHY THIS IS NOT IN join-code.js. That file is copied byte-for-byte into
// functions/ and pinned by a test, because the limits that make six digits safe
// are only safe together. Nothing here is ever asked on the server — the server
// is TOLD which kind it is being given — so putting it there would add dead code
// to the one place this project has already been bitten by dead code (v1.36.0,
// where two places decided the same thing and one was never reached).
//
// ⚠️ AND WHY A LINK EXISTS AT ALL. createWorkspace mints a 32-character token for
// the new owner. Six digits are read down a phone; thirty-two characters of mixed
// case are not — they are mistyped, and every mistype spends one of five attempts
// an hour. A link is the only honest way to hand that one over.

import { normalizeTyped, isWellFormed } from './join-code.js';

// Where a join link lands: the app's front door. Not a page of its own — whoever
// opens it may already be signed in, may have an account and no location, or may
// be a stranger, and index.html is the one screen that already tells those apart.
export const JOIN_PAGE = 'index.html';

// The name of the fragment field. Short, because it is typed nowhere and read by
// machines only.
const FIELD = 'join';

// ⚠️ THE TOKEN GOES AFTER THE #, AND THAT IS A SECURITY DECISION, NOT A STYLE ONE.
// A fragment is never sent to the server, so it cannot land in a web-server log,
// a proxy log, or a Referer header on the way to some other site. The same choice
// was made for the client ordering link (js/client-orders-data.js) and for the
// same reason; the two must not disagree about it.
export function joinLinkFor(token, href) {
  const code = String(token == null ? '' : token);
  const base = new URL(JOIN_PAGE, href || (typeof window !== 'undefined' ? window.location.href : 'https://example.invalid/'));
  return `${base.origin}${base.pathname}#${FIELD}=${encodeURIComponent(code)}`;
}

// Pull a token back out of an address. Returns '' for anything that is not one —
// a missing fragment, another app's fragment, a truncated paste.
//
// ⚠️ IT VALIDATES THE SHAPE BEFORE HANDING IT BACK. Whatever is in a URL was put
// there by whoever sent the link, so it is untrusted input: a caller that pasted
// it straight into a network call would spend a join attempt on rubbish.
export function readJoinToken(href) {
  let hash = '';
  try {
    hash = new URL(String(href == null ? '' : href)).hash;
  } catch {
    return '';
  }
  if (!hash || hash.length < 2) return '';

  const found = new URLSearchParams(hash.slice(1)).get(FIELD);
  if (!found) return '';

  const token = normalizeTyped(found, 'link');
  return isWellFormed(token, 'link') ? token : '';
}

// Which kind of code is this? Returns 'digits', 'link', or null when it is
// neither, so a caller can refuse before spending one of five attempts an hour.
//
// ⚠️ THE TWO SHAPES CANNOT OVERLAP, and the answer must never be a guess. Six
// digits are exactly six characters; a link is at least thirty-two. Nothing can
// satisfy both, so this reads the input twice and takes whichever matches —
// no ordering, no precedence, no ambiguity to get wrong later.
//
// ⚠️ IT REQUIRES A STRING, exactly as isWellFormed does, and for that function's
// own stated reason. Everything real that reaches here is an input's .value or a
// URL fragment, both always strings — so a number arriving means a caller has
// lost track of what it is holding. normalizeTyped() is forgiving because it
// handles what a person TYPED; composing it with a strict validator would move
// the coercion one function earlier and quietly undo the strictness. This is the
// door: strict is the safe direction.
export function kindOfTyped(input) {
  if (typeof input !== 'string') return null;
  if (isWellFormed(normalizeTyped(input, 'digits'), 'digits')) return 'digits';
  if (isWellFormed(normalizeTyped(input, 'link'), 'link')) return 'link';
  return null;
}

// What somebody should be told when it is neither. One sentence naming BOTH
// shapes, because this screen now accepts two and a message that named only
// digits would read as a refusal of the link somebody was just sent.
export const CODE_SHAPE_HINT = 'Enter your six-digit code, or open the link you were sent.';
