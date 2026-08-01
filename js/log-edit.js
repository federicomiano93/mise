// log-edit.js — the dedicated log-edit screen (B) and the version history (C).
//
// EDIT (B): NOT the calculator. Shows all of the category's products with editable
// quantities only (weights/recipe stay as configured). A free "calculated by" name
// is recorded. Saving APPENDS a new version (append-only) — the previous version is
// never destroyed. Leaving with unsaved changes asks to confirm (the log stays
// exactly as before on cancel). Any "occasional clients" stored on older logs are
// carried forward unchanged on save (the feature to add new ones was removed).
//
// HISTORY (C): lists every version (append-only chain), opens any one read-only and
// can RESTORE it — restoring appends a copy on top as the new current version, so
// the history is never truncated.

import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { getConfig } from './calculator-config-store.js';
import { getTabProducts, getDivisorIncluded, getRecipes, getRecipeById } from './calculator-config.js';
import { logTimestamp } from './log-time.js';
import { confirmDiscard } from './calculator-confirm.js';
import { buildSheet, buildLogText, latestVersion, recipeSnapshot, editRows } from './log-model.js';
import { getLogById, appendAndSave, restoreAndSave } from './log-store.js';
import { renderVersion } from './log-view.js';
import { qtyRow } from './log-qty.js';
import { confirmDialog } from './confirm-dialog.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The recipe id a log belongs to: its stored recipeId, else a recipe matched by the
// log's dough name (older migrated logs), else the first recipe.
function resolveRecipeId(log) {
  if (log.recipeId && getRecipeById(getConfig(), log.recipeId)) return log.recipeId;
  const byName = getRecipes(getConfig()).find(r => r.name === log.dough);
  if (byName) return byName.id;
  const first = getRecipes(getConfig())[0];
  return first ? first.id : '';
}

// ── Edit screen state ─────────────────────────────────────────────────────────
let working = null; // { logId, dough, tab, items[], occasional[], calculatedBy }
let dirty = false;

export function openLogEdit(logId) {
  const log = getLogById(logId);
  if (!log) return;
  const v = latestVersion(log) || {};
  const tab = resolveRecipeId(log);

  // What the log SAVED comes first and verbatim; the products added to those clients
  // since then follow at zero, so a log can gain a row but never lose or rewrite one.
  const items = editRows(v.items, getTabProducts(getConfig(), tab).map(p => ({
    id: p.id, name: p.name, clientName: p.clientName, weightG: p.weight, kind: p.kind,
    crate: p.crate || { show: false, perBox: 20 },
  })));

  // The recipe this log was calculated with. Logs written before the freeze existed
  // have none, and fall back to today's — without that fallback they would stop being
  // editable altogether.
  const recipe = v.recipe || getRecipeById(getConfig(), tab);
  const occasional = (v.occasional || []).map(o => ({
    name: o.name || '',
    products: (o.products || []).map(p => ({
      name: p.name || '', qty: num(p.qty), weightG: num(p.weightG),
      unit: p.unit === 'kg' ? 'kg' : 'pz', productId: p.productId || '',
    })),
  }));

  working = { logId, dough: log.dough, recipeId: tab, tab, recipe, items, occasional, calculatedBy: v.calculatedBy || '' };
  dirty = false;
  render();
  updateSaveBtn();
  document.getElementById('logedit-overlay').classList.add('visible');
}

function updateSaveBtn() {
  const b = document.getElementById('logedit-save-btn');
  b.disabled = !dirty;
  b.classList.toggle('dirty', dirty);
}
function markDirty() { dirty = true; updateSaveBtn(); }

function render() {
  const c = document.getElementById('logedit-content');
  c.textContent = '';
  c.appendChild(el('div', { class: 'logedit-dough' }, working.dough + ' log'));

  const by = el('input', { class: 'cp-client-name', type: 'text', value: working.calculatedBy, placeholder: 'Name (optional)' });
  by.addEventListener('input', () => { working.calculatedBy = by.value; markDirty(); });
  c.appendChild(el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Calculated by'), by]));

  c.appendChild(el('div', { class: 'cp-label' }, 'Products — quantities only'));
  let lastClient = null;
  let card = null;
  if (!working.items.length) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, 'No products in this category.'));
  }
  for (const it of working.items) {
    if (it.clientName !== lastClient || card === null) {
      lastClient = it.clientName;
      card = el('div', { class: 'card' }, [el('div', { class: 'card-title' }, it.clientName || 'Client')]);
      c.appendChild(card);
    }
    card.appendChild(qtyRow(it, (q) => { it.qty = q; markDirty(); }));
  }

  c.appendChild(saveBottom());
}

// ── Save (append a new version) ───────────────────────────────────────────────
function saveBottom() {
  const b = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save changes');
  b.addEventListener('click', save);
  return b;
}

async function save() {
  if (!(await confirmDialog({ message: 'Save these changes as a new version?', okLabel: 'Save' }))) return;
  const tab = working.tab;

  const items = working.items.map(it => ({
    id: it.id, name: it.name, clientName: it.clientName,
    qty: num(it.qty), weightG: num(it.weightG), kind: it.kind, crate: it.crate,
  }));

  // Occasional clients → cleaned data + extra lines that feed the dough total.
  const occClean = [];
  const occLines = [];
  working.occasional.forEach((o, oi) => {
    const prods = (o.products || []).filter(p => (p.name || '').trim() !== '' && num(p.qty) > 0);
    if (!(o.name || '').trim() && !prods.length) return; // drop fully empty
    const name = (o.name || '').trim() || 'Occasional client';
    occClean.push({ name, products: prods.map(p => ({ name: p.name.trim(), qty: num(p.qty), weightG: num(p.weightG), unit: p.unit === 'kg' ? 'kg' : 'pz', productId: p.productId || '' })) });
    prods.forEach((p, pi) => occLines.push({
      id: 'occ-' + oi + '-' + pi, name: p.name.trim(), clientName: name,
      qty: num(p.qty), weightG: num(p.weightG), kind: p.unit === 'kg' ? 'kg' : 'number', crate: { show: false, perBox: 20 },
    }));
  });

  // Keep leavening / extra / total / divisor from the previous version (this screen
  // edits quantities only); recompute the sheet faithfully for the new quantities,
  // using the recipe the log was MADE with, not today's.
  const recipe = working.recipe;
  const prevSheet = (latestVersion(getLogById(working.logId)) || {}).sheet;
  const leaveningPct = prevSheet && prevSheet.param ? prevSheet.param.value : (recipe ? recipe.leaveningDefaultPct : 0);
  const extraG = prevSheet ? num(prevSheet.extra_g) : 0;
  const totalInput = recipe && recipe.logic === 'total' ? num(prevSheet && prevSheet.total_g) : 0;
  const divisor = { includedIds: getDivisorIncluded(getConfig(), tab), n: prevSheet && prevSheet.divisor ? prevSheet.divisor.n : 0 };

  const sheet = buildSheet({ recipe, items: items.concat(occLines), extraGrams: extraG, totalInput, leaveningPct, divisor });
  const extra = { grams: extraG, value: extraG, unit: 'g' };
  const text = buildLogText(items, occClean, extra);
  const version = {
    calculatedBy: (working.calculatedBy || '').trim(), at: logTimestamp(), kind: 'edit',
    items, occasional: occClean, sheet, text, recipe: recipeSnapshot(recipe),
  };

  appendAndSave(working.logId, version);
  dirty = false;
  updateSaveBtn();
  closeEdit(true);
}

async function closeEdit(saved) {
  if (!saved && !(await confirmDiscard(dirty))) return; // "continue editing" on cancel
  document.getElementById('logedit-overlay').classList.remove('visible');
  working = null;
  dirty = false;
}

// ── Version history (C) ───────────────────────────────────────────────────────
let historyLogId = null;

export function openLogHistory(logId) {
  historyLogId = logId;
  renderHistoryList();
  document.getElementById('loghistory-overlay').classList.add('visible');
}
function closeHistory() { document.getElementById('loghistory-overlay').classList.remove('visible'); }

function kindLabel(v, i, last) {
  if (v.kind === 'restore') return 'Restored from v' + ((num(v.restoredFrom) || 0) + 1);
  if (i === 0) return 'Created';
  return 'Edited';
}

function renderHistoryList() {
  const log = getLogById(historyLogId);
  const c = document.getElementById('loghistory-content');
  c.textContent = '';
  if (!log) { c.appendChild(el('p', { class: 'log-empty' }, 'Log not found.')); return; }
  c.appendChild(el('div', { class: 'logedit-dough' }, log.dough + ' — edit history'));
  const vs = log.versions || [];
  for (let i = vs.length - 1; i >= 0; i--) {
    const v = vs[i];
    const last = i === vs.length - 1;
    const at = v.at || {};
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('div', { class: 'loghist-info' }, [
        el('span', { class: 'loghist-kind' }, 'v' + (i + 1) + ' · ' + kindLabel(v, i) + (last ? ' · current' : '')),
        el('span', { class: 'loghist-meta' }, (at.date ? at.date + ' — ' + at.time : '') + (v.calculatedBy ? ' · ' + v.calculatedBy : '')),
      ]),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    box.addEventListener('click', () => openHistoryVersion(i));
    c.appendChild(box);
  }
}

function openHistoryVersion(i) {
  const log = getLogById(historyLogId);
  if (!log) return;
  const vs = log.versions || [];
  const v = vs[i];
  if (!v) return;
  const c = document.getElementById('loghistory-content');
  c.textContent = '';
  const back = el('button', { class: 'loghist-tolist', type: 'button' }, [icon('chevronLeft', 16), ' All versions']);
  back.addEventListener('click', renderHistoryList);
  c.appendChild(back);
  c.appendChild(renderVersion(v, log));
  if (i !== vs.length - 1) {
    const restore = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Restore this version');
    restore.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: 'Restore this version? It is added on top as the new current version — the history is kept.', okLabel: 'Restore' }))) return;
      restoreAndSave(historyLogId, i, { calculatedBy: v.calculatedBy || '', at: logTimestamp() });
      renderHistoryList();
    });
    c.appendChild(restore);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
document.querySelector('.logedit-back-btn').addEventListener('click', () => closeEdit(false));
document.getElementById('logedit-save-btn').addEventListener('click', save);
document.querySelector('.loghistory-back-btn').addEventListener('click', closeHistory);
