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

import { t } from '../i18n.js';
import { buildSupplierPicker } from './supplier-picker.js';
import { chooseAndSend } from './send-chooser.js';
import { currentSession } from '../firebase.js';

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
    title: t('orders.sendOrder'),
    // ⚠️ "Send", not "Send on WhatsApp". The button no longer names one road: it
    // asks which of the open ones to take, and goes straight there when only one
    // is open — a question with a single answer is a tap wasted on every order.
    actionLabel: t('orders.send.button'),
    emptyText: t('orders.noItemsInThis'),
    format,
    // A message goes to one chat: who it is for is a decision, not a default.
    preselect: false,
    // ⚠️ THE SECOND BUTTON IS GONE, and "to the manager" did not go with it — it
    // became one of the four roads in the chooser. A footer that grew a button per
    // destination would be four buttons wide by now, and the two that address a
    // supplier directly need a sentence under them anyway.
  }, {
    onBack: () => callbacks.onBack(),
    onConfirm: (selected, { grouped }) => chooseAndSend({
      rows: selected,
      settings: callbacks.sendSettings,
      canManage: callbacks.canManage === true,
      // ⚠️ ONLY THE PICKED SUPPLIERS, matched by ID. The chooser has to know which
      // of them can actually be reached, and by name they could not be told apart.
      suppliers: selected.map(r => suppliers.find(s => s.id === r.id)).filter(Boolean),
      locationName: currentSession().name,
      grouped,
      onSendToManager: callbacks.onSendToManager,
      onSent: callbacks.onSent,
    }),
  });
}
