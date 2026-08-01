import './firebase.js';
import {
  calc, copyRecipe, shareRecipeWA, buildDivisorBox,
  restoreRevealed, clearRevealed, restoreLock, clearLock,
} from './calc.js';
import { saveDay, editTab, renderLog } from './log.js';
import { closeRecipes, goHomeFromRecipes } from './recipes.js';
import { openSettings } from './calculator-settings.js';
import './log-settings.js';
import { shareMarketOrder, closeLoafModal, sendWithLoaves, closeListPicker } from './whatsapp.js';
import { getConfig, initConfig } from './calculator-config-store.js';
import { initLogs } from './log-store.js';
import { renderTab, buildRecipePanel, el } from './calculator-render.js';
import { getVisibleRecipes, getRecipeById, getTabProducts, isExtraDoughEnabled } from './calculator-config.js';
import { confirmDialog } from './confirm-dialog.js';

// Service-worker registration and the update banner live in js/sw-update.js,
// shared by every page — nothing to do here.

// ── Tab switching ─────────────────────────────────────────────────────────────
// The tab-bar holds the visible recipes (built from config); the Log lives in the
// footer (next to Settings). currentTab is a recipe id or 'log'.
let lastRecipeTab = null; // remembered so the Log screen's Back returns here
let currentTab = null;    // the active screen, for the header Back destination

function visibleIds() { return getVisibleRecipes(getConfig()).map(r => r.id); }

function switchTab(name) {
  document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('#tab-bar .tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.recipe === name);
  });
  const scroll = document.querySelector('.scroll-area');
  if (scroll) scroll.scrollTop = 0;
  // Footer "Log" is a no-op while the Log is open; hide it there (the tab-bar still leaves).
  const logFooterBtn = document.getElementById('log-footer-btn');
  if (logFooterBtn) logFooterBtn.style.display = name === 'log' ? 'none' : '';
  if (name !== 'log') lastRecipeTab = name;
  currentTab = name;
  if (name === 'log') renderLog();
}

// ── Per-recipe quantity persistence (one localStorage key per client+product pair) ─
function productIds(recipeId) {
  return getTabProducts(getConfig(), recipeId).map(p => p.qtyId);
}
function saveQty(recipeId) {
  productIds(recipeId).forEach(id => {
    const e = document.getElementById(id);
    if (e) localStorage.setItem('qty-' + id, e.value);
  });
}
function clearQty(recipeId) {
  productIds(recipeId).forEach(id => localStorage.removeItem('qty-' + id));
}
function restoreQty(recipeId) {
  productIds(recipeId).forEach(id => {
    const e = document.getElementById(id);
    if (!e) return;
    const val = localStorage.getItem('qty-' + id);
    if (val !== null) e.value = val;
  });
}

// The leavening knob is persisted exactly like the quantities. Without this the panel
// is rebuilt at the recipe's DEFAULT percentage on every load while the quantities
// survive, so a confirmed recipe silently recomputes: 0.80% yeast came back as 0.65%
// and the sheet on screen showed less yeast than the one that was confirmed and logged.
function saveParam(recipeId) {
  const e = document.getElementById(recipeId + '-param');
  if (e) localStorage.setItem('param-' + recipeId, e.value);
}
function restoreParam(recipeId) {
  const e = document.getElementById(recipeId + '-param');
  if (!e) return;
  const val = localStorage.getItem('param-' + recipeId);
  if (val !== null) e.value = val;
}

// Number-field UX: clear a leading 0 on focus, restore 0 (and recalc) on blur.
function wireNumberUX(e, recipeId) {
  e.addEventListener('focus', function () {
    if (this.value === '0' || this.value === '') this.value = '';
    else this.select();
  });
  e.addEventListener('blur', function () {
    if (this.value === '' || isNaN(parseFloat(this.value))) { this.value = '0'; calc(recipeId); }
  });
}

// Attach listeners to one recipe panel's product/param/total/extra inputs + buttons.
function wireRecipe(recipe) {
  const id = recipe.id;

  // Product quantity inputs.
  productIds(id).forEach(qid => {
    const e = document.getElementById(qid);
    if (!e) return;
    const evt = e.tagName === 'SELECT' ? 'change' : 'input';
    e.addEventListener(evt, () => { calc(id); saveQty(id); });
    if (e.tagName !== 'SELECT') wireNumberUX(e, id);
  });

  // Leavening knob.
  const param = document.getElementById(id + '-param');
  if (param) {
    param.addEventListener('input', () => { calc(id); saveParam(id); });
    param.addEventListener('focus', function () {
      if (this.value === '0' || this.value === '') this.value = '';
      else this.select();
    });
    param.addEventListener('blur', function () {
      if (this.value === '' || isNaN(parseFloat(this.value))) { this.value = String(recipe.leaveningDefaultPct); calc(id); saveParam(id); }
    });
  }

  // Typed total (total/both logic) — persisted like quantities.
  const totalInput = document.getElementById(id + '-total-input');
  if (totalInput) {
    const saved = localStorage.getItem('total-' + id);
    if (saved !== null) totalInput.value = saved;
    totalInput.addEventListener('input', () => { calc(id); localStorage.setItem('total-' + id, totalInput.value); });
    wireNumberUX(totalInput, id);
  }

  // Extra dough (orders/both).
  const extra = document.getElementById(id + '-extra');
  const extraUnit = document.getElementById(id + '-extra-unit');
  if (extra) {
    const sv = localStorage.getItem('extra-' + id);
    if (sv !== null) extra.value = sv;
    extra.addEventListener('input', () => { calc(id); localStorage.setItem('extra-' + id, extra.value); });
    wireNumberUX(extra, id);
  }
  if (extraUnit) {
    const su = localStorage.getItem('extra-unit-' + id);
    if (su !== null) extraUnit.value = su;
    extraUnit.addEventListener('change', () => { calc(id); localStorage.setItem('extra-unit-' + id, extraUnit.value); });
  }

  // Confirm (opens the shared day picker), Edit, Copy, WhatsApp, Reset.
  const confirmBtn = document.getElementById(id + '-day-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', () => openDayModal(id));
  const editBtn = document.getElementById(id + '-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => editTab(id));
  const copyBtn = document.getElementById(id + '-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', () => copyRecipe(id));
  const waBtn = document.getElementById(id + '-wa-recipe-btn');
  if (waBtn) waBtn.addEventListener('click', () => shareRecipeWA(id));
  const resetBtn = document.querySelector('#tab-' + id + ' .reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => resetTab(id));
}

// (Re)build the whole calculator from config: the tab-bar, every visible recipe's
// panel, then restore quantities/state and recalc. Called on first paint and on any
// config change.
function renderAll() {
  const recipes = getVisibleRecipes(getConfig());

  // Tab bar.
  const bar = document.getElementById('tab-bar');
  if (bar) {
    bar.textContent = '';
    recipes.forEach(r => {
      const btn = el('button', { class: 'tab', type: 'button', 'data-recipe': r.id }, r.name);
      btn.addEventListener('click', () => switchTab(r.id));
      bar.appendChild(btn);
    });
  }

  // Panels.
  const host = document.getElementById('recipe-tabs');
  if (host) {
    host.textContent = '';
    recipes.forEach(r => host.appendChild(buildRecipePanel(r)));
  }

  // Per-recipe content + wiring + restore + calc.
  recipes.forEach(r => {
    const ordersEl = document.getElementById(r.id + '-orders');
    if (ordersEl) renderTab(getConfig(), r.id, ordersEl);
    wireRecipe(r);
    restoreQty(r.id);
    restoreParam(r.id);
    buildDivisorBox(r.id);
    restoreRevealed(r.id);
    restoreLock(r.id);
  });

  // Keep the active tab if still valid, else fall back to the first recipe.
  const ids = recipes.map(r => r.id);
  let active = currentTab;
  if (active !== 'log' && !ids.includes(active)) active = ids[0] || 'log';
  switchTab(active);

  recipes.forEach(r => calc(r.id));
  renderLog();
}

// ── Reset ─────────────────────────────────────────────────────────────────────
async function resetTab(recipeId) {
  if (!(await confirmDialog({ message: 'Reset all fields?', okLabel: 'Reset', danger: true }))) return;
  const recipe = getRecipeById(getConfig(), recipeId);
  clearRevealed(recipeId);
  clearLock(recipeId);
  document.querySelectorAll('#tab-' + recipeId + ' input[type="number"]').forEach(input => {
    if (input.id === recipeId + '-param') input.value = String(recipe ? recipe.leaveningDefaultPct : 0);
    else input.value = '0';
  });
  document.querySelectorAll('#tab-' + recipeId + ' select.qty-select').forEach(sel => { sel.value = '0'; });
  const divSel = document.getElementById(recipeId + '-divisor-div');
  if (divSel) divSel.value = '0';
  clearQty(recipeId);
  // The knob is put back to the recipe's default above, so the stored value has to go
  // too — otherwise the next load would restore the percentage the reset just undid.
  localStorage.removeItem('param-' + recipeId);
  localStorage.removeItem('total-' + recipeId);
  const extraUnit = document.getElementById(recipeId + '-extra-unit');
  if (extraUnit) extraUnit.value = 'kg';
  localStorage.removeItem('extra-' + recipeId);
  localStorage.removeItem('extra-unit-' + recipeId);
  calc(recipeId);
}

// ── Shared Today/Tomorrow day picker (opened by any recipe's Confirm) ──────────
const dayModal = document.getElementById('day-modal');
let dayModalTab = null;
function openDayModal(recipeId) { dayModalTab = recipeId; dayModal.classList.add('visible'); }
function closeDayModal() { dayModal.classList.remove('visible'); dayModalTab = null; }
if (dayModal) {
  dayModal.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => { const t = dayModalTab; closeDayModal(); if (t) saveDay(t, btn.dataset.day); });
  });
  const cancel = document.getElementById('day-modal-cancel');
  if (cancel) cancel.addEventListener('click', closeDayModal);
  dayModal.addEventListener('click', (e) => { if (e.target === dayModal) closeDayModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dayModal.classList.contains('visible')) closeDayModal();
  });
}

// ── Static header / footer / modal wiring (elements exist in calculator.html) ──
document.getElementById('header-wa-btn').addEventListener('click', shareMarketOrder);
document.getElementById('header-back-btn').addEventListener('click', () => {
  // From the Log, Back returns to the last recipe; from a recipe it leaves to the app home.
  if (currentTab === 'log') switchTab(lastRecipeTab || (visibleIds()[0] || 'log'));
  else window.location.href = 'index.html';
});
document.getElementById('log-footer-btn').addEventListener('click', () => switchTab('log'));
document.getElementById('settings-footer-btn').addEventListener('click', openSettings);
document.querySelector('.recipe-back-btn').addEventListener('click', closeRecipes);
document.getElementById('recipe-home-btn').addEventListener('click', goHomeFromRecipes);
document.querySelector('.loaf-modal-cancel').addEventListener('click', closeLoafModal);
document.querySelector('.loaf-modal-send').addEventListener('click', sendWithLoaves);
document.querySelector('.list-select-cancel').addEventListener('click', closeListPicker);

// ── Cross-module events ───────────────────────────────────────────────────────
// A recipe/config save re-renders everything (recipes now live in config; saveConfig
// already notifies, but the recipe editor also emits this for an immediate refresh).
document.addEventListener('recipes-saved', renderAll);

// ── Init ──────────────────────────────────────────────────────────────────────
initLogs(renderLog);
// Start the Firestore sync (re-renders on every remote change), then paint NOW from
// the synchronous cache/default so the tabs appear instantly and work offline — the
// dynamic tabs must not wait on the network (P17, local-first).
initConfig(renderAll);
renderAll();
