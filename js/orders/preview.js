// preview.js — "Send order on WhatsApp" for the order IN PROGRESS.
//
// Opened by the header WhatsApp button. Shows a tick per supplier that has items in
// the current draft, builds ONE message grouped by supplier, and opens WhatsApp with
// NO recipient — the operator picks the chat himself (the whole app sends this way;
// see js/whatsapp.js and js/orders/order-text.js).
//
// The screen itself is supplier-picker.js and the text is order-text.js, both shared
// with the bulk "Order placed" flow and with re-sending an order from History. What
// is left here is the one thing specific to sending a DRAFT: reporting which
// suppliers went out, so the caller can offer to mark exactly those as placed.
//
// Sending is the moment the order actually leaves, so it is the moment to ask —
// forgetting to record it afterwards was the whole problem.

import { buildSupplierPicker } from './supplier-picker.js';
import { buildOrderMessage, whatsappUrl } from './order-text.js';

// suppliers: array; ingredientsBySupplier: { supplierId: [ingredient] };
// entries: { ingredientId: { qty, stock } }; callbacks: { onBack, onSent };
// format: { grouped, onChange } — the remembered message-format choice, owned by
// orders-main so every send path reads the same one.
export function buildSendScreen(suppliers, ingredientsBySupplier, entries, callbacks, format) {
  // Only suppliers with at least one ordered item can be sent.
  const rows = suppliers.map(supplier => ({
    id: supplier.id,
    name: supplier.name,
    items: (ingredientsBySupplier[supplier.id] || [])
      .filter(ing => (entries[ing.id]?.qty || 0) > 0)
      .map(ing => ({ name: ing.name, weight: ing.weight || '', qty: entries[ing.id].qty })),
  })).filter(row => row.items.length);

  return buildSupplierPicker(rows, {
    title: 'Send order',
    actionLabel: 'Send on WhatsApp',
    emptyText: 'No items in this order yet. Add quantities first.',
    format,
    // A message goes to one chat: who it is for is a decision, not a default.
    preselect: false,
  }, {
    onBack: () => callbacks.onBack(),
    onConfirm: (selected, { grouped }) => {
      const text = buildOrderMessage(
        selected.map(r => ({ supplierName: r.name, items: r.items })), { grouped });
      if (!text) return;            // nothing orderable — never open an empty chat
      window.open(whatsappUrl(text), '_blank');
      callbacks.onSent?.(selected.map(r => r.id));
    },
  });
}
