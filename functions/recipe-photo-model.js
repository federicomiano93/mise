// recipe-photo-model.js — turning a photograph of a recipe into a DRAFT somebody
// then checks by hand. PURE: no network, no Firestore, no clock read from inside.
//
// Federico, 22 Aug 2026: «per facilitare il caricamento delle ricette vorrei che
// tramite una foto venga creata la ricetta con i campi precompilati, il salvataggio
// finale spetta sempre all'operatore».
//
// ⚠️⚠️ THE WHOLE FILE IS SHAPED BY ONE FACT: A MACHINE READING A PHOTOGRAPH IS
// SOMETIMES CONFIDENTLY WRONG, AND A WRONG QUANTITY LOOKS EXACTLY LIKE A RIGHT ONE.
// 100 g read as 1000 g is not a visible defect — it is a ruined batch found at the
// oven. So nothing here is ever saved: this produces a draft, the existing recipe
// editor shows it, and the person presses Save. Three rules follow from that:
//
//   1. it would rather return NOTHING than something that looks complete and is
//      not. `found` is a field the reader must set, never something inferred from
//      an empty list — see draftFromToolInput;
//   2. every value is clamped to what the database will actually accept, here, in
//      one tested place. A key or a size the rules refuse makes EVERY later save of
//      that recipe fail with a permission error the screen cannot explain;
//   3. it costs real money per call, so the limits are counted before the work and
//      never refunded.
//
// ⚠️ THIS FILE HAS NO IMPORTS, AND THAT IS FORCED, NOT STYLISTIC. CI's `test` job
// runs `node --test` at the repo root and NEVER runs `npm ci` in functions/ — that
// happens only in `deploy-functions`. A file the root tests import must therefore
// resolve with no node_modules. Every judgement lives here; functions/recipe-photo.js
// is a shell that supplies the network and nothing else.

// ── What the database will accept ────────────────────────────────────────────
// ⚠️ THESE MIRROR firestore.rules AND MUST NOT DRIFT. The recipes block reads
// `name.size() < 200` and `ingredients.size() <= 300`, so the cap here is 199, not
// 200. tests/recipe-photo-caps.test.mjs parses those two numbers out of the rules
// file and compares them with these — because drift does not fail here, it fails
// later, as a permission error on somebody else's save.
export const MAX_NAME = 199;
export const MAX_ROWS = 300;
export const MAX_LABEL = 120;

// The twelve units the catalogue understands. ⚠️ A COPY of CATALOGUE_UNITS in
// js/catalogue/catalogue-model.js, and it cannot be an import: that file imports
// the i18n dictionary, which cannot run on the server. Pinned by
// tests/recipe-photo-model.test.mjs, which reads the other file and compares.
export const UNITS = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste'];
export const DEFAULT_UNIT = 'g';

// A quantity nobody types. Bread is scaled in kilos; 1,000,000 of anything is a
// misread decimal point, and clamping is kinder than refusing the whole recipe.
export const MAX_AMOUNT = 1000000;

// ── What one call may carry ──────────────────────────────────────────────────
// Five photos covers a recipe written across a double page and its overleaf. The
// byte caps keep the callable payload well inside its ~10MB ceiling AND keep the
// bill down: the reader charges by pixels, so a photo nobody downscaled costs more
// and reads no better (it is downsampled at the far end anyway).
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

// ── What one person, and one venue, may spend in a day ───────────────────────
// ⚠️ TWO CEILINGS, NOT ONE. Per person alone, twenty staff at forty photos each is
// about $24 in a day — a bill nobody chose. Per venue alone, one person could use
// up everybody else's allowance before the morning shift arrives.
//
// ⚠️ AND NEITHER IS THE REAL GUARD. The real guard is the spend limit on the API
// key itself, which holds even if this file is wrong. These two exist so a mistake
// costs pennies rather than the whole month's cap.
export const DAILY_IMAGES_PER_PERSON = 40;
export const DAILY_IMAGES_PER_VENUE = 150;
export const WINDOW_MS = 24 * 60 * 60 * 1000;

// ── The payload ──────────────────────────────────────────────────────────────

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Roughly how many bytes a base64 string stands for. Cheap, and never an
// under-estimate by more than two bytes, which is what a size guard needs.
export function approxBytes(base64) {
  return typeof base64 === 'string' ? Math.floor(base64.length * 3 / 4) : 0;
}

// What is wrong with this set of photos, or null. Run on the PHONE before sending
// and again on the SERVER before charging — the phone's copy saves somebody a slow
// upload, the server's copy is the one that is actually enforced.
//
// ⚠️ It returns a CODE, never a sentence. The app is bilingual and the phrase is
// chosen on the phone; a message built here would arrive in one language.
export function payloadProblem(images) {
  if (!Array.isArray(images) || images.length === 0) return { code: 'no-images' };
  if (images.length > MAX_IMAGES) return { code: 'too-many-images' };

  let total = 0;
  for (const image of images) {
    if (!image || typeof image !== 'object') return { code: 'bad-image' };
    const { data, mediaType } = image;
    if (typeof data !== 'string' || !data || !BASE64.test(data)) return { code: 'bad-image' };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) return { code: 'bad-image' };
    const bytes = approxBytes(data);
    if (bytes > MAX_IMAGE_BYTES) return { code: 'image-too-large' };
    total += bytes;
  }
  if (total > MAX_TOTAL_BYTES) return { code: 'images-too-large' };
  return null;
}

// ── What we ask the reader for ───────────────────────────────────────────────

// ⚠️ A STRICT TOOL, NOT FREE TEXT. `strict: true` sits on the TOOL, not on
// tool_choice, and makes the reader's answer conform to this schema or not arrive
// at all — so there is no JSON to parse hopefully and no half-object to guess at.
//
// ⚠️ `found` IS THE MOST IMPORTANT FIELD HERE. "There is no recipe in this photo"
// has to be something the reader SAYS, not something we infer from an empty list —
// an empty list is also what a reader produces when it has failed, and telling
// those two apart afterwards is impossible. With `found`, the screen that says
// «no recipe was found» is telling the truth rather than guessing.
export function toolDefinition() {
  return {
    name: 'record_recipe',
    description: 'Record the recipe written in the photographs.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        found: {
          type: 'boolean',
          description: 'True only if the photographs really show a recipe with a list of ingredients.',
        },
        name: {
          type: 'string',
          description: 'The name of the recipe as written. Empty string if it has none.',
        },
        ingredients: {
          type: 'array',
          description: 'One entry per ingredient line, in the order written.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The ingredient name, as written.' },
              amount: { type: 'number', description: 'The quantity as a number. 0 if none is given.' },
              unit: { type: 'string', enum: UNITS, description: 'The unit of that quantity.' },
            },
            required: ['label', 'amount', 'unit'],
            additionalProperties: false,
          },
        },
      },
      required: ['found', 'name', 'ingredients'],
      additionalProperties: false,
    },
  };
}

// ⚠️ THE DECIMAL COMMA IS NOT A DETAIL. An Italian recipe writes «1,5 kg», and read
// as an English thousands separator that is 15 kg — ten times the dough, and a
// number that looks perfectly ordinary on the screen afterwards. It is called out
// explicitly because it is the one misreading this app is most likely to meet.
export function promptText() {
  return [
    'These photographs show one recipe, possibly spread over several pages.',
    'Record its name and every ingredient line, in the order they are written.',
    '',
    'Rules:',
    '- A comma inside a number is a DECIMAL SEPARATOR, not a thousands separator:',
    '  "1,5 kg" is 1.5 kg. A full stop is also a decimal separator.',
    '- Keep each ingredient name exactly as written, in its own language.',
    '  Do not translate it and do not tidy it up.',
    '- Use the unit that is written. If a line gives no unit, use "to taste".',
    '  If a line gives no quantity at all, record the amount as 0.',
    '- List an ingredient twice if the recipe names it twice; do not merge lines.',
    '- Ignore the method, the oven temperature, timings and any prose.',
    '- If the photographs do not show a recipe with a list of ingredients,',
    '  set found to false and leave the other fields empty.',
  ].join('\n');
}

// ── Reading the reply ────────────────────────────────────────────────────────

// ⚠️ stop_reason IS CHECKED BEFORE content IS TOUCHED. A refusal arrives as a
// normal 200 with a stop_reason, not as an error, so code that goes straight for
// the content finds nothing and reports the wrong thing.
export function readToolResult(message) {
  if (!message || typeof message !== 'object') return { problem: 'no-tool' };
  if (message.stop_reason === 'refusal') return { problem: 'refused' };
  if (message.stop_reason === 'max_tokens') return { problem: 'truncated' };

  const blocks = Array.isArray(message.content) ? message.content : [];
  // ⚠️ FIND IT, NEVER content[0]. A thinking block, or a sentence before the call,
  // sits in front of it — and indexing position zero would report a working read
  // as a failure at random.
  const call = blocks.find(b => b && b.type === 'tool_use');
  if (!call || !call.input || typeof call.input !== 'object') return { problem: 'no-tool' };
  return { input: call.input };
}

// ── The draft ────────────────────────────────────────────────────────────────

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, MAX_AMOUNT) * 1000) / 1000;
}

// The reader's answer, turned into exactly what the recipe editor and the database
// expect. Returns `{ recipe, notes }`; `recipe` is null when there is nothing
// worth opening a screen for.
//
// ⚠️ THE SHAPE IS EXACT AND MUST STAY EXACT: a row is `{ label, grams, unit }` and
// a recipe is `{ name, ingredients }`. Never `rid` — those are minted on save by
// withRowIds, and one invented here would bind a guided step to the wrong line.
// Never `kind`/`refId`/`lossPct`/`steps`/`endNote`/`bakery`/`id` — the rules carry
// a CLOSED key list, so one extra key makes every save of that recipe fail with a
// permission error nothing on screen can explain.
//
// ⚠️ `grams` IS A MISNOMER AND IT IS THE CATALOGUE'S, NOT OURS: the field holds the
// amount in the ROW'S OWN unit, not grams. The rename from the reader's `amount`
// happens here, in a tested function, rather than by asking the reader to use a
// field name that would confuse it.
export function draftFromToolInput(input) {
  const notes = { rowsDropped: 0, rowsCapped: false, nameTruncated: false };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { recipe: null, notes };
  }
  // ⚠️ The reader has to SAY it found a recipe. Anything other than a true here —
  // false, missing, a string — means no.
  if (input.found !== true) return { recipe: null, notes };

  const rawName = typeof input.name === 'string' ? input.name : '';
  const name = cleanText(rawName, MAX_NAME);
  notes.nameTruncated = cleanText(rawName, MAX_NAME + 1).length > MAX_NAME;

  const rows = [];
  const list = Array.isArray(input.ingredients) ? input.ingredients : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { notes.rowsDropped++; continue; }
    const label = cleanText(raw.label, MAX_LABEL);
    // A row with no name is not an ingredient. The editor drops these on save
    // anyway (cleanWorking); dropping them here means the screen never shows a
    // blank line somebody has to work out what to do with.
    if (!label) { notes.rowsDropped++; continue; }
    const unit = typeof raw.unit === 'string' && UNITS.includes(raw.unit) ? raw.unit : DEFAULT_UNIT;
    rows.push({ label, grams: cleanAmount(raw.amount), unit });
  }

  // ⚠️ NOT DEDUPLICATED, DELIBERATELY. A recipe legitimately lists flour twice —
  // some in the starter, the rest in the dough — and merging those two lines would
  // silently change the recipe into a different one.
  if (rows.length > MAX_ROWS) {
    notes.rowsCapped = true;
    rows.length = MAX_ROWS;
  }

  // Nothing at all is nothing to show. A recipe with rows but no name IS worth
  // showing: the editor already refuses that save and puts the cursor in the name.
  if (!name && rows.length === 0) return { recipe: null, notes };
  return { recipe: { name, ingredients: rows }, notes };
}

// ── The daily allowance ──────────────────────────────────────────────────────

// Which of the recorded moments still fall inside the window.
function recent(record, now) {
  const list = record && Array.isArray(record.at) ? record.at : [];
  return list.map(Number).filter(t => Number.isFinite(t) && now - t < WINDOW_MS);
}

// Charge `count` photos against a rolling 24 hours, or refuse. Modelled on
// chargeAttempt in functions/onboarding.js: the same document shape, and the same
// rule that the charge is made BEFORE the work and never given back.
//
// ⚠️ IT RETURNS THE NEXT DOCUMENT RATHER THAN WRITING ONE. Keeping the decision
// here and the write in the shell is what lets every boundary be tested without a
// database, and it is the only reason the "charged even when the reader throws"
// case can be proved at all.
export function chargeImages(record, now, count, limit) {
  const kept = recent(record, now);
  const used = kept.length;
  if (used + count > limit) {
    // When it lifts: the oldest moment that must fall out of the window before
    // there is room. An empty list here cannot happen (used >= count > 0).
    const oldest = kept.sort((a, b) => a - b)[Math.max(0, used - limit + count - 1)];
    const retryMs = Math.max(0, WINDOW_MS - (now - oldest));
    return { blocked: true, used, retryMs };
  }
  const at = [...kept];
  for (let i = 0; i < count; i++) at.push(now);
  return {
    blocked: false,
    used: used + count,
    remaining: limit - used - count,
    // Trimmed on every write so one document cannot grow for ever.
    next: { at: at.slice(-limit * 2), updatedAt: now },
  };
}

// ── The whole sequence ───────────────────────────────────────────────────────
//
// ⚠️⚠️ THE ORDER LIVES HERE, IN THE FILE WITH NO IMPORTS, AND THAT IS THE POINT.
// The arithmetic above is easy to test anywhere; the ORDER is the part that goes
// wrong in a way that reads perfectly well, and it can only be proved if it can be
// run. functions/recipe-photo.js cannot be imported by the root test job — its
// dependencies are installed only by the deploy — so anything that matters and
// lives there is, in practice, untested for ever.
//
// Everything the outside world provides is handed in:
//   store.access(uid, lid)      → the membership VALUE, or false. ⚠️ Implemented by
//                                 the shell with onboarding.js's accessValue, never
//                                 re-decided here: what a membership value MEANS
//                                 already lives in three files that must agree, and
//                                 a fourth reading is a lockout waiting to happen.
//   store.location(lid)         → the location document, or null
//   store.limit(path)           → an allowance document, or null
//   store.saveLimit(path, value)
//   ask(images)                 → the reader's reply
//   now                         → the clock, never read from in here
//
// It RETURNS its refusals as plain objects rather than throwing framework errors,
// so nothing here needs firebase-functions. The shell turns `error` into an
// HttpsError and nothing else.
export async function readRecipe({ uid, locationId, images, store, ask, now }) {
  if (!uid) return { error: { code: 'unauthenticated', key: 'signed-out', message: 'Sign in first.' } };
  if (typeof locationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(locationId)) {
    return { error: { code: 'invalid-argument', key: 'no-location', message: 'Which location?' } };
  }

  // ⚠️ THE SHAPE IS CHECKED BEFORE ANYTHING IS CHARGED, which is the opposite of
  // redeemJoinCode — there a malformed guess MUST cost, because the shape of a
  // code is itself a secret. Here the shape is public, so charging for a payload
  // that was never going to be read charges somebody for nothing.
  const bad = payloadProblem(images);
  if (bad) {
    return { error: { code: 'invalid-argument', key: bad.code, message: `Those photos cannot be read (${bad.code}).` } };
  }

  if (!await store.access(uid, locationId)) {
    return { error: { code: 'permission-denied', key: 'not-allowed', message: 'You are not in that venue.' } };
  }
  // ⚠️ ONE READ ANSWERS BOTH QUESTIONS. The section and the switch live on the same
  // document, so asking twice would double the reads for nothing.
  const location = await store.location(locationId);
  if (!sectionOn(location, 'catalogue')) {
    return { error: { code: 'permission-denied', key: 'not-allowed', message: 'The recipe catalogue is not switched on here.' } };
  }
  if (!photoEnabled(location)) {
    return { error: { code: 'failed-precondition', key: 'photo-off', message: 'Reading recipes from a photo is switched off for this venue.' } };
  }

  // ⚠️ CHARGED BEFORE THE READER IS CALLED, AND NEVER REFUNDED. A refund path would
  // have to decide what "it did not work" means, and every answer to that question
  // is a way to read for free by making the call fail.
  const person = await chargeTo(store, `recipe-photo-limits/${uid}`, images.length, DAILY_IMAGES_PER_PERSON, now);
  if (person.blocked) return { error: limitError('person-limit', person, 'You have') };
  const venue = await chargeTo(store, `recipe-photo-venue/${locationId}`, images.length, DAILY_IMAGES_PER_VENUE, now);
  if (venue.blocked) return { error: limitError('venue-limit', venue, 'This venue has') };

  let message;
  try {
    message = await ask(images);
  } catch (err) {
    // ⚠️ THE READER'S OWN MESSAGE IS NEVER PASSED ON. It is written for a developer,
    // it is English, and it can contain a fragment of the API key.
    return { error: { code: 'internal', key: 'read-failed', message: 'The photo could not be read. Try again.' },
      logged: String(err && err.message) };
  }

  const result = readToolResult(message);
  // ⚠️ NOT AN ERROR. The call worked; the answer was "nothing I can use". Making
  // that a failure is what teaches somebody to stop believing the app.
  if (result.problem) return { ok: false, reason: result.problem, usage: usageOf(message) };

  const { recipe, notes } = draftFromToolInput(result.input);
  if (!recipe) return { ok: false, reason: 'nothing-readable', usage: usageOf(message) };
  return { ok: true, recipe, notes, remaining: person.remaining, usage: usageOf(message) };
}

// ⚠️ THE DEFAULT IS ON, IN THREE PLACES AT ONCE — a missing location document, a
// missing `sections` map and a missing key all mean yes. A section added to the app
// after a venue was created must not switch itself off for that venue.
//
// ⚠️ It matches firestore.rules sectionOn(), NOT js/sections.js. The client's
// version forgives a stray space in the field name (production once carried a
// literal `sections ` key); the rules do not, and it is the rules that decide
// whether the finished recipe can be SAVED. A check that disagreed with them would
// let somebody pay for a read they cannot keep.
// Is reading a photograph switched on for this venue?
//
// ⚠️⚠️ THE DEFAULT IS OFF, AND IT POINTS THE OPPOSITE WAY TO sectionOn() BELOW ON
// PURPOSE. A missing SECTION means yes, because a part of the app added after a venue
// was created must not switch itself off for that venue. A missing switch here means
// NO, because this one SPENDS MONEY per tap, on an account nobody in the venue owns —
// a venue that has never heard of it must never find it already running.
//
// ⚠️ ONLY A LITERAL `true` COUNTS. A stray string, a 1, a corrupt value: all off. Read
// the other way round, "anything truthy is on", a mangled field would quietly start
// spending.
//
// ⚠️ AND IT IS NOT INSIDE `sections`. sectionOn() reads a missing key as true, so
// putting it there would hand the feature to every venue at once and the mistake
// would be invisible until an invoice arrived.
export function photoEnabled(locationDoc) {
  return !!locationDoc && typeof locationDoc === 'object' && locationDoc.recipePhoto === true;
}

export function sectionOn(locationDoc, name) {
  if (!locationDoc || typeof locationDoc !== 'object') return true;
  const sections = locationDoc.sections;
  if (!sections || typeof sections !== 'object') return true;
  return sections[name] !== false;
}

async function chargeTo(store, path, count, limit, now) {
  const result = chargeImages(await store.limit(path), now, count, limit);
  if (!result.blocked) await store.saveLimit(path, result.next);
  return result;
}

function limitError(key, result, who) {
  const hours = Math.max(1, Math.round(result.retryMs / (60 * 60 * 1000)));
  return {
    code: 'resource-exhausted',
    key,
    hours,
    retryMs: result.retryMs,
    message: `${who} read ${result.used} photos today. More in about ${hours} hours.`,
  };
}

function usageOf(message) {
  const u = (message && message.usage) || {};
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
}
