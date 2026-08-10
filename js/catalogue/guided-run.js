// guided-run.js — following a recipe's mixing procedure, one step at a time.
//
// The screen someone stands in front of with their hands in dough, so it is built
// for exactly that: one instruction at a time, the amounts big enough to read from
// a step back, and a countdown that is right whatever the phone did while nobody
// was looking.
//
// ⚠️ EVERYTHING TIME-RELATED COMES FROM guided-model.js AND IS DERIVED FROM THE
// CLOCK. Nothing in this file counts seconds; the interval below only repaints.
// See the note in the model for why — a decrementing counter on a backgrounded
// phone comes back showing a time that never happened.
//
// ⚠️ THE RUN WORKS AGAINST A FROZEN SNAPSHOT, NOT THE LIVE RECIPE. The catalogue
// is a live listener: a recipe edited on another phone arrives mid-screen. Doing
// that here would change the amounts under somebody's hands halfway through a
// dough. The snapshot is taken on Start, exactly as the Calculator freezes a
// recipe onto a log and Orders freezes the item names onto a record.

import { el } from './dom.js';
import {
  normalizeSteps, amountsFor, stepRows, unassignedRows,
  timerState, formatRemaining, formatDuration, overdueText, progressText,
  isResumable, RESUME_TTL_MS,
} from './guided-model.js';
import { unitOf } from './catalogue-model.js';
import { unlockAlarm, startAlarm, stopAlarm, keepScreenAwake, releaseScreen, canKeepScreenAwake } from './guided-alarm.js';

const SESSION_KEY = 'catalogue-guided-run';
const TICK_MS = 250;
const EXTRA_MS = 60 * 1000; // what "+1 min" adds

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const PLAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"/></svg>';

// Whole numbers, no thousands separator — the same formatting as the recipe rows
// this screen quotes, so a number never reads differently in the two places.
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

// ── The saved session ─────────────────────────────────────────────────────────
// localStorage, not Firestore: it belongs to the phone doing the mixing, it must
// survive with no connection, and nobody else's screen should follow along.

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function writeSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// A run worth offering back: recent, whole, and for a recipe still in the
// catalogue. A recipe deleted since is dropped rather than resumed against a
// snapshot of something that no longer exists.
export function resumableSession(recipes, nowMs = Date.now()) {
  const saved = readSession();
  if (!isResumable(saved, nowMs)) return null;
  const recipe = (Array.isArray(recipes) ? recipes : []).find(r => r && r.id === saved.recipeId);
  return recipe ? saved : null;
}

// Everything the run needs, copied out of the recipe at the moment Start is
// tapped. `ingredients` comes along because a step names ROWS and those rows must
// keep the labels, units and amounts they had when the dough was started.
export function snapshotOf(recipe, targetGrams) {
  return {
    name: String(recipe.name || ''),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    steps: normalizeSteps(recipe.steps),
    targetGrams: Number(targetGrams) > 0 ? Number(targetGrams) : 0,
  };
}

// ── The screen ────────────────────────────────────────────────────────────────

export function renderRun({ recipe, targetGrams, app, resume = null }) {
  const snapshot = resume ? resume.snapshot : snapshotOf(recipe, targetGrams);
  const steps = normalizeSteps(snapshot.steps);
  const amounts = amountsFor(snapshot, snapshot.targetGrams);

  let index = resume ? Number(resume.stepIndex) : 0;
  let endsAt = resume && Number(resume.endsAt) > 0 ? Number(resume.endsAt) : 0;
  const startedAt = resume ? Number(resume.startedAt) : Date.now();
  // Which timer the alarm has already sounded for, so it rings once per step and
  // not once per repaint.
  let alarmedFor = 0;
  let finished = false;
  let ticker = null;

  const body = el('div', { class: 'guided-body' });
  // ⚠️ `.guided-run` IS THE MARKER TWO OTHER MODULES LOOK FOR — js/update-gate.js
  // (so a compulsory update waits instead of reloading the page mid-dough) and
  // js/idle-reset.js (so five minutes in the background does not bounce someone
  // back to the Home screen with their hands in flour). It is built here and torn
  // down on leaving, so it exists ONLY while the run is on screen; a marker that
  // outlived the screen would make the app look permanently busy and the update
  // would never appear again, silently.
  const root = el('div', { class: 'guided-run' }, [body]);

  function save() {
    if (finished) return;
    writeSession({ recipeId: recipe.id, snapshot, stepIndex: index, endsAt, startedAt });
  }

  function step() { return steps[index] || null; }

  // ── Painting ────────────────────────────────────────────────────────────────

  function stepCard() {
    const current = step();
    const state = timerState(endsAt, Date.now());
    const rows = stepRows(current, snapshot, amounts);

    const card = el('div', { class: 'guided-card' + (state === 'finished' ? ' guided-card--due' : '') });

    card.appendChild(el('p', { class: 'guided-count', text: progressText(index, steps.length) }));
    if (current.text) card.appendChild(el('h2', { class: 'guided-text', text: current.text }));

    if (rows.length) {
      const list = el('div', { class: 'guided-ings' });
      for (const row of rows) {
        // A row whose ingredient has been deleted from the recipe keeps its place
        // and says so. Dropping it would show a step with one fewer ingredient
        // than it was written with, and nothing would say why.
        list.appendChild(el('div', { class: 'guided-ing' + (row.missing ? ' guided-ing--gone' : '') }, [
          el('span', { class: 'guided-ing-name', text: row.label }),
          el('span', { class: 'guided-ing-amt' }, [
            el('span', { class: 'guided-ing-num', text: row.amount === null ? '' : nf.format(row.amount) }),
            el('span', { class: 'guided-ing-unit', text: row.amount === null && !row.missing ? 'to taste' : (row.missing ? '' : row.unit) }),
          ]),
        ]));
      }
      card.appendChild(list);
    }

    if (current.seconds > 0) {
      card.appendChild(el('div', { class: 'guided-clock' }, [
        el('span', {
          class: 'guided-time',
          text: state === 'idle' ? formatDuration(current.seconds) : formatRemaining(endsAt, Date.now()),
        }),
      ]));
    }
    if (current.speed) card.appendChild(el('p', { class: 'guided-speed', text: `Speed ${current.speed}` }));

    if (state === 'finished') {
      card.appendChild(el('p', { class: 'guided-due', text: overdueText(endsAt, Date.now()) || 'Time is up.' }));
    }

    return card;
  }

  function actions() {
    const current = step();
    const state = timerState(endsAt, Date.now());
    const wrap = el('div', { class: 'guided-actions' });

    if (current.seconds > 0 && state === 'idle') {
      wrap.appendChild(el('button', { class: 'guided-go', type: 'button', onclick: startTimer }, [
        el('span', { icon: PLAY_SVG, 'aria-hidden': 'true' }), 'Start the timer',
      ]));
      // A step can be finished without its timer — the mixer was already running,
      // or this dough needed a minute less. Guiding is not commanding.
      wrap.appendChild(el('button', { class: 'guided-skip', type: 'button', text: 'Skip the timer', onclick: next }));
      return wrap;
    }

    if (state === 'running') {
      wrap.appendChild(el('button', { class: 'guided-go guided-go--wait', type: 'button', disabled: 'disabled' },
        [el('span', { text: 'Running…' })]));
      wrap.appendChild(el('div', { class: 'guided-adjust' }, [
        el('button', { class: 'guided-skip', type: 'button', text: '+1 min', onclick: () => { endsAt += EXTRA_MS; save(); paint(); } }),
        el('button', { class: 'guided-skip', type: 'button', text: 'Done early', onclick: next }),
      ]));
      return wrap;
    }

    wrap.appendChild(el('button', { class: 'guided-go', type: 'button', onclick: next }, [
      el('span', { icon: CHECK_SVG, 'aria-hidden': 'true' }),
      index >= steps.length - 1 ? 'Done — finish' : 'Done',
    ]));
    return wrap;
  }

  // The last screen: what was made, and — the part that matters — anything the
  // procedure never mentioned. See unassignedRows() in the model.
  function finishCard() {
    const missed = unassignedRows(snapshot);
    const card = el('div', { class: 'guided-card guided-card--end' }, [
      el('h2', { class: 'guided-text', text: 'Dough finished' }),
      el('p', { class: 'guided-count', text: snapshot.name }),
    ]);

    if (missed.length) {
      const warn = el('div', { class: 'guided-missed' }, [
        el('p', { class: 'guided-missed-title', text: 'Not in any step — check these went in:' }),
      ]);
      for (const row of missed) {
        const i = snapshot.ingredients.indexOf(row);
        const amount = amounts[i];
        warn.appendChild(el('div', { class: 'guided-ing' }, [
          el('span', { class: 'guided-ing-name', text: row.label }),
          el('span', { class: 'guided-ing-amt' }, [
            el('span', { class: 'guided-ing-num', text: amount === null || amount === undefined ? '' : nf.format(amount) }),
            el('span', { class: 'guided-ing-unit', text: amount === null ? 'to taste' : unitOf(row) }),
          ]),
        ]));
      }
      card.appendChild(warn);
    }

    return el('div', {}, [
      card,
      el('div', { class: 'guided-actions' }, [
        el('button', { class: 'guided-go', type: 'button', onclick: () => { leave(true); } }, [
          el('span', { icon: CHECK_SVG, 'aria-hidden': 'true' }), 'Back to the recipe',
        ]),
      ]),
    ]);
  }

  function paint() {
    if (finished) { body.replaceChildren(finishCard()); return; }
    const parts = [stepCard(), actions()];
    // Said once, at the bottom, and only where it is true: a phone that cannot
    // hold its screen on must not be promised that it will.
    parts.push(el('p', {
      class: 'guided-note',
      text: canKeepScreenAwake()
        ? 'Keep this screen open — the alarm cannot ring if you leave the app.'
        : 'Keep this screen open and awake — the alarm cannot ring if you leave the app.',
    }));
    body.replaceChildren(...parts);
  }

  // ── Moving ──────────────────────────────────────────────────────────────────

  function startTimer() {
    const current = step();
    if (!current || current.seconds <= 0) return;
    // The tap that starts a timer is a real gesture, which is the only moment a
    // browser will let the alarm be authorised. See unlockAlarm().
    unlockAlarm();
    endsAt = Date.now() + current.seconds * 1000;
    alarmedFor = 0;
    save();
    paint();
  }

  function next() {
    stopAlarm();
    endsAt = 0;
    alarmedFor = 0;
    if (index >= steps.length - 1) {
      finished = true;
      clearSession();
      releaseScreen();
      paint();
      return;
    }
    index += 1;
    save();
    paint();
  }

  function tick() {
    if (finished) return;
    if (timerState(endsAt, Date.now()) === 'finished' && endsAt !== alarmedFor) {
      alarmedFor = endsAt;
      startAlarm();
      paint();
      return;
    }
    // Only the clock face changes while a timer runs, so the whole card is not
    // rebuilt four times a second under someone's finger.
    if (timerState(endsAt, Date.now()) === 'running') {
      const face = body.querySelector('.guided-time');
      if (face) face.textContent = formatRemaining(endsAt, Date.now());
      else paint();
    }
  }

  // ⚠️ A HIDDEN TAB'S INTERVAL IS THROTTLED OR STOPPED, so coming back has to
  // repaint rather than wait for the next tick — otherwise the screen shows the
  // time it froze at, which is the one thing this design exists to avoid.
  function onVisible() {
    if (document.visibilityState === 'visible') { tick(); paint(); }
  }

  function leave(toRecipe) {
    stop();
    if (toRecipe) app.openDetail(recipe); else app.showList();
  }

  function stop() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    document.removeEventListener('visibilitychange', onVisible);
    stopAlarm();
    releaseScreen();
  }

  // Leaving mid-dough asks, and keeps the session either way: the answer to
  // "are you sure?" is about navigating, never about throwing the dough away.
  async function confirmLeave() {
    if (finished) return true;
    const ok = await app.confirm({
      title: 'Leave the guided mix?',
      message: `You are on ${progressText(index, steps.length).toLowerCase()}. It will be waiting where you left it.`,
      okLabel: 'Leave',
    });
    if (ok) stop();
    return ok;
  }

  keepScreenAwake();
  document.addEventListener('visibilitychange', onVisible);
  ticker = setInterval(tick, TICK_MS);
  save();
  paint();
  // Fire the alarm straight away if this session was resumed onto a timer that
  // ran out while the app was closed.
  tick();

  return { root, confirmLeave, stop, sessionAgeLimitMs: RESUME_TTL_MS };
}
