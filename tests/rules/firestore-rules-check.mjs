// firestore-rules-check.mjs — prove the Orders security rules accept every write
// the app really makes, and reject everything else.
//
// Run it, emulator and all, with:
//   npm run test:rules:emulated
// or, against an emulator you already have running under the same project id:
//   npm run test:rules
//
// It also runs in CI on every push — see .github/workflows/test.yml.
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
// Deliberately NOT named *.test.mjs: `node --test` auto-discovers that pattern, and
// the `test` job has no emulator. This suite has its own CI job, which does — see
// .github/workflows/test.yml. Keep the naming as it is.

import { toFields, wipe, seedDoc, readDoc, requireEmulators, PROJECT, FIXTURE } from './seed-emulator.mjs';

// PROJECT is imported, never re-declared: two independent defaults for the same id
// would drift, and the day they did, this file and the seeder would be writing into
// two different namespaces inside the emulator.
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

// ALICE belongs to location 'main' and uses the whole app; the scenarios below
// run as her. BOB belongs to 'trattoria-x' and uses ORDERS ONLY; he exists to
// prove what he CANNOT reach. NOBODY has an account but no access document.
let ALICE = null, BOB = null, NOBODY = null;

// SAM works at 'main' and is explicitly STAFF. LEGACY also works at 'main' and
// has NO `roles` field at all — the shape of every users document in production
// until the backfill runs, and the one that has to answer 'staff' cleanly
// rather than throw. They are two accounts and not one on purpose: "written
// down as staff" and "nobody has said" must be proved to behave the same, or
// the backfill becomes load-bearing for safety instead of for convenience.
let SAM = null, LEGACY = null;

// MAYA runs 'main' as its MANAGER. She is the third role, and the checks that
// name her are the ones this account exists for: she must be able to do
// everything ALICE can do INSIDE the location — deleting included — and must be
// refused nothing that SAM is allowed. The one thing she may not do never
// reaches these rules at all: hiring is functions/onboarding.js.
//
// ⚠️ SHE ALSO PROVES SHE CAN GET IN. Membership and role are the same value, so
// an unrecognised 'manager' would not demote her — it would lock her out of the
// location entirely, which is a different and much louder failure.
let MAYA = null;

// CLIENT_A and CLIENT_B are ORDERING accounts: wholesale customers, the first people
// outside the business ever to hold an account here. They have no users/{uid}
// document at all — only a client-accounts document inside one location — so every
// rule written for staff must refuse them without having been told about them.
let CLIENT_A = null, CLIENT_B = null;

let TOKEN = null;
const asUser = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
const asAccount = who => ({ Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' });
const noAuth = () => ({ 'Content-Type': 'application/json' });

// wipe() empties the database, so the access documents have to go back in after
// every scenario — without them, every check would fail for the wrong reason.
async function seedAccess() {
  // ALICE is the OWNER of main: most checks below run as her and expect the full
  // set of powers, including the deletes that isOwner() now guards.
  await seedDoc(`users/${ALICE.uid}`, { locations: { main: 'owner' } });
  // ⚠️ BOB DELIBERATELY HAS NO `roles` FIELD AT ALL. That is not laziness — it is
  // the shape of EVERY users document in production until the backfill runs, and
  // roleIn() has to answer 'staff' for it cleanly rather than throw.
  await seedDoc(`users/${BOB.uid}`, { locations: { 'trattoria-x': true } });
  // ⚠️ SAM's membership is a plain `true`, which is EXACTLY what every users
  // document in production says today. He is not a contrived case: he is the
  // whole database on the morning the rules land, and he must be able to work.
  await seedDoc(`users/${SAM.uid}`, { locations: { main: true } });
  // LEGACY starts the same and gets rewritten inside the roles scenario to try
  // the values that must grant nothing.
  await seedDoc(`users/${LEGACY.uid}`, { locations: { main: true } });
  // MAYA runs 'main'. The value is the membership AND the role, so this single
  // line is what lets her in and what gives her the deletes.
  await seedDoc(`users/${MAYA.uid}`, { locations: { main: 'manager' } });
    await seedDoc('locations/main', { name: 'The Italian Club Bakery' });
  // ⚠️ EVERY SECTION THE VENUE DOES NOT USE MUST BE LISTED false, INCLUDING NEW
  // ONES. sectionOn() defaults to TRUE for a key that is not there, so a section
  // added to the app after this document was written is silently switched on —
  // here, and in production, for exactly the same reason. Forgetting `pastries`
  // below does not fail loudly: it quietly makes BOB a Pastries user and the
  // "an orders-only location is refused…" checks start passing for the wrong
  // reason. The fix in production is the same one line, typed in the console.
  await seedDoc('locations/trattoria-x', {
    name: 'Trattoria X',
    sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false },
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

// ⚠️ A REFUSAL AND A CRASH ARE BOTH 403, AND IN THIS RULESET THEY ARE THE SAME
// THING — which is worth knowing before the next person loses an afternoon to it.
//
// A helper was written here that insisted a denial be an ANSWER and not an
// evaluation error, on the reasoning that a security rule whose failure mode
// nobody can explain is not finished. It reported thirteen failures against the
// new owner-gated rules. Ten reformulations later, the CONTROL check below —
// pointed at `orders-history`, whose delete rule was NOT touched and still reads
// plain canUse() — failed identically. Every rule in this file that reads a
// document refuses by raising an evaluation error, and always has; production
// has behaved this way for months.
//
// So the standard was wrong, not the code: expectDenied() is the right gate, and
// a 403 is a 403. The lesson kept here is the one that cost the time — when a
// new check fails, aim the same check at code that has always worked BEFORE
// concluding the new code is broken.

function check(label, condition) {
  if (condition) { passed++; return; }
  failures.push(`STATE wrong — ${label}`);
}

const bigString = n => 'x'.repeat(n);

// ── Scenarios ────────────────────────────────────────────────────────────────
async function suppliers() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/suppliers/SUP_LEGACY', FIXTURE.suppliers.SUP_LEGACY);
  await seedDoc('locations/main/suppliers/SUP_MODERN', FIXTURE.suppliers.SUP_MODERN);

  // THE ONE THAT MATTERS: Deactivate on a supplier that still carries the retired
  // field and has no orderDays. This is the write that a naive hasOnly() breaks.
  await expectAllowed('Deactivate a pre-6-Jul supplier (notifyHoursBefore: null, no orderDays)',
    () => mergeWrite('locations/main/suppliers/SUP_LEGACY', { active: false, bakery: 'main' }));

  await seedDoc('locations/main/suppliers/SUP_NUM', { ...FIXTURE.suppliers.SUP_LEGACY, notifyHoursBefore: 12 });
  await expectAllowed('Deactivate a supplier whose notifyHoursBefore is a number',
    () => mergeWrite('locations/main/suppliers/SUP_NUM', { active: false, bakery: 'main' }));

  await expectAllowed('save the whole supplier form onto a legacy document', () =>
    mergeWrite('locations/main/suppliers/SUP_LEGACY', {
      name: 'Aldo Legacy Foods', category: 'Dry goods', phone: '447700900123',
      email: 'orders@aldolegacy.example', deliveryDays: ['Tuesday'],
      orderDays: ['Monday'], active: true, bakery: 'main',
    }));

  const after = await readDoc('locations/main/suppliers/SUP_LEGACY');
  check('notifyHoursBefore survives a full-form merge (it must, or hasOnly would be wrong)',
    Boolean(after?.fields?.notifyHoursBefore));

  await expectAllowed('create a brand-new supplier', () =>
    createWrite('locations/main/suppliers', {
      name: 'New Co', category: '', phone: '', email: '',
      deliveryDays: [], orderDays: [], active: true, bakery: 'main',
    }));

  await expectDenied('an unknown key on a supplier',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { evil: 'x', bakery: 'main' }));
  await expectDenied('a supplier stamped with the wrong bakery',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { active: true, bakery: 'other' }));
  await expectDenied('a supplier write with no authentication',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { active: true, bakery: 'main' }, noAuth()));
  await expectDenied('a 5000-character supplier name',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { name: bigString(5000), bakery: 'main' }));
  await expectDenied('50 order days on a supplier',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { orderDays: Array(50).fill('Monday'), bakery: 'main' }));
  await expectDenied('deliveryDays sent as a string instead of a list',
    () => mergeWrite('locations/main/suppliers/SUP_MODERN', { deliveryDays: 'Monday', bakery: 'main' }));

  await expectAllowed('delete a supplier', () => deleteWrite('locations/main/suppliers/SUP_MODERN'));
}

async function ingredients() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/ingredients/ING_LEGACY', FIXTURE.ingredients.ING_LEGACY);
  await seedDoc('locations/main/ingredients/ING_MODERN', FIXTURE.ingredients.ING_MODERN);

  await expectAllowed('Deactivate a pre-v1.10.0 ingredient (no brand, no weight)',
    () => mergeWrite('locations/main/ingredients/ING_LEGACY', { active: false, bakery: 'main' }));

  await expectAllowed('save the whole ingredient form', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      name: 'Bacon', supplierId: 'SUP_MODERN', brand: 'Galbani', weight: '2.27kg',
      category: 'Other', unit: 'casse', active: true, bakery: 'main',
    }));

  await expectAllowed('create a brand-new ingredient', () =>
    createWrite('locations/main/ingredients', {
      name: 'Olives', supplierId: 'SUP_MODERN', brand: '', weight: '',
      category: 'Other', unit: '', active: true, bakery: 'main',
    }));

  await expectDenied('an unknown key on an ingredient',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { evil: 'x', bakery: 'main' }));
  await expectDenied('an ingredient stamped with the wrong bakery',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { active: true, bakery: 'other' }));
  await expectDenied('a 5000-character ingredient name',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { name: bigString(5000), bakery: 'main' }));
  await expectDenied('active sent as a string instead of a boolean',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { active: 'yes', bakery: 'main' }));

  // ── Prices on the ingredient ──
  // The shape written today: a typed rate, and the two retired pack fields
  // explicitly nulled so they drain off the documents that still carry them.
  await expectAllowed('save an ingredient with a price', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      priceUnit: 'kg', pricePerUnit: 7.2, packPrice: null, packSize: null,
      unitWeightKg: null, priceUpdatedAt: '2026-08-10T09:00:00.000Z', bakery: 'main',
    }));

  // ⚠️ AND THE SHAPE A PHONE STILL ON THE OLD CODE WRITES. Rules reach every phone
  // the instant they are deployed; code arrives per device. Refuse the pack fields
  // and every save from an un-updated phone is rejected until it happens to update.
  await expectAllowed('save an ingredient from a phone still sending the pack fields', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25,
      unitWeightKg: null, priceUpdatedAt: '2026-08-10T09:00:00.000Z', bakery: 'main',
    }));

  await expectAllowed('a per-piece price carries the weight of one piece', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      priceUnit: 'pcs', pricePerUnit: 2.1, packPrice: null, packSize: null,
      unitWeightKg: 0.0035, priceUpdatedAt: '2026-08-10T09:00:00.000Z', bakery: 'main',
    }));

  // ⚠️ THE ONE THAT MAKES A PRICE REMOVABLE. These documents are merge-written, so
  // a field left OUT of the payload keeps its old value — "clear the price" can
  // only be said by writing null. Refuse null here and a wrong price entered once
  // could never be taken off the ingredient again.
  await expectAllowed('clear a price by writing nulls', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      priceUnit: null, pricePerUnit: null, packPrice: null, packSize: null,
      unitWeightKg: null, priceUpdatedAt: null, bakery: 'main',
    }));

  await expectDenied('a price unit that is not one of the three',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { priceUnit: 'crate', bakery: 'main' }));
  await expectDenied('a negative price',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { pricePerUnit: -7.2, bakery: 'main' }));
  await expectDenied('a price of zero',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { pricePerUnit: 0, bakery: 'main' }));
  await expectDenied('a pack size of zero — it is a divisor',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { packSize: 0, bakery: 'main' }));
  await expectDenied('a piece weight of zero — it is a divisor too',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { unitWeightKg: 0, bakery: 'main' }));
  await expectDenied('a price sent as text',
    () => mergeWrite('locations/main/ingredients/ING_MODERN', { pricePerUnit: '7.20', bakery: 'main' }));
  await expectDenied('a priceUpdatedAt long enough to be a payload',
    () => mergeWrite('locations/main/ingredients/ING_MODERN',
      { priceUpdatedAt: bigString(65), bakery: 'main' }));

  // ── Allergens and nutrition on the ingredient ──
  // ⚠️ THE CONTENTS OF THESE LISTS ARE NOT VALIDATED BY THE RULES AND CANNOT BE —
  // rules cannot look inside a list, the same limitation as `steps` on a recipe.
  // Which codes are legal is js/allergen-model.js's job, and it is tested there.
  // What is checked here is the SHAPE and the SIZE.
  await expectAllowed('an ingredient may declare its allergens and nutrition', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      allergens: ['gluten-wheat', 'milk'],
      mayContain: ['nuts-hazelnut'],
      allergensCheckedAt: '2026-08-11T09:00:00.000Z',
      nutrition: { kj: 1400, kcal: 330, fat: 1.2, saturates: 0.2, carbs: 70, sugars: 1.5, protein: 11, salt: 0.01 },
      bakery: 'main',
    }));

  // ⚠️ "CHECKED, CONTAINS NONE" IS A REAL ANSWER and must save: an empty list with
  // a stamp is how water and salt are declared, and refusing it would leave them
  // permanently "unknown" and block every label they appear in.
  await expectAllowed('checked, contains none of the 14', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      allergens: [], mayContain: [], allergensCheckedAt: '2026-08-11T09:00:00.000Z', bakery: 'main',
    }));

  // ⚠️ AND THE STAMP MUST BE REMOVABLE. These documents are merge-written, so a
  // field left out keeps its old value — "this was verified wrongly, un-verify it"
  // can only be said by writing an empty string. Refuse it and a mistaken
  // verification could never be taken back.
  await expectAllowed('un-verify an ingredient by clearing the stamp', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', { allergensCheckedAt: '', bakery: 'main' }));

  // A nutrition value not filled in is null, and null is NOT zero.
  await expectAllowed('a half-filled nutrition table saves, with nulls', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', {
      nutrition: { kj: null, kcal: 330, fat: null, saturates: null, carbs: null, sugars: null, protein: null, salt: null },
      bakery: 'main',
    }));

  // ⚠️ THE REGRESSION THAT MATTERS, the same one as `steps` and `endNote`: rules
  // land on every phone the instant they deploy while code arrives one device at a
  // time, so a phone still on the old build sends NONE of these and must keep
  // saving. Refuse that and every ingredient edit from an un-updated phone fails.
  await expectAllowed('an ingredient with none of the new fields still saves', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', { name: 'Flour T45', bakery: 'main' }));

  await expectDenied('a runaway allergen list', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN',
      { allergens: Array.from({ length: 41 }, (_, i) => 'a' + i), bakery: 'main' }));
  await expectDenied('a runaway may-contain list', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN',
      { mayContain: Array.from({ length: 41 }, (_, i) => 'a' + i), bakery: 'main' }));
  await expectDenied('allergens sent as anything but a list', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', { allergens: 'milk', bakery: 'main' }));
  await expectDenied('a nutrition key nobody declared', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN',
      { nutrition: { kcal: 330, sodium: 0.4 }, bakery: 'main' }));
  await expectDenied('nutrition sent as anything but a map', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', { nutrition: [330], bakery: 'main' }));
  await expectDenied('a stamp long enough to be a payload', () =>
    mergeWrite('locations/main/ingredients/ING_MODERN', { allergensCheckedAt: bigString(65), bakery: 'main' }));

  await expectAllowed('delete an ingredient', () => deleteWrite('locations/main/ingredients/ING_MODERN'));
}

// The append-only record of what an ingredient has cost. It is a SUBCOLLECTION,
// which inherits nothing from the rules of the document above it — without its own
// block every write here is refused by the default-deny at the bottom of the file.
async function ingredientPrices() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/ingredients/ING_MODERN', FIXTURE.ingredients.ING_MODERN);

  const PRICES = 'locations/main/ingredients/ING_MODERN/prices';
  const entry = (over = {}) => ({
    recordedAt: '2026-08-10T09:00:00.000Z',
    priceUnit: 'kg', pricePerUnit: 7.2,
    supplierId: 'SUP_MODERN', source: 'manual', bakery: 'main', ...over,
  });

  await expectAllowed('append a price to the history', () => createWrite(PRICES, entry()));
  await expectAllowed('append a second one — the history accumulates', () =>
    createWrite(PRICES, entry({ recordedAt: '2026-08-11T09:00:00.000Z', pricePerUnit: 7.6 })));
  await expectAllowed('a per-piece price records the piece weight', () =>
    createWrite(PRICES, entry({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 })));
  await expectAllowed('an ingredient bought without a supplier still records', () =>
    createWrite(PRICES, entry({ supplierId: '' })));

  // ⚠️ THE ROLLOUT CHECK, and the reason this rules change had to be deployed
  // BEFORE the code merged. The rate used to be derived from a pack price and a
  // pack size and both were REQUIRED here; a phone still on that code sends them,
  // a phone on the new code sends neither, and for a while both are in the two
  // kitchens at once. Whichever of the two this block refuses, somebody's price
  // silently fails to record.
  await expectAllowed('a price from a phone still on the old two-box form', () =>
    createWrite(PRICES, entry({ packPrice: 180, packSize: 25 })));
  await expectAllowed('a price from a phone that has updated', () =>
    createWrite(PRICES, entry({ recordedAt: '2026-08-12T09:00:00.000Z' })));

  // ⚠️ APPEND-ONLY IS THE WHOLE POINT. A history that can be rewritten afterwards
  // answers nothing about what was actually paid, and this is the record the margin
  // history will later be rebuilt from. Correcting a price means adding the
  // corrected one — which is also what really happened.
  await seedDoc(`${PRICES}/SEEDED`, entry());
  await expectDenied('editing a price already recorded',
    () => mergeWrite(`${PRICES}/SEEDED`, { pricePerUnit: 1, bakery: 'main' }));
  await expectDenied('replacing a price already recorded',
    () => wholeWrite(`${PRICES}/SEEDED`, entry({ pricePerUnit: 1 })));
  await expectDenied('deleting a price already recorded',
    () => deleteWrite(`${PRICES}/SEEDED`));

  // A field left OUT, not sent as null: toValue() encodes undefined as an explicit
  // null, which is a different thing from absent and would test a different rule.
  const without = key => { const e = entry(); delete e[key]; return e; };

  await expectDenied('an unknown key on a price record',
    () => createWrite(PRICES, entry({ evil: 'x' })));
  await expectDenied('a price record with no date at all',
    () => createWrite(PRICES, without('recordedAt')));
  await expectDenied('a price record with an empty date',
    () => createWrite(PRICES, entry({ recordedAt: '' })));
  await expectDenied('a price record with no rate at all',
    () => createWrite(PRICES, without('pricePerUnit')));
  await expectDenied('a price record with no source',
    () => createWrite(PRICES, without('source')));
  await expectDenied('a rate of zero',
    () => createWrite(PRICES, entry({ pricePerUnit: 0 })));
  // Optional does not mean unchecked: a retired field is still validated when it
  // IS sent, or an old phone becomes the way to write junk into the archive.
  await expectDenied('a negative pack price',
    () => createWrite(PRICES, entry({ packPrice: -180 })));
  await expectDenied('a pack size of zero — it was a divisor',
    () => createWrite(PRICES, entry({ packSize: 0 })));
  await expectDenied('a pack price sent as text',
    () => createWrite(PRICES, entry({ packPrice: '180' })));
  await expectDenied('a price unit that is not one of the three',
    () => createWrite(PRICES, entry({ priceUnit: 'crate' })));
  await expectDenied('a source nobody writes',
    () => createWrite(PRICES, entry({ source: 'guessed' })));
  await expectDenied('a piece weight of zero',
    () => createWrite(PRICES, entry({ unitWeightKg: 0 })));
  await expectDenied('a supplierId long enough to be a payload',
    () => createWrite(PRICES, entry({ supplierId: bigString(201) })));
  await expectDenied('a price record stamped for another location',
    () => createWrite(PRICES, entry({ bakery: 'trattoria-x' })));
  await expectDenied('a signed-out device appends nothing',
    () => createWrite(PRICES, entry(), noAuth()));

  // ── Who may see a price ──
  // The design's rule: the ingredient LIST is read by Orders and by the Recipe
  // catalogue (which links a row to an ingredient to cost it), but it is still
  // WRITTEN only from Orders. trattoria-x is re-seeded here as a catalogue-only
  // venue to prove exactly that split — BOB's own location, so nothing about
  // crossing between locations is involved.
  await seedDoc('locations/trattoria-x', {
    name: 'Trattoria X',
    sections: { orders: false, calculator: false, catalogue: true, pastries: false, foodcost: false },
  });
  await seedDoc('locations/trattoria-x/ingredients/ING_X', {
    bakery: 'trattoria-x', name: 'Olive oil', supplierId: '', active: true,
  });
  const X_PRICES = 'locations/trattoria-x/ingredients/ING_X/prices';

  await seedDoc('locations/trattoria-x/suppliers/SUP_X', { bakery: 'trattoria-x', name: 'Theirs' });

  await expectAllowed('a catalogue-only venue may READ its own ingredients',
    () => fetch(`${FS}/locations/trattoria-x/ingredients/ING_X`, { headers: asAccount(BOB) }));
  // ⚠️ THIS CHECK WAS FLIPPED ON PURPOSE, and the reason is the whole point of
  // moving the price out of the ingredient. The history answers "what did we pay,
  // and when did it go up" — the same money the Food Cost screen is closed over.
  // Reading the ingredient LIST is the catalogue's job; reading what it COST is
  // not. BOB is an employee at a venue with foodcost off, so both halves of
  // canManage(lid, 'foodcost') refuse him.
  await expectDenied('…but NOT their price history',
    () => fetch(`${FS}/${X_PRICES}`, { headers: asAccount(BOB) }));
  // The chooser names the supplier so two similar articles can be told apart, so
  // the supplier LIST is readable on the same terms — and writable on the old ones.
  await expectAllowed('…and read the supplier list the chooser names',
    () => fetch(`${FS}/locations/trattoria-x/suppliers/SUP_X`, { headers: asAccount(BOB) }));
  await expectDenied('…but may not WRITE a supplier', () =>
    mergeWrite('locations/trattoria-x/suppliers/SUP_X',
      { name: 'Renamed', bakery: 'trattoria-x' }, asAccount(BOB)));
  await expectDenied('…but may not WRITE an ingredient', () =>
    mergeWrite('locations/trattoria-x/ingredients/ING_X',
      { pricePerUnit: 9, bakery: 'trattoria-x' }, asAccount(BOB)));
  await expectDenied('…nor append a price', () =>
    createWrite(X_PRICES, { ...entry(), bakery: 'trattoria-x' }, asAccount(BOB)));

  // A venue that uses neither section reaches nothing at all.
  await seedDoc('locations/trattoria-x', {
    name: 'Trattoria X',
    sections: { orders: false, calculator: true, catalogue: false, pastries: false, foodcost: false },
  });
  await expectDenied('a venue with neither Orders nor the catalogue reads no ingredients',
    () => fetch(`${FS}/locations/trattoria-x/ingredients/ING_X`, { headers: asAccount(BOB) }));
  await expectDenied('…and no price history',
    () => fetch(`${FS}/${X_PRICES}`, { headers: asAccount(BOB) }));
  await expectDenied('…and no supplier list',
    () => fetch(`${FS}/locations/trattoria-x/suppliers/SUP_X`, { headers: asAccount(BOB) }));

  // Isolation: prices are business data, and they stay inside their own location.
  await expectDenied('reading another location\'s price history',
    () => fetch(`${FS}/${X_PRICES}`, { headers: asAccount(ALICE) }));
  await expectDenied('writing a price into another location', () =>
    createWrite(X_PRICES, { ...entry(), bakery: 'trattoria-x' }, asAccount(ALICE)));
}

async function drafts() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/drafts/current', FIXTURE.draft);

  // THE OTHER ONE THAT MATTERS: the autosave writes onto a draft that still carries
  // the retired weekId. If this is refused, typing an order saves nothing.
  await expectAllowed('autosave onto a draft that still carries the retired weekId', () =>
    mergeWrite('locations/main/drafts/current', {
      entries: { ING_LEGACY: { qty: 3, stock: 1 } },
      days: { SUP_LEGACY: '2026-07-24' },
      updatedAt: new Date().toISOString(),
      bakery: 'main',
    }));

  await expectAllowed('clearSupplier removes one supplier\'s rows', () =>
    clearWrite('locations/main/drafts/current',
      { updatedAt: new Date().toISOString(), bakery: 'main' },
      ['entries.ING_LEGACY', 'days.SUP_LEGACY']));

  const after = await readDoc('locations/main/drafts/current');
  check('the cleared row is gone',
    !after?.fields?.entries?.mapValue?.fields?.ING_LEGACY);
  check('weekId survives the clear',
    after?.fields?.weekId?.stringValue === '2026-W28');

  await expectDenied('an unknown key on the draft',
    () => mergeWrite('locations/main/drafts/current', { evil: 'x', bakery: 'main' }));
  await expectDenied('entries sent as a string instead of a map',
    () => mergeWrite('locations/main/drafts/current', { entries: 'nope', bakery: 'main' }));

  const huge = {};
  for (let i = 0; i < 2001; i++) huge[`k${i}`] = { qty: 1, stock: 0 };
  await expectDenied('a draft stuffed with 2001 entries',
    () => mergeWrite('locations/main/drafts/current', { entries: huge, bakery: 'main' }));

  await expectDenied('deleting the draft (nothing in the app does this any more)',
    () => deleteWrite('locations/main/drafts/current'));
  await expectDenied('writing a draft document other than "current"',
    () => mergeWrite('locations/main/drafts/other', { entries: {}, days: {}, bakery: 'main' }));
}

async function history() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/orders-history/2026-W28', FIXTURE.history['2026-W28']);

  const legacyPayload = {
    bakery: 'main', weekStart: '2026-07-06', createdAt: '2026-07-09T10:00:00.000Z',
    quantities: { ING_LEGACY: 4 }, stock: { ING_LEGACY: 1 },
    updatedAt: new Date().toISOString(),
  };
  await expectAllowed('edit the legacy weekly record from the History editor',
    () => wholeWrite('locations/main/orders-history/2026-W28', legacyPayload));

  // REGRESSION TEST for the bug fixed in js/orders/history-edit.js: the editor used
  // to spread watchCollection's injected `id` into the payload.
  await expectDenied('the legacy record with a stray top-level id',
    () => wholeWrite('locations/main/orders-history/2026-W28', { ...legacyPayload, id: '2026-W28' }));

  const modern = {
    bakery: 'main', date: '2026-07-24', supplierId: 'SUP_MODERN',
    supplierName: 'Brava Fresh', quantities: { ING_MODERN: 5 }, stock: { ING_MODERN: 1 },
    createdAt: '2026-07-24T08:00:00.000Z', updatedAt: '2026-07-24T08:00:00.000Z',
  };
  await expectAllowed('record an order in the current model',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', modern));
  await expectDenied('a current-model record with a stray top-level id',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, id: 'x' }));

  const { date, ...noDate } = modern;
  await expectDenied('a current-model record with no date',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', noDate));
  await expectDenied('quantities sent as a list instead of a map',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, quantities: [1, 2] }));
  await expectDenied('a date written the British way',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', { ...modern, date: '24/07/2026' }));

  // ── names: the labels frozen into the record ───────────────────────────────
  //
  // Rules reach every phone the instant they deploy; code arrives per device. So the
  // field has to be OPTIONAL in both directions at once: a phone on the new version
  // writes it, a phone still on the old one does not, and both must be able to record
  // an order for as long as the rollout takes.
  await expectAllowed('an order carrying the names it was placed under',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN',
      { ...modern, names: { ING_MODERN: 'Bacon 2.27kg' } }));
  await expectAllowed('an order from a phone that has not updated yet (no names)',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', modern));
  await expectDenied('names sent as a list instead of a map',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN',
      { ...modern, names: ['Bacon'] }));
  await expectDenied('names sent as a string',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN',
      { ...modern, names: 'Bacon' }));

  // The two allow statements must not OR into a hole: a weekly-shaped payload has to
  // stay out of the daily ids.
  await expectDenied('a legacy-shaped payload smuggled under a current-model id',
    () => wholeWrite('locations/main/orders-history/2026-07-24_SUP_MODERN', legacyPayload));
  await expectDenied('names smuggled onto a legacy weekly record',
    () => wholeWrite('locations/main/orders-history/2026-W28',
      { ...legacyPayload, names: { ING_LEGACY: 'Type 00 Flour' } }));

  await expectAllowed('delete a recorded order',
    () => deleteWrite('locations/main/orders-history/2026-07-24_SUP_MODERN'));
}

// The edit must not have disturbed its neighbours, and the default-deny must hold.
async function neighbours() {
  await wipe();
  await seedAccess();

  await expectDenied('a write to a collection nobody declared',
    () => mergeWrite('some-other-collection/x', { anything: 1 }));

  await expectAllowed('daily-logs still accepts a dough entry',
    () => mergeWrite('locations/main/daily-logs/2026-07-24', { focaccia: { text: 'ok' } }));

  await expectAllowed('recipes still accepts a recipe', () =>
    wholeWrite('locations/main/recipes/r1', { bakery: 'main', name: 'Focaccia', ingredients: [] }));

  // ── A recipe that knows what it costs ──
  // The link a row carries (kind/refId) is NOT checked here and cannot be: rules
  // cannot look inside a list. Only the recipe's own new field is.
  await expectAllowed('a recipe may record the weight it loses', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], lossPct: 12 }));
  await expectAllowed('…including none at all', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], lossPct: 0 }));
  await expectAllowed('a recipe written by a phone that has not updated yet still saves', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [] }));
  await expectAllowed('a linked row is stored, links and all', () =>
    wholeWrite('locations/main/recipes/r1', {
      bakery: 'main', name: 'Focaccia', lossPct: 8,
      ingredients: [{ label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'ING_MODERN' }],
    }));

  // ⚠️ A loss of 100 would divide the price per kilo by zero and make every
  // recipe built on this one cost Infinity — capped in the model AND here.
  await expectDenied('a weight loss of 100%', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], lossPct: 100 }));
  await expectDenied('a negative weight loss', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], lossPct: -5 }));
  await expectDenied('a weight loss sent as text', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], lossPct: '12' }));
  await expectDenied('an unknown key on a recipe', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Focaccia', ingredients: [], costPerKg: 3.2 }));

  // ── The guided mixing procedure ──
  // A step's own fields are NOT checked and cannot be (rules cannot look inside a
  // list) — js/catalogue/guided-model.js owns that. Only the list itself is.
  await expectAllowed('a recipe may carry its mixing steps', () =>
    wholeWrite('locations/main/recipes/r1', {
      bakery: 'main', name: 'Croissant', ingredients: [],
      steps: [
        { id: 's1', text: 'Add the flour and the water', rows: ['a'], seconds: 0, speed: '' },
        { id: 's2', text: 'Mix', rows: [], seconds: 240, speed: '1' },
      ],
    }));
  await expectAllowed('…and a procedure that has been emptied again', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [], steps: [] }));
  // ⚠️ THE REGRESSION THAT MATTERS: hundreds of recipes carry no steps at all, and
  // a phone still on the previous version never sends the field. Both must save.
  await expectAllowed('a recipe with no procedure at all still saves', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [] }));

  await expectDenied('a runaway number of mixing steps', () =>
    wholeWrite('locations/main/recipes/r1', {
      bakery: 'main', name: 'Croissant', ingredients: [],
      steps: Array.from({ length: 101 }, (_, i) => ({ id: 's' + i, text: 'x' })),
    }));
  await expectDenied('a procedure sent as anything but a list', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [], steps: { s1: 'Mix' } }));

  // ── The closing message ──
  await expectAllowed('a recipe may carry a closing message', () =>
    wholeWrite('locations/main/recipes/r1', {
      bakery: 'main', name: 'Croissant', ingredients: [],
      endNote: 'Final dough temperature 24-26 degrees',
    }));
  await expectAllowed('…and one that has been cleared again', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [], endNote: '' }));
  // ⚠️ THE SAME REGRESSION THAT MATTERS FOR steps, for the same reason: rules land
  // on every phone the instant they deploy while code arrives one device at a
  // time, so a phone still on the old build sends NO endNote and must keep saving.
  await expectAllowed('a recipe with no closing message at all still saves', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [] }));
  await expectDenied('a closing message longer than the cap', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [], endNote: 'x'.repeat(301) }));
  await expectDenied('a closing message sent as anything but a string', () =>
    wholeWrite('locations/main/recipes/r1',
      { bakery: 'main', name: 'Croissant', ingredients: [], endNote: ['Mix'] }));

  await expectDenied('config still refuses a delete', () => deleteWrite('locations/main/config/calculator'));
}

// ── The location tree ──────────────────────────────────────────────────────
// The data moved from the top of the database into locations/{id}/… . The
// validation rules there were ported from the flat ones, and "ported verbatim"
// is exactly the kind of claim that has to be tested rather than trusted — so
// the legacy shapes that broke merge writes are re-checked at the new address.
//
// The rule that is NEW: `bakery` must equal the folder the document sits in, so
// the field and the path can never drift apart.
async function locationTree() {
  await wipe();
  await seedAccess();
  const A = 'locations/main';
  const B = 'locations/trattoria-x';

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
  await expectDenied('tenant: a supplier stamped with ANOTHER location id',
    () => mergeWrite(`${A}/suppliers/SUP_X`, { bakery: 'trattoria-x', name: 'X' }));

  await expectDenied('tenant: an order stamped with another location id',
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

  // A second location is a separate folder that behaves the same way — for the
  // people who belong to IT. Alice, who runs the checks above, is refused here;
  // that is not an aside, it is the release.
  await expectAllowed('tenant: a second location writes its own supplier',
    () => mergeWrite(`${B}/suppliers/S1`, { bakery: 'trattoria-x', name: 'Theirs' },
      asAccount(BOB)));

  check('the two locations are separate documents, not one shared one',
    (await readDoc(`${A}/suppliers/SUP_LEGACY`)) !== null
    && (await readDoc(`${B}/suppliers/SUP_LEGACY`)) === null);

  // The location's own document (its name and which sections it uses) decides
  // what the app shows and who it belongs to: the console writes it, never a client.
  await expectDenied('tenant: the location document itself is not app-writable',
    () => mergeWrite(A, { name: 'Renamed' }));

  await expectDenied('tenant: nothing can be written outside the location tree',
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
// cannot do somebody else's. ALICE is location 'main'; BOB is 'trattoria-x'
// and uses Orders only; NOBODY has an account with no access document.
async function isolation() {
  await wipe();
  await seedAccess();
  await seedDoc('locations/main/suppliers/S1', { bakery: 'main', name: 'Ours' });
  await seedDoc('locations/main/recipes/R1',
    { bakery: 'main', name: 'Focaccia', ingredients: [] });
  await seedDoc('locations/trattoria-x/suppliers/S1',
    { bakery: 'trattoria-x', name: 'Theirs' });
  await seedDoc('locations/trattoria-x/recipes/R1',
    { bakery: 'trattoria-x', name: 'Theirs', ingredients: [] });

  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });

  await expectAllowed('a member reads their own location',
    readAs(ALICE, 'locations/main/suppliers/S1'));
  await expectDenied('a member CANNOT read another location',
    readAs(ALICE, 'locations/trattoria-x/suppliers/S1'));
  await expectDenied('a member CANNOT write into another location',
    () => mergeWrite('locations/trattoria-x/suppliers/S9',
      { bakery: 'trattoria-x', name: 'Intruder' }, asAccount(ALICE)));
  await expectDenied('a member CANNOT delete in another location',
    () => deleteWrite('locations/trattoria-x/suppliers/S1', asAccount(ALICE)));
  await expectDenied('the other way round too',
    readAs(BOB, 'locations/main/suppliers/S1'));

  await expectDenied('an account with no access document sees nothing',
    readAs(NOBODY, 'locations/main/suppliers/S1'));
  await expectDenied('…and cannot write either',
    () => mergeWrite('locations/main/suppliers/S9',
      { bakery: 'main', name: 'Intruder' }, asAccount(NOBODY)));

  // The access list is the boundary, so it must be untouchable from the app.
  await expectAllowed('you can read your OWN access document',
    readAs(ALICE, `users/${ALICE.uid}`));
  await expectDenied('you cannot read someone else’s access document',
    readAs(ALICE, `users/${BOB.uid}`));
  await expectDenied('you cannot grant yourself another location',
    () => mergeWrite(`users/${ALICE.uid}`,
      { locations: { main: true, 'trattoria-x': true } }, asAccount(ALICE)));
  await expectDenied('you cannot create an access document for someone else',
    () => mergeWrite(`users/${NOBODY.uid}`, { locations: { main: true } }, asAccount(ALICE)));

  // The location document decides the name on the WhatsApp message and which
  // sections exist: an app that could write it could hand itself a section.
  await expectDenied('you cannot rename your location from the app',
    () => mergeWrite('locations/main', { name: 'Renamed' }, asAccount(ALICE)));
  await expectDenied('you cannot turn a section on from the app',
    () => mergeWrite('locations/trattoria-x',
      { sections: { calculator: true } }, asAccount(BOB)));

  // Sections: BOB has Orders only.
  await expectAllowed('an orders-only location reads its suppliers',
    readAs(BOB, 'locations/trattoria-x/suppliers/S1'));
  await expectDenied('an orders-only location is refused the recipe catalogue',
    readAs(BOB, 'locations/trattoria-x/recipes/R1'));
  await expectDenied('…and the calculator configuration',
    () => mergeWrite('locations/trattoria-x/config/calculator',
      { bakery: 'trattoria-x', clients: [] }, asAccount(BOB)));
  await expectAllowed('…while its own Orders settings still save',
    () => mergeWrite('locations/trattoria-x/config/orders',
      { bakery: 'trattoria-x', showStock: false }, asAccount(BOB)));
  await expectAllowed('a location with every section keeps its recipes',
    readAs(ALICE, 'locations/main/recipes/R1'));
}

// ── config/* and logs/* field validation ─────────────────────────────────────
// config/calculator was the ONE collection with no field validation at all: any
// signed-in device could write anything of any shape into the document holding
// the clients, their products and the recipes — which no client can delete or
// roll back. These checks pin both directions: everything the app really writes
// stays legal, and a document of arbitrary shape or runaway size is refused.
async function configAndLogs() {
  await wipe();
  await seedAccess();
  const A = 'locations/main';

  // ── Everything the app actually writes must still be accepted ──
  await expectAllowed('config: the full calculator document the app saves', () =>
    wholeWrite(`${A}/config/calculator`, {
      bakery: 'main', configRev: 3,
      clients: [{ id: 'c1', name: 'Bakery', products: [] }],
      recipes: [{ id: 'focaccia', name: 'Focaccia', ingredients: [] }],
      ingredients: ['Flour'],
      whatsappLists: [], whatsappClients: [],
      extraDough: {}, divisorIncluded: {},
      logVisibility: {}, logRetentionHours: 24, logRetentionByDough: {},
    }));

  await expectAllowed('config: the Orders settings patch', () =>
    mergeWrite(`${A}/config/orders`, { bakery: 'main', showStock: false, historyDays: 15 }));

  // ── Which days the WhatsApp order form fills itself from ──
  // A closed set, because this value decides which quantities are offered for a
  // message sent to a real client. An unrecognised one must not reach the database.
  for (const w of ['both', 'yesterday', 'today']) {
    await expectAllowed(`config: the order prefill window can be "${w}"`, () =>
      mergeWrite(`${A}/config/calculator`, { bakery: 'main', orderPrefillWindow: w }));
  }
  await expectDenied('config: a prefill window nobody recognises',
    () => mergeWrite(`${A}/config/calculator`, { bakery: 'main', orderPrefillWindow: 'ieri' }));
  await expectDenied('config: a prefill window sent as a number',
    () => mergeWrite(`${A}/config/calculator`, { bakery: 'main', orderPrefillWindow: 2 }));
  // ⚠️ OPTIONAL, and it has to be: a phone still on older code writes this whole
  // document without the field, and rules reach every phone the instant they deploy
  // while code arrives per device.
  await expectAllowed('config: a phone that never heard of the prefill window', () =>
    mergeWrite(`${A}/config/calculator`, { bakery: 'main', clients: [] }));

  // ⚠️ An un-updated phone still sends the retired shared catalogue. Rules land
  // on every device instantly while code rolls out per device, so refusing this
  // would break saving for anyone who has not updated yet.
  await expectAllowed('config: a phone still on the shared-catalogue shape', () =>
    wholeWrite(`${A}/config/calculator`, {
      bakery: 'main', configRev: 1, clients: [], recipes: [],
      products: [{ id: 'p1', name: 'Pizzas' }], groups: {},
    }));

  // ── ...and nothing else ──
  await expectDenied('config: a key nobody declared', () =>
    mergeWrite(`${A}/config/calculator`, { bakery: 'main', surprise: 'anything' }));

  await expectDenied('config: clients as something other than a list', () =>
    mergeWrite(`${A}/config/calculator`, { bakery: 'main', clients: 'not a list' }));

  await expectDenied('config: a runaway number of recipes', () =>
    mergeWrite(`${A}/config/calculator`, {
      bakery: 'main', recipes: Array.from({ length: 201 }, (_, i) => ({ id: 'r' + i })),
    }));

  await expectDenied('config: stamped with another location', () =>
    mergeWrite(`${A}/config/calculator`, { bakery: 'trattoria-x', clients: [] }));

  // ── logs: the whole document, and the cap that keeps it under 1MB ──
  await expectAllowed('logs: the document the Calculator writes', () =>
    wholeWrite(`${A}/logs/L2`, {
      bakery: 'main', id: 'L2', dough: 'Focaccia', recipeId: 'focaccia',
      forDay: 'tomorrow', origin: 'calculator', createdAtMs: 1785926647303,
      versions: [{ kind: 'create' }],
    }));

  await expectDenied('logs: a key nobody declared', () =>
    wholeWrite(`${A}/logs/L3`, {
      bakery: 'main', dough: 'Focaccia', versions: [], smuggled: 'x',
    }));

  await expectDenied('logs: forDay outside today/tomorrow', () =>
    wholeWrite(`${A}/logs/L4`, {
      bakery: 'main', dough: 'Focaccia', forDay: 'someday', versions: [],
    }));

  // The append-only chain never shrinks, and a document dies at 1MB.
  await expectDenied('logs: a version chain past the cap', () =>
    wholeWrite(`${A}/logs/L5`, {
      bakery: 'main', dough: 'Focaccia',
      versions: Array.from({ length: 101 }, () => ({ kind: 'edit' })),
    }));

  // ── orders-history: the legacy branch is no longer a free-for-all ──
  await expectAllowed('history: the real legacy weekly id still writes', () =>
    wholeWrite(`${A}/orders-history/2026-W28`, {
      bakery: 'main', weekStart: '2026-07-06', quantities: {}, stock: {},
    }));

  await expectDenied('history: an id that is neither daily nor weekly', () =>
    wholeWrite(`${A}/orders-history/whatever-i-like`, {
      bakery: 'main', weekStart: '2026-07-06', quantities: {}, stock: {},
    }));
}

// ── Run ──────────────────────────────────────────────────────────────────────
await requireEmulators();
ALICE = await account('alice');
BOB = await account('bob');
NOBODY = await account('nobody');
CLIENT_A = await account('client-a');
CLIENT_B = await account('client-b');
SAM = await account('sam');
LEGACY = await account('legacy');
MAYA = await account('maya');
TOKEN = ALICE.token;

// ── pastries/{Weekday} ───────────────────────────────────────────────────────
// Seven documents, one per weekday, holding what has to be put to prove. Unlike
// suppliers/ingredients/drafts this collection is written WHOLE, so its fields
// can be REQUIRED — there is no phone anywhere still running an older writer.
// The id is pinned to the seven weekday names, so the collection cannot grow a
// document that means nothing.
async function pastries() {
  await wipe();
  await seedAccess();
  const A = 'locations/main';
  const day = (d, extra = {}) => ({
    bakery: 'main', day: d, items: [], updatedAt: '2026-08-05T20:00:00.000Z', ...extra,
  });
  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });

  // ── What the app really writes must be accepted ──
  await expectAllowed('a day with its pastries on it', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', {
      items: [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }],
    })));

  // An empty list is how a day gets CLEARED — the app has no other way to do it,
  // because delete is refused below.
  await expectAllowed('a day with nothing to prove', () =>
    wholeWrite(`${A}/pastries/Sunday`, day('Sunday')));

  for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await expectAllowed(`the weekday id ${d}`, () => wholeWrite(`${A}/pastries/${d}`, day(d)));
  }

  await expectAllowed('a member reads a day', readAs(ALICE, `${A}/pastries/Monday`));

  // ── The standing note ──
  await expectAllowed('a day carrying its standing note', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', {
      items: [{ name: 'Cornetti', qty: 24 }],
      note: 'Butter is low\nCheck the fridge',
    })));

  // ⚠️ THE CHECK THAT MATTERS MOST. `note` is optional, so a phone still on the
  // version before notes existed — which writes no note at all — must keep
  // saving. Make this required and every one of its saves is refused, silently
  // and permanently, until someone updates it.
  await expectAllowed('a phone that predates the note still saves its day', () =>
    wholeWrite(`${A}/pastries/Tuesday`, {
      bakery: 'main', day: 'Tuesday', items: [], updatedAt: '2026-08-05T20:00:00.000Z',
    }));

  await expectAllowed('an empty note', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { note: '' })));
  await expectDenied('a note longer than the cap', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { note: bigString(501) })));
  await expectDenied('a note that is not text', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { note: 42 })));
  await expectDenied('a note that is a list', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { note: ['a'] })));

  // ── ...and nothing else ──
  await expectDenied('an id that is not a weekday', () =>
    wholeWrite(`${A}/pastries/Funday`, day('Funday')));
  await expectDenied('a weekday in the wrong case', () =>
    wholeWrite(`${A}/pastries/monday`, day('monday')));
  await expectDenied('a date instead of a weekday', () =>
    wholeWrite(`${A}/pastries/2026-08-05`, day('2026-08-05')));
  // ⚠️ matches() in rules is RE2 and UNANCHORED unless you say so, which is why
  // the id is checked against a LIST. This is the check that would catch it.
  await expectDenied('a weekday with something stuck to it', () =>
    wholeWrite(`${A}/pastries/xMondayx`, day('xMondayx')));

  await expectDenied('a key nobody declared', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { qty: 3 })));
  await expectDenied('a day missing its stamp', () =>
    wholeWrite(`${A}/pastries/Monday`, { day: 'Monday', items: [], updatedAt: 'x' }));
  await expectDenied('items as a string', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { items: 'Cornetti' })));
  await expectDenied('items as a map', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { items: { a: 1 } })));
  await expectDenied('a runaway number of pastries', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', {
      items: Array.from({ length: 101 }, (_, i) => ({ name: `P${i}`, qty: 1 })),
    })));
  await expectDenied('an updatedAt long enough to be a payload', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { updatedAt: bigString(65) })));

  // The field and the folder can never disagree.
  await expectDenied('a document filed under a different day than it names', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Tuesday')));

  // ── Isolation ──
  await expectDenied('a stamp naming another location', () =>
    wholeWrite(`${A}/pastries/Monday`, day('Monday', { bakery: 'trattoria-x' })));
  await expectDenied('writing into another location entirely', () =>
    wholeWrite('locations/trattoria-x/pastries/Monday',
      { bakery: 'trattoria-x', day: 'Monday', items: [], updatedAt: 'x' }, asAccount(ALICE)));
  await expectDenied('reading another location',
    readAs(ALICE, 'locations/trattoria-x/pastries/Monday'));

  // ── The section gate ──
  await expectDenied('an orders-only location is refused pastries',
    readAs(BOB, 'locations/trattoria-x/pastries/Monday'));
  await expectDenied('…and cannot write them either', () =>
    wholeWrite('locations/trattoria-x/pastries/Monday',
      { bakery: 'trattoria-x', day: 'Monday', items: [], updatedAt: 'x' }, asAccount(BOB)));

  // ── Never deletable ──
  // Emptying a day is items: [], an ordinary update, so the destructive verb is
  // simply not reachable from a phone.
  await expectDenied('a day cannot be deleted, even by its owner', () =>
    deleteWrite(`${A}/pastries/Monday`, asAccount(ALICE)));

  await expectDenied('a signed-out device reads nothing', () =>
    fetch(`${FS}/${A}/pastries/Monday`, { headers: noAuth() }));
}

// ── pastry-logs/{date}_{Weekday} ─────────────────────────────────────────────
// A night's proving, kept as a record. One document per work date per weekday
// list; accepting twice in one night replaces rather than adds.
async function pastryLogs() {
  await wipe();
  await seedAccess();
  const A = 'locations/main';
  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });
  const log = (date, day, extra = {}) => ({
    bakery: 'main', date, day,
    items: [{ name: 'Cornetti', qty: 24 }],
    createdAt: '2026-08-05T20:00:00.000Z',
    updatedAt: '2026-08-05T20:00:00.000Z',
    ...extra,
  });

  // ── What Accept really writes ──
  await expectAllowed('a record of a night', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Wednesday`, log('2026-08-05', 'Wednesday')));
  await expectAllowed('…carrying the standing note it was proved under', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Wednesday`,
      log('2026-08-05', 'Wednesday', { note: 'Butter is low' })));
  await expectAllowed('a night with nothing proved', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-06_Thursday`,
      log('2026-08-06', 'Thursday', { items: [] })));
  for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await expectAllowed(`a record for the ${d} list`, () =>
      wholeWrite(`${A}/pastry-logs/2026-08-05_${d}`, log('2026-08-05', d)));
  }
  await expectAllowed('a member reads a record', readAs(ALICE, `${A}/pastry-logs/2026-08-05_Wednesday`));

  // ── The id has to be the two fields, joined ──
  await expectDenied('an id that does not match its own fields', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`, log('2026-08-05', 'Tuesday')));
  await expectDenied('a weekday that is not one', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Funday`, log('2026-08-05', 'Funday')));
  await expectDenied('a weekday in the wrong case', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_monday`, log('2026-08-05', 'monday')));
  await expectDenied('a date the wrong way round', () =>
    wholeWrite(`${A}/pastry-logs/05-08-2026_Monday`, log('05-08-2026', 'Monday')));
  // ⚠️ Probed against the emulator rather than assumed: matches() compares the
  // WHOLE string, so this stays refused even with the anchors removed. The
  // check is kept because it pins the BEHAVIOUR — an id with rubbish around the
  // date is refused — which is what matters whoever rewrites the pattern.
  await expectDenied('a date with something stuck to it', () =>
    wholeWrite(`${A}/pastry-logs/xx2026-08-05xx_Monday`, log('xx2026-08-05xx', 'Monday')));
  await expectDenied('an id with no weekday at all', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05`, log('2026-08-05', 'Monday')));

  // ── …and nothing else ──
  await expectDenied('a key nobody declared', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`, log('2026-08-05', 'Monday', { total: 60 })));
  await expectDenied('a record missing its stamp', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`, {
      date: '2026-08-05', day: 'Monday', items: [], createdAt: 'x', updatedAt: 'x',
    }));
  await expectDenied('items as a string', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`, log('2026-08-05', 'Monday', { items: 'Cornetti' })));
  await expectDenied('a runaway number of rows', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`, log('2026-08-05', 'Monday', {
      items: Array.from({ length: 101 }, (_, i) => ({ name: `P${i}`, qty: 1 })),
    })));
  await expectDenied('a note past the cap', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`,
      log('2026-08-05', 'Monday', { note: bigString(501) })));
  await expectDenied('a createdAt long enough to be a payload', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`,
      log('2026-08-05', 'Monday', { createdAt: bigString(65) })));

  // ── Isolation ──
  await expectDenied('a stamp naming another location', () =>
    wholeWrite(`${A}/pastry-logs/2026-08-05_Monday`,
      log('2026-08-05', 'Monday', { bakery: 'trattoria-x' })));
  await expectDenied('writing a record into another location', () =>
    wholeWrite('locations/trattoria-x/pastry-logs/2026-08-05_Monday',
      { ...log('2026-08-05', 'Monday'), bakery: 'trattoria-x' }, asAccount(ALICE)));
  await expectDenied('reading another location\'s records',
    readAs(ALICE, 'locations/trattoria-x/pastry-logs/2026-08-05_Monday'));
  await expectDenied('an orders-only location is refused the records',
    readAs(BOB, 'locations/trattoria-x/pastry-logs/2026-08-05_Monday'));
  await expectDenied('…and cannot write one either', () =>
    wholeWrite('locations/trattoria-x/pastry-logs/2026-08-05_Monday',
      { ...log('2026-08-05', 'Monday'), bakery: 'trattoria-x' }, asAccount(BOB)));
  await expectDenied('a signed-out device reads nothing', () =>
    fetch(`${FS}/${A}/pastry-logs/2026-08-05_Monday`, { headers: noAuth() }));

  // ⚠️ DELETE IS ALLOWED, DELIBERATELY — and nothing but a person ever asks for
  // it. The app deletes no record on its own; the 15 days are a display window
  // in pastries-log-model.js that hides and never removes. Refusing the delete
  // would take away the only way to undo a record made by mistake.
  await expectAllowed('a member can remove a record — the window is enforced in code, not here',
    () => deleteWrite(`${A}/pastry-logs/2026-08-05_Monday`, asAccount(ALICE)));
  await expectDenied('…but not one belonging to another location',
    () => deleteWrite('locations/trattoria-x/pastry-logs/2026-08-05_Monday', asAccount(ALICE)));
}


// Finished products and their append-only margin history. A brand-new collection
// and a brand-new SECTION: the venues that must not have it list it false, exactly
// as production must before this deploys.
async function products() {
  await wipe();
  await seedAccess();

  const P = 'locations/main/products';
  const product = (over = {}) => ({
    bakery: 'main', name: 'Cornetto',
    components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
    packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }],
    sellingMode: 'piece', piecesPerBatch: 100,
    sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30, ...over,
  });

  await expectAllowed('save a finished product', () => wholeWrite(`${P}/P1`, product()));
  await expectAllowed('create one with an auto id', () => createWrite(P, product()));

  // A product is created before anybody knows its price, so a half-filled one has
  // to be saveable — the screen says what is missing, it is not the rules' job.
  await expectAllowed('save a product with nothing but a name', () =>
    wholeWrite(`${P}/P2`, { bakery: 'main', name: 'Not filled in yet' }));
  await expectAllowed('…and one whose fields are explicitly empty', () =>
    wholeWrite(`${P}/P2`, {
      bakery: 'main', name: 'Not filled in yet', components: [], packaging: [],
      sellingMode: null, piecesPerBatch: null, sellingPrice: null,
      vatRate: null, foodCostTarget: null,
    }));

  // ⚠️ ZERO IS A REAL VAT RATE. Most takeaway bakery in the UK is zero-rated, so a
  // rule demanding a positive rate would refuse the bakery's main line.
  await expectAllowed('a zero-rated product', () => wholeWrite(`${P}/P1`, product({ vatRate: 0 })));
  await expectAllowed('sold by weight, with no pieces-per-batch', () =>
    wholeWrite(`${P}/P1`, product({ sellingMode: 'weight', piecesPerBatch: null })));

  await expectDenied('a product with no name', () =>
    wholeWrite(`${P}/P3`, { bakery: 'main', components: [] }));
  await expectDenied('a product with an empty name', () =>
    wholeWrite(`${P}/P3`, { bakery: 'main', name: '' }));
  await expectDenied('an unknown key on a product', () =>
    wholeWrite(`${P}/P1`, product({ costPerKg: 3.2 })));
  await expectDenied('a selling mode nobody writes', () =>
    wholeWrite(`${P}/P1`, product({ sellingMode: 'pezzo' })));
  await expectDenied('a negative VAT rate', () => wholeWrite(`${P}/P1`, product({ vatRate: -20 })));
  await expectDenied('a VAT rate above 100', () => wholeWrite(`${P}/P1`, product({ vatRate: 120 })));
  await expectDenied('a selling price of zero', () => wholeWrite(`${P}/P1`, product({ sellingPrice: 0 })));
  await expectDenied('a price sent as text', () => wholeWrite(`${P}/P1`, product({ sellingPrice: '1.20' })));
  await expectDenied('pieces-per-batch of zero — it is a divisor', () =>
    wholeWrite(`${P}/P1`, product({ piecesPerBatch: 0 })));
  await expectDenied('a food-cost target above 100', () =>
    wholeWrite(`${P}/P1`, product({ foodCostTarget: 150 })));
  await expectDenied('a runaway number of components', () =>
    wholeWrite(`${P}/P1`, product({ components: Array.from({ length: 101 }, () => ({ recipeId: 'X', qtyKg: 1 })) })));
  await expectDenied('a product stamped for another location', () =>
    wholeWrite(`${P}/P1`, product({ bakery: 'trattoria-x' })));

  await expectAllowed('a member may delete a product', () => deleteWrite(`${P}/P2`));

  // ── The margin history ──
  const SNAPS = `${P}/P1/snapshots`;
  const snap = (over = {}) => ({
    bakery: 'main', recordedAt: '2026-08-10T09:00:00.000Z',
    unitCost: 0.32, foodCostPct: 32, sellingPrice: 1.2, vatRate: 20,
    sellingMode: 'piece', frozenPrices: { FLOUR: 2, BUTTER: 8 }, ...over,
  });

  await expectAllowed('record what a product cost today', () => createWrite(SNAPS, snap()));
  await expectAllowed('record a second one later', () =>
    createWrite(SNAPS, snap({ recordedAt: '2026-08-11T09:00:00.000Z', foodCostPct: 35 })));
  await expectAllowed('a zero-rated snapshot', () => createWrite(SNAPS, snap({ vatRate: 0 })));
  await expectAllowed('a product that costs nothing to make is still a valid point', () =>
    createWrite(SNAPS, snap({ unitCost: 0, foodCostPct: 0 })));

  // ⚠️ APPEND-ONLY IS THE POINT. A margin series that can be rewritten afterwards
  // answers nothing about what was actually decided.
  await seedDoc(`${SNAPS}/SEEDED`, snap());
  await expectDenied('editing a recorded margin', () =>
    mergeWrite(`${SNAPS}/SEEDED`, { foodCostPct: 1, bakery: 'main' }));
  await expectDenied('replacing a recorded margin', () =>
    wholeWrite(`${SNAPS}/SEEDED`, snap({ foodCostPct: 1 })));
  await expectDenied('deleting a recorded margin', () => deleteWrite(`${SNAPS}/SEEDED`));

  await expectDenied('a snapshot with no frozen VAT rate', () => {
    const s2 = snap(); delete s2.vatRate; return createWrite(SNAPS, s2);
  });
  await expectDenied('a snapshot with no date', () => {
    const s2 = snap(); delete s2.recordedAt; return createWrite(SNAPS, s2);
  });
  await expectDenied('a snapshot with no frozen prices', () => {
    const s2 = snap(); delete s2.frozenPrices; return createWrite(SNAPS, s2);
  });
  // Added after a mutation test came back GREEN: relaxing the frozen rate's range
  // broke nothing, which meant the guard was not tested at all. A run that stays
  // green after a real mutation proves the check is missing, not that it is safe.
  await expectDenied('a snapshot with a negative VAT rate', () => createWrite(SNAPS, snap({ vatRate: -20 })));
  await expectDenied('a snapshot with a VAT rate above 100', () => createWrite(SNAPS, snap({ vatRate: 120 })));
  await expectDenied('a snapshot with a negative cost', () => createWrite(SNAPS, snap({ unitCost: -1 })));
  await expectDenied('a snapshot with a selling mode nobody writes', () =>
    createWrite(SNAPS, snap({ sellingMode: 'pezzo' })));
  await expectDenied('an unknown key on a snapshot', () => createWrite(SNAPS, snap({ evil: 'x' })));
  await expectDenied('a snapshot stamped for another location', () =>
    createWrite(SNAPS, snap({ bakery: 'trattoria-x' })));
  await expectDenied('a signed-out device records nothing', () =>
    createWrite(SNAPS, snap(), noAuth()));

  // ── The section gate, and the boundary ──
  await expectDenied('a venue without Food Cost reads no products',
    () => fetch(`${FS}/locations/trattoria-x/products/P1`, { headers: asAccount(BOB) }));
  await expectDenied('…and writes none', () =>
    wholeWrite('locations/trattoria-x/products/P1',
      { bakery: 'trattoria-x', name: 'Theirs' }, asAccount(BOB)));
  await expectDenied('reading another location\'s products',
    () => fetch(`${FS}/locations/trattoria-x/products/P1`, { headers: asAccount(ALICE) }));
  await expectDenied('writing a product into another location', () =>
    wholeWrite('locations/trattoria-x/products/P1',
      { bakery: 'trattoria-x', name: 'Theirs' }, asAccount(ALICE)));

  // Food Cost costs a product FROM the recipes, so it must be able to read them.
  await seedDoc('locations/main/recipes/R1', { bakery: 'main', name: 'Dough', ingredients: [] });
  await expectAllowed('Food Cost may read the recipes it costs from',
    () => fetch(`${FS}/locations/main/recipes/R1`, { headers: asUser() }));
}

// ── A client orders for itself ───────────────────────────────────────────────
// The first accounts in this app that belong to somebody OUTSIDE the business. The
// checks below are in two halves, and the second half is the one that matters:
// first that a client can do its own two things, then — at length — that it cannot
// reach anything else in the database, including the things nobody thought to
// mention when the feature was built.
async function clientOrders() {
  await wipe();
  await seedAccess();

  const L = 'locations/main';
  const day = offset => {
    const d = new Date(Date.now() + offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const TOMORROW = day(1);

  // The grant: one document per ordering account, inside the location.
  await seedDoc(`${L}/client-accounts/${CLIENT_A.uid}`,
    { bakery: 'main', clientId: 'c-one', clientName: 'CLIENT A', createdAt: '2026-08-10T09:00:00.000Z' });
  await seedDoc(`${L}/client-accounts/${CLIENT_B.uid}`,
    { bakery: 'main', clientId: 'c-two', clientName: 'CLIENT B', createdAt: '2026-08-10T09:00:00.000Z' });
  await seedDoc(`${L}/client-menus/c-one`, {
    bakery: 'main', clientName: 'CLIENT A', updatedAt: '2026-08-10T09:00:00.000Z',
    products: [{ id: 'p-buns', name: 'Buns', kind: 'number' }],
  });
  await seedDoc(`${L}/client-menus/c-two`, {
    bakery: 'main', clientName: 'CLIENT B', updatedAt: '2026-08-10T09:00:00.000Z', products: [],
  });

  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });
  const order = (over = {}) => ({
    bakery: 'main', date: TOMORROW, clientId: 'c-one', clientName: 'CLIENT A',
    quantities: { 'p-buns': 40 }, names: { 'p-buns': 'Buns' }, note: 'half cut',
    createdAt: '2026-08-10T09:00:00.000Z', updatedAt: '2026-08-10T09:00:00.000Z', ...over,
  });
  const ORDER_A = `${L}/client-orders/${TOMORROW}_c-one`;

  // ── The ordering account's own two things ──
  await expectAllowed('a client reads its own account document to learn who it is',
    readAs(CLIENT_A, `${L}/client-accounts/${CLIENT_A.uid}`));
  await expectAllowed('a client reads its own product list',
    readAs(CLIENT_A, `${L}/client-menus/c-one`));
  await expectAllowed('a client sends its order', () =>
    wholeWrite(ORDER_A, order(), asAccount(CLIENT_A)));
  await expectAllowed('a client reads its own order back', readAs(CLIENT_A, ORDER_A));
  await expectAllowed('a client corrects its order', () =>
    wholeWrite(ORDER_A, order({ quantities: { 'p-buns': 60 }, updatedAt: '2026-08-10T11:00:00.000Z' }),
      asAccount(CLIENT_A)));
  await expectAllowed('a client may order nothing at all — that is a statement too', () =>
    wholeWrite(ORDER_A, order({ quantities: {}, names: {}, updatedAt: '2026-08-10T12:00:00.000Z' }),
      asAccount(CLIENT_A)));
  await expectAllowed('an order with no note and no frozen names (a future page version)', () => {
    const o = order({ updatedAt: '2026-08-10T13:00:00.000Z' });
    delete o.note; delete o.names;
    return wholeWrite(ORDER_A, o, asAccount(CLIENT_A));
  });

  // ── One client is not another ──
  await expectDenied('a client CANNOT read another client\'s product list',
    readAs(CLIENT_A, `${L}/client-menus/c-two`));
  await expectDenied('a client CANNOT read another client\'s account document',
    readAs(CLIENT_A, `${L}/client-accounts/${CLIENT_B.uid}`));
  await seedDoc(`${L}/client-orders/${TOMORROW}_c-two`,
    { ...order({ clientId: 'c-two', clientName: 'CLIENT B' }) });
  await expectDenied('a client CANNOT read another client\'s order',
    readAs(CLIENT_A, `${L}/client-orders/${TOMORROW}_c-two`));
  await expectDenied('a client CANNOT write an order as another client', () =>
    wholeWrite(`${L}/client-orders/${TOMORROW}_c-two`,
      order({ clientId: 'c-two', clientName: 'CLIENT B' }), asAccount(CLIENT_A)));
  // The payload says one client, the folder says another. Pinning the id to the
  // fields is what stops an order being filed where its own rules do not apply.
  await expectDenied('a client CANNOT file its order under another client\'s id', () =>
    wholeWrite(`${L}/client-orders/${TOMORROW}_c-two`, order(), asAccount(CLIENT_A)));
  await expectDenied('…nor under a date that is not the one in the order', () =>
    wholeWrite(`${L}/client-orders/${day(3)}_c-one`, order(), asAccount(CLIENT_A)));

  // ── A client cannot promote itself ──
  await expectDenied('a client CANNOT re-point its own account at another client', () =>
    mergeWrite(`${L}/client-accounts/${CLIENT_A.uid}`,
      { bakery: 'main', clientId: 'c-two' }, asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT create an account document for itself elsewhere', () =>
    wholeWrite(`locations/trattoria-x/client-accounts/${CLIENT_A.uid}`,
      { bakery: 'trattoria-x', clientId: 'c-one', clientName: 'X', createdAt: 'now' },
      asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT make itself a member', () =>
    mergeWrite(`users/${CLIENT_A.uid}`, { locations: { main: true } }, asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT publish its own product list', () =>
    mergeWrite(`${L}/client-menus/c-one`,
      { bakery: 'main', products: [{ id: 'p-free', name: 'Free bread', kind: 'number' }] },
      asAccount(CLIENT_A)));

  // ── The venue's own name travels to the client on the menu ──
  //
  // ⚠️ IT HAS TO TRAVEL, because locations/{lid} is NOT readable by a client — it
  // is staff-only on purpose, since it also lists which sections the venue uses.
  // Without a name on something the client may read, their ordering page can only
  // say who it is from by hardcoding one venue's name, which is precisely the
  // defect: one bakery's customer told they are ordering from another.
  await expectAllowed('the bakery may publish its own name onto a menu', () =>
    wholeWrite(`${L}/client-menus/c-one`,
      { bakery: 'main', bakeryName: 'Panificio Maria', clientName: 'C ONE',
        products: [], updatedAt: 'now' }, asAccount(ALICE)));
  await expectAllowed('the client may read it',
    readAs(CLIENT_A, `${L}/client-menus/c-one`));
  // ⚠️ OPTIONAL IN BOTH DIRECTIONS: every menu published before today lacks the
  // field, and rules reach every phone instantly while code arrives per device.
  await expectAllowed('a menu with no name at all is still accepted', () =>
    wholeWrite(`${L}/client-menus/c-two`,
      { bakery: 'main', clientName: 'C TWO', products: [], updatedAt: 'now' },
      asAccount(ALICE)));
  await expectDenied('but it is still validated when present', () =>
    wholeWrite(`${L}/client-menus/c-two`,
      { bakery: 'main', bakeryName: 42, clientName: 'C TWO', products: [], updatedAt: 'now' },
      asAccount(ALICE)));
  await expectDenied('a client still cannot write its own', () =>
    mergeWrite(`${L}/client-menus/c-one`,
      { bakery: 'main', bakeryName: 'Not mine' }, asAccount(CLIENT_A)));

  // ── THE HALF THAT MATTERS: everything else in the database ──
  // Seeded first, so a refusal is the rules refusing and not the document missing.
  await seedDoc(`${L}/config/calculator`, { bakery: 'main', clients: [] });
  await seedDoc(`${L}/recipes/R1`, { bakery: 'main', name: 'Focaccia', ingredients: [] });
  await seedDoc(`${L}/ingredients/I1`, { bakery: 'main', name: 'Flour', pricePerUnit: 7.2 });
  await seedDoc(`${L}/suppliers/S1`, { bakery: 'main', name: 'A supplier' });
  await seedDoc(`${L}/products/P1`, { bakery: 'main', name: 'A product' });
  await seedDoc(`${L}/logs/G1`, { bakery: 'main', dough: 'Focaccia', versions: [] });
  await seedDoc(`${L}/orders-history/2026-08-10_S1`, { bakery: 'main', date: '2026-08-10' });
  await seedDoc(`${L}/pastries/Monday`, { bakery: 'main', day: 'Monday', items: [] });
  await seedDoc(`${L}/drafts/current`, { bakery: 'main', entries: {} });

  for (const [what, path] of [
    ['the address book, every client and every recipe in one read', `${L}/config/calculator`],
    ['a recipe', `${L}/recipes/R1`],
    ['what an ingredient costs', `${L}/ingredients/I1`],
    ['who the bakery buys from', `${L}/suppliers/S1`],
    ['a product and its margin', `${L}/products/P1`],
    ['a production log', `${L}/logs/G1`],
    ['what was ordered from a supplier', `${L}/orders-history/2026-08-10_S1`],
    ['the pastry list', `${L}/pastries/Monday`],
    ['the order in progress', `${L}/drafts/current`],
    ['the location\'s own settings', 'locations/main'],
  ]) {
    await expectDenied(`a client CANNOT read ${what}`, readAs(CLIENT_A, path));
  }
  await expectDenied('a client CANNOT write the address book', () =>
    mergeWrite(`${L}/config/calculator`, { bakery: 'main', clients: [] }, asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT touch another location at all',
    readAs(CLIENT_A, 'locations/trattoria-x/suppliers/S1'));
  await expectDenied('an account with no grant anywhere sends no order', () =>
    wholeWrite(`${L}/client-orders/${TOMORROW}_c-one`, order(), asAccount(NOBODY)));
  await expectDenied('a signed-out device sends no order', () =>
    wholeWrite(`${L}/client-orders/${TOMORROW}_c-one`, order(), noAuth()));

  // ── "The bakery has used this" is the bakery's to say ──
  await expectDenied('a client CANNOT claim its order was already used', () =>
    wholeWrite(ORDER_A, order({ appliedAt: '2026-08-10T10:00:00.000Z' }), asAccount(CLIENT_A)));

  // ⚠️ AND ON A FIRST ORDER TOO, WHERE THERE IS NOTHING TO COMPARE AGAINST. This
  // needed its own check and would not have been written without one: the line above
  // aims at a document that already exists, so it is the UPDATE branch that refuses
  // it, and deleting the create branch's guard altogether left the whole suite green.
  // Found by mutation, which is the only thing that could have found it — a guard
  // whose removal changes nothing is a guard nobody is testing.
  await expectDenied('…on a first order as well, where there is nothing to compare against', () =>
    wholeWrite(`${L}/client-orders/${day(5)}_c-one`,
      order({ date: day(5), appliedAt: '2026-08-10T10:00:00.000Z' }), asAccount(CLIENT_A)));
  await expectDenied('…including a first order that only claims WHICH version was used', () =>
    wholeWrite(`${L}/client-orders/${day(6)}_c-one`,
      order({ date: day(6), appliedFor: '2026-08-10T09:00:00.000Z' }), asAccount(CLIENT_A)));

  await seedDoc(ORDER_A, order({
    appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: '2026-08-10T09:00:00.000Z',
  }));
  await expectAllowed('a client corrects an order the bakery has used, carrying that forward', () =>
    wholeWrite(ORDER_A, order({
      quantities: { 'p-buns': 99 }, updatedAt: '2026-08-10T14:00:00.000Z',
      appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: '2026-08-10T09:00:00.000Z',
    }), asAccount(CLIENT_A)));

  // ⚠️ THE SUBTLEST RULE IN THE BLOCK, and the one that bakes the wrong amount if it
  // goes. A correction is written WHOLE, so a payload that merely OMITS these two
  // erases the bakery's record that this order was already in the Calculator — and
  // the screen stops warning that it changed afterwards.
  await expectDenied('a client CANNOT erase the record that its order was already used', () =>
    wholeWrite(ORDER_A, order({ quantities: { 'p-buns': 1 }, updatedAt: '2026-08-10T15:00:00.000Z' }),
      asAccount(CLIENT_A)));
  await expectDenied('…nor rewrite which version was used', () =>
    wholeWrite(ORDER_A, order({
      updatedAt: '2026-08-10T15:00:00.000Z',
      appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: '2026-08-10T15:00:00.000Z',
    }), asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT delete an order the bakery may already have baked',
    () => deleteWrite(ORDER_A, asAccount(CLIENT_A)));

  // ── The coarse floor on dates ──
  // Not the business deadline (that is the page's, and it is shown to the bakery) —
  // just the two things no page may talk the database out of.
  await expectDenied('a client CANNOT rewrite an order for a day well past', () =>
    wholeWrite(`${L}/client-orders/${day(-5)}_c-one`,
      order({ date: day(-5) }), asAccount(CLIENT_A)));
  await expectDenied('a client CANNOT book a year of deliveries in an afternoon', () =>
    wholeWrite(`${L}/client-orders/${day(400)}_c-one`,
      order({ date: day(400) }), asAccount(CLIENT_A)));
  await expectAllowed('…while an order a fortnight ahead is ordinary', () =>
    wholeWrite(`${L}/client-orders/${day(14)}_c-one`,
      order({ date: day(14) }), asAccount(CLIENT_A)));

  // ── Shape ──
  await expectDenied('an unknown key on an order', () =>
    wholeWrite(ORDER_A, order({ evil: 'x' }), asAccount(CLIENT_A)));
  await expectDenied('an order stamped for another location', () =>
    wholeWrite(ORDER_A, order({ bakery: 'trattoria-x' }), asAccount(CLIENT_A)));
  await expectDenied('quantities sent as a string instead of a map', () =>
    wholeWrite(ORDER_A, order({ quantities: 'lots' }), asAccount(CLIENT_A)));
  await expectDenied('a 5000-character note', () =>
    wholeWrite(ORDER_A, order({ note: bigString(5000) }), asAccount(CLIENT_A)));
  await expectDenied('a runaway number of lines', () => {
    const many = {};
    for (let i = 0; i < 201; i++) many[`p-${i}`] = 1;
    return wholeWrite(ORDER_A, order({ quantities: many }), asAccount(CLIENT_A));
  });
  await expectDenied('a date that is not a date', () =>
    wholeWrite(`${L}/client-orders/tomorrow_c-one`, order({ date: 'tomorrow' }), asAccount(CLIENT_A)));

  // ⚠️ An underscore in a client id would split `{date}_{clientId}` into three pieces
  // and make the rule compare the wrong half. Refused where ids are minted.
  await expectDenied('an ordering account for a client id containing an underscore', () =>
    wholeWrite(`${L}/client-accounts/${CLIENT_B.uid}`,
      { bakery: 'main', clientId: 'c_two', clientName: 'B', createdAt: 'now' }));
  await expectDenied('an unknown key on an ordering account', () =>
    mergeWrite(`${L}/client-accounts/${CLIENT_A.uid}`, { bakery: 'main', evil: 'x' }));

  // ── The one setting a client's page has to read ──
  // It is a collection of its own precisely so it CAN be shared: config/calculator is
  // the whole address book, and there is no way to share one field of that without
  // sharing every client, every product and every recipe with it.
  await seedDoc(`${L}/client-settings/orders`,
    { bakery: 'main', cutoff: '16:00', updatedAt: '2026-08-10T09:00:00.000Z' });

  await expectAllowed('a client reads when orders close',
    readAs(CLIENT_A, `${L}/client-settings/orders`));
  await expectAllowed('the bakery changes when orders close', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: '15:30', updatedAt: '2026-08-10T18:00:00.000Z' }));
  // ⚠️ An EMPTY cutoff is how "no deadline at all" is expressed. Refusing it would
  // make switching the deadline off impossible, and a cleared box would silently keep
  // the old time — the same trap as a VAT rate of 0 in Food Cost.
  await expectAllowed('…and can switch the deadline off entirely', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: '', updatedAt: '2026-08-10T18:00:00.000Z' }));

  await expectDenied('a client CANNOT change when orders close', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: '23:59', updatedAt: 'now' }, asAccount(CLIENT_A)));
  await expectDenied('a deadline that is not a time', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: 'whenever', updatedAt: 'now' }));
  await expectDenied('a 25th hour', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: '25:00', updatedAt: 'now' }));
  await expectDenied('an unknown key on the setting', () =>
    wholeWrite(`${L}/client-settings/orders`,
      { bakery: 'main', cutoff: '16:00', updatedAt: 'now', evil: 'x' }));
  await expectDenied('a second settings document nobody reads', () =>
    wholeWrite(`${L}/client-settings/something-else`,
      { bakery: 'main', cutoff: '16:00', updatedAt: 'now' }));
  await expectDenied('the setting cannot be deleted, only changed', () =>
    deleteWrite(`${L}/client-settings/orders`));
  await expectDenied('another location cannot read this bakery\'s deadline',
    readAs(BOB, `${L}/client-settings/orders`));
  await expectDenied('an account with no grant anywhere reads no deadline',
    readAs(NOBODY, `${L}/client-settings/orders`));

  // ── The bakery's own side ──
  await expectAllowed('the bakery reads the orders it has been sent', () =>
    fetch(`${FS}/${ORDER_A}`, { headers: asUser() }));
  await expectAllowed('the bakery records that it has put an order in the Calculator', () =>
    wholeWrite(ORDER_A, order({
      appliedAt: '2026-08-10T16:00:00.000Z', appliedFor: '2026-08-10T09:00:00.000Z',
    })));
  await expectAllowed('the bakery publishes a product list', () =>
    wholeWrite(`${L}/client-menus/c-one`, {
      bakery: 'main', clientName: 'CLIENT A', updatedAt: '2026-08-10T17:00:00.000Z',
      products: [{ id: 'p-buns', name: 'Burger buns', kind: 'number' }],
    }));
  await expectAllowed('the bakery creates an ordering account', () =>
    wholeWrite(`${L}/client-accounts/${NOBODY.uid}`,
      { bakery: 'main', clientId: 'c-three', clientName: 'CLIENT C', createdAt: 'now' }));
  // Kept so the owner can re-send a link to a client who changed phone without
  // revoking the phone that still works. It is a capability token for an account
  // that can do two things — not a person's password.
  await expectAllowed('…carrying the token inside its ordering link', () =>
    wholeWrite(`${L}/client-accounts/${NOBODY.uid}`, {
      bakery: 'main', clientId: 'c-three', clientName: 'CLIENT C',
      createdAt: 'now', linkToken: 'a'.repeat(43),
    }));
  await expectDenied('a link token cannot become a payload of its own', () =>
    wholeWrite(`${L}/client-accounts/${NOBODY.uid}`, {
      bakery: 'main', clientId: 'c-three', clientName: 'CLIENT C',
      createdAt: 'now', linkToken: bigString(500),
    }));
  await expectDenied('a client CANNOT read the token of another client\'s link',
    readAs(CLIENT_A, `${L}/client-accounts/${NOBODY.uid}`));
  await expectAllowed('the bakery revokes a link', () =>
    deleteWrite(`${L}/client-accounts/${NOBODY.uid}`));
  await expectAllowed('the bakery deletes an order', () => deleteWrite(ORDER_A));

  // ── And the boundary between the two businesses still holds ──
  await expectDenied('another location cannot read these orders',
    readAs(BOB, `${L}/client-orders/${TOMORROW}_c-two`));
  await expectDenied('another location cannot read these product lists',
    readAs(BOB, `${L}/client-menus/c-one`));
  await expectDenied('another location cannot create an ordering account here', () =>
    wholeWrite(`${L}/client-accounts/${CLIENT_B.uid}`,
      { bakery: 'main', clientId: 'c-two', clientName: 'B', createdAt: 'now' }, asAccount(BOB)));

  // A venue without the Calculator has no clients to take orders for.
  await expectDenied('a venue without the Calculator publishes no product lists', () =>
    wholeWrite('locations/trattoria-x/client-menus/c-one',
      { bakery: 'trattoria-x', clientName: 'X', products: [], updatedAt: 'now' }, asAccount(BOB)));
}

// ── Notifications that arrive with the app closed ───────────────────────────
//
// Two collections a phone writes about ITSELF. The server reads them with the
// Admin SDK, which bypasses rules entirely, so everything here is about what a
// CLIENT may do — and the check that matters most is the last group: an ordering
// account, the only account here belonging to somebody outside the business, must
// not be able to touch either of them.
async function pushNotifications() {
  await wipe();
  await seedAccess();

  const L = 'locations/main';
  const TOKEN_A = 'device-token-alice';
  const TOKEN_B = 'device-token-somebody-else';
  const soon = Date.now() + 20 * 60 * 1000;

  await seedDoc(`${L}/client-accounts/${CLIENT_A.uid}`,
    { bakery: 'main', clientId: 'c-one', clientName: 'CLIENT A', createdAt: '2026-08-10T09:00:00.000Z' });

  const tokenDoc = (over = {}) => ({ bakery: 'main', uid: ALICE.uid, updatedAt: Date.now(), ...over });
  const timer = (over = {}) => ({
    bakery: 'main', uid: ALICE.uid, token: TOKEN_A, fireAt: soon,
    title: 'Croissant', body: 'Add the butter', active: true, createdAt: Date.now(), ...over,
  });
  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });

  // ── A phone registers itself ──
  await expectAllowed('a phone registers itself for notifications', () =>
    wholeWrite(`${L}/fcm-tokens/${TOKEN_A}`, tokenDoc()));
  await expectAllowed('…and unregisters itself again', () =>
    deleteWrite(`${L}/fcm-tokens/${TOKEN_A}`));

  // ⚠️ WITHOUT THE uid CHECK a member could register a token belonging to
  // somebody else and quietly redirect this location's alerts to another phone.
  await expectDenied('a phone registered in somebody else\'s name', () =>
    wholeWrite(`${L}/fcm-tokens/${TOKEN_B}`, tokenDoc({ uid: BOB.uid })));
  await expectDenied('a token stamped for another location', () =>
    wholeWrite(`${L}/fcm-tokens/${TOKEN_A}`, tokenDoc({ bakery: 'trattoria-x' })));
  await expectDenied('an unknown key on a token', () =>
    wholeWrite(`${L}/fcm-tokens/${TOKEN_A}`, tokenDoc({ evil: 'x' })));

  await seedDoc(`${L}/fcm-tokens/${TOKEN_B}`, { bakery: 'main', uid: BOB.uid, updatedAt: Date.now() });
  await expectDenied('deleting somebody else\'s registration', () =>
    deleteWrite(`${L}/fcm-tokens/${TOKEN_B}`));

  // ── A scheduled alarm ──
  await expectAllowed('a phone schedules an alarm for itself', () =>
    wholeWrite(`${L}/push-timers/t1`, timer()));
  await expectAllowed('a fresh alarm always starts active', () =>
    wholeWrite(`${L}/push-timers/t2`, timer()));

  await expectDenied('an alarm scheduled in somebody else\'s name', () =>
    wholeWrite(`${L}/push-timers/t3`, timer({ uid: BOB.uid })));
  await expectDenied('an alarm created already cancelled', () =>
    wholeWrite(`${L}/push-timers/t4`, timer({ active: false })));
  await expectDenied('an alarm with nowhere to send it', () =>
    wholeWrite(`${L}/push-timers/t5`, timer({ token: '' })));
  await expectDenied('an alarm with nothing to say', () =>
    wholeWrite(`${L}/push-timers/t6`, timer({ title: '' })));
  await expectDenied('an alarm whose time is not a number', () =>
    wholeWrite(`${L}/push-timers/t7`, timer({ fireAt: 'later' })));
  await expectDenied('a runaway notification body', () =>
    wholeWrite(`${L}/push-timers/t8`, timer({ body: 'x'.repeat(200) })));
  await expectDenied('an unknown key on an alarm', () =>
    wholeWrite(`${L}/push-timers/t9`, timer({ evil: 'x' })));

  // ── Cancelling, which is the only update allowed ──
  await expectAllowed('cancelling an alarm', () =>
    mergeWrite(`${L}/push-timers/t1`, { active: false }));
  // ⚠️ THE NARROW UPDATE IS THE POINT. An update that could also move `fireAt` or
  // repoint `token` would let one member retime another's alarm, or send it to a
  // different phone, while looking like an ordinary cancel.
  await expectDenied('retiming an alarm instead of cancelling it', () =>
    mergeWrite(`${L}/push-timers/t2`, { fireAt: Date.now() + 60000 }));
  await expectDenied('repointing an alarm at another phone', () =>
    mergeWrite(`${L}/push-timers/t2`, { token: TOKEN_B }));
  await expectDenied('rewriting what an alarm says', () =>
    mergeWrite(`${L}/push-timers/t2`, { body: 'something else' }));
  await expectDenied('cancelling AND retiming in one write', () =>
    mergeWrite(`${L}/push-timers/t2`, { active: false, fireAt: Date.now() + 60000 }));

  await seedDoc(`${L}/push-timers/other`, {
    bakery: 'main', uid: BOB.uid, token: TOKEN_B, fireAt: soon,
    title: 'X', body: '', active: true, createdAt: Date.now(),
  });
  await expectDenied('cancelling somebody else\'s alarm', () =>
    mergeWrite(`${L}/push-timers/other`, { active: false }));

  // ── The boundary between two businesses ──
  await expectDenied('another location cannot read these registrations',
    readAs(BOB, `${L}/fcm-tokens/${TOKEN_B}`));
  await expectDenied('another location cannot schedule an alarm here', () =>
    wholeWrite(`${L}/push-timers/t10`, timer({ uid: BOB.uid }), asAccount(BOB)));

  // ⚠️ THE CHECK THAT MATTERS MOST. An ordering account belongs to somebody
  // OUTSIDE the business. It has no users/{uid} document, so member() refuses it
  // by construction rather than because a rule remembered to ask — and that is
  // the property these four checks exist to keep from being lost.
  await expectDenied('a client cannot register a phone for notifications', () =>
    wholeWrite(`${L}/fcm-tokens/client-token`,
      { bakery: 'main', uid: CLIENT_A.uid, updatedAt: Date.now() }, asAccount(CLIENT_A)));
  await expectDenied('a client cannot read who is registered',
    readAs(CLIENT_A, `${L}/fcm-tokens/${TOKEN_B}`));
  await expectDenied('a client cannot schedule an alarm', () =>
    wholeWrite(`${L}/push-timers/client-timer`,
      { bakery: 'main', uid: CLIENT_A.uid, token: 'x', fireAt: soon,
        title: 'X', body: '', active: true, createdAt: Date.now() }, asAccount(CLIENT_A)));
  await expectDenied('a client cannot read the alarms', readAs(CLIENT_A, `${L}/push-timers/t2`));
}

// ── Roles: what a person may do inside a location they ALREADY belong to ─────
//
// Membership is the boundary between two businesses, and it is proved elsewhere
// in this file. This is the smaller boundary between two people in the SAME
// business. It exists because the app is going to be sold: with one owner's own
// two venues, everybody being able to delete everything is a shrug; with a
// paying customer it is their counter staff emptying their supplier list.
//
// ⚠️ THE SECOND HALF OF THIS SCENARIO MATTERS MORE THAN THE FIRST. Proving that
// staff cannot delete a supplier is the easy, obvious half. Proving that staff
// can STILL correct their own log is what stops this change from quietly making
// the app useless to everybody who is not the owner — and a baker who cannot fix
// a mistyped entry at 5am stops recording things altogether.
async function roles() {
  await wipe();
  await seedAccess();
  const L = 'locations/main';
  const stamp = { bakery: 'main' };
  const readAs = (who, path) => () => fetch(`${FS}/${path}`, { headers: asAccount(who) });

  await seedDoc(`${L}/suppliers/S1`, { ...stamp, name: 'S', active: true });
  await seedDoc(`${L}/ingredients/I1`, { ...stamp, name: 'I', active: true });
  await seedDoc(`${L}/recipes/R1`, { ...stamp, name: 'R', ingredients: [] });
  await seedDoc(`${L}/products/P1`, { ...stamp, name: 'P' });
  await seedDoc(`${L}/client-accounts/${CLIENT_A.uid}`,
    { ...stamp, clientId: 'c-one', clientName: 'C ONE', createdAt: 'now' });
  await seedDoc(`${L}/client-menus/c-one`,
    { ...stamp, clientName: 'C ONE', products: [], updatedAt: 'now' });
  await seedDoc(`${L}/logs/LG1`, { ...stamp, versions: [] });
  await seedDoc(`${L}/log/focaccia`, { ...stamp, dough: 'focaccia', text: 'x' });
  await seedDoc(`${L}/orders-history/2026-08-11_S1`, { ...stamp, date: '2026-08-11', supplierId: 'S1' });
  await seedDoc(`${L}/client-orders/2026-08-11_c-one`, { ...stamp, date: '2026-08-11', clientId: 'c-one' });
  await seedDoc(`${L}/pastry-logs/2026-08-11_Tuesday`, { ...stamp, date: '2026-08-11', day: 'Tuesday' });

  // ⚠️ THE CONTROL, and it is the reason the note above the assertions exists.
  // This delete rule was NOT touched by the roles change — it still reads plain
  // canUse(lid, 'orders'). It refuses exactly the way the new owner-gated rules
  // do, which is what proved the roles introduced nothing. Keep it.
  await expectDenied('CONTROL: an untouched delete rule refuses a stranger',
    () => deleteWrite(`${L}/orders-history/2026-08-11_S1`, asAccount(BOB)));

  // ── Staff may not take away what everybody else's work rests on ──
  await expectDenied('staff cannot delete a supplier',
    () => deleteWrite(`${L}/suppliers/S1`, asAccount(SAM)));
  await expectDenied('staff cannot delete an ingredient',
    () => deleteWrite(`${L}/ingredients/I1`, asAccount(SAM)));
  await expectDenied('staff cannot delete a recipe',
    () => deleteWrite(`${L}/recipes/R1`, asAccount(SAM)));
  await expectDenied('staff cannot delete a Food Cost product',
    () => deleteWrite(`${L}/products/P1`, asAccount(SAM)));

  // Handing an account to somebody outside the business is the nearest thing
  // this app has to granting access, so it is the owner's by definition.
  await expectDenied('staff cannot hand a client an ordering account', () =>
    wholeWrite(`${L}/client-accounts/${NOBODY.uid}`,
      { ...stamp, clientId: 'c-two', clientName: 'C TWO', createdAt: 'now' }, asAccount(SAM)));
  await expectDenied('staff cannot revoke a client ordering account',
    () => deleteWrite(`${L}/client-accounts/${CLIENT_A.uid}`, asAccount(SAM)));
  await expectDenied('staff cannot delete a client menu',
    () => deleteWrite(`${L}/client-menus/c-one`, asAccount(SAM)));

  // ── …and an account nobody has said anything about behaves the SAME ──
  // ⚠️ THIS IS THE PRODUCTION STATE, and it is the reason the change is safe to
  // deploy at all: every membership in the real database is written `true`. It
  // keeps working and it grants no owner powers, so the backfill decides who is
  // an owner rather than the deploy deciding who is locked out.
  await expectDenied('a plain `true` membership cannot delete a supplier',
    () => deleteWrite(`${L}/suppliers/S1`, asAccount(LEGACY)));
  await expectDenied('a plain `true` membership cannot delete an ingredient',
    () => deleteWrite(`${L}/ingredients/I1`, asAccount(LEGACY)));
  await expectDenied('a plain `true` membership cannot delete a recipe',
    () => deleteWrite(`${L}/recipes/R1`, asAccount(LEGACY)));

  // A role is not a passport. Owner somewhere else is staff here.
  await seedDoc(`users/${LEGACY.uid}`,
    { locations: { main: true, 'trattoria-x': 'owner' } });
  await expectDenied('owner of ANOTHER location is only staff in this one',
    () => deleteWrite(`${L}/suppliers/S1`, asAccount(LEGACY)));

  // A role nobody recognises must never read as more power than staff — the
  // same rule js/roles.js keeps, checked here against the database itself.
  await seedDoc(`users/${LEGACY.uid}`, { locations: { main: 'head-chef' } });
  await expectDenied('an unrecognised role is not an owner',
    () => deleteWrite(`${L}/suppliers/S1`, asAccount(LEGACY)));
  await seedDoc(`users/${LEGACY.uid}`, { locations: { main: 'Owner' } });
  await expectDenied('the role is case sensitive: Owner is not owner',
    () => deleteWrite(`${L}/suppliers/S1`, asAccount(LEGACY)));

  // ── THE HALF THAT MATTERS MORE: staff can still do the work ──
  // Every one of these is somebody correcting their OWN entry, and every one of
  // them stays open on purpose. If a future change gates one of these, it should
  // fail here loudly rather than be discovered by a baker at five in the morning.
  await expectAllowed('staff can still delete a production log entry',
    () => deleteWrite(`${L}/logs/LG1`, asAccount(SAM)));
  await expectAllowed('staff can still delete a legacy per-dough log',
    () => deleteWrite(`${L}/log/focaccia`, asAccount(SAM)));
  await expectAllowed('staff can still delete a recorded order',
    () => deleteWrite(`${L}/orders-history/2026-08-11_S1`, asAccount(SAM)));
  await expectAllowed('staff can still delete a client order',
    () => deleteWrite(`${L}/client-orders/2026-08-11_c-one`, asAccount(SAM)));
  await expectAllowed('staff can still delete a pastry record',
    () => deleteWrite(`${L}/pastry-logs/2026-08-11_Tuesday`, asAccount(SAM)));

  // ⚠️ config/calculator is NOT gated, and that is a decision, not an oversight:
  // it holds the address book, every client's products AND every recipe the
  // Calculator owns. Gating it would stop a baker editing a recipe — the most
  // ordinary act in this app — to protect a few settings that share the document
  // by history. This check pins the decision so nobody "tightens" it by accident.
  await expectAllowed('staff can still edit the address book and the recipes', () =>
    mergeWrite(`${L}/config/calculator`, { ...stamp, clients: [] }, asAccount(SAM)));
  await expectAllowed('staff can still type quantities into the draft', () =>
    mergeWrite(`${L}/drafts/current`, { ...stamp, updatedAt: 'now' }, asAccount(SAM)));

  // ── And the owner is still the owner ──
  await expectAllowed('the owner can delete a supplier',
    () => deleteWrite(`${L}/suppliers/S1`));
  await expectAllowed('the owner can delete an ingredient',
    () => deleteWrite(`${L}/ingredients/I1`));
  await expectAllowed('the owner can delete a recipe',
    () => deleteWrite(`${L}/recipes/R1`));
  await expectAllowed('the owner can delete a product',
    () => deleteWrite(`${L}/products/P1`));
  await expectAllowed('the owner can revoke a client ordering account',
    () => deleteWrite(`${L}/client-accounts/${CLIENT_A.uid}`));

  // ── And the manager runs the place ──
  //
  // ⚠️ FRESH DOCUMENTS, because the owner's checks above DELETED S1/I1/R1/P1.
  // A read of a document that is not there answers 404 and would fail here for a
  // reason that has nothing to do with permissions.
  await seedDoc(`${L}/suppliers/S2`, { ...stamp, name: 'S2', active: true });
  await seedDoc(`${L}/ingredients/I2`, { ...stamp, name: 'I2', active: true });
  await seedDoc(`${L}/recipes/R2`, { ...stamp, name: 'R2', ingredients: [] });
  await seedDoc(`${L}/products/P2`, { ...stamp, name: 'P2' });

  // ⚠️ THE FIRST CHECK IS NOT A FORMALITY, IT IS THE DEFECT THAT HAS ALREADY
  // HAPPENED ONCE — and it caught it again here. The membership and the role are
  // the SAME value, so a 'manager' the rules do not recognise does not quietly
  // demote her: it locks her out of the location altogether. member() had not
  // learnt the new value, and this is the check that said so. Reading something
  // ordinary proves she is IN before anything below asks what she may do.
  await expectAllowed('a manager is a member at all, and can read',
    readAs(MAYA, `${L}/suppliers/S2`));

  // She may take away what everybody's work rests on. This is the whole point of
  // the third role: an owner's powers inside ONE location, without the hiring.
  await expectAllowed('a manager can delete a supplier',
    () => deleteWrite(`${L}/suppliers/S2`, asAccount(MAYA)));
  await expectAllowed('a manager can delete an ingredient',
    () => deleteWrite(`${L}/ingredients/I2`, asAccount(MAYA)));
  await expectAllowed('a manager can delete a recipe',
    () => deleteWrite(`${L}/recipes/R2`, asAccount(MAYA)));
  await expectAllowed('a manager can delete a product',
    () => deleteWrite(`${L}/products/P2`, asAccount(MAYA)));

  // And she must lose nothing an ordinary employee already had.
  await expectAllowed('a manager can still do the daily work', () =>
    mergeWrite(`${L}/drafts/current`, { ...stamp, updatedAt: 'now' }, asAccount(MAYA)));

  // ⚠️ HER LIMIT IS NOT IN THESE RULES, AND THAT IS THE DESIGN. Hiring means
  // writing a membership or minting a join code, and both are `allow write: if
  // false` for EVERY account — the owner's included. The owner does it through a
  // Cloud Function that checks for the owner itself. So the rules need two tiers
  // and not three, and the check that proves the manager cannot hire is the one
  // below: she is refused exactly as anybody else is.
  await expectDenied('a manager cannot write a membership either',
    () => mergeWrite(`users/${SAM.uid}`, { locations: { main: 'manager' } }, asAccount(MAYA)));
  await expectDenied('a manager cannot mint a join code',
    () => mergeWrite('join-codes/whatever', { locationId: 'main' }, asAccount(MAYA)));

  // ⚠️ A ROLE NARROWS, IT NEVER WIDENS. MAYA runs 'main' and nothing else, so
  // being a manager somewhere must not reach into another business at all.
  await expectDenied('a manager of one location is nobody in another',
    readAs(MAYA, 'locations/trattoria-x/suppliers/S1'));

  // ── The money is the one thing an employee may not even READ ──
  //
  // ⚠️ THIS IS THE ONLY PLACE IN THE RULESET WHERE A ROLE GATES A READ. Everywhere
  // else the role guards what cannot be undone and reading stays open to anybody
  // in the location. Here the reading IS the thing: products carries what each
  // one sells for and what it costs to make.
  await seedDoc(`${L}/products/P3`, { ...stamp, name: 'P3' });
  await seedDoc(`${L}/products/P3/snapshots/S1`, { ...stamp, takenAt: 1 });

  await expectAllowed('the owner can read a Food Cost product',
    readAs(ALICE, `${L}/products/P3`));
  await expectAllowed('a manager can read a Food Cost product',
    readAs(MAYA, `${L}/products/P3`));
  await expectDenied('an employee cannot read a Food Cost product',
    readAs(SAM, `${L}/products/P3`));
  await expectDenied('an employee cannot read the margin history either',
    readAs(SAM, `${L}/products/P3/snapshots/S1`));
  await expectDenied('an employee cannot write one',
    () => mergeWrite(`${L}/products/P9`, { ...stamp, name: 'Nope' }, asAccount(SAM)));

  // ── And what an ingredient COSTS is money too ──
  //
  // ⚠️ THIS IS THE OTHER HALF, AND WITHOUT IT THE FIRST HALF IS DECORATION. The
  // rate used to live ON the ingredient, which Orders must read to work at all —
  // so closing the Food Cost screen hid the margin and left "what a sack of flour
  // costs" in plain view of everybody.
  await seedDoc(`${L}/ingredient-prices/I3`,
    { ...stamp, priceUnit: 'kg', pricePerUnit: 7.2, priceUpdatedAt: '2026-08-12' });

  await expectAllowed('the owner can read what an ingredient costs',
    readAs(ALICE, `${L}/ingredient-prices/I3`));
  await expectAllowed('a manager can too',
    readAs(MAYA, `${L}/ingredient-prices/I3`));
  await expectDenied('an employee cannot',
    readAs(SAM, `${L}/ingredient-prices/I3`));
  await expectDenied('and cannot write one either',
    () => mergeWrite(`${L}/ingredient-prices/I9`,
      { ...stamp, priceUnit: 'kg', pricePerUnit: 1 }, asAccount(SAM)));
  await expectAllowed('a manager can write one',
    () => mergeWrite(`${L}/ingredient-prices/I9`,
      { ...stamp, priceUnit: 'kg', pricePerUnit: 1 }, asAccount(MAYA)));

  // ⚠️ AND THE PRICE HISTORY MOVED BEHIND THE SAME GATE. Leaving it on the Orders
  // gate would be the back door into the thing the front door just locked.
  await seedDoc(`${L}/ingredients/I3/prices/H1`,
    { ...stamp, recordedAt: '2026-08-12', priceUnit: 'kg', pricePerUnit: 7.2 });
  await expectDenied('an employee cannot read the price history',
    readAs(SAM, `${L}/ingredients/I3/prices/H1`));
  await expectAllowed('a manager can read the price history',
    readAs(MAYA, `${L}/ingredients/I3/prices/H1`));

  // ⚠️ AND THE DAILY WORK IS UNTOUCHED. An employee who lost Orders because the
  // money moved would be a far worse outcome than seeing a margin.
  // ⚠️ A FRESH ONE: I1 and I2 were deleted by the owner's and the manager's own
  // checks above, and a read of a document that is not there answers 404 — which
  // fails here for a reason that has nothing to do with permissions.
  await seedDoc(`${L}/ingredients/I3`, { ...stamp, name: 'I3', active: true });
  await expectAllowed('an employee can still read an ingredient',
    readAs(SAM, `${L}/ingredients/I3`));
}


// ── The collections only the server may touch ────────────────────────────────
//
// Onboarding writes membership from a Cloud Function, because users/{uid} is the
// boundary between two businesses and no client may write it. That server code
// leans on four collections, and if any one of them were reachable from a phone
// the whole arrangement would be theatre.
async function onboardingCollections() {
  await wipe();
  await seedAccess();
  const L = 'locations/main';

  await seedDoc(`admins/${ALICE.uid}`, { note: 'the app owner' });
  await seedDoc('join-codes/deadbeef', {
    kind: 'digits', locationId: 'main', role: 'staff',
    expiresAt: Date.now() + 60000, failedAttempts: 0, usedAt: null,
  });
  await seedDoc(`rate-limits/${ALICE.uid}`, { attempts: [Date.now()] });
  await seedDoc(`${L}/members/${ALICE.uid}`,
    { bakery: 'main', email: 'alice@example.com', role: 'owner', joinedAt: Date.now() });

  // ⚠️ THE ONE THAT MATTERS MOST. If a code could be read, six digits would be
  // worthless — anybody could list the collection and learn which location each
  // code opens, and the guessing would be over before it started.
  await expectDenied('nobody can read a join code, not even an owner',
    () => fetch(`${FS}/join-codes/deadbeef`, { headers: asUser() }));
  await expectDenied('nobody can LIST the join codes',
    () => fetch(`${FS}/join-codes`, { headers: asUser() }));
  await expectDenied('nobody can mint a join code from a phone', () =>
    wholeWrite('join-codes/forged', {
      kind: 'digits', locationId: 'main', role: 'owner',
      expiresAt: Date.now() + 60000, failedAttempts: 0,
    }, asUser()));
  await expectDenied('nobody can revive a spent code',
    () => mergeWrite('join-codes/deadbeef', { usedAt: null }, asUser()));

  // ⚠️ IT IS THE ACCOUNT'S OWN DOCUMENT AND IT STILL MAY NOT TOUCH IT. A limit
  // somebody can reset is not a limit, and this one is the whole reason a
  // six-digit code is safe to hand out loud.
  await expectDenied('an account cannot clear its own rate limit',
    () => mergeWrite(`rate-limits/${ALICE.uid}`, { attempts: [] }, asUser()));
  await expectDenied('an account cannot read its own rate limit',
    () => fetch(`${FS}/rate-limits/${ALICE.uid}`, { headers: asUser() }));

  // Making yourself the app's administrator would mean creating locations for
  // anybody, so WRITING here is closed to everybody, including an administrator.
  await expectDenied('nobody can make themselves the app administrator',
    () => wholeWrite(`admins/${BOB.uid}`, { note: 'me' }, asAccount(BOB)));
  await expectDenied('an administrator cannot even rewrite their own row',
    () => mergeWrite(`admins/${ALICE.uid}`, { note: 'still me' }, asUser()));

  // ⚠️ READING YOUR OWN IS ALLOWED, and it is the whole reason the "New customer"
  // entry can exist. Without it the app could only discover who may create a
  // business by CALLING createWorkspace and being refused — so it would either
  // show everybody a door that opens for one person, or hide it from the one
  // person who needs it. Reading grants nothing: the function checks this same
  // document server-side and never trusts what the app sends.
  await expectAllowed('an administrator can read their OWN row, so the app can ask',
    () => fetch(`${FS}/admins/${ALICE.uid}`, { headers: asUser() }));

  // ⚠️ AND ONLY THEIR OWN. These two are what keep "read your own" from becoming
  // "read the collection": nobody can learn who the administrators are, and
  // nobody can enumerate them.
  await expectDenied('nobody can read somebody ELSE’s administrator row',
    () => fetch(`${FS}/admins/${ALICE.uid}`, { headers: asAccount(BOB) }));
  await expectDenied('nobody can LIST the administrators',
    () => fetch(`${FS}/admins`, { headers: asUser() }));
  await expectDenied('a client ordering account cannot read an administrator row',
    () => fetch(`${FS}/admins/${ALICE.uid}`, { headers: asAccount(CLIENT_A) }));

  // The roster is for the screen. Readable inside the location, writable nowhere
  // — the functions write it in the same transaction as the membership itself.
  await expectAllowed('a member can see who else works here',
    () => fetch(`${FS}/${L}/members/${ALICE.uid}`, { headers: asUser() }));
  await expectDenied('another location cannot see the people here',
    () => fetch(`${FS}/${L}/members/${ALICE.uid}`, { headers: asAccount(BOB) }));
  await expectDenied('a client ordering account cannot see the staff',
    () => fetch(`${FS}/${L}/members/${ALICE.uid}`, { headers: asAccount(CLIENT_A) }));

  // ⚠️ THE ROSTER MUST NOT BECOME A SECOND PLACE TO GRANT ACCESS. Nothing in the
  // rules consults it, so writing it would grant nothing — but it would let
  // somebody put a convincing lie on their colleague's screen, and the next
  // person to add a shortcut that reads it would turn that lie into a key.
  await expectDenied('an owner cannot write the roster by hand', () =>
    mergeWrite(`${L}/members/${ALICE.uid}`, { role: 'owner' }, asUser()));
  await expectDenied('staff cannot promote themselves on the roster', () =>
    mergeWrite(`${L}/members/${SAM.uid}`, { role: 'owner' }, asAccount(SAM)));

  // ⚠️ AND THE REAL PRIZE IS STILL SHUT. Everything above would be pointless if
  // the document the RULES actually read were writable — this is the check that
  // says the whole design still holds.
  await expectDenied('and users/{uid} is STILL writable by nobody', () =>
    mergeWrite(`users/${SAM.uid}`, { locations: { main: 'owner' } }, asAccount(SAM)));
  await expectDenied('…not even by the owner of the location', () =>
    mergeWrite(`users/${SAM.uid}`, { locations: { main: 'owner' } }, asUser()));
}

for (const scenario of [suppliers, ingredients, ingredientPrices, drafts, history, neighbours,
                        locationTree, isolation, configAndLogs, pastries, pastryLogs,
                        products, clientOrders, pushNotifications, roles, onboardingCollections]) {
  await scenario();
}

// Leave the emulator holding a world the app can actually be DRIVEN in — data,
// locations AND accounts. Restoring only the data would leave a database where
// no account can sign in, which looks exactly like a broken login.
await wipe();
const { seedDemoWorld } = await import('./seed-emulator.mjs');
await seedDemoWorld();

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\n--- FAILURES ---');
  failures.forEach(f => console.log('  ✖ ' + f));
  process.exit(1);
}
console.log('Every write the app makes is allowed; everything else is refused.\n');
