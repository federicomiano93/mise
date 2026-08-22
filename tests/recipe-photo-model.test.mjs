// The judgement that turns a photograph into a recipe draft.
//
// ⚠️⚠️ THIS IS THE ONLY PART OF THE PHOTO FEATURE THAT CAN BE PROVED. Whether the
// reader reads a handwritten «1,5 kg» correctly is measured by a person holding ten
// real photos; what IS provable, and what breaks silently if it is wrong, is
// everything after the answer arrives: the clamping, the exact key shape, the
// refusal to invent a recipe out of an empty answer, and the daily allowance.
//
// ⚠️ The exact-key assertions are not fussiness. firestore.rules carries a CLOSED
// key list for a recipe, so ONE extra key makes every later save of that recipe
// fail with a permission error that nothing on screen can explain — and it would
// fail for the person who typed the corrections, not for whoever added the key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_NAME, MAX_ROWS, MAX_LABEL, MAX_AMOUNT, UNITS, DEFAULT_UNIT,
  MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, WINDOW_MS,
  DAILY_IMAGES_PER_PERSON, DAILY_IMAGES_PER_VENUE,
  approxBytes, payloadProblem, toolDefinition, promptText,
  readToolResult, draftFromToolInput, chargeImages,
} from '../functions/recipe-photo-model.js';

const root = new URL('../', import.meta.url);
const read = (n) => readFileSync(new URL(n, root), 'utf8');

const found = (over = {}) => ({ found: true, name: 'Focaccia', ingredients: [], ...over });
const row = (over = {}) => ({ label: 'Flour', amount: 1000, unit: 'g', ...over });

// ── the answer, turned into a draft ──────────────────────────────────────────

test('a real answer becomes a recipe', () => {
  const { recipe } = draftFromToolInput(found({
    ingredients: [row(), row({ label: 'Water', amount: 0.7, unit: 'l' })],
  }));
  assert.equal(recipe.name, 'Focaccia');
  assert.deepEqual(recipe.ingredients, [
    { label: 'Flour', grams: 1000, unit: 'g' },
    { label: 'Water', grams: 0.7, unit: 'l' },
  ]);
});

test('⚠️ the shape is EXACT — one extra key breaks every future save', () => {
  const { recipe } = draftFromToolInput(found({
    // Everything a reader might helpfully volunteer, and none of it may survive.
    ingredients: [{ ...row(), rid: 'r1234', kind: 'ingredient', refId: 'X', note: 'sifted' }],
    lossPct: 12, steps: [{ text: 'mix' }], endNote: 'enjoy', bakery: 'somewhere', id: 'abc',
  }));
  assert.deepEqual(Object.keys(recipe).sort(), ['ingredients', 'name']);
  assert.deepEqual(Object.keys(recipe.ingredients[0]), ['label', 'grams', 'unit']);
});

test('⚠️ a rid is NEVER invented — those are minted on save', () => {
  // One invented here would bind a guided step to the wrong ingredient line.
  const { recipe } = draftFromToolInput(found({ ingredients: [row(), row({ label: 'Salt' })] }));
  assert.ok(recipe.ingredients.every(r => !('rid' in r)));
});

// ── it would rather say nothing ──────────────────────────────────────────────

test('⚠️ the reader must SAY it found a recipe', () => {
  // An empty list is also what a failed read produces. Inferring "nothing here"
  // from it would make the on-screen message a guess.
  for (const value of [false, undefined, null, 'true', 1, 0]) {
    const { recipe } = draftFromToolInput({ found: value, name: 'X', ingredients: [row()] });
    assert.equal(recipe, null, `found: ${JSON.stringify(value)} must not produce a recipe`);
  }
  assert.notEqual(draftFromToolInput(found({ ingredients: [row()] })).recipe, null);
});

test('junk in gives nothing out, and never throws', () => {
  for (const bad of [null, undefined, 'text', 42, [], [{ found: true }]]) {
    assert.equal(draftFromToolInput(bad).recipe, null);
  }
});

test('found but completely empty is still nothing to show', () => {
  assert.equal(draftFromToolInput(found({ name: '', ingredients: [] })).recipe, null);
  assert.equal(draftFromToolInput(found({ name: '   ', ingredients: [] })).recipe, null);
});

test('rows with no name are worth showing even when the name is missing', () => {
  // The editor already refuses this save and puts the cursor in the name field,
  // which is a better outcome than throwing away a correctly-read ingredient list.
  const { recipe } = draftFromToolInput(found({ name: '', ingredients: [row()] }));
  assert.equal(recipe.name, '');
  assert.equal(recipe.ingredients.length, 1);
});

// ── clamping to what the database accepts ────────────────────────────────────

test('⚠️ the name is capped at 199, not 200', () => {
  // firestore.rules says `name.size() < 200`. A 200-character name is refused.
  const { recipe, notes } = draftFromToolInput(found({ name: 'x'.repeat(500) }));
  assert.equal(recipe.name.length, MAX_NAME);
  assert.equal(MAX_NAME, 199);
  assert.equal(notes.nameTruncated, true);
});

test('the row count is capped at 300, and says so', () => {
  const many = Array.from({ length: 400 }, (_, i) => row({ label: `Item ${i}` }));
  const { recipe, notes } = draftFromToolInput(found({ ingredients: many }));
  assert.equal(recipe.ingredients.length, MAX_ROWS);
  assert.equal(notes.rowsCapped, true);
  assert.equal(draftFromToolInput(found({ ingredients: [row()] })).notes.rowsCapped, false);
});

test('a label is trimmed, collapsed and capped', () => {
  const { recipe } = draftFromToolInput(found({
    ingredients: [row({ label: '  Strong   white\n flour  ' }), row({ label: 'y'.repeat(400) })],
  }));
  assert.equal(recipe.ingredients[0].label, 'Strong white flour');
  assert.equal(recipe.ingredients[1].label.length, MAX_LABEL);
});

test('⚠️ a row with no label is DROPPED, not a row with no amount', () => {
  // A nameless row is not an ingredient. A zero amount is a real answer — a recipe
  // that says "salt, to taste" carries no number and must survive.
  const { recipe, notes } = draftFromToolInput(found({
    ingredients: [
      row({ label: '' }), row({ label: '   ' }), row({ label: null }),
      row({ label: 'Salt', amount: 0, unit: 'to taste' }),
    ],
  }));
  assert.equal(recipe.ingredients.length, 1);
  assert.equal(recipe.ingredients[0].label, 'Salt');
  assert.equal(recipe.ingredients[0].grams, 0);
  assert.equal(notes.rowsDropped, 3);
});

test('an amount is coerced, never NaN, never negative', () => {
  const cases = [
    ['1000', 1000], [1000, 1000], [null, 0], [undefined, 0], ['abc', 0],
    [NaN, 0], [Infinity, 0], [-5, 0], [0, 0], [1.23456, 1.235],
    [MAX_AMOUNT * 10, MAX_AMOUNT],
  ];
  for (const [given, want] of cases) {
    const { recipe } = draftFromToolInput(found({ ingredients: [row({ amount: given })] }));
    assert.equal(recipe.ingredients[0].grams, want, `amount ${JSON.stringify(given)}`);
  }
});

test('an unknown unit falls back to grams, and every real unit survives', () => {
  for (const unit of UNITS) {
    const { recipe } = draftFromToolInput(found({ ingredients: [row({ unit })] }));
    assert.equal(recipe.ingredients[0].unit, unit);
  }
  for (const bad of ['oz', '', null, 42, 'G']) {
    const { recipe } = draftFromToolInput(found({ ingredients: [row({ unit: bad })] }));
    assert.equal(recipe.ingredients[0].unit, DEFAULT_UNIT, `unit ${JSON.stringify(bad)}`);
  }
});

test('⚠️ the same ingredient twice stays twice', () => {
  // A recipe legitimately names flour in the starter and again in the dough.
  // Merging the two lines would silently make it a different recipe.
  const { recipe } = draftFromToolInput(found({
    ingredients: [row({ label: 'Flour', amount: 200 }), row({ label: 'Flour', amount: 800 })],
  }));
  assert.equal(recipe.ingredients.length, 2);
  assert.deepEqual(recipe.ingredients.map(r => r.grams), [200, 800]);
});

// ── the caps must agree with the database ────────────────────────────────────

test('⚠️ the caps match firestore.rules — drift fails on somebody else’s save', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /recipes/{id}'));
  const nameCap = Number(/name\.size\(\)\s*<\s*(\d+)/.exec(block)[1]);
  const rowCap = Number(/ingredients\.size\(\)\s*<=\s*(\d+)/.exec(block)[1]);
  assert.equal(MAX_NAME, nameCap - 1, `rules allow < ${nameCap}, so the cap is ${nameCap - 1}`);
  assert.equal(MAX_ROWS, rowCap);
});

test('⚠️ the units match the catalogue’s own list', () => {
  // A copy, because catalogue-model.js imports the dictionary and cannot run on
  // the server. A unit here that the catalogue does not know renders as a blank
  // dropdown on the review screen.
  const src = read('js/catalogue/catalogue-model.js');
  const listed = /export const CATALOGUE_UNITS = \[([^\]]+)\]/.exec(src)[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(UNITS, listed);
  assert.equal(DEFAULT_UNIT, /export const DEFAULT_UNIT = '([^']+)'/.exec(src)[1]);
});

// ── what we ask for ──────────────────────────────────────────────────────────

test('the tool is strict, closed, and asks whether a recipe was found at all', () => {
  const tool = toolDefinition();
  assert.equal(tool.strict, true, 'strict goes on the TOOL, not on tool_choice');
  assert.equal(tool.input_schema.additionalProperties, false);
  assert.deepEqual(tool.input_schema.required, ['found', 'name', 'ingredients']);
  const item = tool.input_schema.properties.ingredients.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['label', 'amount', 'unit']);
  assert.deepEqual(item.properties.unit.enum, UNITS);
});

test('⚠️ the prompt names the decimal comma', () => {
  // «1,5 kg» read as a thousands separator is 15 kg — ten times the dough, and a
  // number that looks perfectly ordinary afterwards.
  assert.match(promptText(), /DECIMAL SEPARATOR/);
  assert.match(promptText(), /1,5 kg/);
  assert.match(promptText(), /do not merge/i);
});

// ── reading the reply ────────────────────────────────────────────────────────

test('a refusal and a cut-off answer are told apart, and from a missing tool', () => {
  assert.equal(readToolResult({ stop_reason: 'refusal', content: [] }).problem, 'refused');
  assert.equal(readToolResult({ stop_reason: 'max_tokens', content: [] }).problem, 'truncated');
  assert.equal(readToolResult({ stop_reason: 'end_turn', content: [] }).problem, 'no-tool');
  assert.equal(readToolResult(null).problem, 'no-tool');
  assert.equal(readToolResult({ content: [{ type: 'tool_use' }] }).problem, 'no-tool');
});

test('⚠️ stop_reason is read BEFORE the content', () => {
  // A refusal arrives as an ordinary 200. Code that goes straight for the content
  // finds a tool block that is not there and reports the wrong thing.
  const refused = { stop_reason: 'refusal', content: [{ type: 'tool_use', input: found() }] };
  assert.equal(readToolResult(refused).problem, 'refused');
});

test('⚠️ the tool block is FOUND, never content[0]', () => {
  // A thinking block, or a sentence, sits in front of it — and indexing zero would
  // report a working read as a failure, at random.
  const message = {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'Here is the recipe.' },
      { type: 'tool_use', name: 'record_recipe', input: found({ ingredients: [row()] }) },
    ],
  };
  assert.equal(readToolResult(message).input.found, true);
});

// ── the daily allowance ──────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

test('inside the allowance it charges every photo, not the call', () => {
  const r = chargeImages(null, NOW, 3, 40);
  assert.equal(r.blocked, false);
  assert.equal(r.used, 3);
  assert.equal(r.remaining, 37);
  assert.equal(r.next.at.length, 3);
});

test('at the boundary it allows the last one and refuses the next', () => {
  const at = Array.from({ length: 38 }, () => NOW - 1000);
  assert.equal(chargeImages({ at }, NOW, 2, 40).blocked, false);
  assert.equal(chargeImages({ at }, NOW, 3, 40).blocked, true);
});

test('a moment older than the window no longer counts', () => {
  const at = Array.from({ length: 40 }, () => NOW - WINDOW_MS - 1);
  const r = chargeImages({ at }, NOW, 1, 40);
  assert.equal(r.blocked, false);
  assert.equal(r.used, 1, 'the expired ones are dropped, not carried');
});

test('a refusal says when it lifts, and the answer is inside the window', () => {
  const at = Array.from({ length: 40 }, (_, i) => NOW - i * 60_000);
  const r = chargeImages({ at }, NOW, 1, 40);
  assert.equal(r.blocked, true);
  assert.ok(r.retryMs > 0 && r.retryMs <= WINDOW_MS, `retryMs was ${r.retryMs}`);
});

test('a corrupt record is treated as empty rather than throwing', () => {
  for (const bad of [null, {}, { at: 'nope' }, { at: [null, 'x', NaN] }]) {
    assert.equal(chargeImages(bad, NOW, 1, 40).blocked, false);
  }
});

test('the record cannot grow for ever', () => {
  const at = Array.from({ length: 500 }, () => NOW - 1000);
  const r = chargeImages({ at }, NOW, 1, 1000);
  assert.ok(r.next.at.length <= 2000, `kept ${r.next.at.length}`);
});

test('the two ceilings are different, and the venue one is the larger', () => {
  assert.ok(DAILY_IMAGES_PER_VENUE > DAILY_IMAGES_PER_PERSON,
    'a venue cap below the person cap would make the person cap unreachable');
});

// ── the payload ──────────────────────────────────────────────────────────────

const image = (bytes, mediaType = 'image/jpeg') =>
  ({ mediaType, data: 'A'.repeat(Math.ceil(bytes * 4 / 3)) });

test('a good payload has no problem', () => {
  assert.equal(payloadProblem([image(1000), image(1000)]), null);
});

test('every bad payload is named, and none of them throws', () => {
  assert.equal(payloadProblem([]).code, 'no-images');
  assert.equal(payloadProblem(null).code, 'no-images');
  assert.equal(payloadProblem('nope').code, 'no-images');
  assert.equal(payloadProblem(Array.from({ length: MAX_IMAGES + 1 }, () => image(10))).code, 'too-many-images');
  assert.equal(payloadProblem([image(MAX_IMAGE_BYTES + 5000)]).code, 'image-too-large');
  assert.equal(payloadProblem([null]).code, 'bad-image');
  assert.equal(payloadProblem([{ data: 'A'.repeat(40) }]).code, 'bad-image', 'no media type');
  assert.equal(payloadProblem([{ mediaType: 'image/heic', data: 'AAAA' }]).code, 'bad-image');
  assert.equal(payloadProblem([{ mediaType: 'image/jpeg', data: 'not base64!!' }]).code, 'bad-image');
  assert.equal(payloadProblem([{ mediaType: 'image/jpeg', data: '' }]).code, 'bad-image');
});

test('the total is guarded as well as each photo', () => {
  const each = Math.floor(MAX_TOTAL_BYTES / 4);
  const five = Array.from({ length: 5 }, () => image(each));
  assert.equal(payloadProblem(five).code, 'images-too-large');
});

test('approxBytes is never a wild over-estimate', () => {
  assert.equal(approxBytes('AAAA'), 3);
  assert.equal(approxBytes(''), 0);
  assert.equal(approxBytes(null), 0);
});

// ── the file itself ──────────────────────────────────────────────────────────

test('⚠️ the model has no imports — CI never installs functions/ dependencies', () => {
  // The root `test` job runs node --test with no npm ci in functions/. A single
  // import here would make every test in this file fail to load, in CI only.
  const src = read('functions/recipe-photo-model.js');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /^\s*import\s/m, 'this file must resolve with no node_modules');
  assert.doesNotMatch(code, /require\s*\(/, 'and it is an ES module either way');
});
