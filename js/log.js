// log.js — the production log UI: the log list, the Confirm→save flow (with the
// Today/Tomorrow choice), and the tap / edit / delete / history actions. The data
// model and persistence live in log-model.js (pure) and log-store.js (Firestore).

import { showResult, hideResult, markRevealed, clearRevealed, getLock, setLock } from './calc.js';
import { getConfig } from './calculator-config-store.js';
import {
  getTabProducts, getDivisorIncluded, isExtraDoughEnabled, doughExtraGrams,
  isLogVisible, getLogRetentionForDough, getRecipes, getRecipeById, showsLeaveningKnob,
} from './calculator-config.js';
import { logTimestamp } from './log-time.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { buildSheet, buildLogText, latestVersion, filterVisibleLogs, confirmTarget, dayLabel, recipeSnapshot } from './log-model.js';
import { getLogs, getLogById, createAndSave, appendAndSave, genLogId, deleteLog } from './log-store.js';
import { renderOrder, renderVersion } from './log-view.js';
import { openLogEdit, openLogHistory } from './log-edit.js';
import { openLogAdd } from './log-add.js';
import { confirmDialog } from './confirm-dialog.js';

function qtyOf(id) { const e = document.getElementById(id); return e ? (+e.value || 0) : 0; }

// The leavening % in effect for a recipe: its knob value when shown, else its default.
function leaveningPctFor(recipe) {
  if (showsLeaveningKnob(recipe)) {
    const e = document.getElementById(recipe.id + '-param');
    if (e && e.value !== '') return +e.value || recipe.leaveningDefaultPct || 0;
  }
  return recipe.leaveningDefaultPct || 0;
}

// The typed total (grams) for a 'total'/'both' recipe; 0 when the field is absent.
function totalInputFor(recipeId) {
  const e = document.getElementById(recipeId + '-total-input');
  return e ? Math.max(0, +e.value || 0) : 0;
}

// ── Gather the current calculator state for a dough tab ───────────────────────
function gatherItems(tab) {
  // One line per (client, product) association. `id` stays the product id so the
  // divisor (which selects by product) still matches; the quantity is read per pair
  // (qtyId), so two clients ordering the same product are two independent lines.
  return getTabProducts(getConfig(), tab).map(p => ({
    id: p.id, name: p.name, clientName: p.clientName,
    qty: qtyOf(p.qtyId), weightG: p.weight, kind: p.kind,
    crate: p.crate || { show: false, perBox: 20 },
  }));
}
function gatherExtra(tab) {
  const v = document.getElementById(tab + '-extra');
  if (!v || !isExtraDoughEnabled(getConfig(), tab)) return { grams: 0, value: 0, unit: 'g' };
  const u = document.getElementById(tab + '-extra-unit');
  const unit = u ? u.value : 'g';
  return { grams: doughExtraGrams(v.value, unit), value: +v.value || 0, unit };
}

// ── Confirm (Today/Tomorrow day picker) + Edit ────────────────────────────────
// Each dough tab's Confirm button opens a shared Today/Tomorrow day picker. Choosing
// a day saves the log (create the first time, or UPDATE the linked one) and LOCKS
// the tab; the Confirm button is then replaced by an "Edit" button. Edit unlocks the
// inputs (keeping the link) and hides the recipe, which reappears recomputed only on
// the next save. A new, separate log is made only after Reset clears the link.
let pendingTab = null;
let pendingDay = null;

// Tap Today/Tomorrow in the day picker → save that dough's log for the chosen day.
export function saveDay(tab, day) {
  if (getLock(tab).locked) return; // locked: the buttons are hidden; ignore stray taps
  pendingTab = tab;
  pendingDay = day;
  commitLog();
}

// Tap Edit on a locked dough tab → confirm, then unlock the inputs (keeping the link)
// and hide the recipe so it can't change live; it returns, recomputed, on the next save.
export async function editTab(tab) {
  if (!getLock(tab).locked) return;
  if (!(await confirmDialog({ message: 'Edit these quantities? The recipe updates only after you save it again.', okLabel: 'Edit' }))) return;
  clearRevealed(tab);
  hideResult(tab + '-result');
  setLock(tab, false, getLock(tab).logId);
}

// Build and save the log for the chosen day (one tap on Today/Tomorrow does this).
function commitLog() {
  const tab = pendingTab;
  if (!tab || !pendingDay) return;
  const config = getConfig();
  const recipe = getRecipeById(config, tab);
  if (!recipe) return;
  const items = gatherItems(tab);
  const extra = gatherExtra(tab);
  const leaveningPct = leaveningPctFor(recipe);
  const totalInput = totalInputFor(tab);
  const divEl = document.getElementById(tab + '-divisor-div');
  const divisor = { includedIds: getDivisorIncluded(config, tab), n: divEl ? (+divEl.value || 0) : 0 };
  const at = logTimestamp();
  const sheet = buildSheet({ recipe, items, extraGrams: extra.grams, totalInput, leaveningPct, divisor });
  const text = buildLogText(items, [], extra);

  // Update the linked log, or create a fresh one. The link is dropped only by Reset;
  // a deleted linked log falls back to create (confirmTarget handles that edge case).
  const lock = getLock(tab);
  const action = confirmTarget({ linkedId: lock.logId, linkedExists: !!getLogById(lock.logId) });
  const frozenRecipe = recipeSnapshot(recipe); // the doses used TODAY, kept with the log
  let logId = lock.logId;
  if (action === 'update') {
    const version = { calculatedBy: '', at, kind: 'edit', items, occasional: [], sheet, text, recipe: frozenRecipe };
    appendAndSave(lock.logId, version, pendingDay);
  } else {
    logId = genLogId();
    const version = { calculatedBy: '', at, kind: 'create', items, occasional: [], sheet, text, recipe: frozenRecipe };
    createAndSave({ id: logId, dough: recipe.name, recipeId: tab, forDay: pendingDay, version, createdAtMs: Date.now(), origin: 'calculator' });
  }

  // Reveal the recipe and LOCK the tab: the Today/Tomorrow pair becomes an "Edit" button
  // and the inputs grey out until the user taps Edit. The link is remembered so the next
  // save updates this same log.
  markRevealed(tab);
  showResult(tab + '-result');
  setLock(tab, true, logId);
  pendingTab = null;
  pendingDay = null;
}

// ── Log list ──────────────────────────────────────────────────────────────────
export function renderLog() {
  const container = document.getElementById('log-content');
  if (!container) return;
  const cfg = getConfig();
  // Visibility + retention are keyed by recipe id (filterVisibleLogs matches each
  // log by its recipeId, falling back to the dough name for older migrated logs).
  const visibility = {};
  const retentionHours = {};
  for (const r of getRecipes(cfg)) {
    visibility[r.id] = isLogVisible(cfg, r.id);
    retentionHours[r.id] = getLogRetentionForDough(cfg, r.id);
  }
  const logs = filterVisibleLogs(getLogs(), { visibility, retentionHours, nowMs: Date.now() });
  container.textContent = '';
  if (!logs.length) {
    // Distinguish "nothing saved yet" from "everything is hidden/expired by the
    // current Log settings", so the empty state is never misleading.
    const anySaved = getLogs().length > 0;
    container.appendChild(el('p', { class: 'log-empty' }, anySaved
      ? 'No logs to show right now — check the Log settings (visibility and duration).'
      : 'No logs yet. Calculate and confirm a dough to save it here.'));
  } else {
    for (const log of logs) container.appendChild(logCard(log));
  }

  // Manual add-log entry point, always available below the list.
  const addBtn = el('button', { class: 'cp-add-client', type: 'button', id: 'log-add-btn' }, '+ Add log');
  addBtn.addEventListener('click', openLogAdd);
  container.appendChild(addBtn);
}

function logCard(log) {
  const v = latestVersion(log) || {};
  const card = el('div', { class: 'card log-card' });

  // Tappable body → read-only full sheet (D).
  const body = el('button', { class: 'log-card-body', type: 'button', 'data-id': log.id });
  const day = dayLabel(log, Date.now());
  body.appendChild(el('div', { class: 'log-card-top' }, [
    el('span', { class: 'card-title log-card-dough' }, log.dough),
    el('span', { class: 'logday-badge ' + day.tone }, day.text),
  ]));
  const at = v.at || {};
  body.appendChild(el('div', { class: 'log-timestamp' }, [icon('calendar', 14), ' ' + (at.date || '') + ' — ' + (at.time || '')]));
  if (v.calculatedBy) body.appendChild(el('div', { class: 'logview-by' }, 'by ' + v.calculatedBy));
  if ((log.versions || []).length > 1) body.appendChild(el('div', { class: 'log-ver-count' }, 'v' + log.versions.length + ' (edited)'));
  body.appendChild(renderOrder(v));
  card.appendChild(body);

  // Actions: history (icon), edit (manual logs only), delete (low-key). A calculator
  // log is edited from the calculator (Edit → Confirm), never here, so its Edit button
  // is omitted; only a hand-entered log ("+ Add log") shows it.
  const actions = el('div', { class: 'log-actions' });
  const hist = el('button', { class: 'log-hist-btn', type: 'button', 'data-id': log.id, 'aria-label': 'Version history' }, [icon('clock', 16), ' History']);
  const del = el('button', { class: 'log-delete-btn', type: 'button', 'data-id': log.id, 'aria-label': 'Delete log' }, icon('trash', 16));
  actions.appendChild(hist);
  if (log.origin === 'manual') {
    actions.appendChild(el('button', { class: 'log-edit-btn', type: 'button', 'data-id': log.id }, 'Edit'));
  }
  actions.appendChild(del);
  card.appendChild(actions);
  return card;
}

// ── Read-only view (D) ────────────────────────────────────────────────────────
function openLogView(id) {
  const log = getLogById(id);
  if (!log) return;
  const c = document.getElementById('logview-content');
  c.textContent = '';
  document.getElementById('logview-title').textContent = log.dough + ' log';
  c.appendChild(renderVersion(latestVersion(log), log));
  document.getElementById('logview-overlay').classList.add('visible');
}
function closeLogView() { document.getElementById('logview-overlay').classList.remove('visible'); }

// Edit (B): confirm first, then open the dedicated edit screen (never the calculator).
async function startEdit(id) {
  if (!(await confirmDialog({ message: 'Edit this log?', okLabel: 'Edit' }))) return;
  openLogEdit(id);
}

// ── Wiring (elements exist in calculator.html) ────────────────────────────────
document.querySelector('.logview-back-btn').addEventListener('click', closeLogView);
document.querySelector('.logview-home-btn').addEventListener('click', () => { window.location.href = 'index.html'; });

document.getElementById('log-content').addEventListener('click', async e => {
  const histB = e.target.closest('.log-hist-btn');
  const editB = e.target.closest('.log-edit-btn');
  const delB = e.target.closest('.log-delete-btn');
  const bodyB = e.target.closest('.log-card-body');
  if (histB) { openLogHistory(histB.dataset.id); return; }
  if (editB) { startEdit(editB.dataset.id); return; }
  if (delB) {
    const id = delB.dataset.id;
    const log = getLogById(id);
    const msg = 'Delete this ' + (log ? log.dough : '') + ' log? This cannot be undone.';
    if (await confirmDialog({ message: msg, okLabel: 'Delete', danger: true })) deleteLog(id);
    return;
  }
  if (bodyB) { openLogView(bodyB.dataset.id); return; }
});
