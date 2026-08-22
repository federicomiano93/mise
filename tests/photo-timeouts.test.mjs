// Two clocks, in two files, each correct on its own.
//
// ⚠️⚠️ httpsCallable GIVES UP AFTER 70 SECONDS BY DEFAULT. functions/recipe-photo.js
// declares 120. Left at the default, the phone abandons a call that is still
// running — and by then the daily allowance has been charged and the read has been
// paid for. The person sees a failure, the money is gone, and nothing anywhere says
// what happened.
//
// Neither number is wrong when you read its own file. That is exactly the shape
// this project pins by reading the source of both, the same way
// tests/copie-allineate.test.mjs pins the duplicated modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (n) => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');
// The comments in both files discuss these numbers; only the code decides them.
const codeOf = (n) => read(n).replace(/^\s*\/\/.*$/gm, '');

test('⚠️ the phone waits at least as long as the function may run', () => {
  const server = codeOf('functions/recipe-photo.js');
  const client = codeOf('js/catalogue/firebase-photo.js');

  const seconds = Number(/timeoutSeconds:\s*(\d+)/.exec(server)[1]);
  const clientMs = Number(/CLIENT_TIMEOUT_MS = (\d+)/.exec(client)[1]);

  assert.ok(seconds > 0 && clientMs > 0, 'both must actually be declared');
  assert.ok(clientMs >= seconds * 1000,
    `the phone gives up after ${clientMs}ms while the function may run ${seconds}s — `
    + 'the read would be paid for and thrown away');
});

test('⚠️ the client timeout is set explicitly, never left at the default', () => {
  // 70 seconds is the default and it is shorter than the function. A missing
  // option here is not a smaller number in a diff — it is no number at all.
  const client = codeOf('js/catalogue/firebase-photo.js');
  assert.match(client, /httpsCallable\([^)]*'readRecipeFromPhotos'[^)]*,\s*\{[\s\S]*?timeout:/,
    'httpsCallable must be given a timeout');
});

test('⚠️ the reader is given less time than the function it runs inside', () => {
  // The SDK's own timeout has to leave room for the function to answer at all: a
  // reader still working when the container is killed produces no result and no
  // error, only a charge.
  const server = codeOf('functions/recipe-photo.js');
  const seconds = Number(/timeoutSeconds:\s*(\d+)/.exec(server)[1]);
  const sdkMs = Number(/timeout:\s*([\d_]+)/.exec(server)[1].replace(/_/g, ''));
  assert.ok(sdkMs < seconds * 1000, `the SDK waits ${sdkMs}ms inside a ${seconds}s function`);
});

test('⚠️ the SDK is not left to retry on its own', () => {
  // maxRetries defaults to 2: three full PAID attempts, each able to outlive the
  // function that started them.
  assert.match(codeOf('functions/recipe-photo.js'), /maxRetries:\s*1/);
});
