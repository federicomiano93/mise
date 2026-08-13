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

import { onSession, signIn, signUp, sendReset, chooseLocation, signOutNow,
         enterMyBusinesses, backToHub } from './firebase.js';
import { normalizeTyped } from './join-code.js';
import { kindOfTyped, readJoinToken, CODE_SHAPE_HINT } from './join-link.js';
import { nameProblem, passwordProblem, MIN_PASSWORD_LENGTH } from './credentials.js';
import { isSectionAllowedFor } from './sections.js';

const HOME = 'index.html';

// ⚠️ AN INVITATION MUST SURVIVE A RELOAD, and until 13 Aug 2026 it did not.
// Redeeming one can need a sign-in first, and signing in reloads the page — so a
// token living only in a variable was thrown away by the very step the app itself
// recommended ("that email already has an account, sign in with it instead").
// Whoever followed that advice arrived signed in with nothing left to redeem.
//
// sessionStorage for the same reason as `hub-passed` and `pick-venue` in
// js/firebase.js: this app is several pages, so memory is too short (every
// navigation loses it) and localStorage is too long (an invitation declined today
// would come back next month). It survives a reload and dies with the window.
//
// ⚠️ The token is a secret, and it is already in the address bar of this same
// window — so this stores it no more widely than it already was, for no longer
// than the window lives, and forgetInvite() clears both at once.
const INVITE_KEY = 'pending-invite';

function rememberInvite(token) {
  try { sessionStorage.setItem(INVITE_KEY, token); } catch { /* private mode */ }
}

// ⚠️ VALIDATED ON THE WAY OUT, exactly as readJoinToken validates the URL. What
// comes back from storage is no more trustworthy than what went into the address
// bar: another tab, an extension or a stale entry could have left anything there,
// and handing rubbish to redeemJoinCode spends one of five attempts an hour.
function rememberedInvite() {
  try {
    const found = sessionStorage.getItem(INVITE_KEY) || '';
    return kindOfTyped(found) === 'link' ? found : '';
  } catch { return ''; }
}

// ⚠️ READ ONCE, AT LOAD, BEFORE ANYTHING CAN NAVIGATE. A link sent to a brand-new
// customer arrives as index.html#join=<token>; without this the token would be in
// the address bar and the only screen that could use it would be asking them to
// type it out by hand — which is exactly the state this app shipped in until
// 12 Aug 2026.
let invitedWith = readJoinToken(window.location.href) || rememberedInvite();
if (invitedWith) rememberInvite(invitedWith);

// Take the spent secret out of the address bar (and out of the history entry)
// once it has been used. It is single-use, so what is left behind is worthless —
// but a secret with no reason to still be on screen should not be.
//
// ⚠️ IT CLEARS THE VARIABLE AND THE STORAGE TOO, not only the address bar. Half a
// forget is worse than none: the invitation would be gone from the URL and still
// offered on the next page, with nothing on screen explaining where it came from.
function forgetInvite() {
  invitedWith = '';
  try { sessionStorage.removeItem(INVITE_KEY); } catch { /* private mode */ }
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { /* an old browser: the fragment simply stays */ }
}

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
  'auth/email-already-in-use': 'That email already has an account. Sign in with it instead.',
  'auth/weak-password': 'Pick a longer password — at least 6 characters.',
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

// `note` replaces the usual subtitle when this screen is reached from somewhere
// that already knows why — today, only from an invitation whose email turned out
// to have an account. It says what will happen AFTER signing in, because on that
// path the sign-in is a step towards something else, not the destination.
function signInScreen({ note = '' } = {}) {
  const card = el('div', 'auth-card');
  // ⚠️ THE PRODUCT'S NAME, NOT A VENUE'S. Nobody is signed in yet, so the app
  // cannot know which location this person belongs to — putting one venue's name
  // here told every other customer's staff they were signing in to somebody
  // else's business. The venue's own name appears the moment it is known, in the
  // green header (js/location-title.js).
  card.append(el('h1', 'auth-title', 'Misé'));
  card.append(el('p', 'auth-sub', note || 'Sign in to open your location.'));

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

  // How to install the app — the ONE place it is reachable from.
  //
  // The guide (install-guide.html) is a standalone page with no link anywhere in
  // the app, so the only way to reach it is to remember the address. In practice
  // that means the link people get sent is the APP's, and whoever receives it lands
  // on exactly this screen: signed out, with no hint that instructions exist and no
  // idea they are supposed to "Add to Home Screen" first. An <a>, not a button:
  // it navigates, and the browser should treat it as such (P18).
  // ⚠️ THE ONLY WAY IN FOR SOMEBODY WHO HAS NEVER BEEN HERE. Without this link
  // a new employee holding a valid code has nowhere to type it: the form above
  // asks for a password they do not have yet, and the guide explains installing,
  // not joining. The same mistake — a screen nobody could reach — kept the
  // install guide unseen for weeks (v1.19.0).
  const join = el('button', 'auth-link', 'I have a join code');
  join.type = 'button';
  join.addEventListener('click', () => showGate(() => joinScreen({ needsAccount: true })));
  card.append(join);

  const guide = el('a', 'auth-link auth-guide-link', 'How to install the app');
  guide.href = 'install-guide.html';
  card.append(guide);

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


// ── Joining with a code ──────────────────────────────────────────────────────
//
// ⚠️ TWO ENTRANCES, ONE SCREEN, and the difference is whether an account exists
// yet. Somebody handed a code by their new employer has neither; somebody who
// signed up a minute ago and landed on "No location yet" has one already and
// must not be asked to make a second. `needsAccount` is the whole difference.
//
// Creating the account here grants NOTHING — a brand-new account has no
// users/{uid} document, so every rule refuses it until a Cloud Function accepts
// the code and writes the membership. That is why it is safe for the app to do
// this part at all.
function joinScreen({ needsAccount, prefill = '' }) {
  const card = el('div', 'auth-card');
  // ⚠️ FOUR SITUATIONS, FOUR SENTENCES, NOT ONE HEDGED ONE. "Type the code you
  // were given" is a LIE to somebody who arrived by link — their code is already
  // in the box — and a sentence that is wrong about what is on screen teaches
  // people to stop reading the next one.
  card.append(el('h1', 'auth-title',
    prefill ? 'You have been invited'
      : needsAccount ? 'Join with a code' : 'Enter your code'));
  card.append(el('p', 'auth-sub',
    prefill
      ? (needsAccount
        ? 'Your code is already filled in. Add your name and choose a password.'
        : 'Your code is already filled in. Add your name to finish.')
      : (needsAccount
        ? 'Create your account, then type the code you were given.'
        : 'Type the code you were given.')));

  const form = el('form', 'auth-form');
  form.noValidate = true;

  // ⚠️ THE NAME IS ASKED EVERY TIME, NOT ONLY WITH A NEW ACCOUNT. The roster is
  // per LOCATION, so somebody joining a second venue needs a row there too — and
  // that row is the only place their name is ever written. Asking once, on the
  // account, would leave every later location with an anonymous entry.
  const firstLabel = el('label', 'auth-label', 'Your first name');
  firstLabel.htmlFor = 'join-first';
  const firstName = el('input', 'auth-input');
  firstName.id = 'join-first';
  firstName.type = 'text';
  firstName.autocomplete = 'given-name';
  firstName.setAttribute('autocapitalize', 'words');

  const lastLabel = el('label', 'auth-label', 'Your surname');
  lastLabel.htmlFor = 'join-last';
  const lastName = el('input', 'auth-input');
  lastName.id = 'join-last';
  lastName.type = 'text';
  lastName.autocomplete = 'family-name';
  lastName.setAttribute('autocapitalize', 'words');

  form.append(firstLabel, firstName, lastLabel, lastName);

  let email = null, password = null;
  if (needsAccount) {
    const emailLabel = el('label', 'auth-label', 'Your email');
    emailLabel.htmlFor = 'join-email';
    email = el('input', 'auth-input');
    email.id = 'join-email';
    email.type = 'email';
    email.autocomplete = 'username';

    const passLabel = el('label', 'auth-label',
      `Choose a password (at least ${MIN_PASSWORD_LENGTH} characters)`);
    passLabel.htmlFor = 'join-password';
    password = el('input', 'auth-input');
    password.id = 'join-password';
    password.type = 'password';
    password.autocomplete = 'new-password';

    form.append(emailLabel, email, passLabel, password);
  }

  const codeLabel = el('label', 'auth-label', 'Code');
  codeLabel.htmlFor = 'join-code';
  const code = el('input', 'auth-input auth-code');
  code.id = 'join-code';
  code.type = 'text';
  // A numeric keypad on a phone, and no autocorrect deciding six digits are a word.
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.setAttribute('autocapitalize', 'off');
  code.setAttribute('spellcheck', 'false');
  if (prefill) {
    // Arrived by link: the code is already known, so it is filled in and the
    // keypad hint dropped — a numeric keypad in front of a 32-character token
    // would be the wrong keyboard for a box nobody has to type in.
    code.value = prefill;
    code.inputMode = 'text';
  }

  const submit = el('button', 'auth-btn', 'Join');
  submit.type = 'submit';

  const status = el('p', 'auth-status');
  status.setAttribute('role', 'alert');

  form.append(codeLabel, code, submit, status);
  card.append(form);

  // ⚠️ THE WAY OUT OF THE DEAD END, and it is hidden until it is the answer.
  // Somebody who already has an account here — an owner buying a second business,
  // a chef who works in two places — reaches this form and is refused by Firebase
  // with "that email already has an account". Until 13 Aug 2026 the app said
  // "sign in with it instead" and that was the whole reply: signing in meant a
  // reload, the reload threw the invitation away, and they arrived signed in with
  // nothing left to redeem. The advice led exactly nowhere.
  //
  // It is built now and revealed later for the reason this project learnt in
  // v1.19.1: a control that appears only in an error path has no element to
  // reveal when the error arrives, so it gets built on a screen that is already
  // being replaced. Hidden is safe — tokens.css forces [hidden] to stay hidden.
  const signInInstead = el('button', 'auth-link', 'Sign in with that email');
  signInInstead.type = 'button';
  signInInstead.hidden = true;
  signInInstead.addEventListener('click', () => {
    // The invitation lives in sessionStorage, so it survives the sign-in and the
    // reload that follows it; offerInvite() picks it up on the other side.
    showGate(() => signInScreen({
      note: 'Sign in, and we will add the business to your account.',
    }));
  });
  card.append(signInInstead);

  const back = el('button', 'auth-link', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => {
    showGate(needsAccount ? signInScreen : () => noAccessScreen(lastSession || {}));
  });
  card.append(back);

  const setStatus = (text, kind = 'bad') => {
    status.textContent = text;
    status.className = `auth-status auth-status--${kind}`;
  };

  // Say what is wrong and put the cursor in the box it is about. Returns true
  // when the form is worth sending.
  //
  // ⚠️ EVERY CHECK RUNS BEFORE THE NETWORK, and the reason is not tidiness: each
  // call — even a malformed one — spends one of this account's five join attempts
  // an hour. A blank surname must not cost somebody one of five real tries.
  //
  // ⚠️ AND CREATING THE ACCOUNT COMES LAST, AFTER EVERYTHING IS VALID. Sign-up
  // cannot be undone from here, so a form that created the account and THEN
  // complained about the surname would leave somebody holding an account they
  // cannot use, on a screen that had just refused them.
  const problem = () => {
    const first = nameProblem(firstName.value, 'first');
    if (first) return [first, firstName];
    const last = nameProblem(lastName.value, 'last');
    if (last) return [last, lastName];
    if (needsAccount) {
      if (!email.value.trim()) return ['Enter your email.', email];
      const pass = passwordProblem(password.value, email.value);
      if (pass) return [pass, password];
    }
    // ⚠️ TWO SHAPES REACH THIS BOX, NOT ONE. Six digits are read down a phone;
    // the owner of a brand-new business is sent a 32-character link instead,
    // because nobody dictates thirty-two mixed-case characters and every mistype
    // spends one of five attempts an hour. Until 12 Aug 2026 this line refused
    // the link outright — the token createWorkspace mints could not be redeemed
    // anywhere in the app.
    if (!kindOfTyped(code.value)) return [CODE_SHAPE_HINT, code];
    return null;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const wrong = problem();
    if (wrong) {
      setStatus(wrong[0]);
      wrong[1].focus();
      return;
    }
    // The kind decides how the code is normalised as well as what it is called:
    // case is folded for digits and KEPT for a link, where folding destroys it.
    const kind = kindOfTyped(code.value);
    const typed = normalizeTyped(code.value, kind);

    submit.disabled = true;
    setStatus(needsAccount ? 'Creating your account…' : 'Checking…', 'busy');
    try {
      if (needsAccount) {
        await signUp(email.value, password.value);
        setStatus('Checking your code…', 'busy');
      }
      // Loaded only now: this screen is on the critical path of every app open,
      // and the functions client is a chunk nobody needs until they are joining.
      const { redeemJoinCode } = await import('./staff/firebase-staff.js');
      await redeemJoinCode(typed, kind, firstName.value, lastName.value);
      forgetInvite();
      // Everything downstream reads the membership once, at sign-in, so the
      // honest way to pick up a brand-new one is to start again.
      location.reload();
    } catch (err) {
      // A refused code arrives as the function's own message; anything from the
      // sign-up half arrives as a Firebase auth code.
      const fromAuth = err && typeof err.code === 'string' && err.code.startsWith('auth/');
      setStatus(fromAuth ? messageFor(err)
        : (err && err.message) || 'That code does not work. Ask for a new one.');
      // ⚠️ ONE refusal has a way forward, so it gets one. Every other failure here
      // is answered by trying again on this same screen; this one cannot be, because
      // the account already exists and no amount of retyping will create it.
      if (err && err.code === 'auth/email-already-in-use') signInInstead.hidden = false;
      submit.disabled = false;
    }
  });

  setTimeout(() => firstName.focus(), 0);
  return card;
}

// ── The app's own home ───────────────────────────────────────────────────────
//
// ⚠️ THE ONE SCREEN IN THIS APP THAT IS ABOUT THE PRODUCT AND NOT ABOUT A VENUE,
// which is why it is titled with the product's name. Everything past it belongs
// to one business and says that business's name in the green header; this sits
// above all of them.
//
// ⚠️ AND ONLY THE APP'S ADMINISTRATOR EVER REACHES IT (js/sections.js
// pickStart). For a customer's owner or a kitchen employee it would be a door
// opened every morning onto the only room behind it.
//
// "New customer" used to sit at the foot of a venue's Home, between an action
// about that venue and an action about your account — three scopes in one list,
// under a header naming one customer's bakery. This is the other half of that
// fix: the back office is not a drawer inside a customer's app, it is the floor
// the customer's app stands on.
function hubChoice(label, description, onClick) {
  const button = el('button', 'auth-choice');
  button.type = 'button';
  button.append(el('span', 'auth-choice-name', label));
  button.append(el('span', 'auth-choice-sub', description));
  button.addEventListener('click', onClick);
  return button;
}

function hubScreen(session) {
  const card = el('div', 'auth-card');
  card.append(el('h1', 'auth-title', 'Misé'));
  card.append(el('p', 'auth-sub', 'Where would you like to go?'));

  const list = el('div', 'auth-choices');

  // ⚠️ THE DAILY DOOR IS FIRST, and it is the one place this screen departs
  // from how Federico described it. He listed "businesses" first; this is a
  // screen he will open several times a day to reach his own kitchen and once a
  // month to reach the back office, so the thumb should land on the kitchen.
  // Two labels a single word apart also need their sub-lines to tell them
  // apart, which is what those are for.
  const count = (session.options || []).length;
  const mine = hubChoice('My businesses',
    count === 1 ? 'The place you run' : 'The places you run',
    () => {
      list.querySelectorAll('button').forEach(b => { b.disabled = true; });
      enterMyBusinesses().catch(err => {
        console.error('Could not open your businesses:', err);
        list.querySelectorAll('button').forEach(b => { b.disabled = false; });
      });
    });

  const customers = hubChoice('Businesses', 'The businesses using Misé', async () => {
    const { openBusinesses } = await import('./staff/businesses.js');
    // ⚠️ MOUNTED INSIDE THE COVER, not on the body. This screen is drawn while
    // the gate is up, and the gate marks every other child of <body> `inert` —
    // a panel appended out there would be visible and untappable.
    openBusinesses({ host: gateHost() });
  });

  list.append(mine, customers);
  card.append(list);

  const out = el('button', 'auth-link', 'Log out');
  out.type = 'button';
  out.addEventListener('click', async () => {
    // Loaded on the tap: auth-gate.js runs on every page of the app, and the
    // dialog is a module nobody needs until they are leaving.
    const { confirmDialog } = await import('./confirm-dialog.js');
    const ok = await confirmDialog({
      title: 'Log out?',
      message: 'You will need your email and password to get back in.',
      okLabel: 'Log out',
      danger: true,
    });
    if (ok) signOutNow();
  });
  card.append(out);

  return card;
}

// The way back up to the hub, for the screens it leads to. Only ever drawn for
// the account that has a hub to go back to.
function hubBackLink() {
  const back = el('button', 'auth-link', 'Back to Misé');
  back.type = 'button';
  back.addEventListener('click', () => backToHub());
  return back;
}

function chooseScreen(session) {
  const options = session.options || [];
  const names = session.optionNames || {};
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
  // Reached from the hub, so it needs the way back to it — otherwise the only
  // route to the customer list is to close the app entirely.
  if (session.isAppAdmin) card.append(hubBackLink());
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


// The account exists and belongs nowhere. Two very different people land here:
// somebody whose access was removed, and somebody who has just created an
// account and is holding a code.
//
// ⚠️ THIS IS THE MOST IMPORTANT ENTRANCE IN THE WHOLE FLOW. Creating the account
// and redeeming the code are two steps, and anything can happen between them —
// a dropped connection, a mistyped code, a phone that locked. Whoever gets
// separated from the first attempt arrives here, and without a way to type the
// code from this screen their only options are to give up or make a SECOND
// account, which cannot be joined either because the code is single use.
let lastAccount = '';

function noAccessScreen(session = {}) {
  const card = messageScreen(
    'No location yet',
    'This account is not linked to a location. If you were given a code, type it here.',
    { account: lastAccount },
  );
  const join = el('button', 'auth-link', 'I have a join code');
  join.type = 'button';
  join.addEventListener('click', () => showGate(() => joinScreen({ needsAccount: false })));
  // Above "Try again" and "Sign in with a different account", because for the
  // person this screen is usually showing to, it is the answer and they are not.
  card.insertBefore(join, card.querySelector('.auth-btn'));
  // ⚠️ An app administrator who runs no venue of their own reaches this screen by
  // tapping "My businesses" and would otherwise be stuck on a message about a
  // problem they do not have, with the whole back office behind them.
  if (session.isAppAdmin) card.append(hubBackLink());
  return card;
}

// ── The gate ─────────────────────────────────────────────────────────────────

// The last thing the session said, kept so an invitation arriving AFTER the page
// has settled can be answered without waiting for the session to change again.
let lastSession = null;

// ⚠️ AN INVITATION OPENED BY SOMEBODY WHO IS ALREADY IN. Until 13 Aug 2026 nothing
// happened at all: render() answered an invitation only when signed OUT or with no
// access, and the comment on the hashchange listener below said why — "an invitation
// is not a reason to throw a working session off its screen". That is right for an
// employee at the mixer and wrong for the person this app is FOR: an owner adding a
// second business to the account they are already using. Both halves were correct
// on their own, and together they made adding a business to yourself impossible.
//
// ⚠️ SO IT IS A QUESTION, NOT A REDIRECT. Answering the invitation by taking over
// the screen would fix the owner's case by breaking the employee's — quantities
// half-typed at the mixer, gone because a colleague's link was tapped. The dialog
// waits, and "Not now" ends it for this opening of the app.
let inviteOffered = false;

async function offerInvite(session) {
  if (!invitedWith || inviteOffered) return;
  inviteOffered = true;

  // Loaded only now: this file is on the critical path of every app open, and an
  // invitation is rare. Same reasoning as the redeem call in joinScreen.
  const { confirmDialog } = await import('./confirm-dialog.js');
  // ⚠️ IT NAMES THE ACCOUNT. On a shared kitchen phone the person tapping is not
  // always the person signed in, and a business added to the wrong account can
  // only be undone from the Firebase console.
  const who = session.user?.email || 'this account';
  const add = await confirmDialog({
    title: 'You opened an invitation',
    message: `Add this business to ${who}?`,
    okLabel: 'Add it',
    cancelLabel: 'Not now',
  });

  if (!add) { forgetInvite(); return; }
  showGate(() => joinScreen({ needsAccount: false, prefill: invitedWith }));
}

function render(session) {
  lastSession = session;
  switch (session.status) {
    case 'loading':
      gateHost().hidden = false;
      break;

    case 'signed-out':
      // ⚠️ ARRIVED BY LINK: go straight to joining, not to sign-in. Whoever opens
      // an invitation has no account here yet, so the sign-in form is a wall with
      // the way round it three lines below in small type. They still get there by
      // Back if they do have one.
      showGate(invitedWith
        ? () => joinScreen({ needsAccount: true, prefill: invitedWith })
        : signInScreen);
      break;

    // The app's own home, above every venue. Only an app administrator is ever
    // put in this state (js/sections.js pickStart).
    case 'hub':
      showGate(() => hubScreen(session));
      offerInvite(session);
      break;

    case 'choose-location':
      showGate(() => chooseScreen(session));
      offerInvite(session);
      break;

    case 'no-access':
      lastAccount = session.user?.email || session.user?.uid || '';
      // Signed in already and holding an invitation — the second entrance, with
      // the code filled in. Somebody who made an account and got separated from
      // the first attempt must not be asked to make a second (v267).
      showGate(invitedWith
        ? () => joinScreen({ needsAccount: false, prefill: invitedWith })
        : () => noAccessScreen(session));
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
      // ⚠️ THE ROLE IS ASKED HERE TOO, or hiding the card would be theatre:
      // typing the address is all it would take. The rules refuse the DATA
      // regardless — this is what stops the screen sitting there collecting
      // permission errors instead of saying nothing at all.
      if (pageSection && !isSectionAllowedFor(session.location, session.role, pageSection)) {
        location.replace(HOME);
        return;
      }
      clearGate();
      gateHost().hidden = true;
      document.body.classList.add('signed-in');
      // ⚠️ AFTER the app is on screen, never before. Asking over a cover that is
      // still up would put the question in front of a page nobody can see behind,
      // and "Not now" would leave them staring at the cover.
      offerInvite(session);
      break;

    default:
      break;
  }
}

onSession(render);

// ⚠️ A LINK OPENED WHILE THE APP IS ALREADY ON THIS PAGE CHANGES ONLY THE
// FRAGMENT, AND THE BROWSER DOES NOT RELOAD FOR THAT. Everything above runs once,
// at load, so without this the invitation would be sitting in the address bar
// doing nothing while the screen showed a sign-in form — silent, and impossible
// for the person holding the phone to explain. Found by driving the app: opening
// the link in a FRESH page always worked, which is why nothing else caught it.
//
// ⚠️ 'ready' USED TO BE EXCLUDED HERE, and that exclusion was half of the defect
// fixed on 13 Aug 2026. The old comment read "nothing happens for somebody already
// inside a location: an invitation is not a reason to throw a working session off
// its screen" — true about not REDIRECTING, and implemented as not reacting AT ALL.
// So the one person most likely to open an invitation from inside the app — an
// owner adding a second business, already signed in and working — got silence.
//
// Now every state reacts, and "do not throw anybody off their screen" is kept where
// it belongs: offerInvite ASKS, and "Not now" leaves the screen exactly as it was.
// render() is safe to re-run in 'ready' — it re-hides an already hidden gate and
// re-adds a class that is already there — and offerInvite only asks once per page.
window.addEventListener('hashchange', () => {
  const found = readJoinToken(window.location.href);
  if (!found || found === invitedWith) return;
  invitedWith = found;
  rememberInvite(found);
  if (lastSession) render(lastSession);
});
