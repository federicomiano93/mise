// The SEQUENCE: who may call the photo reader, what it charges, and in what order.
//
// ⚠️⚠️ THE ORDER IS THE THING BEING TESTED, not the arithmetic — that is proved in
// tests/recipe-photo-model.test.mjs. Three orderings matter, and each has a way of
// being wrong that reads perfectly well:
//   · the payload is checked BEFORE anything is charged;
//   · the allowance is charged BEFORE the reader is called;
//   · and it is NOT given back when the reader throws.
//
// ⚠️ It tests functions/recipe-photo-model.js, never functions/recipe-photo.js. The
// shell imports @anthropic-ai/sdk and firebase-functions, which CI installs only in
// the deploy job — a test that imported it would fail in CI and pass here, which is
// the worst of both. That is exactly why the sequence was put in the model: what
// cannot be loaded cannot be tested, and what cannot be tested rots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readRecipe, sectionOn } from '../functions/recipe-photo-model.js';

const read = (n) => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');

// ⚠️ THE COMMENTS IN THESE FILES DESCRIBE THE MISTAKES THEY AVOID, so a check that
// searched the whole text would find the very phrase it is banning inside the
// warning against it — and report the code as broken while it is correct. Read the
// CODE. (The first version of the thinking check did exactly that.)
const codeOf = (name) => read(name).replace(/^\s*\/\/.*$/gm, '');

const IMAGE = { mediaType: 'image/jpeg', data: 'QUFBQQ==' };
const GOOD = { found: true, name: 'Focaccia', ingredients: [{ label: 'Flour', amount: 1000, unit: 'g' }] };
const NOW = 1_700_000_000_000;

const answer = (input) => ({
  stop_reason: 'tool_use',
  usage: { input_tokens: 2000, output_tokens: 200 },
  content: [{ type: 'tool_use', name: 'record_recipe', input }],
});

// A stand-in for Firestore: documents in a Map, and a record of every write.
function fakeStore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  return {
    docs,
    writes,
    access: async (uid, lid) => {
      const user = docs.get(`users/${uid}`);
      const value = user && user.locations && user.locations[lid];
      return [true, 'manager', 'owner'].includes(value) ? value : false;
    },
    location: async (lid) => docs.get(`locations/${lid}`) || null,
    limit: async (path) => docs.get(path) || null,
    saveLimit: async (path, value) => { docs.set(path, value); writes.push(path); },
  };
}

const MEMBER = { 'users/u1': { locations: { bakery: true } } };

const call = (over = {}) => readRecipe({
  uid: 'u1',
  locationId: 'bakery',
  images: [IMAGE],
  store: fakeStore(MEMBER),
  ask: async () => answer(GOOD),
  now: NOW,
  ...over,
});

// ── the happy path ───────────────────────────────────────────────────────────

test('a real read returns a draft, and saves no recipe anywhere', async () => {
  const store = fakeStore(MEMBER);
  const out = await call({ store });
  assert.equal(out.ok, true);
  assert.equal(out.recipe.name, 'Focaccia');
  assert.deepEqual(Object.keys(out.recipe.ingredients[0]), ['label', 'grams', 'unit']);
  assert.ok(!store.writes.some(p => p.includes('/recipes/')),
    'nothing is saved here — the operator saves, from the editor');
});

test('the reader is handed exactly the photos it was given', async () => {
  let seen = null;
  await call({ images: [IMAGE, IMAGE], ask: async (list) => { seen = list; return answer(GOOD); } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].mediaType, 'image/jpeg');
});

// ── who may call it ──────────────────────────────────────────────────────────

test('signing in is required', async () => {
  assert.equal((await call({ uid: null })).error.code, 'unauthenticated');
});

test('a missing or malformed location is refused before anything else', async () => {
  for (const locationId of [undefined, '', 'has/slash', '../escape', 'x'.repeat(80)]) {
    assert.equal((await call({ locationId })).error.code, 'invalid-argument',
      `locationId ${JSON.stringify(locationId)}`);
  }
});

test('somebody outside the venue is refused, and is not charged', async () => {
  const store = fakeStore({ 'users/u1': { locations: { elsewhere: true } } });
  const out = await call({ store });
  assert.equal(out.error.code, 'permission-denied');
  assert.deepEqual(store.writes, [], 'nothing written means nothing charged');
});

test('a manager and an owner may use it; a value nobody recognises may not', async () => {
  for (const value of [true, 'manager', 'owner']) {
    const store = fakeStore({ 'users/u1': { locations: { bakery: value } } });
    assert.equal((await call({ store })).ok, true, `value ${value}`);
  }
  // ⚠️ A membership value nobody recognises must read as NO ACCESS, never as more.
  for (const value of ['head-chef', false, null, 1, 'Owner']) {
    const store = fakeStore({ 'users/u1': { locations: { bakery: value } } });
    assert.equal((await call({ store })).error.code, 'permission-denied',
      `value ${JSON.stringify(value)}`);
  }
});

test('the catalogue being switched off refuses it', async () => {
  const store = fakeStore({ ...MEMBER, 'locations/bakery': { sections: { catalogue: false } } });
  assert.equal((await call({ store })).error.code, 'permission-denied');
});

test('⚠️ every section default points ON', async () => {
  // A missing location document, a missing sections map and a missing key all mean
  // yes. Getting this backwards locks out every venue whose location document
  // predates the feature — which is all of them.
  for (const seed of [
    MEMBER,
    { ...MEMBER, 'locations/bakery': {} },
    { ...MEMBER, 'locations/bakery': { sections: {} } },
    { ...MEMBER, 'locations/bakery': { sections: { orders: false } } },
  ]) {
    assert.equal((await call({ store: fakeStore(seed) })).ok, true);
  }
  assert.equal(sectionOn(null, 'catalogue'), true);
  assert.equal(sectionOn({ sections: { catalogue: false } }, 'catalogue'), false);
  // Only an explicit false switches it off.
  assert.equal(sectionOn({ sections: { catalogue: 0 } }, 'catalogue'), true);
});

// ── the order ────────────────────────────────────────────────────────────────

test('⚠️ a bad payload is refused BEFORE anything is charged', async () => {
  // Charging for a payload that was never going to be read charges for nothing.
  // This is deliberately the OPPOSITE of redeemJoinCode, where a malformed guess
  // must cost because the shape of a code is itself a secret.
  const store = fakeStore(MEMBER);
  const out = await call({ store, images: [] });
  assert.equal(out.error.code, 'invalid-argument');
  assert.equal(out.error.key, 'no-images');
  assert.deepEqual(store.writes, []);
});

test('⚠️ the payload is refused before the MEMBERSHIP is even read', async () => {
  // Cheapest question first: a malformed call from a stranger costs no reads.
  let asked = false;
  const store = fakeStore(MEMBER);
  store.access = async () => { asked = true; return true; };
  await call({ store, images: 'nonsense' });
  assert.equal(asked, false);
});

test('⚠️ the allowance is charged BEFORE the reader runs', async () => {
  const store = fakeStore(MEMBER);
  let chargedFirst = false;
  await call({ store, ask: async () => { chargedFirst = store.writes.length === 2; return answer(GOOD); } });
  assert.equal(chargedFirst, true, 'both allowances must be written before the call is made');
});

test('⚠️ the allowance is KEPT when the reader throws', async () => {
  // A refund path would have to decide what "it did not work" means, and every
  // answer to that is a way to read for free by making the call fail.
  const store = fakeStore(MEMBER);
  const out = await call({ store, images: [IMAGE, IMAGE], ask: async () => { throw new Error('network down'); } });
  assert.equal(out.error.code, 'internal');
  // ⚠️ THE CHARGE ITSELF, NOT MERELY THE DOCUMENT. The first version of this check
  // asked only whether the document EXISTED — and a mutation that refunded by
  // writing `{ at: [] }` left it existing and empty, so the check stayed green
  // while the allowance had been handed back. Found by mutation testing; it is the
  // difference between proving a rule and proving a file.
  assert.equal(store.docs.get('recipe-photo-limits/u1').at.length, 2, 'the person is still charged');
  assert.equal(store.docs.get('recipe-photo-venue/bakery').at.length, 2, 'the venue is still charged');
});

test('⚠️ the reader’s own error text never reaches the phone', async () => {
  const out = await call({ ask: async () => { throw new Error('401 invalid x-api-key sk-ant-XYZ'); } });
  assert.doesNotMatch(out.error.message, /sk-ant|401|x-api-key/,
    'a key fragment must never be shown to anybody');
  assert.match(out.logged, /sk-ant/, 'but it is written to the log, where it is needed');
});

test('each photo is charged, not each call', async () => {
  const store = fakeStore(MEMBER);
  await call({ store, images: [IMAGE, IMAGE, IMAGE] });
  assert.equal(store.docs.get('recipe-photo-limits/u1').at.length, 3);
  assert.equal(store.docs.get('recipe-photo-venue/bakery').at.length, 3);
});

test('the daily limit refuses, names itself, and says when it lifts', async () => {
  const store = fakeStore({ ...MEMBER, 'recipe-photo-limits/u1': { at: Array.from({ length: 40 }, () => NOW) } });
  const out = await call({ store });
  assert.equal(out.error.code, 'resource-exhausted');
  assert.equal(out.error.key, 'person-limit');
  assert.ok(out.error.hours >= 1);
});

test('the venue limit is separate from the person limit', async () => {
  const store = fakeStore({ ...MEMBER, 'recipe-photo-venue/bakery': { at: Array.from({ length: 150 }, () => NOW) } });
  const out = await call({ store });
  assert.equal(out.error.key, 'venue-limit');
});

test('a person blocked by their own limit does not consume the venue’s', async () => {
  const store = fakeStore({ ...MEMBER, 'recipe-photo-limits/u1': { at: Array.from({ length: 40 }, () => NOW) } });
  await call({ store });
  assert.ok(!store.docs.has('recipe-photo-venue/bakery'));
});

// ── an answer that is not a recipe ───────────────────────────────────────────

test('⚠️ "nothing readable" comes back as an ANSWER, not an error', async () => {
  // The call worked. The answer was "nothing I can use". Making that a failure is
  // what teaches somebody to stop believing the app.
  const cases = [
    [answer({ found: false, name: '', ingredients: [] }), 'nothing-readable'],
    [{ stop_reason: 'refusal', content: [] }, 'refused'],
    [{ stop_reason: 'max_tokens', content: [] }, 'truncated'],
    [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }, 'no-tool'],
  ];
  for (const [message, reason] of cases) {
    const out = await call({ ask: async () => message });
    assert.equal(out.ok, false, reason);
    assert.equal(out.reason, reason);
    assert.equal(out.error, undefined, 'never an error — the call itself worked');
  }
});

// ── the shell's wiring, which nothing can load ───────────────────────────────

test('⚠️ the callable is re-exported from index.js, or it is not deployed at all', () => {
  assert.match(read('functions/index.js'),
    /export \{ readRecipeFromPhotos \} from '\.\/recipe-photo\.js'/,
    'missing here, the app gets a generic "internal" that looks like a broken function');
});

test('⚠️ the secret is on its own options object, never the shared CALL', () => {
  const shell = codeOf('functions/recipe-photo.js');
  assert.match(shell, /secrets:\s*\[ANTHROPIC_KEY\]/);
  assert.match(shell, /maxInstances/, 'a ceiling on what can be in flight at once');
  assert.doesNotMatch(codeOf('functions/onboarding.js'), /secrets:\s*\[/,
    'the nine door functions must not carry an API key they have no use for');
});

test('⚠️ thinking is never disabled on this model', () => {
  // A disabled-thinking turn can write the tool call into visible TEXT instead of
  // emitting a tool_use block: the call succeeds, nothing errors, and the
  // extraction silently returns nothing for ever. Low effort is the right saving.
  const shell = codeOf('functions/recipe-photo.js');
  assert.doesNotMatch(shell, /type:\s*'disabled'/);
  assert.match(shell, /effort:\s*'low'/);
});

test('⚠️ the SDK’s retry and timeout defaults are overridden', () => {
  // Left alone: three full PAID attempts, each able to outlive the function.
  const shell = codeOf('functions/recipe-photo.js');
  assert.match(shell, /maxRetries:\s*1/);
  assert.match(shell, /timeout:\s*50_000/);
});

test('⚠️ the shell delegates the membership question, never re-answers it', () => {
  const shell = codeOf('functions/recipe-photo.js');
  assert.match(shell, /access:\s*accessValue/);
  assert.doesNotMatch(shell, /users\/\$\{/, 'a fourth reading of a membership value is a lockout');
});

// ── the model, and the parameters that belong to a different one ─────────────

test('⚠️ the model is named once, and the request suits it', () => {
  // Federico chose Sonnet 5 on measured numbers (22 Aug 2026). Pinned here so a
  // change is a deliberate edit to a test, not a quiet edit to a string — the model
  // decides both the bill and how well handwriting is read, and only one of those
  // shows up anywhere.
  const shell = codeOf('functions/recipe-photo.js');
  assert.match(shell, /const MODEL = 'claude-sonnet-5';/);

  // ⚠️ `fallbacks` AND ITS BETA HEADER ARE DOCUMENTED FOR OPUS 5 AND FABLE 5, NOT
  // FOR THIS MODEL. An unsupported parameter is a 400, and a 400 here is not a worse
  // read — it is the feature dead on the first tap, for everybody, at once. The
  // refusal is still handled: readToolResult() reads stop_reason before content.
  assert.doesNotMatch(shell, /fallbacks/, 'not documented for this model');
  assert.doesNotMatch(shell, /server-side-fallback/);
  // …and with no beta parameters left, the beta endpoint is the wrong door.
  assert.match(shell, /client\.messages\.create\(/);
  assert.doesNotMatch(shell, /client\.beta\.messages\.create\(/);
});

test('⚠️ the screen never resolves the venue — the data layer does, after the wait', () => {
  // The first version passed locationId in from the screen, which read it ONCE while
  // rendering. currentLocationId() returns null before a location is open, so the
  // screen froze a null and every read afterwards came back "which location?" — for
  // the life of that screen. It was a RACE: the same code read a recipe perfectly on
  // one run and refused on the next. Found by driving the app twice.
  const view = readFileSync(new URL('../js/catalogue/photo-capture.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /locationId/, 'the screen must not know or hold the venue');

  const layer = readFileSync(new URL('../js/catalogue/firebase-photo.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(layer.indexOf('await sessionReady') < layer.indexOf('currentLocationId()'),
    'the venue must be read AFTER the wait, or it can still be null');
});
