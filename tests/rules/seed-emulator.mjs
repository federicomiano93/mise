// seed-emulator.mjs — plant production-SHAPED Orders data into the local Firestore
// emulator, so the app can be driven by hand against realistic documents.
//
// Run it with the emulators up:
//   firebase emulators:start --only auth,firestore
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
// pattern, and this needs a running emulator, which CI does not have.

import { pathToFileURL } from 'node:url';

const PROJECT = 'bakery-app-ebf90';
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
    ING_MODERN_2: {
      bakery: 'main',
      name: 'Mozzarella',
      supplierId: 'SUP_MODERN',
      brand: 'Galbani',
      weight: '1kg',
      category: 'Dairy',
      unit: 'box',
      active: true,
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

export async function seedAll() {
  for (const [id, data] of Object.entries(FIXTURE.suppliers)) {
    await seedDoc(`suppliers/${id}`, data);
  }
  for (const [id, data] of Object.entries(FIXTURE.ingredients)) {
    await seedDoc(`ingredients/${id}`, data);
  }
  await seedDoc('drafts/current', FIXTURE.draft);
  for (const [id, data] of Object.entries(FIXTURE.history)) {
    await seedDoc(`orders-history/${id}`, data);
  }
}

// Only run when invoked directly, so the harness can import the helpers.
// pathToFileURL, not a hand-built string: on Windows a path is "C:\...", whose file
// URL is "file:///C:/..." with THREE slashes — a hand-rolled `file://${path}` never
// matches and the script silently does nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await requireEmulators();
  await wipe();
  await seedAll();
  console.log(
    'Seeded the emulator:\n' +
    '  2 suppliers  (SUP_LEGACY has notifyHoursBefore and NO orderDays)\n' +
    '  3 ingredients (ING_LEGACY has no brand/weight)\n' +
    '  drafts/current (carries the retired weekId, 1 row stamped 2026-07-20)\n' +
    '  2 orders-history records (2026-W28 legacy + 2026-07-20_SUP_MODERN)\n',
  );
}
