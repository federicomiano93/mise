// onboarding.js — the four calls that let somebody into a location without
// anybody opening the Firebase console.
//
// ⚠️ WHY THIS HAS TO BE SERVER CODE, and why the obvious shortcut is forbidden.
// users/{uid} says which locations an account may open, and it is
// `allow write: if false` for every client — that single fact is what makes it a
// boundary between two businesses rather than a preference. Letting the app write
// ANOTHER person's users document, which is the one-line way to make an invite
// button work, would hand every signed-in client a master key to the whole
// database, across every location, for ever. So the write happens here, with the
// Admin SDK, after this file has checked that whoever asked was already entitled
// to hand out what they are handing out.
//
// The four, and who may call each:
//   createWorkspace   the app's owner only   a new customer's location + its first link
//   createJoinCode    a location's owner     a six-digit code for one person
//   redeemJoinCode    anybody signed in      THE only write to users/{uid}
//   setMemberRole     a location's owner     promote, demote, remove
//
// ⚠️ EVERY DECISION THAT CAN BE MADE WITHOUT A DATABASE LIVES IN join-code.js,
// which is a byte-for-byte copy of js/join-code.js pinned by a test. The limits
// that make a six-digit code safe are only safe TOGETHER, and a server that
// quietly relaxed one while the app still believed it would not be visible from
// either side.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { createHash, randomInt, randomBytes } from 'node:crypto';

import {
  DIGITS_LENGTH, LINK_LENGTH, TTL_MS, MAX_FAILED_ATTEMPTS,
  MAX_ATTEMPTS_PER_HOUR, ATTEMPT_WINDOW_MS,
  isWellFormed, codeStatus, isRateLimited, retryAfterMs, redeemFailureText,
} from './join-code.js';

const REGION = 'us-central1';

// ⚠️ App Check enforcement is deliberately NOT switched on here, and it is one
// line away (`enforceAppCheck: true`). App Check is still in MONITOR mode for
// this project and nobody has confirmed that real phones pass it — turning it on
// for the one call that lets people in would stake the door on a subsystem this
// project has never verified, and the failure would look exactly like a broken
// app. It is the right strengthening once App Check is decided; it is not a
// substitute for the limits in join-code.js, which stand on their own.
const CALL = { region: REGION };

const db = () => getFirestore();

// ── Small shared pieces ──────────────────────────────────────────────────────

// The location id is MINTED, never derived from the business name. A name-derived
// id puts a customer's business inside every path in their database, and the
// second "Panificio Rossi" to sign up collides with the first. Kept inside
// isValidLocationId()'s shape (letters, digits, dash, underscore).
function mintLocationId() {
  return `loc-${randomBytes(6).toString('hex')}`;
}

function mintDigits() {
  // randomInt, not Math.random: this is a key, however short.
  let out = '';
  for (let i = 0; i < DIGITS_LENGTH; i += 1) out += String(randomInt(0, 10));
  return out;
}

function mintLinkToken() {
  return randomBytes(LINK_LENGTH).toString('base64url').slice(0, LINK_LENGTH);
}

// The stored id of a code. ⚠️ THE CODE ITSELF IS NEVER WRITTEN DOWN — not in the
// document, not in a log line. The collection is unreadable by every client, so
// this is defence in depth rather than the main protection; it earns its place
// because backups, exports and function logs all outlive the code's 24 hours.
function codeId(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

function requireAuth(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

// ⚠️ THE ROLE IS THE MEMBERSHIP VALUE — `true` is an ordinary employee,
// 'manager' runs the location, 'owner' owns the business. It is not a field of
// its own; see js/roles.js for why. Reading it here has to agree with
// firestore.rules exactly, so it forgives nothing: no trimming, no case folding.
//
// ⚠️ EVERY NEW VALUE MUST BE ADDED HERE, AND FORGETTING IS NOT A DEMOTION — IT
// IS A LOCKOUT. This function answers "is this account in this location at all",
// so an unlisted value reads as no access rather than as less access. That
// mistake has already been made twice with 'manager' alone: once in
// js/sections.js locationsOf(), once in firestore.rules member(). Same cause,
// same shape, three files that must be changed together.
const ACCESS_VALUES = [true, 'manager', 'owner'];

async function accessValue(uid, locationId) {
  const snap = await db().doc(`users/${uid}`).get();
  if (!snap.exists) return false;
  const locations = snap.data().locations;
  if (!locations || typeof locations !== 'object') return false;
  const value = locations[locationId];
  return ACCESS_VALUES.includes(value) ? value : false;
}

async function requireOwner(uid, locationId) {
  if (typeof locationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(locationId)) {
    throw new HttpsError('invalid-argument', 'Which location?');
  }
  if (await accessValue(uid, locationId) !== 'owner') {
    // Deliberately the same message whether they are staff there or have never
    // heard of the place: an error that distinguishes the two confirms the
    // location exists to somebody who should not know.
    throw new HttpsError('permission-denied', 'Only the owner can do that.');
  }
}

// Federico, and nobody else. One document, created once from the console — the
// same way everything else in this project is bootstrapped, needing no new
// tooling and no key.
//
// ⚠️ SINCE v272 AN ACCOUNT MAY READ ITS OWN admins/{uid}, so the app can decide
// whether to draw the entry at all. Nobody may write one, nobody may read
// somebody else's, and nobody may list the collection. This check is the real
// gate and never trusts anything the caller sends.
async function requireAppAdmin(uid) {
  const snap = await db().doc(`admins/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Not allowed.');
}

// One code, stored once. The write is the same for both shapes.
async function storeCode({ code, kind, locationId, role, createdBy }) {
  const now = Date.now();
  await db().doc(`join-codes/${codeId(code)}`).set({
    kind, locationId, role,
    createdBy, createdAt: now,
    expiresAt: now + TTL_MS[kind],
    failedAttempts: 0,
    usedAt: null, usedBy: null,
  });
  return now + TTL_MS[kind];
}

// ── 1. A new customer's location ─────────────────────────────────────────────

export const createWorkspace = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  await requireAppAdmin(uid);

  const name = String((request.data && request.data.name) || '').trim();
  if (!name || name.length > 80) {
    throw new HttpsError('invalid-argument', 'Give the business a name.');
  }

  // ⚠️ SECTIONS ARE CHOSEN HERE, AT CREATION. A section missing from this map
  // defaults to ON everywhere in this app — in js/sections.js and in
  // firestore.rules alike — so a customer who bought only the Calculator would
  // otherwise open the app to every screen in it. Writing them all explicitly is
  // what closes, for every new customer, the trap that needs a console visit for
  // the two venues that already exist.
  const wanted = (request.data && request.data.sections) || {};
  const sections = {};
  for (const key of ['orders', 'calculator', 'catalogue', 'pastries', 'foodcost']) {
    sections[key] = wanted[key] === true;
  }

  const locationId = mintLocationId();
  const now = Date.now();

  // ⚠️ TWO KINDS OF BUSINESS, AND THE DIFFERENCE IS WHO ENDS UP INSIDE.
  //
  // A CUSTOMER's business (the default): a link is minted and the caller does
  // NOT become a member. That is deliberate and must stay — it is somebody
  // else's data, staff and prices, and whoever sells the app has no business
  // holding the keys to it. See js/staff/businesses.js: the seller can see that
  // a business exists and re-issue an unopened link, and nothing more.
  //
  // ONE OF MY OWN (`forSelf`): there is nobody else to invite. Before 13 Aug 2026
  // the only route was to mint a link meant for a stranger and redeem it on
  // yourself — which failed outright, because signing up again with an email that
  // already has an account is refused, and the app's advice ("sign in instead")
  // led back to a screen that ignored the invitation. Federico hit exactly that
  // and could not add his second business. The link is not a missing feature
  // here; it is a step that should never have existed for this case.
  const forSelf = !!(request.data && request.data.forSelf === true);

  if (forSelf) {
    // ⚠️ ONE TRANSACTION, THREE WRITES. Half of this is worse than none of it: a
    // location that exists with no member is precisely the stranded state the
    // Businesses screen had to be built to repair (v273), and here it would be
    // stranded for the person who just created it, with no link to fall back on.
    await db().runTransaction(async (tx) => {
      tx.set(db().doc(`locations/${locationId}`), {
        name, sections, createdAt: now, createdBy: uid,
      });
      // The truth the rules read. merge:true because this account almost
      // certainly already owns something — that is what makes it "one of mine".
      tx.set(db().doc(`users/${uid}`),
        { locations: { [locationId]: membershipValue('owner') } }, { merge: true });
      // The roster row is a LABEL for the screen; the powers are above.
      tx.set(db().doc(`locations/${locationId}/members/${uid}`), {
        bakery: locationId,
        email: (request.auth.token && request.auth.token.email) || '',
        firstName: cleanName(request.data && request.data.firstName),
        lastName: cleanName(request.data && request.data.lastName),
        role: 'owner',
        joinedAt: now,
      });
    });

    logger.info('Workspace created for self', { locationId, by: uid });
    // ⚠️ NO TOKEN IS RETURNED, and none is minted. An unused link is a working
    // key: one left lying around for a business you are already inside is a way
    // in for whoever finds it, protecting nothing.
    return { locationId, mine: true };
  }

  const token = mintLinkToken();

  await db().doc(`locations/${locationId}`).set({
    name, sections, createdAt: now, createdBy: uid,
  });
  const expiresAt = await storeCode({
    code: token, kind: 'link', locationId, role: 'owner', createdBy: uid,
  });

  // ⚠️ NO ACCOUNT IS CREATED FOR THE CUSTOMER. They sign up themselves, with
  // their own email and their own password, and redeem the link. Minting an
  // account here would mean knowing — and having to transmit — a password
  // belonging to somebody whose business this is.
  logger.info('Workspace created', { locationId, by: uid });
  return { locationId, token, expiresAt, mine: false };
});

// ── 1b. The customers I have created, and a second chance at their link ──────
//
// ⚠️ WHY THESE EXIST AT ALL. locations/{lid} is readable only by a MEMBER, and
// whoever creates a customer is deliberately not one — so without these two, a
// business created here is invisible from the moment it is made, and the link
// (stored only as a sha256) is unrecoverable if it never arrives. The Firebase
// console was the only way back.
//
// ⚠️ AND WHY THEY ARE FUNCTIONS RATHER THAN A RULES CHANGE. Letting an
// administrator read locations from the rules needs a get(admins/{uid}) inside
// the locations rule, and that ruleset is at Firestore's exact 10-read ceiling —
// one more read has already produced an evaluation error on 8 rules. The Admin
// SDK is not subject to any of it.

// ⚠️ `createdBy` HAS BEEN STORED SINCE createWorkspace EXISTED, so this needs no
// backfill. Federico's OWN two venues predate it and therefore never appear here,
// which is right: this screen is the customers of the app, not the places he runs.
export const listWorkspaces = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  await requireAppAdmin(uid);

  // Equality on a single field: no composite index to create or forget.
  const snap = await db().collection('locations').where('createdBy', '==', uid).get();

  // ⚠️ COST (P14): one extra read per location, and it is worth being deliberate
  // about. `limit(1)` makes each one the cheapest question Firestore can answer —
  // "is there anybody at all" — rather than fetching a roster nothing here shows.
  const rows = await Promise.all(snap.docs.map(async (doc) => {
    const data = doc.data() || {};
    const members = await db().collection(`locations/${doc.id}/members`).limit(1).get();
    return {
      id: doc.id,
      name: typeof data.name === 'string' ? data.name : doc.id,
      sections: data.sections && typeof data.sections === 'object' ? data.sections : {},
      createdAt: Number(data.createdAt) || 0,
      // ⚠️ CLAIMED IS DECIDED BY THE ROSTER, NOT BY THE CODE. A code's usedAt is a
      // fact about that code; a location can outlive several. redeemJoinCode
      // writes the membership and the roster row in ONE transaction, so a member
      // existing is the same fact as somebody having got in.
      claimed: !members.empty,
    };
  }));

  rows.sort((a, b) => b.createdAt - a.createdAt);
  return { workspaces: rows };
});

// A fresh owner link for a business whose first one never arrived.
export const reissueOwnerLink = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  await requireAppAdmin(uid);

  const locationId = request.data && request.data.locationId;
  if (typeof locationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(locationId)) {
    throw new HttpsError('invalid-argument', 'Which business?');
  }

  const doc = await db().doc(`locations/${locationId}`).get();
  // Same message for "not there" and "not yours": an error that told them apart
  // would confirm a location exists to somebody with no business knowing.
  if (!doc.exists || (doc.data() || {}).createdBy !== uid) {
    throw new HttpsError('permission-denied', 'Not allowed.');
  }

  // ⚠️⚠️ THE CONSTRAINT THE WHOLE FUNCTION RESTS ON. Without it, whoever runs this
  // app could mint themselves the owner's way into a customer's LIVE business, at
  // any time, for ever. With it, the power exists only while the place belongs to
  // nobody — which is exactly the case this is for.
  const members = await db().collection(`locations/${locationId}/members`).limit(1).get();
  if (!members.empty) {
    throw new HttpsError('failed-precondition',
      'Somebody has already opened this business. Its owner can add people from inside it.');
  }

  // ⚠️ SPEND THE OLD LINKS FIRST. A link nobody used is still a working key: if
  // the first one turns up later in somebody else's hands, it opens the business.
  // Equality on locationId alone — a single field, so no composite index — with
  // kind and usedAt filtered here, because a location has a handful of codes.
  const codes = await db().collection('join-codes').where('locationId', '==', locationId).get();
  const now = Date.now();
  const batch = db().batch();
  let revoked = 0;
  codes.docs.forEach((code) => {
    const value = code.data() || {};
    if (value.kind === 'link' && !value.usedAt) {
      // usedAt is what codeStatus() reads, so the old link now reports itself
      // spent through exactly the path every other dead code takes.
      batch.update(code.ref, { usedAt: now, revokedBy: uid });
      revoked += 1;
    }
  });
  if (revoked) await batch.commit();

  const token = mintLinkToken();
  const expiresAt = await storeCode({
    code: token, kind: 'link', locationId, role: 'owner', createdBy: uid,
  });

  logger.info('Owner link reissued', { locationId, by: uid, revoked });
  return { token, expiresAt };
});

// The membership value a role is written as.
//
// ⚠️ ONE PLACE, AND IT HAS TO BE ONE PLACE. Two writers store a membership —
// redeemJoinCode when somebody joins, and setMemberRole when somebody is
// promoted — and each used to do this conversion inline. Two copies of a mapping
// drift, and the way they drift here is silent: a manager promoted through one
// path and joined through the other would hold different powers with nothing on
// any screen saying so.
//
// ⚠️ AND THE FALLBACK IS `true`, THE LEAST POWER. Anything this file does not
// recognise is written as an ordinary employee, never as something more.
// js/roles.js reads the same three values the same way, in the other direction.
function membershipValue(role) {
  if (role === 'owner') return 'owner';
  if (role === 'manager') return 'manager';
  return true;
}

// The three roles this file will write down, and nothing else.
const WRITABLE_ROLES = ['owner', 'manager', 'staff'];

// A name for the roster: whitespace collapsed, capped, never trusted raw.
//
// ⚠️ IT IS A LABEL, NEVER AN IDENTITY. Nothing decides a permission from it —
// two people may share one, and renaming somebody must never change what they
// can do. The identity is the uid, and the powers are the membership value.
//
// ⚠️ A DELIBERATE MISMATCH WITH js/credentials.js: the app REFUSES an empty name
// so the form cannot be skipped, while this ACCEPTS one and stores ''. A server
// that refused would make the roster row the thing that can fail, and somebody
// with a valid code would be left outside over a blank box. Better in with no
// name — which the owner can then type — than out.
const MAX_NAME = 60;
function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

// ── 2. A code for one person ─────────────────────────────────────────────────

export const createJoinCode = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  const locationId = request.data && request.data.locationId;
  await requireOwner(uid, locationId);

  // ⚠️ AN UNRECOGNISED ROLE BECOMES AN EMPLOYEE, it is never refused. A code is
  // minted by the owner standing next to the person; failing the whole errand
  // over a typo in a field nobody typed helps nobody, and the safe reading of an
  // unknown role is the smallest one.
  const asked = request.data && request.data.role;
  const role = WRITABLE_ROLES.includes(asked) ? asked : 'staff';
  const code = mintDigits();
  const expiresAt = await storeCode({ code, kind: 'digits', locationId, role, createdBy: uid });

  logger.info('Join code created', { locationId, role, by: uid });
  // The plain code is returned to the owner's screen ONCE and never stored.
  return { code, role, expiresAt };
});

// ── 3. The only write to users/{uid} ─────────────────────────────────────────

// ⚠️ THE RATE LIMIT IS WHAT MAKES SIX DIGITS SAFE, and it is counted against the
// CALLER, not the code — a search would otherwise just move to the next guess.
// The caller must therefore already be signed in, which also means Firebase
// Auth's own sign-up limits sit in front of this.
async function chargeAttempt(uid) {
  const ref = db().doc(`rate-limits/${uid}`);
  const now = Date.now();
  const snap = await ref.get();
  const record = snap.exists ? snap.data() : null;

  if (isRateLimited(record, now)) {
    return { blocked: true, retryMs: retryAfterMs(record, now) };
  }
  // Keep only what still matters, so the document cannot grow for ever.
  const kept = (record && Array.isArray(record.attempts) ? record.attempts : [])
    .filter(t => Number.isFinite(Number(t)) && now - Number(t) < ATTEMPT_WINDOW_MS);
  await ref.set({ attempts: [...kept, now].slice(-MAX_ATTEMPTS_PER_HOUR * 2), updatedAt: now });
  return { blocked: false };
}

export const redeemJoinCode = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  const kind = (request.data && request.data.kind) === 'link' ? 'link' : 'digits';
  const code = String((request.data && request.data.code) || '');

  // Charged BEFORE the code is even looked at, so a malformed guess costs the
  // same as a well-formed one and the shape of a code cannot be probed for free.
  const limit = await chargeAttempt(uid);
  if (limit.blocked) {
    logger.info('Redeem refused', { uid, reason: 'rate-limited' });
    throw new HttpsError('resource-exhausted', redeemFailureText('rate-limited', limit.retryMs));
  }

  if (!isWellFormed(code, kind)) {
    logger.info('Redeem refused', { uid, reason: 'malformed' });
    throw new HttpsError('permission-denied', redeemFailureText('missing'));
  }

  const ref = db().doc(`join-codes/${codeId(code)}`);

  // ⚠️ A TRANSACTION, because two phones redeeming the same code at the same
  // instant would otherwise both find it unused and both be let in. Single use
  // has to mean single use even when the two requests overlap.
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = snap.exists ? snap.data() : null;
    const status = codeStatus(doc, Date.now());

    if (status !== 'ok') {
      // A wrong guess against a code that EXISTS costs that code one of its five
      // lives; a guess at nothing costs only the caller's hourly allowance.
      if (doc && status !== 'used') {
        tx.update(ref, { failedAttempts: FieldValue.increment(1) });
      }
      return { ok: false, status };
    }

    const { locationId, role } = doc;
    const value = membershipValue(role);

    // Both writes in one transaction. users/{uid} is the TRUTH — it is what the
    // rules read. The members roster below is for the screen only.
    tx.set(db().doc(`users/${uid}`),
      { locations: { [locationId]: value } }, { merge: true });
    tx.set(db().doc(`locations/${locationId}/members/${uid}`), {
      bakery: locationId,
      email: (request.auth.token && request.auth.token.email) || '',
      // ⚠️ CLEANED AND CAPPED ON THE SERVER TOO, not only on the phone. The app's
      // checks are what make the form usable; they are not what makes the data
      // safe, because this function can be called without the app at all.
      firstName: cleanName(request.data && request.data.firstName),
      lastName: cleanName(request.data && request.data.lastName),
      role: WRITABLE_ROLES.includes(role) ? role : 'staff',
      joinedAt: Date.now(),
    });
    tx.update(ref, { usedAt: Date.now(), usedBy: uid });
    return { ok: true, locationId, role };
  });

  if (!result.ok) {
    logger.info('Redeem refused', { uid, reason: result.status });
    throw new HttpsError('permission-denied', redeemFailureText(result.status));
  }

  logger.info('Joined', { uid, locationId: result.locationId, role: result.role });
  return { locationId: result.locationId, role: result.role };
});

// ── 4. Promote, demote, remove ───────────────────────────────────────────────

export const setMemberRole = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  const { locationId, uid: targetUid, role } = request.data || {};
  await requireOwner(uid, locationId);

  if (typeof targetUid !== 'string' || !targetUid) {
    throw new HttpsError('invalid-argument', 'Which person?');
  }
  // ⚠️ HERE AN UNKNOWN ROLE IS REFUSED rather than quietly reduced, which is the
  // opposite of the join code above and is deliberate. This call names a person
  // who is ALREADY in the roster: silently writing them down as an employee
  // because a word was misspelled would take powers away from somebody who has
  // them, and the screen would show the change as if it had been asked for.
  if (role !== null && !WRITABLE_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument',
      'A person is an owner, a manager, an employee, or gone.');
  }

  // ⚠️ THE LAST OWNER CANNOT BE DEMOTED OR REMOVED, and this is not politeness.
  // A location with no owner has nobody who can invite, nobody who can delete and
  // nobody who can promote anyone — it would need the Firebase console to
  // recover, which is the thing this whole file exists to stop needing. The check
  // has to count the roster, so it happens before the write and inside no
  // transaction it could race with; a second owner being demoted concurrently is
  // survivable (the loser is told to try again by the read below).
  if (role !== 'owner') {
    const owners = await db().collection(`locations/${locationId}/members`)
      .where('role', '==', 'owner').get();
    const remaining = owners.docs.filter(d => d.id !== targetUid).length;
    if (remaining === 0) {
      throw new HttpsError('failed-precondition',
        'This is the only owner. Make somebody else an owner first.');
    }
  }

  const memberRef = db().doc(`locations/${locationId}/members/${targetUid}`);
  const userRef = db().doc(`users/${targetUid}`);

  if (role === null) {
    await db().runTransaction(async (tx) => {
      tx.set(userRef, { locations: { [locationId]: FieldValue.delete() } }, { merge: true });
      tx.delete(memberRef);
    });
    logger.info('Member removed', { locationId, targetUid, by: uid });
    return { removed: true };
  }

  await db().runTransaction(async (tx) => {
    tx.set(userRef,
      { locations: { [locationId]: membershipValue(role) } }, { merge: true });
    tx.set(memberRef, { role }, { merge: true });
  });
  logger.info('Member role changed', { locationId, targetUid, role, by: uid });
  return { role };
});

// ── 5. Give somebody a name ──────────────────────────────────────────────────
//
// The roster is written by redeemJoinCode from what the person typed, so almost
// every row names itself. This exists for the two cases where that is not true:
// the accounts created BY HAND in the Firebase console years before any of this
// existed and have no name at all, and the ordinary correction — a typo, or
// "Luca (forno)" because there are two Lucas.
//
// ⚠️ IT WRITES ONLY THE ROSTER, NEVER users/{uid}. A name decides nothing: two
// people may share one, and renaming somebody must never change what they can
// do. Keeping this call away from the document that grants access is what makes
// that structurally true rather than a promise.
export const setMemberName = onCall(CALL, async (request) => {
  const uid = requireAuth(request);
  const { locationId, uid: targetUid, firstName, lastName } = request.data || {};
  await requireOwner(uid, locationId);

  if (typeof targetUid !== 'string' || !targetUid) {
    throw new HttpsError('invalid-argument', 'Which person?');
  }

  const first = cleanName(firstName);
  const last = cleanName(lastName);
  // ⚠️ BOTH BLANK IS REFUSED HERE, though redeemJoinCode accepts it. The
  // difference is what failing costs: there, refusing would lock somebody with a
  // valid code out of the app over a blank box; here, the person is already in
  // and the only outcome of an empty save is a row that silently loses the name
  // it had.
  if (!first && !last) {
    throw new HttpsError('invalid-argument', 'Give them a name.');
  }

  const ref = db().doc(`locations/${locationId}/members/${targetUid}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'That person is not in this location.');
  }

  await ref.set({ firstName: first, lastName: last }, { merge: true });
  logger.info('Member renamed', { locationId, targetUid, by: uid });
  return { firstName: first, lastName: last };
});
