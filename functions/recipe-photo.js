// recipe-photo.js — the shell around functions/recipe-photo-model.js: the secret,
// the network, the database. It contains no judgement at all.
//
// ⚠️⚠️ EVERY DECISION IS IN THE MODEL, AND THAT IS FORCED. This file imports
// @anthropic-ai/sdk and firebase-functions, which CI installs only in the
// deploy-functions job — so a root test can never load it, and anything that
// mattered and lived here would be untested for ever. What is left is wiring, and
// the wiring is checked by reading this file (tests/recipe-photo-handler.test.mjs).
//
// ⚠️ THIS IS THE FIRST CODE IN THE PROJECT THAT SPENDS MONEY PER TAP, and the first
// that holds a REAL secret (js/firebase.js is public config; this is not). Four
// guards, in order of how much they can be relied on:
//   1. a SPEND LIMIT on the Anthropic key itself — the only one that holds when
//      this code is wrong, and it is set outside the repo;
//   2. maxInstances below;
//   3. the daily allowances, charged in the model before the reader is called;
//   4. the payload caps.
//
// ⚠️ The key must never reach a browser. That is the whole reason this exists
// rather than the app calling the API itself.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import Anthropic from '@anthropic-ai/sdk';
import { accessValue } from './onboarding.js';
import { readRecipe, toolDefinition, promptText } from './recipe-photo-model.js';

const REGION = 'us-central1';
const db = () => getFirestore();

const ANTHROPIC_KEY = defineSecret('ANTHROPIC_API_KEY');

// ⚠️ ITS OWN OPTIONS OBJECT, NOT THE SHARED `CALL` IN onboarding.js. Attaching a
// secret there would attach it to all nine door functions: every one of them would
// then fail to start if the binding were ever lost, and none of them has any
// business holding an API key.
//
// ⚠️ timeoutSeconds MUST STAY >= the client's own timeout in
// js/catalogue/firebase-photo.js, or the phone abandons a call that is still
// running and has already been paid for. tests/photo-timeouts.test.mjs pins the pair.
const PHOTO_CALL = {
  region: REGION,
  secrets: [ANTHROPIC_KEY],
  timeoutSeconds: 120,
  memory: '512MiB',
  maxInstances: 10,
};

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 8000;

// The one call to the reader.
async function askAnthropic(images, apiKey) {
  // ⚠️ THE SDK'S DEFAULTS ARE WRONG FOR US: maxRetries 2 and a ten-minute timeout
  // mean three full PAID attempts, each able to outlive the function itself.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 50_000 });

  return client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // ⚠️ LOW EFFORT, AND THINKING LEFT ON. This is transcription, not reasoning, so
    // the thinking tokens are waste — but `thinking: { type: 'disabled' }` is NOT
    // the way to save them: on this model a disabled-thinking turn sometimes writes
    // the tool call into visible TEXT instead of emitting a tool_use block. The
    // call succeeds, nothing errors, and the extraction silently returns nothing.
    output_config: { effort: 'low' },
    // A policy decline is vanishingly unlikely on a photograph of a recipe, but it
    // costs one header to reroute rather than fail.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools: [toolDefinition()],
    messages: [{
      role: 'user',
      content: [
        // Images FIRST, then the instruction — the documented order.
        ...images.map(i => ({
          type: 'image',
          source: { type: 'base64', media_type: i.mediaType, data: i.data },
        })),
        { type: 'text', text: promptText() },
      ],
    }],
  });
}

// The four things the model needs from the outside world.
//
// ⚠️ `access` DELEGATES TO onboarding.js RATHER THAN RE-READING users/{uid}. What a
// membership value MEANS already lives in three files that must agree
// (firestore.rules member(), js/sections.js locationsOf(), onboarding.js
// accessValue) and forgetting a value there is a LOCKOUT, not a demotion. A fourth
// reading is the one nobody would remember to update.
const store = {
  access: accessValue,
  location: async (lid) => {
    const snap = await db().doc(`locations/${lid}`).get();
    return snap.exists ? snap.data() : null;
  },
  limit: async (path) => {
    const snap = await db().doc(path).get();
    return snap.exists ? snap.data() : null;
  },
  saveLimit: async (path, value) => { await db().doc(path).set(value); },
};

export const readRecipeFromPhotos = onCall(PHOTO_CALL, async (request) => {
  const { locationId, images } = request.data || {};
  const uid = request.auth && request.auth.uid;

  const out = await readRecipe({
    uid,
    locationId,
    images,
    store,
    now: Date.now(),
    ask: (list) => askAnthropic(list, ANTHROPIC_KEY.value()),
  });

  if (out.error) {
    if (out.logged) logger.error('Recipe photo read failed', { uid, locationId, error: out.logged });
    const { code, message, ...details } = out.error;
    throw new HttpsError(code, message, details);
  }

  // The only place the bill is visible. Without it, a change in what a read costs
  // is invisible until the invoice arrives.
  logger.info('Recipe photo read', {
    uid, locationId,
    images: Array.isArray(images) ? images.length : 0,
    ok: out.ok,
    reason: out.reason,
    rows: out.recipe ? out.recipe.ingredients.length : 0,
    inputTokens: out.usage && out.usage.inputTokens,
    outputTokens: out.usage && out.usage.outputTokens,
    remaining: out.remaining,
  });

  const { usage, ...forThePhone } = out;
  return forThePhone;
});
