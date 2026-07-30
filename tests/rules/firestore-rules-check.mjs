// firestore-rules-check.mjs — prove the Orders security rules accept every write
// the app really makes, and reject everything else.
//
// Run it with the emulators up:
//   firebase emulators:exec --only auth,firestore "npm run test:rules"
// or, against an emulator you already have running:
//   npm run test:rules
//
// WHY THIS EXISTS. The four Orders collections used to validate nothing but
// `bakery == 'main'`. Tightening them is dangerous in one specific way: suppliers,
// ingredients and drafts are written with setDoc(merge: true), and on an update
// Firestore evaluates rules against the FULL MERGED document. So a retired field
// still sitting on a live document — and production really does carry
// notifyHoursBefore and weekId — makes keys().hasOnly() reject every future write
// to it. The failure is silent at the database level and permanent. These tests
// pin exactly that: the legacy shapes must stay writable.
//
// HOW IT WORKS, and why there are no dependencies:
//   * Seeding uses `Authorization: Bearer owner`, which the emulator treats as
//     admin — rules are skipped. That is the only way to plant a legacy shape the
//     new rules would themselves refuse.
//   * Assertions use a real anonymous ID token minted from the Auth emulator, so
//     rules ARE enforced, exactly as in the browser.
//   * Everything is hardcoded to 127.0.0.1. It can never reach production.
//
// FIDELITY NOTE. setDoc(merge:true) is reproduced as PATCH + updateMask listing the
// payload's TOP-LEVEL keys. The SDK deep-merges nested maps where a top-level mask
// replaces them wholesale — immaterial here, because rules only ever see the
// post-write document, and the property under test ("fields outside the mask
// survive, so hasOnly sees them") is reproduced exactly.
//
// Deliberately NOT named *.test.mjs: `node --test` auto-discovers that pattern and
// CI has no emulator. Keep it that way.

import { toFields, wipe, seedDoc, readDoc, requireEmulators, FIXTURE } from './seed-emulator.mjs';

const PROJECT = 'bakery-app-ebf90';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake';

// ── Accounts ─────────────────────────────────────────────────────────────────
// Real email/password accounts from the Auth emulator, because that is what the
// app uses now. Anonymous sign-in is gone: it was the reason anyone who knew the
// address could read everything.
async function account(label) {
  const res = await fetch(AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'password-for-tests',
      returnSecureToken: true,
    }),
  });
  const body = await res.json();
  if (!body.idToken) throw new Error(`Sign-up failed: ${JSON.stringify(body).slice(0, 200)}`);
  return { uid: body.localId, token: body.idToken };
}

// ALICE belongs to restaurant 'main' and uses the whole app; the scenarios below
// run as her. BOB belongs to 'trattoria-x' and uses ORDERS ONLY; he exists to
// prove what he CANNOT reach. NOBODY has an account but no access document.
let ALICE = null, BOB = null, NOBODY = null;

let TOKEN = null;
const asUser = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
const asAccount = who => ({ Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' });
const noAuth = () => ({ 'Content-Type': 'application/json' });

// wipe() empties the database, so the access documents have to go back in after
// every scenario — without them, every check would fail for the wrong reason.
async function seedAccess() {
  await seedDoc(`users/${ALICE.uid}`, { restaurants: { main: true } });
  await seedDoc(`users/${BOB.uid}`, { restaurants: { 'trattoria-x': true } });
  await seedDoc('restaurants/main', { name: 'The Italian Club' });
  await seedDoc('restaurants/trattoria-x', {
    name: 'Trattoria X',
    sections: { orders: true, calculator: false, catalogue: false },
  });
}

// ── The four write shapes the app uses, over REST ────────────────────────────

// setDoc(ref, data, { merge: true })  →  saveDoc()
function mergeWrite(path, data, headers = asUser()) {
  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  return fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: toFields(data) }),
  });
}

// setDoc(ref, data)  →  replaceDoc() and the transaction's tx.set()
function wholeWrite(path, data, headers = asUser()) {
  return fetch(`${FS}/${path}`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: toFields(data) }),
  });
}

// updateDoc with deleteField() on dotted paths  →  clearFields() / clearSupplier()
// The deleted paths go in the MASK but not in the body, which is what deletes them.
function clearWrite(path, patch, deletePaths, headers = asUser()) {
  const mask = [...Object.keys(patch), ...deletePaths]
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  return fetch(`${FS}/${path}?${mask}`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: toFields(patch) }),
  });
}

// addDoc()  →  createDoc()
function createWrite(collection, data, headers = asUser()) {
  return fetch(`${FS}/${collection}`, {
    method: 'POST', headers, body: JSON.stringify({ fields: toFields(data) }),
  });
}

// deleteDoc()  →  removeDoc()
function deleteWrite(path, headers = asUser()) {
  return fetch(`${FS}/${path}`, { method: 'DELETE', headers });
}

// ── Tiny assertion harness ───────────────────────────────────────────────────
let passed = 0;
const failures = [];

async function expectAllowed(label, run) {
  const res = await run();
  if (res.ok) { passed++; return; }
  failures.push(`ALLOW expected — ${label}\n      got ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function expectDenied(label, run) {
  const res = await run();
  // A rules refusal is 403. A 400 means the REQUEST was malformed, which would be a
  // bug in this harness masquerading as a passing test — so it is called out.
  if (res.status === 403) { passed++; return; }
  if (res.ok) { failures.push(`DENY expected — ${label}\n      but the write SUCCEEDED (${res.status})`); return; }
  failures.push(`DENY expected — ${label}\n      got ${res.status} (not 403): ${(await res.text()).slice(0, 200)}`);
}

function check(label, condition) {
  if (condition) { passed++; return; }
  failures.push(`STATE wrong — ${label}`);
}

const bigString = n => 'x'.repeat(n);

// ── Scenarios ────────────────────────────────────────────────────────────────
async function suppliers() {
  await wipe();
  await seedAccess();
  await seedDoc('restaurants/main/suppliers/SUP_LEGACY', FIXTURE.suppliers.SUP_LEGACY);
  await seedDoc('restaurants/main/suppliers/SUP_MODERN', FIXTURE.suppliers.SUP_MODERN);

  // THE ONE THAT MATTERS: Deactivate on a supplier that still carries the retired
  // field and has no orderDays. This is the write that a naive hasOnly() breaks.
  await expectAllowed('Deactivate a pre-6-Jul supplier (notifyHoursBefore: null, no orderDays)',
    () => mergeWrite('restaurants/main/suppliers/SUP_LEGACY', { active: false, bakery: 'main' }));

  await seedDoc('restaurants/main/suppliers/SUP_NUM', { ...FIXTURE.suppliers.SUP_LEGACY, notifyHoursBefore: 12 });
  await expectAllowed('Deactivate a supplier whose notifyHoursBefore is a number',
    () => mergeWrite('restaurants/main/suppliers/SUP_NUM', { active: false, bakery: 'main' }));

  await expectAllowed('save the whole supplier form onto a legacy document', () =>
    mergeWrite('restaurants/main/suppliers/SUP_LEGACY', {
      name: 'Aldo Legacy Foods', category: 'Dry goods', phone: '447700900123',
      email: 'orders@aldolegacy.example', deliveryDays: ['Tuesday'],
      orderDays: ['Monday'], active: true, bakery: 'main',
    }));

  const after = await readDoc('restaurants/main/suppliers/SUP_LEGACY');
  check('notifyHoursBefore survives a full-form merge (it must, or hasOnly would be wrong)',
    Boolean(after?.fields?.notifyHoursBefore));

  await expectAllowed('create a brand-new supplier', () =>
    createWrite('restaurants/main/suppliers', {
      name: 'New Co', category: '', phone: '', email: '',
      deliveryDays: [], orderDays: [], active: true, bakery: 'main',
    }));

  await expectDenied('an unknown key on a supplier',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { evil: 'x', bakery: 'main' }));
  await expectDenied('a supplier stamped with the wrong bakery',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { active: true, bakery: 'other' }));
  await expectDenied('a supplier write with no authentication',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { active: true, bakery: 'main' }, noAuth()));
  await expectDenied('a 5000-character supplier name',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { name: bigString(5000), bakery: 'main' }));
  await expectDenied('50 order days on a supplier',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { orderDays: Array(50).fill('Monday'), bakery: 'main' }));
  await expectDenied('deliveryDays sent as a string instead of a list',
    () => mergeWrite('restaurants/main/suppliers/SUP_MODERN', { deliveryDays: 'Monday', bakery: 'main' }));

  await expectAllowed('delete a supplier', () => deleteWrite('restaurants/main/suppliers/SUP_MODERN'));
}

async function ingredients() {
  await wipe();
  await seedAccess();
  await seedDoc('restaurants/main/ingredients/ING_LEGACY', FIXTURE.ingredients.ING_LEGACY);
  await seedDoc('restaurants/main/ingredients/ING_MODERN', FIXTURE.ingredients.ING_MODERN);

  await expectAllowed('Deactivate a pre-v1.10.0 ingredient (no brand, no weight)',
    () => mergeWrite('restaurants/main/ingredients/ING_LEGACY', { active: false, bakery: 'main' }));

  await expectAllowed('save the whole ingredient form', () =>
    mergeWrite('restaurants/main/ingredients/ING_MODERN', {
      name: 'Bacon', supplierId: 'SUP_MODERN', brand: 'Galbani', weight: '2.27kg',
      category: 'Other', unit: 'casse', active: true, bakery: 'main',
    }));

  await expectAllowed('create a brand-new ingredient', () =>
    createWrite('restaurants/main/ingredients', {
      name: 'Olives', supplierId: 'SUP_MODERN', brand: '', weight: '',
      category: 'Other', unit: '', active: true, bakery: 'main',
    }));

  await expectDenied('an unknown key on an ingredient',
    () => mergeWrite('restaurants/main/ingredients/ING_MODERN', { evil: 'x', bakery: 'main' }));
  await expectDenied('an ingredient stamped with the wrong bakery',
    () => mergeWrite('restaurants/main/ingredients/ING_MODERN', { active: true, bakery: 'other' }));
  await expectDenied('a 5000-character ingredient name',
    () => mergeWrite('restaurants/main/ingredients/ING_MODERN', { name: bigString(5000), bakery: 'main' }));
  await expectDenied('active sent as a string instead of a boolean',
    () => mergeWrite('restaurants/main/ingredients/ING_MODERN', { active: 'yes', bakery: 'main' }));

  await expectAllowed('delete an ingredient', () => deleteWrite('restaurants/main/ingredients/ING_MODERN'));
}

async function drafts() {
  await wipe();
  await seedAccess();
  await seedDoc('restaurants/main/drafts/current', FIXTURE.draft);

  // THE OTHER ONE THAT MATTERS: the autosave writes onto a draft that still carries
  // the retired weekId. If this is refused, typing an order saves nothing.
  await expectAllowed('autosave onto a draft that still carries the retired weekId', () =>
    mergeWrite('restaurants/main/drafts/current', {
      entries: { ING_LEGACY: { qty: 3, stock: 1 } },
      days: { SUP_LEGACY: '2026-07-24' },
      updatedAt: new Date().toISOString(),
      bakery: 'main',
    }));

  await expectAllowed('clearSupplier removes one supplier\'s rows', () =>
    clearWrite('restaurants/main/drafts/current',
      { updatedAt: new Date().toISOString(), bakery: 'main' },
      ['entries.ING_LEGACY', 'days.SUP_LEGACY']));

  const after = await readDoc('restaurants/main/drafts/current');
  check('the cleared row is gone',
    !after?.fields?.entries?.mapValue?.fields?.ING_LEGACY);
  check('weekId survives the clear',
    after?.fields?.weekId?.stringValue === '2026-W28');

  await expectDenied('an unknown key on the draft',
    () => mergeWrite('restaurants/main/drafts/current', { evil: 'x', bakery: 'main' }));
  await expectDenied('entries sent as a string instead of a map',
    () => mergeWrite('restaurants/main/drafts/current', { entries: 'nope', bakery: 'main' }));

  const huge = {};
  for (let i = 0; i < 2001; i++) huge[`k${i}`] = { qty: 1, stock: 0 };
  await expectDenied('a draft stuffed with 2001 entries',
    () => mergeWrite('restaurants/main/drafts/current', { entries: huge, bakery: 'main' }));

  await expectDenied('deleting the draft (nothing in the app does this any more)',
    () => deleteWrite('restaurants/main/drafts/current'));
  await expectDenied('writing a draft document other than "current"',
    () => mergeWrite('restaurants/main/drafts/other', { entries: {}, days: {}, bakery: 'main' }));
}

async function history() {
  await wipe();
  await seedAccess();
  await seedDoc('restaurants/main/orders-history/2026-W28', FIXTURE.history['2026-W28']);

  const legacyPayload = {
    bakery: 'main', weekStart: '2026-07-06', createdAt: '2026-07-09T10:00:00.000Z',
    quantities: { ING_LEGACY: 4 }, stock: { ING_LEGACY: 1 },
    updatedAt: new Date().toISOString(),
  };
  await expectAllowed('edit the legacy weekly record from the History editor',
    () => wholeWrite('restaurants/main/orders-history/2026-W28', legacyPayload));

  // REGRESSION TEST for the bug fixed in js/orders/history-edit.js: the editor used
  // to spread watchCollection's injected `id` into the payload.
  await expectDenied('the legacy record with a stray top-level id',
    () => wholeWrite('restaurants/main/orders-history/2026-W28', { ...legacyPayload, id: '2026-W28' }));

  const modern = {
    bakery: 'main', date: '2026-07-24', supplierId: 'SUP_MODERN',
    supplierName: 'Brava Fresh', quantities: { ING_MODERN: 5 }, stock: { ING_MODERN: 1 },
    createdAt: '2026-07-24T08:00:00.000Z', updatedAt: '2026-07-24T08:00:00.000Z',
  };
  await expectAllowed('record an order in the current model',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', modern));
  await expectDenied('a current-model record with a stray top-level id',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, id: 'x' }));

  const { date, ...noDate } = modern;
  await expectDenied('a current-model record with no date',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', noDate));
  await expectDenied('quantities sent as a list instead of a map',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, quantities: [1, 2] }));
  await expectDenied('a date written the British way',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, date: '24/07/2026' }));

  // The two allow statements must not OR into a hole: a weekly-shaped payload has to
  // stay out of the daily ids.
  await expectDenied('a legacy-shaped payload smuggled under a current-model id',
    () => wholeWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN', legacyPayload));

  await expectAllowed('delete a recorded order',
    () => deleteWrite('restaurants/main/orders-history/2026-07-24_SUP_MODERN'));
}

// The edit must not have disturbed its neighbours, and the default-deny must hold.
async function neighbours() {
  await wipe();
  await seedAccess();

  await expectDenied('a write to a collection nobody declared',
    () => mergeWrite('some-other-collection/x', { anything: 1 }));

  await expectAllowed('daily-logs still accepts a dough entry',
    () => mergeWrite('restaurants/main/daily-logs/2026-07-24', { focaccia: { text: 'ok' } }));

  await expectAllowed('recipes still accepts a recipe', () =>
    wholeWrite('restaurants/main/recipes/r1', { bakery: 'main', name: 'Focaccia', ingredients: [] }));

  await expectDenied('config still refuses a delete', () => deleteWrite('restaurants/main/config/calculator'));
}

// ── The restaurant tree ──────────────────────────────────────────────────────
// The data moved from the top of the database into restaurants/{id}/… . The
// validation rules there were ported from the flat ones, and "ported verbatim"
// is exactly the kind of claim that has to be tested rather than trusted — so
// the legacy shapes that broke merge writes are re-checked at the new address.
//
// The rule that is NEW: `bakery` must equal the folder the document sits in, so
// the field and the path can never drift apart.
async function restaurantTree() {
  await wipe();
  await seedAccess();
  const A = 'restaurants/main';
  const B = 'restaurants/trattoria-x';

  await seedDoc(`${A}/suppliers/SUP_LEGACY`, FIXTURE.suppliers.SUP_LEGACY);
  await seedDoc(`${A}/drafts/current`, FIXTURE.draft);
  await seedDoc(`${A}/orders-history/2026-W28`, FIXTURE.history['2026-W28']);

  // The legacy shapes must stay writable at the new address too.
  await expectAllowed('tenant: Deactivate a pre-6-Jul supplier (retired field, no orderDays)',
    () => mergeWrite(`${A}/suppliers/SUP_LEGACY`, { active: false, bakery: 'main' }));

  await expectAllowed('tenant: draft autosave with the retired weekId still on the document',
    () => mergeWrite(`${A}/drafts/current`, { entries: { ING: 3 }, bakery: 'main' }));

  await expectAllowed('tenant: the legacy weekly history record stays editable',
    () => wholeWrite(`${A}/orders-history/2026-W28`, {
      bakery: 'main', weekStart: '2026-07-06', quantities: {}, stock: {},
    }));

  await expectAllowed('tenant: a normal daily order is recorded',
    () => wholeWrite(`${A}/orders-history/2026-07-30_SUP`, {
      bakery: 'main', date: '2026-07-30', supplierId: 'SUP', supplierName: 'S',
      quantities: {}, stock: {}, createdAt: 'x', updatedAt: 'x',
    }));

  await expectAllowed('tenant: config/orders is written like any other config',
    () => mergeWrite(`${A}/config/orders`, { bakery: 'main', showStock: false }));

  await expectAllowed('tenant: a recipe is saved', () =>
    wholeWrite(`${A}/recipes/r1`, { bakery: 'main', name: 'Focaccia', ingredients: [] }));

  await expectAllowed('tenant: a production log is saved', () =>
    wholeWrite(`${A}/logs/L1`, { bakery: 'main', dough: 'Focaccia', versions: [] }));

  // The new rule: the stamp has to name the folder it is written into.
  await expectDenied('tenant: a supplier stamped with ANOTHER restaurant id',
    () => mergeWrite(`${A}/suppliers/SUP_X`, { bakery: 'trattoria-x', name: 'X' }));

  await expectDenied('tenant: an order stamped with another restaurant id',
    () => wholeWrite(`${A}/orders-history/2026-07-30_Y`, {
      bakery: 'trattoria-x', date: '2026-07-30', supplierId: 'Y', supplierName: 'Y',
      quantities: {}, stock: {}, createdAt: 'x', updatedAt: 'x',
    }));

  // Field validation is genuinely in force here, not just at the old address.
  await expectDenied('tenant: an unknown field on a supplier',
    () => mergeWrite(`${A}/suppliers/SUP_Y`, { bakery: 'main', name: 'Y', sneaky: 'x' }));

  await expectDenied('tenant: a draft other than drafts/current',
    () => mergeWrite(`${A}/drafts/other`, { bakery: 'main', entries: {} }));

  await expectDenied('tenant: the order in progress can never be deleted',
    () => deleteWrite(`${A}/drafts/current`));

  // A second restaurant is a separate folder that behaves the same way — for the
  // people who belong to IT. Alice, who runs the checks above, is refused here;
  // that is not an aside, it is the release.
  await expectAllowed('tenant: a second restaurant writes its own supplier',
    () => mergeWrite(`${B}/suppliers/S1`, { bakery: 'trattoria-x', name: 'Theirs' },
      asAccount(BOB)));

  check('the two restaurants are separate documents, not one shared one',
    (await readDoc(`${A}/suppliers/SUP_LEGACY`)) !== null
    && (await readDoc(`${B}/suppliers/SUP_LEGACY`)) === null);

  // The restaurant's own document (its name and which sections it uses) decides
  // what the app shows and who it belongs to: the console writes it, never a client.
  await expectDenied('tenant: the restaurant document itself is not app-writable',
    () => mergeWrite(A, { name: 'Renamed' }));

  await expectDenied('tenant: nothing can be written outside the restaurant tree',
    () => mergeWrite('nonsense/x', { a: 1 }));

  // The old address is CLOSED. The documents are still in the database — nothing
  // was deleted, and they remain the way back — but no client can reach them.
  await expectDenied('the old flat collections are no longer readable',
    () => fetch(`${FS}/suppliers/SUP_LEGACY`, { headers: asUser() }));
  await expectDenied('the old flat collections are no longer writable',
    () => mergeWrite('suppliers/SUP_FLAT', { bakery: 'main', name: 'Old address' }));
}

// ── Isolation: the whole point of the release ────────────────────────────────
// Everything above proves the app can still do its job. This proves the app
// cannot do somebody else's. ALICE is restaurant 'main'; BOB is 'trattoria-x'
// and uses Orders only; NOBODY has an account with no access document.
async function isolation() {
  await wipe();
  await seedAccess();
  await seedDoc('restaurants/main/suppliers/S1', { bakery: 'main', name: 'Ours' });
  await seedDoc('restaurants/main/recipes/R1',
    { bakery: 'main', name: 'Focaccia', ingredients: [] });
  await seedDoc('restaurants/trattoria-x/suppliers/S1',
    { bakery: 'trattoria-x', name: 'Theirs' });
  await seedDoc('restaurants/trattoria-x/recipes/R1',
    { bakery: 'trattoria-x', name: 'Theirs', ingredients: [] });

  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });

  await expectAllowed('a member reads their own restaurant',
    readAs(ALICE, 'restaurants/main/suppliers/S1'));
  await expectDenied('a member CANNOT read another restaurant',
    readAs(ALICE, 'restaurants/trattoria-x/suppliers/S1'));
  await expectDenied('a member CANNOT write into another restaurant',
    () => mergeWrite('restaurants/trattoria-x/suppliers/S9',
      { bakery: 'trattoria-x', name: 'Intruder' }, asAccount(ALICE)));
  await expectDenied('a member CANNOT delete in another restaurant',
    () => deleteWrite('restaurants/trattoria-x/suppliers/S1', asAccount(ALICE)));
  await expectDenied('the other way round too',
    readAs(BOB, 'restaurants/main/suppliers/S1'));

  await expectDenied('an account with no access document sees nothing',
    readAs(NOBODY, 'restaurants/main/suppliers/S1'));
  await expectDenied('…and cannot write either',
    () => mergeWrite('restaurants/main/suppliers/S9',
      { bakery: 'main', name: 'Intruder' }, asAccount(NOBODY)));

  // The access list is the boundary, so it must be untouchable from the app.
  await expectAllowed('you can read your OWN access document',
    readAs(ALICE, `users/${ALICE.uid}`));
  await expectDenied('you cannot read someone else’s access document',
    readAs(ALICE, `users/${BOB.uid}`));
  await expectDenied('you cannot grant yourself another restaurant',
    () => mergeWrite(`users/${ALICE.uid}`,
      { restaurants: { main: true, 'trattoria-x': true } }, asAccount(ALICE)));
  await expectDenied('you cannot create an access document for someone else',
    () => mergeWrite(`users/${NOBODY.uid}`, { restaurants: { main: true } }, asAccount(ALICE)));

  // The restaurant document decides the name on the WhatsApp message and which
  // sections exist: an app that could write it could hand itself a section.
  await expectDenied('you cannot rename your restaurant from the app',
    () => mergeWrite('restaurants/main', { name: 'Renamed' }, asAccount(ALICE)));
  await expectDenied('you cannot turn a section on from the app',
    () => mergeWrite('restaurants/trattoria-x',
      { sections: { calculator: true } }, asAccount(BOB)));

  // Sections: BOB has Orders only.
  await expectAllowed('an orders-only restaurant reads its suppliers',
    readAs(BOB, 'restaurants/trattoria-x/suppliers/S1'));
  await expectDenied('an orders-only restaurant is refused the recipe catalogue',
    readAs(BOB, 'restaurants/trattoria-x/recipes/R1'));
  await expectDenied('…and the calculator configuration',
    () => mergeWrite('restaurants/trattoria-x/config/calculator',
      { bakery: 'trattoria-x', clients: [] }, asAccount(BOB)));
  await expectAllowed('…while its own Orders settings still save',
    () => mergeWrite('restaurants/trattoria-x/config/orders',
      { bakery: 'trattoria-x', showStock: false }, asAccount(BOB)));
  await expectAllowed('a restaurant with every section keeps its recipes',
    readAs(ALICE, 'restaurants/main/recipes/R1'));
}

// ── Run ──────────────────────────────────────────────────────────────────────
await requireEmulators();
ALICE = await account('alice');
BOB = await account('bob');
NOBODY = await account('nobody');
TOKEN = ALICE.token;

for (const scenario of [suppliers, ingredients, drafts, history, neighbours,
                        restaurantTree, isolation]) {
  await scenario();
}

// Leave the emulator holding realistic data, so driving the app by hand right after
// a test run needs no extra step.
await wipe();
const { seedAll } = await import('./seed-emulator.mjs');
await seedAll();

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\n--- FAILURES ---');
  failures.forEach(f => console.log('  ✖ ' + f));
  process.exit(1);
}
console.log('Every write the app makes is allowed; everything else is refused.\n');
