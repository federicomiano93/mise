// migrate-to-locations.mjs — copy every document from the old flat collections
// into locations/{id}/…
//
//   node scripts/migrate-to-locations.mjs                  # emulator, DRY RUN
//   node scripts/migrate-to-locations.mjs --apply          # emulator, writes
//   node scripts/migrate-to-locations.mjs --apply \
//        --host=https://firestore.googleapis.com --token=<idToken>   # production
//
// THREE PROPERTIES THIS SCRIPT IS BUILT AROUND:
//
//   1. It NEVER deletes. The originals stay exactly where they are, so the whole
//      move is reversible by pointing the app back at them. That is the safety
//      net, and it is the reason the old collections are not cleaned up in the
//      same step.
//   2. It is RE-RUNNABLE, and it REFUSES to go backwards. Copies are keyed by
//      document id, so running it again refreshes the copy — which is what keeps
//      the gap between "copy" and "the app switches over" down to a minute.
//      But once the app is live on the new address, the copy is the live data and
//      the original is the stale one: re-running blindly would overwrite a real
//      order with a week-old version. So each document's updateTime is compared,
//      and a target NEWER than its source is skipped, not overwritten. --force
//      exists for the one case where that is genuinely wanted.
//   3. It is a DRY RUN unless --apply is passed, and it prints what it would do.
//
// Documents are copied in Firestore's own REST representation — the `fields`
// object is read and written back untouched — so there is no value encoder in
// the path that could quietly change a type. The only field ever rewritten is
// `bakery`, which must name the folder the document now lives in (the rules
// enforce that the two agree).

const args = new Map(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  }),
);

const PROJECT = args.get('project') || 'bakery-app-ebf90';
const HOST = args.get('host') || 'http://127.0.0.1:8080';
const LOCATION = args.get('location') || 'main';
const TOKEN = args.get('token') || 'owner';
const APPLY = args.has('apply');
const FORCE = args.has('force');

const BASE = `${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const isEmulator = HOST.includes('127.0.0.1') || HOST.includes('localhost');

// Every collection the app has ever written at the top level.
const COLLECTIONS = [
  'suppliers', 'ingredients', 'drafts', 'orders-history',
  'config', 'recipes', 'logs', 'daily-logs', 'log',
];

// Collections whose rules require the `bakery` stamp to match the folder.
// daily-logs and log documents have no such field and must not grow one.
const REQUIRES_STAMP = new Set([
  'suppliers', 'ingredients', 'drafts', 'orders-history', 'config', 'recipes', 'logs',
]);

async function listAll(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`read ${collection}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    (body.documents || []).forEach(d => docs.push(d));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// 'projects/…/documents/suppliers/ABC' → 'ABC'
const idOf = doc => doc.name.split('/').pop();

function stamped(fields, collection) {
  if (!REQUIRES_STAMP.has(collection) && !('bakery' in fields)) return fields;
  return { ...fields, bakery: { stringValue: LOCATION } };
}

// Returns 'copied' or 'skipped'. Skipping protects the live data: once the app
// writes to the location folder, the copy is the truth and the flat original
// is history.
async function copyDoc(collection, doc, existingById) {
  const id = idOf(doc);
  const target = existingById.get(id);
  if (target && !FORCE && target.updateTime && doc.updateTime
      && Date.parse(target.updateTime) > Date.parse(doc.updateTime)) {
    return 'skipped';
  }
  const fields = stamped(doc.fields || {}, collection);
  // A whole-document PATCH with no updateMask replaces the target completely,
  // which is what a copy should do — no leftovers from an earlier run.
  const res = await fetch(`${BASE}/locations/${LOCATION}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`${collection}/${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return 'copied';
}

async function main() {
  console.log(`\nSource : ${BASE}`);
  console.log(`Target : locations/${LOCATION}/…`);
  console.log(`Mode   : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (reads only)'}`);
  console.log(`Server : ${isEmulator ? 'LOCAL EMULATOR' : '*** PRODUCTION ***'}\n`);

  if (APPLY && !isEmulator && !args.has('yes-write-to-production')) {
    console.error('Refusing to write to production without --yes-write-to-production.');
    process.exit(1);
  }

  const rows = [];
  let failures = 0;

  for (const collection of COLLECTIONS) {
    let docs = [];
    try {
      docs = await listAll(collection);
    } catch (err) {
      rows.push([collection, '-', '-', `READ FAILED: ${err.message}`]);
      failures++;
      continue;
    }

    if (!APPLY) {
      rows.push([collection, String(docs.length), '0', 'dry run']);
      continue;
    }

    // What is already at the target, so a newer copy is never overwritten by an
    // older original (see the header: this is what makes a re-run safe).
    let existing = [];
    try { existing = await listAll(`locations/${LOCATION}/${collection}`); } catch { /* empty */ }
    const existingByIdd = new Map(existing.map(d => [idOf(d), d]));

    let copied = 0;
    let skipped = 0;
    const errors = [];
    for (const doc of docs) {
      try {
        const outcome = await copyDoc(collection, doc, existingByIdd);
        if (outcome === 'copied') copied++; else skipped++;
      } catch (err) { errors.push(err.message); }
    }
    failures += errors.length;

    // Read the copies back: "the write returned 200" is not the same claim as
    // "the documents are there".
    let landed = '?';
    try { landed = String((await listAll(`locations/${LOCATION}/${collection}`)).length); }
    catch { /* leave as ? */ }

    const note = errors.length
      ? `${errors.length} FAILED: ${errors[0]}`
      : skipped
        ? `verified ${landed} at target — ${skipped} SKIPPED (target is newer)`
        : `verified ${landed} at target`;
    rows.push([collection, String(docs.length), String(copied), note]);
  }

  const w = [Math.max(...rows.map(r => r[0].length), 10), 6, 6];
  console.log(`${'collection'.padEnd(w[0])}  ${'found'.padStart(w[1])}  ${'copied'.padStart(w[2])}  note`);
  rows.forEach(r => console.log(`${r[0].padEnd(w[0])}  ${r[1].padStart(w[1])}  ${r[2].padStart(w[2])}  ${r[3]}`));

  const found = rows.reduce((n, r) => n + (Number(r[1]) || 0), 0);
  const copied = rows.reduce((n, r) => n + (Number(r[2]) || 0), 0);
  console.log(`\n${found} documents found, ${copied} copied, ${failures} failed.`);
  console.log('Nothing was deleted: the originals are untouched.\n');
  if (failures) process.exit(1);
}

main().catch(err => { console.error('\nMIGRATION FAILED:', err.message); process.exit(1); });
