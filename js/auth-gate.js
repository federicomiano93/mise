// auth-gate.js — the door. Imported by every page that shows data.
//
// It covers the page until the session says a location is open, and turns each
// session state into a screen a person can act on:
//
//   loading           → nothing (the splash / a blank cover, no flicker)
//   signed-out        → sign in, with "forgot password"
//   choose-location → which location am I working on
//   no-access         → this account exists but belongs to no location yet
//   error             → we could not check your access (offline, usually)
//   ready             → uncover the page; if this section is not for this
//                       location, go Home instead of showing permission errors
//
// WHY IT COVERS THE PAGE FIRST. The alternative — render the app, then hide it if
// signed out — shows one frame of somebody's data to whoever is holding the
// phone. The cover is in the HTML from the start and is only ever REMOVED.

import { onSession, signIn, sendReset, chooseLocation, signOutNow } from './firebase.js';
import { isSectionAllowed } from './sections.js';

const HOME = 'index.html';

// Which section this page belongs to. Pages set it on the <body>; a page with no
// section (the Home itself) is never gated by section, only by sign-in.
const pageSection = document.body.dataset.section || '';

// Firebase's error codes, in words that tell you what to DO about it. The codes
// are deliberately vague about which of email/password was wrong (so an attacker
// cannot map who has an account); the message stays vague too rather than
// inventing a certainty we do not have.
// Firebase reports a bad sign-in under several codes depending on whether the
// project has email-enumeration protection switched on, and the emulator uses a
// different one again. All of them mean the same thing to a person, so all of
// them get the same sentence — otherwise the message quietly degrades to the
// generic fallback in exactly the situation people actually hit.
const MESSAGES = {
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/invalid-login-credentials': 'That email and password do not match an account.',
  'auth/wrong-password': 'That email and password do not match an account.',
  'auth/user-not-found': 'That email and password do not match an account.',
  'auth/invalid-email': 'That does not look like an email address.',
  'auth/user-disabled': 'This account has been turned off. Ask the owner to re-enable it.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. The first sign-in on a device needs internet.',
  'auth/missing-password': 'Enter your password.',
};
const messageFor = err =>
  MESSAGES[err && err.code] || 'Could not sign in. Please try again.';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let host = null;

// The cover lives in the HTML so it is painted before any app code runs; this
// only finds it (and creates one if a page forgot, so a missing element can
// never mean "no door").
function gateHost() {
  if (host) return host;
  host = document.getElementById('auth-gate');
  if (!host) {
    host = el('div', 'auth-gate');
    host.id = 'auth-gate';
    document.body.append(host);
  }
  return host;
}

// While the cover is up, the page behind it must not be reachable by keyboard or
// screen reader. Hiding it visually is not enough: Tab would still walk into it,
// and a screen reader would happily read out the app to someone who has not
// signed in. `inert` takes a whole subtree out of play in one attribute.
//
// ⚠️ It takes out EVERYTHING that is not the cover, dialogs included. That is
// correct — the cover is the topmost modal and nothing may sit in front of it —
// but it means nothing else may open a dialog while it is up: the dialog would be
// visible, unreachable, and in the way of signing in. js/whats-new-boot.js waits
// for a location to be open for exactly this reason. Anything else that wants to
// interrupt must do the same.
// The "New version available" banner is the ONE exception. It sits above the
// cover by design (z-index 9999 vs 9000) and all it does is reload the page —
// and a phone stuck on one of these screens is exactly the phone that most needs
// to be able to take a new version. Switching it off with everything else turned
// the cover into a trap: visible update, untappable.
const ALWAYS_REACHABLE = ['sw-update-host', 'auth-gate'];

function setBehindInert(inert) {
  Array.from(document.body.children).forEach(child => {
    if (ALWAYS_REACHABLE.includes(child.id)) return;
    if (inert) child.setAttribute('inert', '');
    else child.removeAttribute('inert');
  });
}

function clearGate() {
  gateHost().textContent = '';
  setBehindInert(false);
}

function showGate(build) {
  const node = gateHost();
  node.textContent = '';
  node.hidden = false;
  node.append(build());
  setBehindInert(true);
}

// ── Screens ──────────────────────────────────────────────────────────────────

function signInScreen() {
  const card = el('div', 'auth-card');
  card.append(el('h1', 'auth-title', 'The Italian Club'));
  card.append(el('p', 'auth-sub', 'Sign in to open your location.'));

  const form = el('form', 'auth-form');
  form.noValidate = true;

  const emailLabel = el('label', 'auth-label', 'Email');
  emailLabel.htmlFor = 'auth-email';
  const email = el('input', 'auth-input');
  email.id = 'auth-email';
  email.type = 'email';
  email.autocomplete = 'username';
  email.required = true;

  const passLabel = el('label', 'auth-label', 'Password');
  passLabel.htmlFor = 'auth-password';
  const password = el('input', 'auth-input');
  password.id = 'auth-password';
  password.type = 'password';
  password.autocomplete = 'current-password';
  password.required = true;

  const submit = el('button', 'auth-btn', 'Sign in');
  submit.type = 'submit';

  const forgot = el('button', 'auth-link', 'Forgot your password?');
  forgot.type = 'button';

  // role=alert so a screen reader announces a failed attempt instead of leaving
  // the person tapping a button that appears to do nothing.
  const status = el('p', 'auth-status');
  status.setAttribute('role', 'alert');

  form.append(emailLabel, email, passLabel, password, submit, status, forgot);
  card.append(form);

  const setStatus = (text, kind = 'bad') => {
    status.textContent = text;
    status.className = `auth-status auth-status--${kind}`;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!email.value.trim()) { setStatus('Enter your email.'); email.focus(); return; }
    if (!password.value) { setStatus('Enter your password.'); password.focus(); return; }
    submit.disabled = true;
    setStatus('Signing in…', 'busy');
    try {
      await signIn(email.value, password.value);
      // The session listener takes it from here (this screen gets replaced).
    } catch (err) {
      setStatus(messageFor(err));
      submit.disabled = false;
      password.select();
    }
  });

  forgot.addEventListener('click', async () => {
    const address = email.value.trim();
    if (!address) { setStatus('Type your email above first, then tap this.'); email.focus(); return; }
    forgot.disabled = true;
    try {
      await sendReset(address);
      // Deliberately does not reveal whether the address has an account.
      setStatus(`If ${address} has an account, a reset link is on its way.`, 'good');
    } catch (err) {
      setStatus(messageFor(err));
    }
    forgot.disabled = false;
  });

  setTimeout(() => email.focus(), 0);
  return card;
}

function chooseScreen(options, names = {}) {
  const card = el('div', 'auth-card');
  card.append(el('h1', 'auth-title', 'Choose location'));
  card.append(el('p', 'auth-sub', 'You have access to more than one.'));

  const list = el('div', 'auth-choices');
  options.forEach(id => {
    // The name, never the database id: nobody should have to pick between
    // "main" and "trattoria-rosa".
    const button = el('button', 'auth-choice', names[id] || id);
    button.type = 'button';
    button.addEventListener('click', () => {
      list.querySelectorAll('button').forEach(b => { b.disabled = true; });
      chooseLocation(id).catch(err => {
        console.error('Could not open that location:', err);
        list.querySelectorAll('button').forEach(b => { b.disabled = false; });
      });
    });
    list.append(button);
  });

  card.append(list);
  return card;
}

// A screen with one button that reloads into the same screen is a dead end. Every
// message screen therefore also offers the way OUT — signing out and coming back
// to the form — and names the account it is talking about, so "ask the owner to
// add it" is a request someone can actually act on instead of a riddle.
function messageScreen(title, body, { account = '' } = {}) {
  const card = el('div', 'auth-card');
  card.append(el('h1', 'auth-title', title));
  card.append(el('p', 'auth-sub', body));

  if (account) {
    const who = el('p', 'auth-account', account);
    card.append(who);
  }

  const retry = el('button', 'auth-btn', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => location.reload());
  card.append(retry);

  const other = el('button', 'auth-link', 'Sign in with a different account');
  other.type = 'button';
  other.addEventListener('click', () => { signOutNow(); });
  card.append(other);

  return card;
}

// ── The gate ─────────────────────────────────────────────────────────────────

onSession(session => {
  switch (session.status) {
    case 'loading':
      gateHost().hidden = false;
      break;

    case 'signed-out':
      showGate(signInScreen);
      break;

    case 'choose-location':
      showGate(() => chooseScreen(session.options, session.optionNames));
      break;

    case 'no-access':
      showGate(() => messageScreen(
        'No location yet',
        'This account is not linked to a location. Ask the owner to add it, then try again.',
        { account: session.user?.email || session.user?.uid || '' },
      ));
      break;

    case 'error':
      showGate(() => messageScreen(
        'Could not check your access',
        'This usually means no connection. Check it and try again.',
        { account: session.user?.email || '' },
      ));
      break;

    case 'ready':
      // A location that does not use this section should never sit on its
      // screen collecting permission errors — send it Home, where the cards it
      // does have are waiting.
      if (pageSection && !isSectionAllowed(session.location, pageSection)) {
        location.replace(HOME);
        return;
      }
      clearGate();
      gateHost().hidden = true;
      document.body.classList.add('signed-in');
      break;

    default:
      break;
  }
});
