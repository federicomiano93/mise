// The only code in this project that does not run on a phone.
//
// It exists for one reason: when you leave the app, the phone SUSPENDS the page.
// Nothing runs, so nothing can ring. A notification has to arrive from outside the
// device — which means something has to be awake when the phone is not.
//
// Three pieces, and nothing else:
//   1. a phone asks for an alarm  → schedule the job for that instant
//   2. the job comes due          → ask whether it is still wanted, then send
//   3. a client sends an order    → tell the bakery's phones straight away
//
// ⚠️ push-model.js IS A COPY OF js/push-model.js, AND A TEST PINS THEM IDENTICAL.
// Whether an alarm is still wanted is a JUDGEMENT, and two copies of a judgement
// drift — the phone would think it had cancelled something the server still
// believed in. It cannot simply be imported across: a functions deploy uploads
// only this folder, so a reference to ../js/ would resolve on this machine and be
// missing in the cloud. The project already carries duplicated files for the same
// kind of reason (confirm-dialog.js, dom.js) and already has the sentinel that
// stops them drifting: tests/copie-allineate.test.mjs.

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

import {
  isSchedulable, isStillDue, skipReason,
  timerNotification, orderNotification, orderRequestNotification,
  notificationTag, targetPage,
} from './push-model.js';
import { isAway } from './away-model.js';

initializeApp();

// Same region as everything else, and stated once so a later function cannot
// quietly land somewhere else and take a continent of latency with it.
const REGION = 'us-central1';
const QUEUE = 'sendTimerPush';

// ── Sending, in one place ────────────────────────────────────────────────────

// ⚠️ A TOKEN THAT NO LONGER EXISTS IS DELETED, NOT RETRIED FOR EVER. Phones are
// reinstalled and tokens rotate; without this the location accumulates dead
// registrations, and every future order notification pays to fail against each
// one of them.
async function sendTo(token, { title, body }, { tag, url, path }) {
  try {
    await getMessaging().send({
      token,
      // DATA-ONLY on purpose: a `notification` block would be displayed by the
      // browser itself, and sw.js would lose its two decisions — whether to show
      // it at all (not while somebody is looking at the app) and what it says.
      data: { title, body, tag, url },
      webpush: { headers: { Urgency: 'high' } },
    });
    return true;
  } catch (err) {
    const code = err && err.errorInfo ? err.errorInfo.code : (err && err.code) || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
      logger.info('Dropping a dead registration', { path });
      if (path) await getFirestore().doc(path).delete().catch(() => {});
      return false;
    }
    logger.error('Send failed', { code, message: err && err.message });
    return false;
  }
}

// ── 1 + 2. A scheduled alarm ─────────────────────────────────────────────────

// A phone wrote locations/{lid}/push-timers/{id}. Book the job for its instant.
//
// ⚠️ VALIDATED AGAIN HERE even though the rules already checked the shape. The
// rules cannot compare fireAt to the clock — they have no clock — so "not in the
// past, not a week away" can only be enforced at this end.
export const scheduleTimerPush = onDocumentCreated(
  { region: REGION, document: 'locations/{lid}/push-timers/{id}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const timer = snap.data();
    const now = Date.now();

    if (!isSchedulable(timer.fireAt, now)) {
      logger.info('Not scheduling', { id: event.params.id, reason: 'outside the allowed window' });
      return;
    }

    await getFunctions().taskQueue(QUEUE, REGION).enqueue(
      { lid: event.params.lid, id: event.params.id },
      { scheduleTime: new Date(timer.fireAt) },
    );
    logger.info('Alarm scheduled', { id: event.params.id, at: new Date(timer.fireAt).toISOString() });
  },
);

// The job came due.
//
// ⚠️ IT RE-READS THE DOCUMENT AND ASKS WHETHER IT IS STILL WANTED. This is the
// whole cancellation mechanism, and it is a READ rather than a delete because a
// delete fails quietly in every way a network can — refused, or arriving after
// the job was already picked up — and the result is a phone buzzing for a step
// finished ten minutes ago. A failed read here sends nothing, which is the safe
// direction. isStillDue() also drops a job that fires early or very late.
//
// ⚠️ retryCount 0: a push that failed is NOT worth retrying. By the time a retry
// lands the moment has passed, and MAX_LATE_MS would refuse it anyway — so a
// retry could only ever produce a late buzz or a duplicate.
export const sendTimerPush = onTaskDispatched(
  { region: REGION, retryConfig: { maxAttempts: 1 }, rateLimits: { maxConcurrentDispatches: 20 } },
  async (req) => {
    const { lid, id } = req.data || {};
    if (!lid || !id) return;
    const path = `locations/${lid}/push-timers/${id}`;
    const snap = await getFirestore().doc(path).get();
    const timer = snap.exists ? snap.data() : null;
    const now = Date.now();

    if (!isStillDue(timer, now)) {
      // Said out loud, always. A phone that stayed quiet with nothing in the log
      // is indistinguishable from a broken function.
      logger.info('Alarm not sent', { id, reason: skipReason(timer, now) });
      return;
    }

    await sendTo(timer.token, timerNotification(timer), {
      tag: notificationTag('timer', id),
      url: targetPage('timer'),
      path: `locations/${lid}/fcm-tokens/${timer.token}`,
    });
    logger.info('Alarm sent', { id });
  },
);

// ── 3. A client sent an order ────────────────────────────────────────────────

// ⚠️ ON CREATE ONLY. A client may correct an order, and every correction rewrites
// the same document — notifying on every write would buzz the bakery once per
// keystroke-batch. The screen already shows a correction loudly; the FIRST
// arrival is the thing nobody would otherwise notice.
export const notifyClientOrder = onDocumentCreated(
  { region: REGION, document: 'locations/{lid}/client-orders/{id}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const order = snap.data();
    const lid = event.params.lid;

    const tokens = await getFirestore().collection(`locations/${lid}/fcm-tokens`).get();
    if (tokens.empty) {
      logger.info('An order arrived, but no phone here has notifications on', { lid });
      return;
    }

    // ⚠️ A HOLIDAY SILENCES THIS ONE TOO. A client order goes to every phone in
    // the venue, so without this the one thing somebody on holiday would still be
    // buzzed about is the busiest one. The ORDER is untouched: it sits in the app
    // with its banner and its badge, exactly as before.
    const onHoliday = await awaySet(lid);
    const targets = tokens.docs.filter(d => !onHoliday.has(d.data().uid));
    if (!targets.length) {
      logger.info('An order arrived, but everybody with notifications on is away', { lid });
      return;
    }

    const message = orderNotification(order);
    const tag = notificationTag('order', event.params.id);
    // Sent one at a time so a single dead registration is dropped by itself
    // rather than failing the batch for every phone that is fine.
    const results = await Promise.all(targets.map(d => sendTo(d.id, message, {
      tag, url: targetPage('order'), path: d.ref.path,
    })));
    logger.info('Order notification', { lid, sent: results.filter(Boolean).length, of: results.length });
  },
);

// ── 3b. Somebody sent an order list to whoever runs the place ────────────────

// The interface language this venue's staff read, for the words in the
// notification. ⚠️ A NOTIFICATION IS THE ONE TEXT THE APP CANNOT BUILD: it is
// written while nobody is looking at the page that knows the language, so the
// server has to look it up. A failed read falls back to English rather than to
// silence — see say() in push-model.js.
// ⚠️ ONE READ, TWO ANSWERS. The language and the venue's NAME live on the same
// document, and a notification needs both — asking twice would double the reads on
// every order list sent, for a fact already in hand (P14).
async function venueOf(lid) {
  try {
    const snap = await getFirestore().doc(`locations/${lid}`).get();
    const data = snap.exists ? snap.data() : {};
    return { lang: data.language || 'en', name: data.name || '' };
  } catch (err) {
    // ⚠️ A FAILED READ STILL SENDS. The alert matters more than the language it is in
    // or the name it carries; a silent phone would be a worse answer than an English
    // one, and the sentence is written to read without either.
    logger.warn('Could not read the venue; sending in English with no venue name', { lid });
    return { lang: 'en', name: '' };
  }
}

// Who has said "do not buzz my phone, I am on holiday", right now.
//
// ⚠️ A FAILED READ MEANS NOBODY IS AWAY — phones ring. One unnecessary
// notification is recoverable; a list that reaches nobody because a read failed
// is not. The same direction the model takes, for the same reason.
//
// ⚠️ AND IT ENDS BY ITSELF: isAway() compares the stored date with today, so a
// holiday that has passed silences nothing and nothing has to run at midnight to
// make that true.
async function awaySet(lid) {
  try {
    const snap = await getFirestore().collection(`locations/${lid}/away`).get();
    const now = Date.now();
    const out = new Set();
    snap.docs.forEach(d => {
      const doc = { ...d.data(), uid: d.data().uid || d.id };
      if (isAway(doc, now)) out.add(doc.uid);
    });
    return out;
  } catch (err) {
    logger.warn('Could not read who is away; everybody will be notified', { lid });
    return new Set();
  }
}

// ⚠️ ONLY THE PEOPLE IT WAS ADDRESSED TO. Every other notification in this app
// goes to every phone in the location; this one must not. A list is prepared FOR
// whoever runs the place, and buzzing the whole kitchen for it is how a team
// learns to ignore the app's notifications — taking the useful ones with them.
//
// ⚠️ AND NEVER THE SENDER, even when the sender runs the place: writing the list
// now and ordering it later is a real way to work, and a phone that buzzes at the
// person who just pressed the button is a phone reporting its own tap.
//
// The role is the membership VALUE (users/{uid}.locations.<lid>), the same fact
// firestore.rules reads. Each uid is read ONCE however many phones it has (P14).
async function managersAmong(tokens, lid, senderUid) {
  const db = getFirestore();
  const roleByUid = new Map();
  const away = await awaySet(lid);

  const uids = [...new Set(tokens.map(d => d.data().uid).filter(Boolean))];
  await Promise.all(uids.map(async uid => {
    if (away.has(uid)) { roleByUid.set(uid, undefined); return; }
    try {
      const snap = await db.doc(`users/${uid}`).get();
      const access = snap.exists ? (snap.data().locations || {})[lid] : undefined;
      roleByUid.set(uid, access);
    } catch (err) {
      // ⚠️ A FAILED READ MEANS "DO NOT SEND", NOT "SEND ANYWAY". The safe
      // direction here is silence: a missed notification is a list still sitting
      // in the app where the banner and the badge will show it.
      logger.warn('Could not read a role; that phone is skipped', { uid });
      roleByUid.set(uid, undefined);
    }
  }));

  return tokens.filter(d => {
    const uid = d.data().uid;
    if (!uid || uid === senderUid) return false;
    // ⚠️ "DO NOT BUZZ ME ABOUT ORDER LISTS", asked by THIS PHONE about itself. Somebody
    // may want the alert on the phone in their pocket and not on the tablet in the
    // kitchen, so it is a property of the token and not of the person.
    //
    // ⚠️ ONLY AN EXPLICIT `true` SILENCES. A missing field, a string, a half-written
    // document — none of those is somebody asking for quiet, and reading them as one
    // would silence a phone nobody meant to silence.
    if (d.data().muteOrderRequests === true) return false;
    const access = roleByUid.get(uid);
    // Exactly what runsThePlace() asks in the rules: a string, and one of the two.
    return access === 'owner' || access === 'manager';
  });
}

export const notifyOrderRequest = onDocumentCreated(
  { region: REGION, document: 'locations/{lid}/order-requests/{id}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const request = snap.data();
    const lid = event.params.lid;

    const tokens = await getFirestore().collection(`locations/${lid}/fcm-tokens`).get();
    const targets = await managersAmong(tokens.docs, lid, request.fromUid);
    if (!targets.length) {
      // Said out loud, always: a quiet phone with nothing in the log is
      // indistinguishable from a broken function.
      logger.info('An order list arrived, but nobody who runs this place has notifications on',
        { lid, phones: tokens.size });
      return;
    }

    const venue = await venueOf(lid);
    const message = orderRequestNotification(request, venue.lang, venue.name);
    const tag = notificationTag('orderRequest', event.params.id);
    const results = await Promise.all(targets.map(d => sendTo(d.id, message, {
      tag, url: targetPage('orderRequest'), path: d.ref.path,
    })));
    logger.info('Order-list notification', {
      lid, sent: results.filter(Boolean).length, of: results.length,
    });
  },
);

// ── 4. Letting somebody in without opening the Firebase console ──────────────
//
// The onboarding calls live in their own file because they have nothing to do
// with notifications; re-exported here because a Firebase deploy publishes what
// index.js exports. See functions/onboarding.js for why they cannot be done from
// the app.
//
// ⚠️ A CALLABLE MISSING FROM THIS LIST IS NOT DEPLOYED, and the app's call to it
// fails with the client's generic "internal" — which says nothing and looks
// exactly like a broken function.
export {
  createWorkspace, listWorkspaces, reissueOwnerLink, deleteWorkspace,
  createJoinCode, redeemJoinCode, setMemberRole, setMemberName,
  setLocationLanguage,
} from './onboarding.js';

// Reading a photographed recipe. ⚠️ THE ONLY FUNCTION HERE THAT HOLDS A REAL
// SECRET AND SPENDS MONEY PER CALL — it carries its own options object with the
// secret and a maxInstances ceiling, deliberately not the shared one.
export { readRecipeFromPhotos } from './recipe-photo.js';
