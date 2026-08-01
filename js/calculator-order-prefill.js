// calculator-order-prefill.js — PURE: fill a WhatsApp order from what was already
// calculated and logged, so the same quantities are not typed twice.
//
// No DOM, no Firebase, no storage, so it can be unit-tested under Node (P15 — the
// owner cannot read code, and these numbers end up in a message sent to a client).
//
// ⚠️ This deliberately bends P20 ("never auto-fill real-looking values"). It is
// acceptable ONLY because the order modal shows the numbers before anything is sent
// and every one of them can be corrected — and because the screen says where they came
// from. That sentence is not decoration: it is the condition that makes the exception
// honest. If it ever disappears, this should go with it.

// A row's identity: the client it belongs to plus the product. The same product
// ordered by two clients is two independent numbers.
const rowKey = (clientName, productId) => String(clientName || '') + '|' + String(productId || '');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The quantity to offer for each (client, product), taken from the most recent log
// that recorded one. `logs` must arrive NEWEST FIRST (log-store's getLogs already
// sorts that way), and `latestOf` returns a log's current version.
//
// Only a quantity ABOVE ZERO counts as recorded: a log that lists a product with 0 is
// saying it was not ordered, not that the answer is zero.
export function prefillFromLogs(entries, logs, latestOf) {
  const found = new Map();

  for (const log of (Array.isArray(logs) ? logs : [])) {
    if (!log || typeof latestOf !== 'function') continue;
    const version = latestOf(log);
    for (const item of ((version && version.items) || [])) {
      if (!item) continue;
      const qty = num(item.qty);
      if (qty <= 0) continue;
      const key = rowKey(item.clientName, item.id);
      if (!found.has(key)) found.set(key, qty); // newest first, so the first win stands
    }
  }

  // Only answer for the rows the modal is actually showing.
  const out = {};
  (Array.isArray(entries) ? entries : []).forEach((entry, entryIndex) => {
    if (!entry || !entry.client) return;
    for (const product of (entry.products || [])) {
      if (!product) continue;
      const qty = found.get(rowKey(entry.client.name, product.id));
      if (qty !== undefined) out[entryIndex + '|' + product.id] = qty;
    }
  });
  return out;
}

// The sentence shown above the form. Names where the numbers came from, or says
// plainly that nothing was found — never silent either way.
export function prefillNote(filledCount) {
  if (!filledCount) return 'Nothing calculated yet for these clients — type the quantities.';
  return filledCount === 1
    ? 'One quantity filled in from your saved logs — check it before sending.'
    : filledCount + ' quantities filled in from your saved logs — check them before sending.';
}
