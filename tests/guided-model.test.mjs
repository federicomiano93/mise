// The guided mixing procedure: the parts a test can actually prove.
//
// Federico cannot read code, so these are the safety net (P15). Two of them are
// worth more than the rest and are marked where they sit: that an ingredient in
// no step is ALWAYS reported, and that a step's amounts are the recipe screen's
// own numbers rather than a second calculation that can drift from them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_STEPS, MAX_STEP_SECONDS, MAX_STEP_TEXT, MAX_SPEED_TEXT, MAX_END_NOTE, RESUME_TTL_MS,
  makeRowId, ridOf, withRowIds,
  normalizeSeconds, normalizeStep, normalizeSteps, normalizeEndNote, isEmptyStep, hasProcedure,
  unassignedRows, missingRefs, amountsFor, stepRows,
  remainingMs, timerState, formatDuration, formatRemaining, overdueText,
  isResumable, progressText,
} from '../js/catalogue/guided-model.js';
import { scaleCatalogue, baseAmounts, normalizeCatalogueRecipe } from '../js/catalogue/catalogue-model.js';

// A recipe shaped exactly as Firestore holds one, rows already carrying ids.
const recipe = () => ({
  id: 'R1',
  name: 'Croissant',
  ingredients: [
    { rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' },
    { rid: 'rb', label: 'Water', grams: 500, unit: 'g' },
    { rid: 'rc', label: 'Butter', grams: 500, unit: 'g' },
    { rid: 'rd', label: 'Salt', grams: 20, unit: 'g' },
  ],
  steps: [
    { text: 'Add the flour and the water', rows: ['ra', 'rb'], seconds: 0, speed: '' },
    { text: 'Mix', rows: [], seconds: 240, speed: '1' },
    { text: 'Add the butter', rows: ['rc'], seconds: 300, speed: '2' },
  ],
});

// ── Stable row ids ────────────────────────────────────────────────────────────

test('a row that already has an id keeps it, byte for byte', () => {
  const rows = [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' }];
  const out = withRowIds(rows);
  assert.equal(out[0], rows[0], 'the untouched row must be the SAME object, not a copy');
  assert.equal(out[0].rid, 'ra');
});

test('a row with no id gets one, and it is unique', () => {
  const out = withRowIds([
    { label: 'Flour', grams: 1000 },
    { label: 'Water', grams: 500 },
    { rid: 'rc', label: 'Butter', grams: 500 },
  ]);
  assert.ok(ridOf(out[0]), 'the first row was left without an id');
  assert.ok(ridOf(out[1]));
  assert.equal(out[2].rid, 'rc');
  assert.equal(new Set(out.map(ridOf)).size, 3, 'two rows ended up sharing an id');
});

test('a DUPLICATED id is broken apart — two rows may never share one', () => {
  // Two rows with the same id means one step's line silently shows the other
  // row's amount. Copy-pasting a row in the editor is exactly how it happens.
  const out = withRowIds([
    { rid: 'ra', label: 'Flour', grams: 1000 },
    { rid: 'ra', label: 'Water', grams: 500 },
  ]);
  assert.equal(out[0].rid, 'ra', 'the first occurrence keeps the id');
  assert.notEqual(out[1].rid, 'ra');
  assert.ok(ridOf(out[1]));
});

test('the generator never repeats itself into a collision', () => {
  // A deliberately broken generator: it hands out 'rx' twice before giving up.
  let n = 0;
  const bad = () => (++n <= 2 ? 'rx' : 'ry');
  const out = withRowIds([{ label: 'A' }, { label: 'B' }], bad);
  assert.equal(out[0].rid, 'rx');
  assert.equal(out[1].rid, 'ry');
});

test('withRowIds survives junk without throwing', () => {
  assert.deepEqual(withRowIds(null), []);
  assert.deepEqual(withRowIds('nope'), []);
  const out = withRowIds([null, { label: 'A' }]);
  assert.equal(out[0], null);
  assert.ok(ridOf(out[1]));
});

test('a generated id looks like an id', () => {
  for (let i = 0; i < 50; i++) assert.match(makeRowId(), /^r[a-z0-9]{8}$/);
});

// ── Surviving the trip through Firestore ──────────────────────────────────────
//
// normalizeCatalogueRecipe REBUILDS a recipe from scratch, so a field it does not
// mention is dropped on the way in — silently, and permanently once the recipe is
// next saved. That has already cost this project every ingredient LINK on a recipe
// opened to fix a typo. These two pin the same trap for the guided procedure.

test('a row id survives the trip in from the database', () => {
  const back = normalizeCatalogueRecipe({
    id: 'R1', name: 'Croissant',
    ingredients: [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' }],
  });
  assert.equal(back.ingredients[0].rid, 'ra');
});

test('a procedure survives the trip in from the database', () => {
  const steps = [{ text: 'Mix', rows: ['ra'], seconds: 240, speed: '1' }];
  assert.deepEqual(normalizeCatalogueRecipe({ id: 'R1', name: 'C', ingredients: [], steps }).steps, steps);
});

test('a recipe with no procedure keeps exactly the shape it has today', () => {
  // Absent, not empty: hundreds of recipes have no steps and must not all be
  // rewritten with a new field the first time anybody opens them.
  const back = normalizeCatalogueRecipe({ id: 'R1', name: 'C', ingredients: [] });
  assert.equal('steps' in back, false);
  assert.equal('rid' in (normalizeCatalogueRecipe({
    id: 'R1', name: 'C', ingredients: [{ label: 'Flour', grams: 1 }],
  }).ingredients[0]), false);
});

// ── Normalising ───────────────────────────────────────────────────────────────

test('a step made of junk never produces NaN or a negative time', () => {
  const step = normalizeStep({ text: null, rows: 'nope', seconds: 'abc', speed: undefined });
  assert.deepEqual(step, { text: '', rows: [], seconds: 0, speed: '' });
  assert.equal(normalizeSeconds(-30), 0);
  assert.equal(normalizeSeconds(NaN), 0);
  // ⚠️ Infinity is JUNK, not "the maximum". It must fall to no timer at all — a
  // step that is simply read and tapped past — because the alternative is
  // starting a 12-hour countdown off a corrupt value and calling it a decision.
  assert.equal(normalizeSeconds(Infinity), 0);
  assert.equal(normalizeSeconds('90'), 90);
  assert.equal(normalizeSeconds(12.7), 12, 'a fraction of a second is not a thing');
  assert.equal(normalizeStep(null), null);
});

test('a mistyped duration is capped, not obeyed', () => {
  // 240 meant as seconds, typed as 240 MINUTES by mistake, is still bounded.
  assert.equal(normalizeSeconds(999999), MAX_STEP_SECONDS);
});

test('long text and a long speed are cut to size', () => {
  const step = normalizeStep({ text: 'x'.repeat(500), speed: 'y'.repeat(50) });
  assert.equal(step.text.length, MAX_STEP_TEXT);
  assert.equal(step.speed.length, MAX_SPEED_TEXT);
});

test('the same row named twice in one step is only added once', () => {
  assert.deepEqual(normalizeStep({ rows: ['ra', 'ra', 'rb', '', null] }).rows, ['ra', 'rb']);
});

test('an entirely empty step is dropped rather than shown as a blank card', () => {
  assert.equal(isEmptyStep({ text: '', rows: [], seconds: 0, speed: '' }), true);
  assert.equal(normalizeSteps([{ text: '', rows: [], seconds: 0, speed: '' }]).length, 0);
  // …but a step that only holds a timer is real work and must survive.
  assert.equal(normalizeSteps([{ seconds: 60 }]).length, 1);
});

test('a runaway procedure is cut to the cap the rules also enforce', () => {
  const many = Array.from({ length: MAX_STEPS + 20 }, (_, i) => ({ text: 'step ' + i }));
  assert.equal(normalizeSteps(many).length, MAX_STEPS);
});

test('normalizeSteps survives junk, and hasProcedure answers honestly', () => {
  assert.deepEqual(normalizeSteps(null), []);
  assert.deepEqual(normalizeSteps('nope'), []);
  assert.deepEqual(normalizeSteps([null, 7, 'x']), []);
  assert.equal(hasProcedure({}), false);
  assert.equal(hasProcedure({ steps: [] }), false);
  assert.equal(hasProcedure(recipe()), true);
});

// ── The safety net: no ingredient may go missing in silence ───────────────────

test('AN INGREDIENT IN NO STEP IS ALWAYS REPORTED', () => {
  // The failure this whole feature has to be protected from: somebody follows
  // the procedure to the letter and the dough comes out without the salt.
  const missed = unassignedRows(recipe());
  assert.deepEqual(missed.map(r => r.label), ['Salt']);
});

test('…and a procedure that accounts for everything reports nothing', () => {
  const r = recipe();
  r.steps.push({ text: 'Add the salt', rows: ['rd'] });
  assert.deepEqual(unassignedRows(r), []);
});

test('a recipe with no procedure at all counts every row as unassigned', () => {
  const r = recipe();
  r.steps = [];
  assert.deepEqual(unassignedRows(r).map(r2 => r2.label), ['Flour', 'Water', 'Butter', 'Salt']);
});

test('a row with no id is unassigned — it cannot be in a step', () => {
  const r = recipe();
  r.ingredients.push({ label: 'Sugar', grams: 100, unit: 'g' });
  assert.ok(unassignedRows(r).some(row => row.label === 'Sugar'));
});

test('a nameless row is not counted — the editor drops those on save', () => {
  const r = recipe();
  r.ingredients.push({ rid: 're', label: '   ', grams: 0, unit: 'g' });
  assert.deepEqual(unassignedRows(r).map(x => x.label), ['Salt']);
});

test('a row deleted from the recipe leaves its step SAYING so', () => {
  const r = recipe();
  r.ingredients = r.ingredients.filter(i => i.rid !== 'rc'); // butter deleted
  assert.deepEqual(missingRefs(r), ['rc']);

  const rows = stepRows(r.steps[2], r, amountsFor(r, 0));
  assert.equal(rows.length, 1, 'the line must stay put, not vanish');
  assert.equal(rows[0].missing, true);
  assert.match(rows[0].label, /no longer in the recipe/i);
  assert.equal(rows[0].amount, null);
});

test('missingRefs is empty for an intact recipe, and never repeats an id', () => {
  assert.deepEqual(missingRefs(recipe()), []);
  const r = recipe();
  r.ingredients = [];
  r.steps = [{ rows: ['ra'] }, { rows: ['ra', 'rb'] }];
  assert.deepEqual(missingRefs(r), ['ra', 'rb']);
});

// ── The amounts are the recipe screen's own numbers ───────────────────────────

test('A STEP SHOWS EXACTLY WHAT THE RECIPE SCREEN SHOWS, at any batch size', () => {
  // ⚠️ The one number in this feature that can be WRONG rather than merely
  // missing. A second copy of the scaling would let the guided screen and the
  // recipe screen disagree about how much flour goes in, with nothing on screen
  // saying which is right.
  const r = recipe();
  for (const target of [0, 4000, 17500, 100000]) {
    const mine = amountsFor(r, target);
    const theirs = target > 0 ? scaleCatalogue(r, target) : baseAmounts(r);
    assert.deepEqual(mine, theirs, `the two disagree at ${target} g`);
  }
});

test('a batch of zero, or junk, falls back to the recipe as written', () => {
  const r = recipe();
  const base = baseAmounts(r);
  for (const bad of [0, -1, NaN, null, undefined, 'x', Infinity]) {
    assert.deepEqual(amountsFor(r, bad), base, `${String(bad)} did not fall back`);
  }
});

test('a step lists its rows in the order it names them, with the batch amounts', () => {
  const r = recipe();
  const amounts = amountsFor(r, 4040); // 2x the 2020 g recipe
  const rows = stepRows(r.steps[0], r, amounts);
  assert.deepEqual(rows.map(x => x.label), ['Flour', 'Water']);
  assert.deepEqual(rows.map(x => x.amount), [2000, 1000]);
  assert.deepEqual(rows.map(x => x.unit), ['g', 'g']);
  assert.equal(rows.every(x => x.missing === false), true);
});

test("a 'to taste' row shows no number rather than a zero", () => {
  const r = {
    ingredients: [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'rb', label: 'Pepper', grams: 0, unit: 'to taste' }],
    steps: [{ rows: ['rb'] }],
  };
  assert.equal(stepRows(r.steps[0], r, amountsFor(r, 2000))[0].amount, null);
});

test('stepRows survives junk without throwing', () => {
  assert.deepEqual(stepRows(null, recipe(), []), []);
  assert.deepEqual(stepRows({ rows: [] }, null, null), []);
  assert.equal(stepRows({ rows: ['ra'] }, recipe(), null)[0].amount, null);
});

// ── The clock ─────────────────────────────────────────────────────────────────

test('what is left is read off the clock, never counted', () => {
  const now = 1_000_000;
  assert.equal(remainingMs(now + 60_000, now), 60_000);
  assert.equal(remainingMs(now - 5_000, now), -5_000, 'overdue must stay negative');
  assert.equal(remainingMs('x', now), 0);
  assert.equal(remainingMs(now, 'x'), 0);
});

test('the timer has three states and no fourth', () => {
  const now = 1_000_000;
  assert.equal(timerState(0, now), 'idle');
  assert.equal(timerState(null, now), 'idle');
  assert.equal(timerState(now + 1, now), 'running');
  assert.equal(timerState(now, now), 'finished');
  assert.equal(timerState(now - 60_000, now), 'finished');
});

test('the countdown reads the way a kitchen timer reads', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(59), '00:59');
  assert.equal(formatDuration(240), '04:00');
  assert.equal(formatDuration(3600), '1:00:00');
  assert.equal(formatDuration(3905), '1:05:05');
});

test('a finished timer reads 00:00 — never a negative', () => {
  const now = 1_000_000;
  assert.equal(formatRemaining(now - 90_000, now), '00:00');
  assert.equal(formatDuration(-30), '00:00');
  assert.equal(formatDuration(NaN), '00:00');
});

test('a part-second left still reads as a second, so it never sits on 00:00', () => {
  const now = 1_000_000;
  assert.equal(formatRemaining(now + 400, now), '00:01');
});

test('COMING BACK LATE SAYS HOW LATE, instead of a tidy countdown', () => {
  // The alarm cannot ring while the app is in the background. What it must never
  // do is come back pretending nothing happened.
  const now = 1_000_000_000;
  assert.equal(overdueText(now + 60_000, now), '', 'still running — say nothing');
  assert.match(overdueText(now - 5_000, now), /just now/);
  assert.match(overdueText(now - 60_000, now), /1 minute ago/);
  assert.match(overdueText(now - 6 * 60_000, now), /6 minutes ago/);
  assert.match(overdueText(now - 90 * 60_000, now), /over an hour/);
  assert.match(overdueText(now - 200 * 60_000, now), /over 3 hours/);
});

// ── Picking up an interrupted run ─────────────────────────────────────────────

const session = (over = {}) => ({
  recipeId: 'R1',
  snapshot: recipe(),
  stepIndex: 1,
  startedAt: 1_000_000_000,
  ...over,
});

test('a run from a few minutes ago is offered back', () => {
  assert.equal(isResumable(session(), 1_000_000_000 + 5 * 60_000), true);
});

test('a run from another day is not', () => {
  assert.equal(isResumable(session(), 1_000_000_000 + RESUME_TTL_MS + 1), false);
  // …and one from just inside the window still is.
  assert.equal(isResumable(session(), 1_000_000_000 + RESUME_TTL_MS - 1), true);
});

test('A CLOCK THAT WENT BACKWARDS MAKES IT STALE, not fresh', () => {
  // now - startedAt negative means the phone's clock moved. The honest answer to
  // "is this still the dough you were making?" is then "I cannot tell" — which
  // has to mean start again, not resume timers nobody can trust.
  assert.equal(isResumable(session(), 1_000_000_000 - 60_000), false);
});

test('a session missing anything it needs is refused', () => {
  assert.equal(isResumable(null, 1_000_000_000), false);
  assert.equal(isResumable('nope', 1_000_000_000), false);
  assert.equal(isResumable(session({ recipeId: '' }), 1_000_000_000), false);
  assert.equal(isResumable(session({ snapshot: null }), 1_000_000_000), false);
  assert.equal(isResumable(session({ snapshot: { steps: [] } }), 1_000_000_000), false);
  assert.equal(isResumable(session({ startedAt: 'x' }), 1_000_000_000), false);
  assert.equal(isResumable(session(), 'x'), false);
});

test('a step number outside the procedure is refused rather than clamped', () => {
  // Clamping would open a snapshot of 3 steps at step 9 and call it step 3 —
  // resuming somebody's dough at the wrong point, which is worse than asking.
  assert.equal(isResumable(session({ stepIndex: 3 }), 1_000_000_000), false);
  assert.equal(isResumable(session({ stepIndex: -1 }), 1_000_000_000), false);
  assert.equal(isResumable(session({ stepIndex: 1.5 }), 1_000_000_000), false);
  assert.equal(isResumable(session({ stepIndex: 2 }), 1_000_000_000), true);
});

test('the resume offer says where you were', () => {
  assert.equal(progressText(3, 9), 'Step 4 of 9');
  assert.equal(progressText(0, 3), 'Step 1 of 3');
  assert.equal(progressText(0, 0), '');
  assert.equal(progressText('x', 9), '');
});

// ── The closing message ───────────────────────────────────────────────────────
//
// Shown on its own when a guided mix finishes. It is the recipe's last word about
// the dough — "final dough temperature 24-26 degrees" — so it belongs to the
// recipe rather than to a step, and it is bounded like a step's text is.

test('a closing message is trimmed and kept', () => {
  assert.equal(normalizeEndNote('  Final dough temperature 24-26 degrees  '),
    'Final dough temperature 24-26 degrees');
});

test('no closing message is an empty string, never undefined or null', () => {
  // The finish screen tests it for truthiness and the store writes it every time;
  // a null reaching Firestore would be refused by the rules, which require a
  // string whenever the field is present at all.
  for (const nothing of [undefined, null, '', '   ']) {
    assert.equal(normalizeEndNote(nothing), '', `${String(nothing)} did not become ''`);
  }
});

test('junk becomes text rather than leaking a shape onto the screen', () => {
  assert.equal(typeof normalizeEndNote(42), 'string');
  assert.equal(normalizeEndNote(42), '42');
  assert.equal(typeof normalizeEndNote({}), 'string');
});

test('a very long closing message is cut, not sent whole', () => {
  // The rules cap it at 300 too. This is the half that gives a person a message
  // that still fits the screen; that one is the half that keeps the document
  // away from Firestore's 1MB ceiling.
  assert.equal(normalizeEndNote('x'.repeat(1000)).length, MAX_END_NOTE);
});

test('the closing message survives a round trip through the recipe normaliser', () => {
  // ⚠️ THE FIVE-PLACE TRAP. A field the model carries and one of the hand-listed
  // field lists does not is dropped on every save, silently. This pins the
  // catalogue end of it; the store end is pinned by the driven checks.
  const withNote = normalizeCatalogueRecipe({
    id: 'R9', name: 'Croissant', ingredients: [], endNote: 'Final dough temperature 24-26 degrees',
  });
  assert.equal(withNote.endNote, 'Final dough temperature 24-26 degrees');
});

test('a recipe with no closing message does not grow an empty one', () => {
  // Absent rather than empty, exactly as `steps` behaves: the hundreds of recipes
  // nobody has written a procedure for stay byte-identical to what they are now.
  const plain = normalizeCatalogueRecipe({ id: 'R9', name: 'Croissant', ingredients: [] });
  assert.equal('endNote' in plain, false);
  const blank = normalizeCatalogueRecipe({ id: 'R9', name: 'Croissant', ingredients: [], endNote: '   ' });
  assert.equal('endNote' in blank, false);
});
