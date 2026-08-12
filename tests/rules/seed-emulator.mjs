// seed-emulator.mjs — plant production-SHAPED Orders data into the local Firestore
// emulator, so the app can be driven by hand against realistic documents.
//
// Run it with the emulators up, under the SAME project id (see PROJECT below):
//   firebase emulators:start --only auth,firestore --project demo-theitalianclub
//   node tests/rules/seed-emulator.mjs
//
// WHY THE LEGACY SHAPES MATTER. Production carries fields no current code writes,
// because a setDoc(merge:true) write never deletes a field:
//   - suppliers.notifyHoursBefore  — retired 6 Jul 2026 (commit 4fc3658). The same
//     commit ADDED orderDays, so a supplier untouched since has the old field and
//     lacks the new one.
//   - ingredients without brand/weight — both added in v1.10.0 (18 Jul 2026).
//   - drafts/current.weekId — written by the pre-v179 weekly model. The clearDraft()
//     that deleted the document is gone, and clearFields only touches
//     entries.*/days.*, so nothing has ever removed it.
//   - orders-history/2026-W28 — the retired weekly record: weekStart instead of
//     date, every supplier merged, no supplierId/supplierName/updatedAt.
// Seeding only the modern shapes would prove nothing about the documents that
// actually exist.
//
// Writes go in as the emulator OWNER (Authorization: Bearer owner), which bypasses
// security rules — that is the only way to plant shapes the rules themselves reject.
// It never touches production: everything here is hardcoded to 127.0.0.1.
//
// This file is deliberately NOT named *.test.mjs: `node --test` auto-discovers that
// pattern, and this needs a running emulator, which the `test` CI job does not have.
// (The `rules` job does — it starts one around npm run test:rules.)

import { pathToFileURL } from 'node:url';

// The project id is a NAMESPACE inside the emulator, not a destination: every URL
// below points at 127.0.0.1 and nothing here can reach Google. It defaults to a
// `demo-` id because firebase-tools treats that prefix as offline-only — it will
// not look for credentials and cannot be pointed at a real project by accident,
// which is what makes it the right default for CI. Override with
// FIREBASE_PROJECT_ID when the emulator is already running under another id.
//
// It should MATCH the id the emulator was started with — `npm run test:rules:emulated`
// starts both halves together, which is why that script exists. A mismatch is not
// dangerous, though, and no guard was added for it: measured on firebase-tools
// 15.26.0, the emulator applies the loaded ruleset to whatever project id a request
// names, with `singleProjectMode` both true and false (161/161 either way). The only
// consequence of a mismatch is that seeded data and the checks can end up in two
// namespaces, which the suite would report as ordinary failures.
export const PROJECT = process.env.FIREBASE_PROJECT_ID || 'demo-theitalianclub';
const HOST = 'http://127.0.0.1:8080';
const BASE = `${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

// ── JS value → Firestore REST value ──────────────────────────────────────────
// Integral numbers become integerValue to match what the JS SDK stores. (The rules
// use `is number`, which covers both integerValue and doubleValue, so this choice
// cannot mask a rule bug — but the stored data should still look like the real thing.)
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`Cannot encode value of type ${typeof v}`);
}

export function toFields(obj) {
  const fields = {};
  Object.entries(obj).forEach(([k, v]) => { fields[k] = toValue(v); });
  return fields;
}

// ── Emulator helpers ─────────────────────────────────────────────────────────
export async function wipe() {
  const res = await fetch(
    `${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE', headers: OWNER },
  );
  if (!res.ok) throw new Error(`Wipe failed: ${res.status} ${await res.text()}`);
}

// Create/overwrite a document as owner (rules bypassed). No updateMask → the whole
// document is replaced, which is what "plant exactly this shape" means.
export async function seedDoc(path, data) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`Seed ${path} failed: ${res.status} ${await res.text()}`);
}

// Read a document back as owner. Returns the raw REST document, or null.
export async function readDoc(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: OWNER });
  return res.ok ? res.json() : null;
}

// Fail loudly and early rather than produce a green run that proved nothing.
export async function requireEmulators() {
  for (const [name, url] of [['firestore', HOST], ['auth', 'http://127.0.0.1:9099']]) {
    try {
      await fetch(url);
    } catch {
      console.error(
        `\n✖ The ${name} emulator is not answering at ${url}.\n` +
        '  Start it first:  firebase emulators:start --only auth,firestore\n',
      );
      process.exit(1);
    }
  }
}

// ── The fixture ──────────────────────────────────────────────────────────────
// Ids are readable on purpose: they show up in the app's own DOM and in History
// document ids, which makes manual verification far easier to follow.
export const FIXTURE = {
  suppliers: {
    // PRE-6-JUL shape: carries the retired field, and has NO orderDays.
    SUP_LEGACY: {
      bakery: 'main',
      name: 'Aldo Legacy Foods',
      category: 'Dry goods',
      phone: '447700900123',
      email: 'orders@aldolegacy.example',
      deliveryDays: ['Tuesday', 'Friday'],
      active: true,
      notifyHoursBefore: null,
    },
    // CURRENT shape.
    SUP_MODERN: {
      bakery: 'main',
      name: 'Brava Fresh',
      category: 'Fresh produce',
      phone: '447700900456',
      email: 'sales@bravafresh.example',
      deliveryDays: ['Monday', 'Thursday'],
      orderDays: ['Sunday', 'Wednesday'],
      active: true,
    },
  },
  ingredients: {
    // PRE-v1.10.0 shape: no brand, no weight.
    ING_LEGACY: {
      bakery: 'main',
      name: 'Type 00 Flour',
      supplierId: 'SUP_LEGACY',
      category: 'Flour',
      unit: '',
      active: true,
    },
    ING_MODERN: {
      bakery: 'main',
      name: 'Bacon',
      supplierId: 'SUP_MODERN',
      brand: 'Galbani',
      weight: '2.27kg',
      category: 'Other',
      unit: 'casse',
      active: true,
    },
    // The one seeded ingredient that already carries a PRICE, so a screen that
    // costs something has something to cost. The other two are deliberately left
    // unpriced — that is the state every real ingredient starts in, and nothing
    // migrates them.
    ING_MODERN_2: {
      bakery: 'main',
      name: 'Mozzarella',
      supplierId: 'SUP_MODERN',
      brand: 'Galbani',
      weight: '1kg',
      category: 'Dairy',
      unit: 'box',
      active: true,
      priceUnit: 'kg',
      pricePerUnit: 6.5,
      // ⚠️ DELIBERATELY THE OLD TWO-BOX SHAPE. The rate is typed now and these two
      // are retired, but every price entered before that carries them and this is
      // the fixture that proves such an ingredient still opens showing 6.50 in the
      // single box — and that saving it clears these without inventing a price
      // change in its history. Do not "tidy" them away.
      //
      // ⚠️ AND £13 FOR 2 kg RATHER THAN £6.50 FOR 1. The three numbers must all
      // DIFFER, or a form that read the wrong field would show 6.5 anyway and the
      // check that says "it opens showing the rate" would prove nothing. It was
      // 6.5/1 for exactly one run, and passed for the wrong reason.
      packPrice: 13,
      packSize: 2,
      unitWeightKg: null,
      priceUpdatedAt: '2026-08-10T09:00:00.000Z',
    },
  },
  // The draft still carries weekId from the retired weekly model, and holds one
  // supplier's rows stamped with an EARLIER day — so the "order not placed" banner
  // has something to find on load.
  draft: {
    bakery: 'main',
    weekId: '2026-W28',
    entries: {
      ING_LEGACY: { qty: 3, stock: 1 },
    },
    days: {
      SUP_LEGACY: '2026-07-20',
    },
    updatedAt: '2026-07-20T09:15:00.000Z',
  },
  history: {
    // The retired weekly record: exactly 5 fields, no date/supplierId/supplierName.
    '2026-W28': {
      bakery: 'main',
      weekStart: '2026-07-06',
      createdAt: '2026-07-09T10:00:00.000Z',
      quantities: { ING_LEGACY: 4, ING_MODERN: 2 },
      stock: { ING_LEGACY: 1, ING_MODERN: 0 },
    },
    // Current model: one day, one supplier.
    '2026-07-20_SUP_MODERN': {
      bakery: 'main',
      date: '2026-07-20',
      supplierId: 'SUP_MODERN',
      supplierName: 'Brava Fresh',
      quantities: { ING_MODERN: 5, ING_MODERN_2: 2 },
      stock: { ING_MODERN: 1, ING_MODERN_2: 3 },
      createdAt: '2026-07-20T08:00:00.000Z',
      updatedAt: '2026-07-20T08:00:00.000Z',
    },
  },
};

// Plant the Orders data INSIDE a location's folder — which is where the app
// reads it. Seeding the old top-level collections would leave the app showing an
// empty screen while the seeder claimed success.
export async function seedAll(location = 'main') {
  const at = path => `locations/${location}/${path}`;
  const stamp = data => ({ ...data, bakery: location });
  for (const [id, data] of Object.entries(FIXTURE.suppliers)) {
    await seedDoc(at(`suppliers/${id}`), stamp(data));
  }
  for (const [id, data] of Object.entries(FIXTURE.ingredients)) {
    await seedDoc(at(`ingredients/${id}`), stamp(data));
  }
  await seedDoc(at('drafts/current'), stamp(FIXTURE.draft));
  for (const [id, data] of Object.entries(FIXTURE.history)) {
    await seedDoc(at(`orders-history/${id}`), stamp(data));
  }
}

// An account that can actually sign in, plus the document that decides what it
// may open. Without one, the app stops at its own sign-in screen and none of the
// seeded data is reachable — so seeding without it is seeding nothing.
const AUTH_BASE = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts';

// ⚠️ MUST BE RE-RUNNABLE. wipe() empties Firestore but NOT the Auth emulator, so
// the second run of this seeder finds the accounts already there. Signing up
// again fails with EMAIL_EXISTS, and if that were simply an error the seeder
// would stop half way: locations present, access documents missing — which on
// screen looks exactly like "the login is broken", for an hour, until you work
// out that it was the seeder. So: create it, or sign in to the one that exists.
export async function seedAccount(email, password, locations) {
  const post = async (op, extra = {}) => {
    const res = await fetch(`${AUTH_BASE}:${op}?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true, ...extra }),
    });
    return res.json();
  };

  let body = await post('signUp');
  if (!body.localId && body.error?.message?.includes('EMAIL_EXISTS')) {
    body = await post('signInWithPassword');
  }
  if (!body.localId) {
    throw new Error(`Could not seed ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  await seedDoc(`users/${body.localId}`, { locations });
  return body.localId;
}

// Only run when invoked directly, so the harness can import the helpers.
// pathToFileURL, not a hand-built string: on Windows a path is "C:\...", whose file
// URL is "file:///C:/..." with THREE slashes — a hand-rolled `file://${path}` never
// matches and the script silently does nothing.
// The whole demo world: two locations, their descriptions, and accounts that can
// sign in. Exported because the rules harness wipes the database and has to put
// it back — otherwise `npm run test:rules` silently leaves an emulator where the
// app cannot get past its own sign-in screen, and the next person to drive it by
// hand spends twenty minutes debugging a login that was never broken.
export const DEMO_PASSWORD = 'club1234';

export async function seedDemoWorld() {
  await seedAll('bakery');
  await seedDoc('locations/bakery', { name: 'The Italian Club Bakery' });
  await seedDoc('locations/bakery/config/calculator',
    { bakery: 'bakery', configRev: 1, clients: [], recipes: [] });
  await seedDoc('locations/bakery/recipes/CAT_1',
    { bakery: 'bakery', name: 'Sourdough', ingredients: [] });

  // TWO days of pastries, five deliberately absent. A day that has never been
  // written is the state all seven start in and the one the empty screen has to
  // hold together for — and two rather than one, so switching day visibly
  // changes something instead of just re-rendering the same list.
  await seedDoc('locations/bakery/pastries/Tuesday', {
    bakery: 'bakery', day: 'Tuesday', updatedAt: '2026-08-04T20:00:00.000Z',
    items: [
      { name: 'Cornetti', qty: 24 },
      { name: 'Savoury croissant', qty: 12 },
      { name: 'Pain chocolat', qty: 5 },
      { name: 'Cinnamon rolls', qty: 5 },
      { name: 'Bomboloni', qty: 10 },
      { name: 'Danish fruit', qty: 4 },
    ],
  });
  await seedDoc('locations/bakery/pastries/Wednesday', {
    bakery: 'bakery', day: 'Wednesday', updatedAt: '2026-08-04T20:00:00.000Z',
    items: [
      { name: 'Cornetti', qty: 36 },
      { name: 'Bomboloni', qty: 18 },
    ],
  });

  // ⚠️ Every section a venue does NOT use has to be listed false, new ones
  // included: sectionOn() defaults to TRUE for a missing key, so a section added
  // to the app after a location document was written switches itself on. That is
  // true here and true in production, where it is a console edit.
  await seedDoc('locations/trattoria-rosa', {
    name: 'Trattoria Rosa',
    sections: { orders: true, calculator: false, catalogue: false, pastries: false },
  });
  await seedDoc('locations/trattoria-rosa/suppliers/SUP_ROSA', {
    bakery: 'trattoria-rosa', name: 'Rosa Fresh Fish', category: 'Fish',
    deliveryDays: ['Monday'], orderDays: ['Sunday'], active: true,
  });
  await seedDoc('locations/trattoria-rosa/ingredients/ING_ROSA', {
    bakery: 'trattoria-rosa', name: 'Sea bass', supplierId: 'SUP_ROSA',
    brand: '', weight: '1kg', category: 'Fish', unit: '', active: true,
  });

  // The restaurant, in the exact shape production is about to get: Orders only,
  // and NOT ONE DOCUMENT of its own. A location that has never been used is the
  // state every new location starts in, and it is the one nobody ever drives —
  // trattoria-rosa above has a supplier and an ingredient, so it cannot show
  // whether an empty Orders screen holds together.
  await seedDoc('locations/restaurant', {
    name: 'The Italian Club',
    sections: { orders: true, calculator: false, catalogue: false, pastries: false },
  });

  // ⚠️ THE VALUE CARRIES THE ROLE: 'owner' is the person whose business it is,
  // `true` is ordinary staff. Both are seeded for the same location on purpose —
  // the roles are only ever visible by comparing two accounts side by side, and
  // `true` is also exactly what every account in production says today.
  const clubUid = await seedAccount('club@club.test', DEMO_PASSWORD, { bakery: 'owner' });
  const staffUid = await seedAccount('staff@club.test', DEMO_PASSWORD, { bakery: true });
  // The third role, so "Who can get in" can be looked at with all three on screen
  // — which is the only way to see whether the pills read as a choice.
  const mgrUid = await seedAccount('manager@club.test', DEMO_PASSWORD, { bakery: 'manager' });

  // ⚠️ THE APP'S OWN ADMINISTRATOR, WHICH IS NOT THE SAME THING AS AN OWNER.
  // An owner runs one venue; this is who may create a NEW CUSTOMER's venue, and
  // it is the only permission in the app that sits above a location. Seeded on
  // the same account because that is production's shape — Federico is both — and
  // without it the "New customer" entry cannot be looked at at all.
  await seedDoc(`admins/${clubUid}`, { note: 'the app owner', createdAt: Date.now() });

  // ── The roster ─────────────────────────────────────────────────────────────
  // ⚠️ THE THIRD ROW HAS NO NAME, AND THAT IS THE POINT. This collection is
  // written only by redeemJoinCode, so every account created by hand in the
  // Firebase console carries no name at all — which is the state of all four
  // rows in production today. Seeding one proves "(no name yet)" renders and
  // that the Rename button has something to do.
  await seedDoc(`locations/bakery/members/${clubUid}`, {
    bakery: 'bakery', email: 'club@club.test',
    firstName: 'Federico', lastName: 'Miano', role: 'owner', joinedAt: Date.now(),
  });
  await seedDoc(`locations/bakery/members/${mgrUid}`, {
    bakery: 'bakery', email: 'manager@club.test',
    firstName: 'Giulia', lastName: 'Bernardi', role: 'manager', joinedAt: Date.now(),
  });
  await seedDoc(`locations/bakery/members/${staffUid}`, {
    bakery: 'bakery', email: 'staff@club.test',
    firstName: '', lastName: '', role: 'staff', joinedAt: Date.now(),
  });
  await seedAccount('rosa@club.test', DEMO_PASSWORD, { 'trattoria-rosa': true });
  await seedAccount('restaurant@club.test', DEMO_PASSWORD, { restaurant: true });
  // Three locations, not two: with two, "Switch location" has only one place to
  // go and never needs the picker. Three is what exercises that path.
  await seedAccount('owner@club.test', DEMO_PASSWORD,
    { bakery: true, 'trattoria-rosa': true, restaurant: true });
  await seedAccount('nobody@club.test', DEMO_PASSWORD, {});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await requireEmulators();
  await wipe();
  await seedDemoWorld();

  console.log(`Seeded the emulator:
  locations/bakery — The Italian Club Bakery, every section
    2 suppliers  (SUP_LEGACY has notifyHoursBefore and NO orderDays)
    3 ingredients (ING_LEGACY has no brand/weight)
    drafts/current (carries the retired weekId, 1 row stamped 2026-07-20)
    2 orders-history records (2026-W28 legacy + 2026-07-20_SUP_MODERN)
  locations/trattoria-rosa — Orders only, its own supplier + ingredient
  locations/restaurant — The Italian Club, Orders only, COMPLETELY EMPTY

  Sign in with any of these (password: ${DEMO_PASSWORD}):
    club@club.test       → The Italian Club Bakery (OWNER — can delete)
    manager@club.test    → the same bakery as MANAGER (deletes, but invites nobody)
    staff@club.test      → the same bakery as an EMPLOYEE (no delete buttons)
    rosa@club.test       → Trattoria Rosa (Orders only)
    restaurant@club.test → The Italian Club (Orders only, no data at all)
    owner@club.test      → all three, so the location picker appears
    nobody@club.test     → an account with no location
`);
}
