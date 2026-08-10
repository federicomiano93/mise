// guided-alarm.js — the sound a finished step makes, and keeping the screen lit.
//
// Two small pieces of the phone, kept together because they are the two things a
// guided mix needs from the device and the two things this project cannot test
// from a desktop.
//
// ── The sound ────────────────────────────────────────────────────────────────
//
// ⚠️ A FILE, NOT A SYNTHESISED TONE, AND NOT A data: URI.
//
//   A `data:` URI is refused outright: every page here declares
//   `default-src 'self'` and sets no media-src, so the audio would simply never
//   load — and it would fail on the phone while working in whatever tool it was
//   written with.
//
//   Web Audio (an oscillator) needs no file at all, which is tempting, but on iOS
//   it is the variant most reliably silenced by the ring/silent switch. An alarm
//   that is quiet exactly when the bakery is loud is not an alarm.
//
// sounds/alarm.wav is one second: three beeps and a gap, so `loop` repeats it
// seamlessly. 16 KB, 8 kHz mono — an alarm is not music, and this ships to every
// phone. Regenerate with a sine at 880 Hz, 100 ms on / 100 ms off × 3, 500 ms
// tail, 8 ms fade at each edge so no beep starts on a click.
//
// ⚠️ AND THE SOUND IS NEVER THE ONLY SIGNAL. It can be muted by a hardware switch
// nobody in this app can read, so a finished step also lights the screen (the
// wake lock below has kept it on) and vibrates where that exists. If the beep
// never arrives, the guided mix still works.

const ALARM_SRC = './sounds/alarm.wav';

// Stop after a minute. An alarm nobody is coming back to should not still be
// going when they do — and a phone left beeping on a bench for an hour is how a
// feature gets turned off for good.
const MAX_RING_MS = 60 * 1000;

// The vibration pattern mirrors the sound: three pulses, then quiet. Android
// honours it; iOS Safari has no Vibration API at all, which is why it can only
// ever be the third signal and never the first.
const BUZZ = [180, 120, 180, 120, 180];

let audio = null;
let ringTimer = null;
let buzzTimer = null;

function element() {
  if (audio) return audio;
  audio = new Audio(ALARM_SRC);
  audio.loop = true;
  audio.preload = 'auto';
  return audio;
}

// ⚠️ CALL THIS FROM A REAL TAP, AND ONLY FROM ONE. A browser refuses to play
// audio a person has not asked for, and the refusal lands LATER — at the moment
// the timer ends, when there is nobody touching the screen to authorise it. So
// the sound is authorised in advance, on the tap that starts the guided mix: it
// is played muted for an instant and stopped again, which is enough for the
// browser to treat every later play as wanted.
export function unlockAlarm() {
  try {
    const el = element();
    el.muted = true;
    const played = el.play();
    const settle = () => { try { el.pause(); el.currentTime = 0; el.muted = false; } catch (e) {} };
    if (played && typeof played.then === 'function') played.then(settle, settle);
    else settle();
  } catch (e) {
    // No audio on this device, or the gesture was not accepted. The screen and
    // the vibration still signal, so this is never fatal.
  }
}

export function startAlarm() {
  stopAlarm();
  try {
    const el = element();
    el.currentTime = 0;
    el.muted = false;
    const played = el.play();
    if (played && typeof played.then === 'function') played.catch(() => {});
  } catch (e) {}

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(BUZZ); } catch (e) {}
    // Repeat the buzz while it rings; one pulse is missed by a hand in dough.
    buzzTimer = setInterval(() => { try { navigator.vibrate(BUZZ); } catch (e) {} }, 2000);
  }

  ringTimer = setTimeout(stopAlarm, MAX_RING_MS);
}

export function stopAlarm() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (buzzTimer) { clearInterval(buzzTimer); buzzTimer = null; }
  try { if (audio) { audio.pause(); audio.currentTime = 0; } } catch (e) {}
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(0); } catch (e) {}
  }
}

// ── Keeping the screen on ─────────────────────────────────────────────────────
//
// A phone dims and locks itself after half a minute, which is fine for a screen
// you are reading and useless for one you are working next to. The Wake Lock API
// asks it not to, for as long as the guided mix is open, and that single call is
// what turns this from a page into a kitchen timer: the phone sits on the bench,
// lit, showing the countdown.
//
// ⚠️ THE LOCK IS RELEASED BY THE BROWSER WHENEVER THE PAGE IS HIDDEN, and it does
// NOT come back by itself. Without the visibilitychange listener below, glancing
// at another app once would leave the screen free to sleep for the rest of the
// dough — which looks exactly like the feature not working.
//
// Absent on older iOS (before 16.4) and on any browser that does not offer it.
// Nothing here fails in that case; the screen simply sleeps as it always did, and
// the countdown is still correct when it is woken, because nothing here counts.

let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel) return;
  const api = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
  if (!api || typeof api.request !== 'function') return;
  try {
    sentinel = await api.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch (e) {
    // Refused (a battery-saver, a background tab, an unsupported context).
    sentinel = null;
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') acquire();
}

export function keepScreenAwake() {
  if (wanted) return;
  wanted = true;
  document.addEventListener('visibilitychange', onVisible);
  acquire();
}

export function releaseScreen() {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisible);
  const held = sentinel;
  sentinel = null;
  if (held) { try { held.release(); } catch (e) {} }
}

// True when this device can hold the screen on, so the screen can say what it
// actually does rather than promising something that will not happen.
export function canKeepScreenAwake() {
  return typeof navigator !== 'undefined'
    && !!navigator.wakeLock && typeof navigator.wakeLock.request === 'function';
}
