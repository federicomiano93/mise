// orders-main.js — entry point for orders.html.
//
// Tabs + Firebase connectivity; the supplier list with stock + order fields; the
// autosaving real-time draft; preview/send; history; the management panel.
//
// The unit of an order is one DAY and one SUPPLIER. Everything here follows from
// that: "Order placed" lives on each supplier card and touches only that
// supplier's rows; the draft remembers which day each supplier's rows were typed
// on, so an order left unmarked overnight is filed under the day it was written,
// not under today.

import { watchCollection, saveDoc, createDoc, removeDoc, COLLECTIONS } from './firebase-orders.js';
import { el, groupBy } from './dom.js';
import { renderSuppliers, refreshSupplierDerived } from './suppliers.js';
import {
  scheduleDraftSave, saveDraftNow, flushDraftSave, watchDraft, archiveSupplier, clearSupplier,
  saveHistoryRecord, deleteHistoryRecord, setDraftSaveReporter,
} from './draft.js';
import { buildSendScreen } from './preview.js';
import { renderHistory as renderHistoryView } from './history.js';
import { buildHistoryEditor } from './history-edit.js';
import { buildManagement, isAdmin } from './management.js';
import { computeSuggestion } from './suggestions.js';
import { refreshBankHolidays } from './bank-holidays.js';
import { renderAlerts } from './notifications.js';
import { confirmDialog } from './confirm-dialog.js';
import { todayISO, dayPhrase, localDayOf } from './day.js';
import { historyDocId, ingredientsOf, supplierHasItems } from './archive.js';
import { todayOrders, pendingSuppliers } from './reminders.js';
import { renderTodayOrders, renderPending } from './reminder-view.js';

const state = {
  suppliers: [],
  ingredients: [],
  history: [],
  entries: {},                  // { ingredientId: { qty, stock } } — shared object, mutated in place
  days: {},                     // { supplierId: 'YYYY-MM-DD' } — the day those rows were typed
  draftUpdatedAt: '',           // fallback day for a draft written before `days` existed
  pending: [],                  // orders typed on an earlier day and never placed
  expanded: new Set(),
  loaded: { suppliers: false, ingredients: false, draft: false },
};

let mgmt = null;                // open management panel handle, or null
let pendingChecked = false;     // the unfinished-order check runs once per page load
const placing = new Set();      // suppliers whose order is being written right now

// Replace state.entries contents WITHOUT changing the reference (row closures keep working).
function setEntries(next) {
  Object.keys(state.entries).forEach(k => delete state.entries[k]);
  Object.assign(state.entries, next || {});
}

const hooks = {
  afterChange(supplierId) {
    const supplier = state.suppliers.find(s => s.id === supplierId);
    if (supplier) {
      refreshSupplierDerived(supplier, ingredientsBySupplier()[supplierId] || [], state.entries);
    }
    // Stamp the day these rows were touched. This is what lets the app offer an
    // order typed yesterday under YESTERDAY's date instead of quietly filing it
    // under today.
    state.days[supplierId] = todayISO();
    scheduleDraftSave(state.entries, state.days);
  },
  onPlaced(supplierId) {
    placeOrder(supplierId);
  },
};

function activeSuppliers() {
  return state.suppliers
    .filter(s => s.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ingredientsBySupplier() {
  return groupBy(state.ingredients.filter(i => i.active !== false), 'supplierId');
}

function refreshAllSuppliers() {
  const bySupplier = ingredientsBySupplier();
  activeSuppliers().forEach(s => refreshSupplierDerived(s, bySupplier[s.id] || [], state.entries));
}

function syncInputsFromState() {
  document.querySelectorAll('#suppliers-list .ing-row').forEach(row => {
    const entry = state.entries[row.dataset.ing] || {};
    const stock = row.querySelector('.ing-stock');
    const qty = row.querySelector('.ing-qty');
    if (stock && stock !== document.activeElement) stock.value = entry.stock || '';
    if (qty && qty !== document.activeElement) qty.value = entry.qty || '';
  });
  refreshAllSuppliers();
}

// ── Rendering: order tab ──────────────────────────────────────────────────────
function render() {
  const container = document.getElementById('suppliers-list');
  if (!container) return;
  if (!state.loaded.suppliers || !state.loaded.ingredients) return;

  const suppliers = activeSuppliers();

  if (!suppliers.length) {
    renderEmptyState(container);
    return;
  }

  renderSuppliers(container, suppliers, ingredientsBySupplier(), {
    entries: state.entries,
    suggest: (id, stock) => computeSuggestion(id, stock, state.history),
    expanded: state.expanded,
    hooks,
  });
}

function renderEmptyState(container) {
  container.textContent = '';
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('p', { class: 'empty-title', text: 'No suppliers yet' }),
    el('p', { class: 'empty-sub', text: 'Add your suppliers and ingredients from the settings panel (gear icon, top right).' }),
  ]));
}

// ── Rendering: history tab ────────────────────────────────────────────────────
function applyHistory(list) {
  state.history = list;
  renderHistory();
  render(); // refresh order-tab suggestions now that history is available
}

function renderHistory() {
  renderHistoryView(
    document.getElementById('history-list'),
    state.history,
    state.suppliers,
    state.ingredients,
    { onEdit: openHistoryEditor },
  );
}

// ── Correcting a recorded order ───────────────────────────────────────────────
function openHistoryEditor(record) {
  const overlay = buildHistoryEditor(record, state.ingredients, {
    onClose: () => overlay.remove(),
    onSave: async (id, next) => {
      try {
        await saveHistoryRecord(id, next);
        overlay.remove();
        setStatus('Order updated ✓', 'ok', 4000);
      } catch (err) {
        console.error('Updating the order failed:', err);
        setStatus('Could not update the order — check your network and try again.', 'error');
      }
    },
    onDelete: async id => {
      try {
        await deleteHistoryRecord(id);
        overlay.remove();
        setStatus('Order deleted', 'warn', 4000);
      } catch (err) {
        console.error('Deleting the order failed:', err);
        setStatus('Could not delete the order — check your network and try again.', 'error');
      }
    },
  });
  document.body.appendChild(overlay);
}

function showAlerts() {
  renderAlerts(document.getElementById('orders-alerts'), state.suppliers);
}

// ── Send order (WhatsApp selection screen) ────────────────────────────────────
function openSendScreen() {
  const overlay = buildSendScreen(activeSuppliers(), ingredientsBySupplier(), state.entries, {
    onBack: () => overlay.remove(),
    onSent: supplierIds => {
      overlay.remove();
      offerToRecordSent(supplierIds);
    },
  });
  document.body.appendChild(overlay);
}

// "A", "A and B", "A, B and C".
function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Sending is the moment the order actually leaves, so it is the moment to ask —
// forgetting to tap "Order placed" afterwards is exactly what left orders
// unrecorded. Only the suppliers that were actually ticked and sent are offered.
async function offerToRecordSent(supplierIds) {
  const suppliers = supplierIds
    .map(id => state.suppliers.find(s => s.id === id))
    .filter(s => s && supplierHasItems(s.id, state.ingredients, state.entries));
  if (!suppliers.length) return;

  const names = listNames(suppliers.map(s => s.name));
  const alreadyRecorded = suppliers.filter(s =>
    state.history.some(h => h.id === historyDocId(dayForSupplier(s.id), s.id)));

  let message = `Mark ${names} as placed? The order goes to History and the rows are cleared.`;
  if (alreadyRecorded.length) {
    const already = listNames(alreadyRecorded.map(s => s.name));
    message += `\n\n${already} already has an order recorded for that day — these items will be ADDED to it.`;
  }

  const ok = await confirmDialog({
    title: 'Order sent',
    message,
    okLabel: 'Mark as placed',
    cancelLabel: 'Not yet',
  });
  if (!ok) return;

  // Sequentially: each archive writes and then clears its own rows, and the draft
  // is one shared document — overlapping writes would race on it.
  const saved = [];
  for (const supplier of suppliers) {
    const done = await placeOrder(supplier.id, { confirm: false });
    if (done) saved.push(supplier.name);
  }
  if (saved.length) setStatus(`${listNames(saved)} — order saved to history ✓`, 'ok', 5000);
}

// ── Order placed (one supplier at a time) ─────────────────────────────────────

// The day a supplier's rows belong to: the day they were typed. Falls back to the
// draft's own timestamp for rows written before the app recorded that, and to
// today when there is nothing at all to go on.
function dayForSupplier(supplierId) {
  return state.days[supplierId] || localDayOf(state.draftUpdatedAt) || todayISO();
}

// Drop a supplier's rows from the in-memory draft immediately, so the screen
// clears without waiting for the write to come back (and so a debounced save
// already in flight cannot resurrect them).
function forgetSupplierLocally(supplierId) {
  ingredientsOf(supplierId, state.ingredients, { activeOnly: false })
    .forEach(ing => { delete state.entries[ing.id]; });
  delete state.days[supplierId];
}

// Record one supplier's order. Returns true when it was written.
//
// `confirm: false` is used right after a WhatsApp send, where the operator has
// just answered the same question for every supplier that was sent.
// `date` PINS the day. The unfinished-order banner passes the day it is showing,
// because state.days[supplierId] is restamped to today by any keystroke on that
// supplier's rows — so reading it here would file a "Placed yesterday" order under
// TODAY, which is precisely the mistake this whole feature exists to prevent.
async function placeOrder(supplierId, { confirm = true, date: pinnedDate } = {}) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) return false;

  // An order takes a second to write. Without this, a second tap in that second
  // passes every check, archives the same rows again, and mergeArchives — which
  // ADDS by design — doubles the quantities.
  if (placing.has(supplierId)) return false;

  if (!supplierHasItems(supplierId, state.ingredients, state.entries)) {
    setStatus('Nothing to record for this supplier — add quantities first.', 'warn', 4000);
    return false;
  }
  // Firestore has no offline persistence here, so the write would simply never
  // resolve and the tap would hang. Say so instead.
  if (!navigator.onLine) {
    setStatus("You're offline — reconnect to record this order.", 'error', 6000);
    return false;
  }

  const date = pinnedDate || dayForSupplier(supplierId);
  if (confirm && !await confirmPlacement(supplier, date)) return false;
  if (placing.has(supplierId)) return false; // the dialog was open a while — re-check

  placing.add(supplierId);
  disablePlaceButton(supplierId);

  try {
    // Any keystroke from the last 800ms is still sitting in the debounce timer —
    // possibly for ANOTHER supplier. Write it before the surgical clear, or it is
    // lost when the next snapshot arrives.
    await flushDraftSave();
    await archiveSupplier({
      supplier, ingredients: state.ingredients, entries: state.entries, date,
    });
  } catch (err) {
    console.error('Archiving order failed:', err);
    setStatus('Could not save the order — check your network and try again.', 'error');
    placing.delete(supplierId);
    refreshAllSuppliers();          // restore the button to whatever the rows say
    return false;
  }

  // PAST THE POINT OF NO RETURN: the order IS in History now. Everything below is
  // tidying up, and none of it may ever report "could not save" — the operator
  // would retry, and the retry would ADD the same items to the record all over
  // again (mergeArchives adds by design).
  //
  // Forget the rows LOCALLY first: a keystroke during the archive above may have
  // queued a draft save, and that save holds state.entries BY REFERENCE. Dropping
  // the keys before it fires is what stops it writing them back after the clear.
  forgetSupplierLocally(supplierId);
  syncInputsFromState();            // also re-derives every button's enabled state
  renderReminders();

  try {
    await clearSupplier(supplierId, state.ingredients);
    setStatus(`${supplier.name} — order saved to history ✓`, 'ok', 5000);
  } catch (err) {
    console.error('Clearing the draft after archiving failed:', err);
    setStatus(
      `${supplier.name} — order saved to History, but the rows could not be cleared. Reload the page; do NOT record it again.`,
      'warn',
    );
  }
  placing.delete(supplierId);
  return true;
}

// Grey the button out while its order is being written, so what the operator sees
// matches the guard above. Re-enabling is never done by hand: refreshAllSuppliers
// derives it from the rows, so a cleared supplier's button stays correctly dead.
function disablePlaceButton(supplierId) {
  const btn = document.getElementById(`place-btn-${supplierId}`);
  if (btn) btn.disabled = true;
}

function confirmPlacement(supplier, date) {
  const when = dayPhrase(date);
  const already = state.history.some(h => h.id === historyDocId(date, supplier.id));

  const message = already
    ? `An order for ${supplier.name} is already recorded ${when}. These items will be ADDED to it.\n\nSend the order on WhatsApp first — recording it clears the rows.`
    : `Record ${supplier.name}'s order ${when}?\n\nSend the order on WhatsApp first — recording it clears the rows.`;

  return confirmDialog({
    title: already ? `Add to ${supplier.name}'s order` : `${supplier.name} — order placed`,
    message,
    okLabel: already ? 'Add to it' : 'Order placed',
  });
}

// ── Reminders (today's orders / an order left from an earlier day) ────────────

// One call site for both banners, invoked from every path that changes the draft,
// the history or the supplier list.
function renderReminders() {
  if (!state.loaded.suppliers) return;

  renderTodayOrders(
    document.getElementById('orders-today'),
    todayOrders({ suppliers: state.suppliers, history: state.history, today: todayISO() }),
    { onPick: expandSupplier },
  );

  renderPending(document.getElementById('orders-pending'), state.pending, {
    onPlaced: recordPending,
    onToday: keepAsToday,
    onDiscard: discardPending,
  });
}

// Look for an order typed on an earlier day and never placed — ONCE per page
// load, and only once the draft, the suppliers and the ingredients have all
// arrived (any of them missing would make every supplier look empty).
//
// Latched on purpose: the draft listener fires on every keystroke, including
// another phone's, and recomputing would rebuild these buttons under the
// operator's finger — or bring the banner back after it had been answered.
function checkPendingOnce() {
  if (pendingChecked) return;
  if (!state.loaded.suppliers || !state.loaded.ingredients || !state.loaded.draft) return;
  pendingChecked = true;

  state.pending = pendingSuppliers({
    suppliers: state.suppliers,
    ingredients: state.ingredients,
    entries: state.entries,
    days: state.days,
    fallbackDay: localDayOf(state.draftUpdatedAt),
    today: todayISO(),
  });
  renderReminders();
}

function dismissPending(supplierId) {
  state.pending = state.pending.filter(p => p.supplier.id !== supplierId);
  renderReminders();
}

// "Placed <day>" — it went out that day and the tap was forgotten.
//
// The day is the one the BANNER is showing, pinned when the unfinished order was
// found, and it is passed through explicitly. It must not be re-read from
// state.days here: touching any row of that supplier restamps that to today
// (hooks.afterChange), so the record would land under today while the button
// still said "Placed yesterday".
async function recordPending(supplierId, day) {
  const done = await placeOrder(supplierId, { date: day });
  if (done) dismissPending(supplierId);
}

// "It's today's" — it was never actually ordered. Keep the rows, restamp to today.
// The banner only goes away once the new stamp is actually saved: dismissing first
// and swallowing a failure would leave the draft still stamped with the old day and
// nothing on screen to say so.
async function keepAsToday(supplierId) {
  const previous = state.days[supplierId];
  state.days[supplierId] = todayISO();
  try {
    await saveDraftNow(state.entries, state.days);
    dismissPending(supplierId);
  } catch (err) {
    console.error('Restamping the draft failed:', err);
    if (previous) state.days[supplierId] = previous; else delete state.days[supplierId];
    setStatus("Could not update the order's day — check your network and try again.", 'error');
  }
}

// "Discard" — not wanted at all. Destructive, so it goes behind a red confirm.
async function discardPending(supplierId) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) return;

  const ok = await confirmDialog({
    title: `Discard ${supplier.name}'s order`,
    message: `Delete the quantities typed for ${supplier.name}? They are not saved anywhere and cannot be recovered.`,
    okLabel: 'Discard',
    danger: true,
  });
  if (!ok) return;

  try {
    await clearSupplier(supplierId, state.ingredients);
    forgetSupplierLocally(supplierId);
    syncInputsFromState();
    dismissPending(supplierId);
    setStatus(`${supplier.name} — order discarded`, 'warn', 4000);
  } catch (err) {
    console.error('Discarding the order failed:', err);
    setStatus('Could not discard the order — check your network and try again.', 'error');
  }
}

// Open one supplier's card and bring it into view — what tapping its name in the
// "order today" reminder does.
function expandSupplier(supplierId) {
  state.expanded.add(supplierId);
  render();
  document
    .querySelector(`.supplier-card[data-supplier="${supplierId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Management panel ──────────────────────────────────────────────────────────
function openManagement() {
  if (mgmt) return;
  mgmt = buildManagement(
    { suppliers: () => state.suppliers, ingredients: () => state.ingredients },
    {
      onClose: () => { mgmt.overlay.remove(); mgmt = null; },
      saveSupplier: (id, payload) =>
        id ? saveDoc(COLLECTIONS.suppliers, id, payload) : createDoc(COLLECTIONS.suppliers, payload),
      saveIngredient: (id, payload) =>
        id ? saveDoc(COLLECTIONS.ingredients, id, payload) : createDoc(COLLECTIONS.ingredients, payload),
      setSupplierActive: (id, active) => saveDoc(COLLECTIONS.suppliers, id, { active }),
      setIngredientActive: (id, active) => saveDoc(COLLECTIONS.ingredients, id, { active }),
      deleteSupplier: (id) => removeDoc(COLLECTIONS.suppliers, id),
      deleteIngredient: (id) => removeDoc(COLLECTIONS.ingredients, id),
    },
  );
  document.body.appendChild(mgmt.overlay);
}

// ── Tabs / status ─────────────────────────────────────────────────────────────
function setupTabs() {
  const tabs = [
    { btn: 'tab-order-btn', panel: 'tab-order' },
    { btn: 'tab-history-btn', panel: 'tab-history' },
  ];
  tabs.forEach(({ btn, panel }) => {
    const button = document.getElementById(btn);
    if (!button) return;
    button.addEventListener('click', () => {
      tabs.forEach(t => {
        document.getElementById(t.btn)?.classList.toggle('active', t.btn === btn);
        document.getElementById(t.panel)?.classList.toggle('active', t.panel === panel);
      });
    });
  });
}

// The one wording for a failed draft autosave, named because it is both SET and
// CLEARED from different places and the two must match exactly.
const DRAFT_SAVE_ERROR = 'Could not save the order — check your network. Keep this page open.';

let statusTimer = null;
// Set the status line. With autoHideMs, the line hides itself after that delay,
// but ONLY if its text is still the same — so a later error / "order saved"
// message set in the meantime is never wiped.
function setStatus(text, kind, autoHideMs) {
  const elStatus = document.getElementById('orders-status');
  if (!elStatus) return;
  clearTimeout(statusTimer);
  elStatus.hidden = false;
  elStatus.textContent = text;
  elStatus.className = 'orders-status' + (kind ? ' ' + kind : '');
  if (autoHideMs) {
    statusTimer = setTimeout(() => {
      if (elStatus.textContent === text) elStatus.hidden = true;
    }, autoHideMs);
  }
}

// Hide the status line, but ONLY if it still shows `text`. Same guard as the
// auto-hide above and for the same reason: whoever set a newer message — an error,
// or "order saved to history ✓" — must never have it wiped by a stale clear.
function clearStatusIf(text) {
  const elStatus = document.getElementById('orders-status');
  if (elStatus && elStatus.textContent === text) elStatus.hidden = true;
}

// Bottom bar shown ONLY while the device is offline. There is no
// "connecting/connected" message anymore: the page fills in when data streams in,
// and this is the single, quiet signal that there is no connection. Uses the
// browser's own network state (navigator.onLine + the online/offline events).
function setupOfflineIndicator() {
  const bar = document.getElementById('orders-offline');
  if (!bar) return;
  const sync = () => { bar.hidden = navigator.onLine; };
  sync();
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setupTabs();
  document.getElementById('orders-wa-btn')?.addEventListener('click', openSendScreen);

  // The debounced draft autosave has no caller to hand a rejection to, so it reports
  // through here. Never auto-hidden on a timer: an order that is no longer being
  // saved is not a message the operator may miss. It clears only when a LATER
  // autosave succeeds — every save carries the whole entries map, so one success
  // really does persist what the failed write held, and a two-second network blip
  // must not leave a permanent alarm on screen.
  setDraftSaveReporter(ok => {
    if (ok) clearStatusIf(DRAFT_SAVE_ERROR);
    else setStatus(DRAFT_SAVE_ERROR, 'error');
  });

  const settingsBtn = document.getElementById('settings-footer-btn');
  if (settingsBtn) {
    if (isAdmin) settingsBtn.addEventListener('click', openManagement);
    else settingsBtn.hidden = true;
  }

  setupOfflineIndicator();

  // No "connecting/connected" status: the data watchers below each await auth
  // internally, so they attach as soon as the (persisted) anonymous session is
  // ready and then stream live. init never blocks, so the page never sits waiting.

  // Refresh the official UK bank-holiday calendar (cached for offline; used by
  // the alerts). Fire-and-forget — failure falls back to the cached list.
  refreshBankHolidays().then(list => { console.log(`Bank holidays loaded: ${list.length} dates`); showAlerts(); });

  // Real-time draft: restores exact state on open and keeps staff in sync.
  watchDraft(draft => {
    setEntries(draft.entries);
    state.days = draft.days || {};
    state.draftUpdatedAt = draft.updatedAt;
    state.loaded.draft = true;
    syncInputsFromState();
    renderReminders();
    checkPendingOnce();
  });

  watchCollection(COLLECTIONS.history, list => {
    applyHistory(list);
    renderReminders();
  });

  // Suppliers and ingredients stay unbounded: they are a handful of documents and
  // every one of them is needed to draw the screen. Only history grows without end.
  watchCollection(COLLECTIONS.suppliers, list => {
    state.suppliers = list;
    state.loaded.suppliers = true;
    render();
    renderHistory();
    showAlerts();
    renderReminders();
    checkPendingOnce();
    mgmt?.refresh();
  });
  watchCollection(COLLECTIONS.ingredients, list => {
    state.ingredients = list;
    state.loaded.ingredients = true;
    render();
    renderHistory();
    renderReminders();
    checkPendingOnce();
    mgmt?.refresh();
  });
}

init();
