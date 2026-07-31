// order-text.js — the WhatsApp message for an order. PURE: no DOM, no Firestore.
//
// Extracted from preview.js because the same text is now built from two different
// sources: the draft (the order you are typing) and a history record (an order
// already placed, which you may want to send, or send again). Keeping one builder
// means the supplier can never receive two differently-formatted messages for the
// same order.
//
// Pure and DOM-free on purpose, following js/calculator-recipe-text.js — that module
// exists for exactly this reason, so the text can be asserted in a unit test instead
// of being re-read out of rendered markup (P15).
//
// The format is deliberately unchanged from what the app has always sent:
//   *Order — The Italian Club*
//
//   *Supplier name*
//   - Bacon 2.27kg: 5
//   - Mozzarella 1kg: 2
//
// The order unit (casse/box) is a private reminder on the order screen and is NOT in
// the message — the supplier gets the number only. An empty weight is skipped.
//
// The name in the title is the LOCATION PLACING THE ORDER, passed in by the caller
// from the session. It used to be the constant 'The Italian Club', which was harmless
// with one location and wrong the moment there were two: a supplier would receive
// another location's order signed with this one's name. With no name the title
// falls back to a plain '*Order*' — anonymous is recoverable, wrong is not.

export function orderTitle(locationName) {
  const name = String(locationName || '').trim();
  return name ? `*Order — ${name}*` : '*Order*';
}

// Round a quantity the same way every other Orders module does (archive.js).
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// "Bacon 2.27kg" — the name with its weight, skipping an empty one.
export function itemLabel(name, weight) {
  return [name, weight].filter(Boolean).join(' ');
}

// One supplier's block: bold name, then "- label: qty" lines, BY NAME.
//
// The sort lives here, in the one place every message passes through, and not in the
// callers. Two reasons. The draft used to send items in raw Firestore order while the
// order screen shows them sorted, so the message never matched what the operator had
// just checked. And now the same order can be sent twice — once from the draft, later
// re-sent from History — so without a single deterministic order the supplier would
// receive the same order twice with the lines shuffled, and reasonably read it as a
// different order.
// group: { supplierName, items: [{ name, weight, qty }] }
function sectionFor({ supplierName, items }) {
  const lines = sortItems(items).map(it => `- ${itemLabel(it.name, it.weight)}: ${num(it.qty)}`);
  return `*${supplierName || 'Order'}*\n` + lines.join('\n');
}

// By displayed label, so the message reads in the order the eye expects.
export function sortItems(items) {
  return (items || []).slice().sort((a, b) =>
    itemLabel(a.name, a.weight).localeCompare(itemLabel(b.name, b.weight)));
}

// One flat shopping list: every item from every group, no supplier headings.
//
// Two lines carrying the SAME label are added together. That is what a shopping list
// wants — the same flour bought from two suppliers is still "buy this much flour" to
// the person walking round the shop. (In the grouped format they stay apart, because
// there each line is addressed to a different supplier.)
//
// Rows adding up to nothing are dropped: this format is read as "what to buy", and
// "- Bacon: 0" is not something to buy.
function flatLines(groups) {
  const totals = new Map();
  groups.forEach(group => (group.items || []).forEach(item => {
    const label = itemLabel(item.name, item.weight);
    totals.set(label, (totals.get(label) || 0) + num(item.qty));
  }));

  return [...totals.entries()]
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, qty]) => `- ${label}: ${qty}`);
}

// The whole message, in one of two formats.
// groups: [{ supplierName, items: [{ name, weight, qty }] }]
//
//   grouped: true  (the default, and what the app has always sent) — one bold section
//                  per supplier. This is the format a SUPPLIER receives, so it is
//                  deliberately untouched, down to the byte.
//   grouped: false — one flat A→Z list with no headings: a shopping list for yourself.
//                  It does NOT say who sells what, so sending it to a supplier shows
//                  them everyone else's order too. Hence the default above.
//
// Returns '' when there is nothing to send, so callers can refuse rather than open
// WhatsApp with an empty order.
export function buildOrderMessage(groups, { grouped = true, locationName = '' } = {}) {
  const withItems = (groups || []).filter(g => (g.items || []).length);
  if (!withItems.length) return '';
  const title = orderTitle(locationName);

  if (grouped) return `${title}\n\n` + withItems.map(sectionFor).join('\n\n');

  const lines = flatLines(withItems);
  if (!lines.length) return '';
  return `${title}\n\n` + lines.join('\n');
}

// Turn a stored `quantities` map into message items, resolving names and weights from
// the CURRENT ingredient list — the same lens history.js uses on screen, so what the
// supplier reads matches what the operator sees.
//
// An ingredient deleted since the order was placed falls back to the name FROZEN into
// the record (`names`), and only then to a placeholder — never to its document id,
// which would send a supplier a line like "Fdx92kQ1: 4". It never vanishes from its
// own order either: a wrong-looking line is recoverable, a silently missing one is
// not. Rows with a quantity of 0 are dropped — there is no such thing as ordering
// none of something.
//
// Same order of preference as recordedName (archive.js); name and weight stay
// SEPARATE fields here because the message composes them itself, and a frozen name
// already carries its weight.
export function itemsFromQuantities(quantities, ingredientsById, names) {
  return Object.keys(quantities || {})
    .map(id => {
      const live = ingredientsById?.[id];
      return {
        name: live?.name || names?.[id] || 'Deleted ingredient',
        weight: (live && live.weight) || '',
        qty: num(quantities[id]),
      };
    })
    .filter(it => it.qty > 0)
    .sort((a, b) => itemLabel(a.name, a.weight).localeCompare(itemLabel(b.name, b.weight)));
}

// Index a list of ingredients by id, for itemsFromQuantities.
export function indexById(items) {
  return (items || []).reduce((acc, it) => { acc[it.id] = it; return acc; }, {});
}

// The wa.me URL for a message. One place, so the "no recipient — the operator picks
// the chat" decision is stated once instead of being re-derived at every call site.
// (The whole app sends this way: js/whatsapp.js, js/calc.js, and here.)
export function whatsappUrl(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
