// guided-model.js — PURE: a recipe's mixing procedure, and the maths of running it.
//
// No DOM, no Firebase, no localStorage, no `Date.now()` read from inside — every
// function that cares about time is handed `nowMs`. That is what makes the timer
// testable at all: a countdown you can only observe by waiting is a countdown
// nobody ever tests.
//
// A procedure is an ORDERED list of steps stored on the recipe itself:
//
//   steps: [ { text, rows: [rid, …], seconds, speed }, … ]
//
// ⚠️ A STEP HAS NO ID, ON PURPOSE. Nothing outside the array ever points at a
// step: the array is ordered, it lives inside the one document, reordering is
// moving an element, and a run in progress is frozen against a SNAPSHOT rather
// than the live recipe. An id would be a second thing to keep unique and in step
// with the order, buying nothing. The ingredient ROWS are the opposite case —
// see `rid` below.

import { unitOf, scaleCatalogue, baseAmounts, weighableTotalGrams } from './catalogue-model.js';

// ── Limits ────────────────────────────────────────────────────────────────────
// The rules cap the number of steps (they cannot see inside one); everything
// about a step's CONTENTS is capped here, and here only.
export const MAX_STEPS = 100;
export const MAX_STEP_TEXT = 300;
export const MAX_SPEED_TEXT = 24;
// 12 hours. Long enough for an overnight biga, short enough that a mistyped
// number is refused rather than starting a countdown nobody will ever see end.
export const MAX_STEP_SECONDS = 12 * 60 * 60;

// ── Stable ingredient row ids ─────────────────────────────────────────────────
//
// ⚠️ A STEP POINTS AT A ROW BY `rid`, NEVER BY NAME AND NEVER BY POSITION, AND
// THIS IS THE MOST LOAD-BEARING DECISION IN THE FILE.
//
//   By name: renaming "Flour" to "Strong flour" silently drops it from the step
//   that adds it, and the dough is mixed without it.
//
//   By position: inserting one row at the top shifts every reference down by one,
//   so the butter step asks for the yeast — with nothing anywhere saying so. That
//   is the worst shape a bug can have here, because the screen still looks right.
//
// ⚠️ AND THE IDS ARE RANDOM, NOT SEQUENTIAL. Sequential ids ("r1, r2, r3…") are
// easier to read and would reintroduce exactly the failure above by another door:
// two phones editing the same recipe offline would each mint `r4` for a DIFFERENT
// ingredient, and whichever synced last would silently rebind the other phone's
// step to the wrong row. With random ids that collision cannot happen; the step
// reports its row as missing instead, which is visible.
const RID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeRowId(random = Math.random) {
  let out = 'r';
  for (let i = 0; i < 8; i++) out += RID_ALPHABET[Math.floor(random() * RID_ALPHABET.length)];
  return out;
}

export function ridOf(row) {
  const rid = row && row.rid != null ? String(row.rid).trim() : '';
  return rid || '';
}

// Every ingredient row given a `rid`, assigning one only where it is missing or
// would collide. Called on SAVE, never on read: an id minted on the way in would
// be different on every load and would point at nothing the next time.
//
// Returns a new array; the input is never mutated. Rows that already have a
// unique id come back byte-identical, so a recipe nobody has touched keeps
// exactly the shape it has today.
export function withRowIds(ingredients, makeId = makeRowId) {
  if (!Array.isArray(ingredients)) return [];
  const seen = new Set();
  return ingredients.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rid = ridOf(row);
    if (rid && !seen.has(rid)) { seen.add(rid); return row; }
    // No id, or a duplicate of one already used: mint a fresh one. Looping guards
    // against the (vanishingly unlikely) case of the generator repeating itself.
    let fresh = makeId();
    while (!fresh || seen.has(fresh)) fresh = makeId();
    seen.add(fresh);
    return { ...row, rid: fresh };
  });
}

// ── Normalising a procedure ───────────────────────────────────────────────────
// Junk-safe throughout: never throws, never yields NaN, never a negative time.
// Anything unreadable becomes the harmless value, because a corrupt step must
// degrade into "read this and tap Done" rather than into a broken screen.

function normalizeText(raw, max) {
  return String(raw == null ? '' : raw).trim().slice(0, max);
}

export function normalizeSeconds(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_STEP_SECONDS);
}

// The rows a step adds: ids only, de-duplicated, order preserved. A row named
// twice in one step would be added twice on screen and read as two ingredients.
function normalizeRows(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const value of raw) {
    const rid = String(value == null ? '' : value).trim();
    if (rid && !out.includes(rid)) out.push(rid);
  }
  return out;
}

export function normalizeStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    text: normalizeText(raw.text, MAX_STEP_TEXT),
    rows: normalizeRows(raw.rows),
    seconds: normalizeSeconds(raw.seconds),
    speed: normalizeText(raw.speed, MAX_SPEED_TEXT),
  };
}

// A step with nothing in it at all says nothing and cannot be acted on, so it is
// dropped rather than shown as a blank card somebody has to tap past.
export function isEmptyStep(step) {
  return !!step && !step.text && !step.rows.length && !step.seconds && !step.speed;
}

export function normalizeSteps(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeStep)
    .filter(step => step && !isEmptyStep(step))
    .slice(0, MAX_STEPS);
}

export function hasProcedure(recipe) {
  return normalizeSteps(recipe && recipe.steps).length > 0;
}

// ── Which ingredients the procedure accounts for ──────────────────────────────
//
// ⚠️ THE SAFETY NET OF THE WHOLE FEATURE, and the reason it is in the pure model
// rather than in a screen. Somebody following the procedure trusts it completely
// — that is what "guided" means — so an ingredient that appears in no step is an
// ingredient that does not go in the bowl. That failure must never be silent, so
// it is computed in one place and shown in BOTH the editor (while writing) and
// the run (at the end).

// The recipe rows no step mentions, in recipe order. Rows with no name are
// ignored: the recipe editor drops them on save, so they are not real rows.
export function unassignedRows(recipe) {
  const rows = ingredientsOf(recipe);
  const used = new Set();
  for (const step of normalizeSteps(recipe && recipe.steps)) {
    for (const rid of step.rows) used.add(rid);
  }
  return rows.filter(row => String(row.label || '').trim() && !used.has(ridOf(row)));
}

// The ids a step points at that the recipe no longer has — a row deleted after
// the procedure was written. Reported so the step can SAY the ingredient is gone
// instead of quietly showing one fewer line than it used to.
export function missingRefs(recipe) {
  const known = new Set(ingredientsOf(recipe).map(ridOf).filter(Boolean));
  const out = [];
  for (const step of normalizeSteps(recipe && recipe.steps)) {
    for (const rid of step.rows) if (!known.has(rid) && !out.includes(rid)) out.push(rid);
  }
  return out;
}

function ingredientsOf(recipe) {
  return (recipe && Array.isArray(recipe.ingredients)) ? recipe.ingredients : [];
}

// ── What one step shows ───────────────────────────────────────────────────────

// The amounts for the whole recipe at the batch being made, aligned with
// recipe.ingredients.
//
// ⚠️ THIS CALLS THE CATALOGUE'S OWN scaleCatalogue / baseAmounts AND MUST GO ON
// DOING SO. A second implementation of the scaling here would be a copy of a
// CALCULATION, and two files that disagree about how much flour goes in produce
// two different doughs with nothing on screen saying which is right. The guided
// screen and the recipe screen are the same numbers by construction.
export function amountsFor(recipe, targetGrams) {
  const target = Number(targetGrams);
  return (Number.isFinite(target) && target > 0 && weighableTotalGrams(recipe) > 0)
    ? scaleCatalogue(recipe, target)
    : baseAmounts(recipe);
}

// The lines one step puts on screen: { rid, label, amount, unit, missing }.
// `amount` is null for a 'to taste' row (no number) and for a missing one.
// A missing row keeps its place in the list and says so — never omitted.
export function stepRows(step, recipe, amounts) {
  const rows = ingredientsOf(recipe);
  const byRid = new Map();
  rows.forEach((row, i) => {
    const rid = ridOf(row);
    if (rid && !byRid.has(rid)) byRid.set(rid, { row, i });
  });
  const wanted = (step && Array.isArray(step.rows)) ? step.rows : [];
  return wanted.map((rid) => {
    const hit = byRid.get(rid);
    if (!hit) return { rid, label: 'No longer in the recipe', amount: null, unit: '', missing: true };
    const amount = Array.isArray(amounts) ? amounts[hit.i] : null;
    return {
      rid,
      label: String(hit.row.label || '').trim(),
      amount: amount === undefined ? null : amount,
      unit: unitOf(hit.row),
      missing: false,
    };
  });
}

// ── The clock ─────────────────────────────────────────────────────────────────
//
// ⚠️ NOTHING HERE COUNTS SECONDS. A step's timer is stored as the wall-clock
// instant it ENDS (`endsAt`), and everything is derived by comparing that to the
// clock. A phone throttles or suspends a backgrounded tab — on iOS it stops
// running JavaScript altogether — so a counter that decrements would drift, or
// freeze, and come back showing a time that never happened. Comparing against
// the clock is right whatever the phone did in between. The same technique the
// 4am pastry lock uses, for the same reason.

export function remainingMs(endsAt, nowMs) {
  const end = Number(endsAt);
  const now = Number(nowMs);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  return end - now;
}

// 'idle' — no timer started; 'running' — still counting; 'finished' — it is due.
export function timerState(endsAt, nowMs) {
  const end = Number(endsAt);
  if (!Number.isFinite(end) || end <= 0) return 'idle';
  return remainingMs(end, nowMs) > 0 ? 'running' : 'finished';
}

// "04:00", or "1:05:00" once it passes an hour. Clamped at zero: a finished
// timer reads 00:00, never a negative.
export function formatDuration(seconds) {
  let total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatRemaining(endsAt, nowMs) {
  return formatDuration(remainingMs(endsAt, nowMs) / 1000);
}

// How long ago a timer ran out, said the way a person would say it.
//
// ⚠️ THIS EXISTS BECAUSE THE ALARM CANNOT ALWAYS RING. Leave the app and the
// phone suspends the page: no sound, no vibration, nothing. What the app must
// never do is come back showing a tidy countdown as though nothing had happened
// — so on return it says how late it already is, out loud.
export function overdueText(endsAt, nowMs) {
  const late = -remainingMs(endsAt, nowMs);
  if (!(late > 0)) return '';
  const mins = Math.floor(late / 60000);
  if (mins < 1) return 'Time is up — just now.';
  if (mins === 1) return 'Time was up 1 minute ago.';
  if (mins < 60) return `Time was up ${mins} minutes ago.`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? 'Time was up over an hour ago.' : `Time was up over ${hours} hours ago.`;
}

// ── Picking up an interrupted run ─────────────────────────────────────────────
//
// A dough is not abandoned because the phone was locked or the app was closed —
// so a run in progress is offered back. What it must NOT do is offer back a
// session from another day and let somebody carry on mixing to yesterday's plan.

// 24 hours: longer than any single procedure including an overnight rest, and
// short enough that a forgotten session never resurfaces as "today's dough".
export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

// Is a saved session still worth offering? A session must know which recipe it
// belongs to, hold a snapshot to run against, and be from the recent past.
//
// ⚠️ A CLOCK THAT HAS GONE BACKWARDS MAKES IT STALE, not fresh. `now - startedAt`
// negative means the phone's clock moved (a timezone fix, a manual change, a
// device that booted with no clock), and the honest answer to "is this still the
// dough you were making?" is then "I cannot tell" — which must resolve to
// starting again, not to resuming a session whose timers cannot be trusted.
export function isResumable(saved, nowMs) {
  if (!saved || typeof saved !== 'object') return false;
  if (!saved.recipeId || !saved.snapshot) return false;
  const steps = normalizeSteps(saved.snapshot.steps);
  if (!steps.length) return false;
  const index = Number(saved.stepIndex);
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return false;
  const started = Number(saved.startedAt);
  const now = Number(nowMs);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return false;
  const age = now - started;
  return age >= 0 && age < RESUME_TTL_MS;
}

// "Step 4 of 9" — the one line the resume offer leads with, so the answer to
// "where was I?" is on screen before any decision is asked for.
export function progressText(stepIndex, total) {
  const i = Number(stepIndex);
  const n = Number(total);
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 0) return '';
  return `Step ${Math.min(Math.max(i + 1, 1), n)} of ${n}`;
}
