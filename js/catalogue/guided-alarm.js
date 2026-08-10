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
  try {
    audio = new Audio(ALARM_SRC);
    audio.loop = true;
    audio.preload = 'auto';
    // ⚠️ ASK FOR THE FILE NOW, at the tap that starts the timer, rather than
    // leaving it to `preload`. A browser is free to ignore preload, and the one
    // moment the sound is needed — minutes later, on a phone in a bakery — is the
    // worst possible moment to discover it still has to be fetched.
    try { audio.load(); } catch (e) {}
  } catch (e) {
    audio = null;
  }
  return audio;
}

// Every one of these can throw on its own (rewinding a clip the browser has not
// loaded yet is the usual culprit), and each is wrapped alone for one reason:
// ⚠️ THE ONLY LINE THAT MATTERS IS play(), AND IT MUST NEVER BE HOSTAGE TO THE
// LINES AROUND IT. With rewind and play in one try block, a throw on the rewind
// meant the alarm never even started — silently, because the catch was there to
// keep a missing sound from breaking the screen.
const attempt = (fn) => { try { fn(); } catch (e) { /* best-effort */ } };

function play(el) {
  try {
    const started = el.play();
    if (started && typeof started.then === 'function') started.catch(() => {});
    return started;
  } catch (e) {
    return null;
  }
}

// ⚠️ CALL THIS FROM A REAL TAP, AND ONLY FROM ONE. A browser refuses to play
// audio a person has not asked for, and the refusal lands LATER — at the moment
// the timer ends, when there is nobody touching the screen to authorise it. So
// the sound is authorised in advance, on the tap that starts the guided mix: it
// is played muted for an instant and stopped again, which is enough for the
// browser to treat every later play as wanted.
export function unlockAlarm() {
  const el = element();
  if (!el) return; // no audio on this device — the screen and buzz still signal
  attempt(() => { el.muted = true; });
  const started = play(el);
  const settle = () => {
    attempt(() => el.pause());
    attempt(() => { el.currentTime = 0; });
    attempt(() => { el.muted = false; });
  };
  if (started && typeof started.then === 'function') started.then(settle, settle);
  else settle();
}

export function startAlarm() {
  stopAlarm();
  const el = element();
  if (el) {
    // Order matters: unmute, then PLAY, and only then rewind. stopAlarm() above
    // has already rewound it, so the rewind here is belt-and-braces — which is
    // exactly why it must come after the line that actually makes a sound.
    attempt(() => { el.muted = false; });
    play(el);
    attempt(() => { el.currentTime = 0; });
  }

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
  if (audio) {
    // Separately again: a failed rewind must not leave the sound still playing.
    attempt(() => audio.pause());
    attempt(() => { audio.currentTime = 0; });
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    attempt(() => navigator.vibrate(0));
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
