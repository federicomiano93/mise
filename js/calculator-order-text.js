// calculator-order-text.js — PURE: the WhatsApp order message the Calculator sends.
//
// No DOM, no Firebase, so every rule below is asserted in a unit test (P15). This
// text is what a CLIENT actually receives, so it gets the same treatment as the
// Orders message builder: the shape is pinned character for character, because a
// change nobody notices here is a change nobody notices in somebody's inbox.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The parts of an order that have something in them: one section per client that
// has at least one quantity above zero, keeping its own index so the caller can
// still address that client's rows.
//
// `qtyOf(entryIndex, productId)` hands over what was typed — passed in rather than
// read from the page, which is what keeps this testable.
//
// A client with nothing typed produces NO section at all: an empty heading in a
// message reads as "we want nothing from you", which is not what it means.
export function orderSections(entries, qtyOf) {
  const out = [];
  const read = typeof qtyOf === 'function' ? qtyOf : () => 0;
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    if (!entry || !entry.client) return;
    const lines = (Array.isArray(entry.products) ? entry.products : [])
      .filter(Boolean)
      .map(p => ({ name: p.name, qty: num(read(index, p.id)) }))
      .filter(l => l.qty > 0);
    if (lines.length) out.push({ index, name: entry.client.name, lines });
  });
  return out;
}

// The message itself.
//
// ⚠️ `multi` is passed IN rather than derived from sections.length, and that is not
// an oversight. Sending everything together keeps naming each client even when only
// one of them ended up with quantities — because the title is then the LIST's name,
// and dropping the heading would leave a message that never says who it is for.
// Sending a single client passes false, and the title is that client's own name, so
// the heading would only repeat it.
export function buildOrderMessage(title, sections, multi) {
  const body = (Array.isArray(sections) ? sections : [])
    .map(s => (multi ? `*${s.name}*\n` : '')
      + (s.lines || []).map(l => `- ${l.name}: ${l.qty}`).join('\n'))
    .join('\n\n');
  return `*${title || 'Order'}*\n\n` + body;
}

// The one place the WhatsApp address is built. No recipient number: the message is
// composed and WhatsApp asks who to send it to — which is deliberate here, because
// one order often goes to a person rather than to a stored business number.
export function whatsappUrl(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
