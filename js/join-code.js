// join-code.js — the one thing that lets a new person into a location.
//
// ⚠️ THIS IS THE ONLY DOOR THIS APP HAS EVER OPENED FROM THE INSIDE. Until now,
// membership was written by hand in the Firebase console and by nothing else,
// which is exactly what made it a boundary between two businesses. That cannot
// survive selling the app: every customer would be half an hour of console, with
// an invisible typo waiting (a trailing space in a field name already cost this
// project half an hour once). So a Cloud Function writes it instead — after
// checking a code that came from somebody who was already allowed to hand it out.
//
// ⚠️ THE APP CANNOT BE TRUSTED WITH THIS AND IS NOT. users/{uid} is still
// `allow write: if false` for every client. The decisions below run on the
// server with the Admin SDK; this file is PURE so those decisions can be tested
// without a database, and so the phone can use the same rules to tell somebody
// their code is malformed before spending a network round trip on it.
//
// ⚠️ functions/join-code.js IS A COPY OF THIS FILE, pinned identical by
// tests/copie-allineate.test.mjs. It cannot be imported across: a functions
// deploy uploads only that folder, so `../js/` resolves on this machine and is
// missing in the cloud. Same reason, same sentinel, as functions/push-model.js.

// Two shapes, because they are handed over in two completely different ways.
//
//   'digits'  six digits, read aloud by an owner to somebody standing next to
//             them. Short because it is TYPED, and kitchen staff often have no
//             email address they actually read on a phone — which is why this is
//             a code at all and not an email invite.
//
//   'link'    a long random token inside a URL, sent to a new customer over
//             WhatsApp or email. Nobody types it, so it can be as long as it
//             likes, and it is the owner's own first way in.
//
// ⚠️ SIX DIGITS IS A MILLION, AND A CALLABLE IS REACHABLE BY ANYONE who knows the
// project id — which is public. Short is only safe because of the limits below,
// and they work together: remove any one and the code becomes guessable.
export const CODE_KINDS = Object.freeze(['digits', 'link']);
export const DIGITS_LENGTH = 6;
export const LINK_LENGTH = 32;

const HOUR = 60 * 60 * 1000;

// A staff code is meant to be used within minutes, in person. A day is already
// generous; a week would leave a live key in a WhatsApp thread nobody rereads.
// The owner link gets longer because it travels to somebody who may not be at
// their desk, and it is the only thing standing between them and their new app.
export const TTL_MS = Object.freeze({ digits: 24 * HOUR, link: 7 * 24 * HOUR });

// Per CODE. Five wrong guesses and it is dead — the owner reads out another one,
// which costs ten seconds, while an attacker has to start again from nothing.
export const MAX_FAILED_ATTEMPTS = 5;

// Per ACCOUNT per hour, which is the limit that actually bounds a search: the
// caller must be signed in, so there is always a uid to count against. Five an
// hour over a whole day is 120 guesses before the code expires anyway — to cover
// a million you would need thousands of accounts, and Firebase Auth rate-limits
// sign-ups on its own.
export const MAX_ATTEMPTS_PER_HOUR = 5;
export const ATTEMPT_WINDOW_MS = HOUR;

// ── What somebody typed ──────────────────────────────────────────────────────

// People type codes with spaces in the middle, and phones like to capitalise the
// first character of anything. Neither should be a wrong answer.
//
// ⚠️ CASE IS FOLDED FOR DIGITS AND KEPT FOR A LINK. A six-digit code has no
// letters, so folding costs nothing and forgives the keyboard; a link token uses
// upper and lower case to be short, so folding it would destroy it.
export function normalizeTyped(input, kind = 'digits') {
  const raw = String(input == null ? '' : input).trim();
  if (kind === 'link') return raw;
  return raw.replace(/[\s-]/g, '');
}

// ⚠️ IT REQUIRES A STRING AND DOES NOT COERCE ONE. normalizeTyped() above is
// forgiving because it handles what a person typed; this decides whether
// something may be used as a key, and there quietly turning the number 123456
// into "123456" hides a caller that has already lost track of what it is
// holding. Strict is the safe direction for the one function guarding the door.
export function isWellFormed(code, kind = 'digits') {
  if (typeof code !== 'string') return false;
  if (kind === 'link') return /^[A-Za-z0-9_-]{32,64}$/.test(code);
  return new RegExp(`^[0-9]{${DIGITS_LENGTH}}$`).test(code);
}

// ── Whether a stored code may still be redeemed ──────────────────────────────

// Every answer that is not 'ok' is a refusal, and they are kept apart because
// the person on the other end can act on the difference: an expired code needs a
// new one, a used code means somebody already joined, and a locked one means
// something is wrong. They are NOT all reported to the caller — see
// redeemFailureText — but the server logs which, and a quiet failure with no
// reason in the log is indistinguishable from a broken function.
export function codeStatus(doc, now = Date.now()) {
  if (!doc || typeof doc !== 'object') return 'missing';
  if (doc.usedAt) return 'used';
  if (Number(doc.failedAttempts) >= MAX_FAILED_ATTEMPTS) return 'locked';
  const expiresAt = Number(doc.expiresAt);
  // ⚠️ AN UNREADABLE EXPIRY IS TREATED AS EXPIRED, not as "no expiry". This is
  // the opposite direction from the app's usual "widen on doubt", and it is the
  // right one here: a code is a key, and a key whose lifetime nobody can read
  // must not be immortal.
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return 'expired';
  return 'ok';
}

export function isRedeemable(doc, now = Date.now()) {
  return codeStatus(doc, now) === 'ok';
}

// ── How hard somebody has been trying ────────────────────────────────────────

// The attempts an account has made inside the last hour. Anything older is not
// forgiven so much as forgotten: the point is to slow a search down, not to
// punish somebody who mistyped a code last Tuesday.
export function recentAttempts(record, now = Date.now()) {
  const list = record && Array.isArray(record.attempts) ? record.attempts : [];
  return list.filter(at => {
    const t = Number(at);
    return Number.isFinite(t) && now - t < ATTEMPT_WINDOW_MS && t <= now;
  });
}

export function isRateLimited(record, now = Date.now()) {
  return recentAttempts(record, now).length >= MAX_ATTEMPTS_PER_HOUR;
}

// When the account may try again — for a message a person can act on, rather
// than "try later", which tells them nothing and gets the app blamed.
export function retryAfterMs(record, now = Date.now()) {
  const attempts = recentAttempts(record, now);
  if (attempts.length < MAX_ATTEMPTS_PER_HOUR) return 0;
  const oldest = Math.min(...attempts);
  return Math.max(0, ATTEMPT_WINDOW_MS - (now - oldest));
}

// ── What the person is told ──────────────────────────────────────────────────

// ⚠️ EVERY REFUSAL SOUNDS THE SAME EXCEPT THE RATE LIMIT, and that is deliberate.
// Telling somebody "that code has expired" confirms the code EXISTED, which is
// exactly the signal a search wants. The rate limit is the one exception because
// it says nothing about any code — only about how often this account has asked.
export function redeemFailureText(status, retryMs = 0) {
  if (status === 'rate-limited') {
    const mins = Math.max(1, Math.ceil(retryMs / 60000));
    return `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`;
  }
  return 'That code does not work. Ask for a new one.';
}

// How long a code has left, in words, for the owner reading it out. Deliberately
// coarse: a countdown to the second invites somebody to watch it.
export function expiresInWords(doc, now = Date.now()) {
  const left = Number(doc && doc.expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return 'expired';
  const mins = Math.round(left / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} left`;
  const hours = Math.round(left / HOUR);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  return `${Math.round(hours / 24)} days left`;
}
