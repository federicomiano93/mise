import './firebase.js';
import { t } from './i18n.js';
import {
  calc, copyRecipe, shareRecipeWA, buildDivisorBox,
  restoreRevealed, clearRevealed, restoreLock, clearLock, getLock,
} from './calc.js';
import { saveDay, editTab, renderLog } from './log.js';
import { openRecipes, closeRecipes, goHomeFromRecipes } from './recipes.js';
import { openSettings } from './calculator-settings.js';
import './log-settings.js';
import { shareMarketOrder, closeLoafModal, sendWithLoaves, closeListPicker, closeWhoPicker } from './whatsapp.js';
import { syncLinkedRecipes } from './calculator-catalogue-link.js';
import { getConfig, initConfig, canSyncConfig } from './calculator-config-store.js';
import { initLogs } from './log-store.js';
import { renderTab, buildRecipePanel, buildEmptyPanel, el } from './calculator-render.js';
import {
  getVisibleRecipes, getRecipeById, getTabProducts, isExtraDoughEnabled,
  calculatorEmptyReason,
} from './calculator-config.js';
import { workDayIndex } from './log-model.js';
import { confirmDialog } from './confirm-dialog.js';
import { initClientOrders } from './calculator-client-orders.js';

// Service-worker registration and the update banner live in js/sw-update.js,
// shared by every page — nothing to do here.

// ── Tab switching ─────────────────────────────────────────────────────────────
// The tab-bar holds the visible recipes (built from config); the Log lives in the
// footer (next to Settings). currentTab is a recipe id or 'log'.
let lastRecipeTab = null; // remembered so the Log screen's Back returns here
let currentTab = null;    // the active screen, for the header Back destination

// The panel shown when there is no recipe to draw. Not a recipe id and not in the
// tab bar — just the third thing `.content` can be, beside a recipe and the Log.
const EMPTY_TAB = 'empty';

function visibleIds() { return getVisibleRecipes(getConfig()).map(r => r.id); }

// Where the Log's Back lands. The remembered tab is CHECKED against the recipes that
// exist right now, never trusted.
//
// ⚠️ WITHOUT THAT CHECK IT LANDS ON A BLANK SCREEN, and it could already: delete the
// recipe you were last on (or open the Log and let another phone delete it), tap Back,
// and switchTab looks for a panel that is no longer built — every `.content` ends up
// hidden and the scroll area is empty, with the header offering no way out but Home.
// The empty panel makes that reachable in one more way, so the destination is now
// resolved rather than remembered.
function backFromLog() {
  const ids = visibleIds();
  if (lastRecipeTab && ids.includes(lastRecipeTab)) return lastRecipeTab;
  if (ids.length) return ids[0];
  return calculatorEmptyReason(getConfig(), canSyncConfig()) ? EMPTY_TAB : 'log';
}

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

// ── Putting a client's own order into the quantity fields ────────────────────
// The Calculator owns these fields, so it is the only thing that writes them. The
// client-orders screen asks; it never reaches in.
//
// ⚠️ INSPECT AND APPLY ARE SEPARATE ON PURPOSE. The screen has to be able to say what
// is about to change BEFORE anything does — which row already holds a different
// number, which tab is confirmed and will not move — and a single "just do it"
// function cannot be asked that question.

// Every (client, product) quantity key currently on a tab, with the tab it belongs to.
// Built fresh each time: a product added or paused a minute ago must not be answered
// for from a map made at start-up.
function qtyIndex() {
  const config = getConfig();
  const index = new Map();
  for (const recipe of getVisibleRecipes(config)) {
    for (const row of getTabProducts(config, recipe.id)) {
      index.set(row.qtyId, { recipeId: recipe.id, recipeName: recipe.name, productName: row.name });
    }
  }
  return index;
}

// What `patch` would do, row by row. A key with no field is simply absent from the
// answer: the product is paused, deleted, or on a recipe that is not a visible tab,
// and there is nothing to fill in either way.
function inspectQuantities(patch) {
  const index = qtyIndex();
  const out = [];
  for (const [qtyId, next] of Object.entries(patch || {})) {
    const where = index.get(qtyId);
    const field = document.getElementById(qtyId);
    if (!where || !field) continue;
    out.push({
      qtyId,
      recipeId: where.recipeId,
      recipeName: where.recipeName,
      productName: where.productName,
      current: Number(field.value) || 0,
      next: Number(next) || 0,
      // A confirmed tab's fields are locked until Edit is tapped. Writing them anyway
      // would put a number on screen that the recipe above it does not account for.
      locked: getLock(where.recipeId).locked,
    });
  }
  return out;
}

// Write them, persist them, and recalculate each affected tab ONCE. Persisting matters
// as much as the value: a reload restores from localStorage, so a field set without
// being saved silently reverts to what the client had NOT asked for.
function applyQuantities(targets) {
  const touched = new Set();
  for (const target of (targets || [])) {
    const field = document.getElementById(target.qtyId);
    if (!field) continue;
    field.value = String(target.next);
    localStorage.setItem('qty-' + target.qtyId, field.value);
    touched.add(target.recipeId);
  }
  for (const recipeId of touched) {
    calc(recipeId);
    // Stamped as used today, or the new-work-day sweep would clear these fields on the
    // next opening as though nobody had touched the tab.
    touchTab(recipeId);
  }
}

// ── The work day ─────────────────────────────────────────────────────────────
// What a tab holds belongs to a day's work: opening the app on a new one should not
// show yesterday's numbers. `touched` is stamped wherever the tab already persists
// something — ⚠️ it must be written in those same places and nowhere new, or a tab
// that WAS used gets cleared as if it had not been.
function touchTab(recipeId) {
  try { localStorage.setItem('touched-' + recipeId, String(Date.now())); } catch (e) {}
}

// Clear every tab whose last use falls on an earlier work day (the day rolls over at
// 4am — see workDayIndex — so a dough calculated at 23:30 and revisited at 00:30 is
// still the same night's work). Returns the ids actually cleared, so the caller can
// say why the screen is empty. `withFields` also resets the on-screen inputs; on first
// paint the panels are freshly built, so only the storage needs forgetting.
function expireStaleTabs(recipeIds, { withFields }) {
  const today = workDayIndex(Date.now());
  const cleared = [];
  for (const id of recipeIds) {
    const stamp = Number(localStorage.getItem('touched-' + id));
    if (!Number.isFinite(stamp) || stamp <= 0) continue;
    if (workDayIndex(stamp) === today) continue;
    if (withFields) clearTabState(id); else forgetTabStorage(id);
    cleared.push(id);
  }
  return cleared;
}

// A quiet line above the tab saying why it is empty — shown ONLY when something was
// actually cleared, so it never becomes background noise.
//
// ⚠️ Which tabs were cleared is remembered in memory, not read back from storage: the
// stamp is gone by then, and renderAll runs again whenever the config arrives, which
// REBUILDS the panels and takes the note with them. Without this the note appeared for
// a moment and vanished, leaving an empty tab with no explanation.
const clearedTabs = new Set();

function noteCleared(recipeId) {
  clearedTabs.add(recipeId);
  paintClearedNote(recipeId);
}

function paintClearedNote(recipeId) {
  if (!clearedTabs.has(recipeId)) return;
  const panel = document.getElementById('tab-' + recipeId);
  if (!panel || panel.querySelector('.tab-cleared-note')) return;
  const note = el('div', { class: 'tab-cleared-note' }, t('calc.fieldsClearedThisIs'));
  panel.insertBefore(note, panel.firstChild);
  setTimeout(() => { clearedTabs.delete(recipeId); note.remove(); }, 12000);
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
    e.addEventListener(evt, () => { calc(id); saveQty(id); touchTab(id); });
    if (e.tagName !== 'SELECT') wireNumberUX(e, id);
  });

  // Leavening knob.
  const param = document.getElementById(id + '-param');
  if (param) {
    param.addEventListener('input', () => { calc(id); saveParam(id); touchTab(id); });
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
    totalInput.addEventListener('input', () => { calc(id); localStorage.setItem('total-' + id, totalInput.value); touchTab(id); });
    wireNumberUX(totalInput, id);
  }

  // Extra dough (orders/both).
  const extra = document.getElementById(id + '-extra');
  const extraUnit = document.getElementById(id + '-extra-unit');
  if (extra) {
    const sv = localStorage.getItem('extra-' + id);
    if (sv !== null) extra.value = sv;
    extra.addEventListener('input', () => { calc(id); localStorage.setItem('extra-' + id, extra.value); touchTab(id); });
    wireNumberUX(extra, id);
  }
  if (extraUnit) {
    const su = localStorage.getItem('extra-unit-' + id);
    if (su !== null) extraUnit.value = su;
    extraUnit.addEventListener('change', () => { calc(id); localStorage.setItem('extra-unit-' + id, extraUnit.value); touchTab(id); });
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

  // Panels — or, when there is not one recipe to draw, the panel that says so.
  const emptyReason = calculatorEmptyReason(getConfig(), canSyncConfig());
  const host = document.getElementById('recipe-tabs');
  if (host) {
    host.textContent = '';
    recipes.forEach(r => host.appendChild(buildRecipePanel(r)));
    if (emptyReason) host.appendChild(buildEmptyPanel(emptyReason, openRecipes));
  }

  // ⚠️ Expire BEFORE restoring: doing it after would paint yesterday's numbers and
  // then blank them, which reads as a glitch.
  const cleared = expireStaleTabs(recipes.map(r => r.id), { withFields: false });

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

  // Keep the active tab if still valid, else fall back to the first recipe — or to
  // the empty panel, which is the only thing on screen when there are no recipes.
  // ⚠️ Falling back to 'log' there is what this release exists to stop: a customer
  // who has just bought the app landed on the Log, with a blank tab bar above it and
  // nothing saying why.
  const ids = recipes.map(r => r.id);
  let active = currentTab;
  if (active !== 'log' && !ids.includes(active)) active = ids[0] || (emptyReason ? EMPTY_TAB : 'log');
  switchTab(active);

  recipes.forEach(r => calc(r.id));
  cleared.forEach(noteCleared);
  // Re-paint on every rebuild, not just the one that did the clearing.
  clearedTabs.forEach(paintClearedNote);
  renderLog();
}

// ── Reset ─────────────────────────────────────────────────────────────────────
// Everything a tab remembers, in ONE place. "Reset all fields" and the new-work-day
// clear both go through these, so they can never drift apart when a field is added.
//
// ⚠️ The LOCK matters as much as the quantities. After a Confirm the tab stays linked
// to that log, and the next Confirm UPDATES it instead of making a new one. Clearing
// the numbers without the link would make tomorrow's first Confirm rewrite yesterday's
// log with today's dough.
function forgetTabStorage(recipeId) {
  clearRevealed(recipeId);
  clearLock(recipeId);
  clearQty(recipeId);
  localStorage.removeItem('param-' + recipeId);
  localStorage.removeItem('total-' + recipeId);
  localStorage.removeItem('extra-' + recipeId);
  localStorage.removeItem('extra-unit-' + recipeId);
  localStorage.removeItem('touched-' + recipeId);
}

function resetTabFields(recipeId) {
  const recipe = getRecipeById(getConfig(), recipeId);
  document.querySelectorAll('#tab-' + recipeId + ' input[type="number"]').forEach(input => {
    if (input.id === recipeId + '-param') input.value = String(recipe ? recipe.leaveningDefaultPct : 0);
    else input.value = '0';
  });
  document.querySelectorAll('#tab-' + recipeId + ' select.qty-select').forEach(sel => { sel.value = '0'; });
  const divSel = document.getElementById(recipeId + '-divisor-div');
  if (divSel) divSel.value = '0';
  const extraUnit = document.getElementById(recipeId + '-extra-unit');
  if (extraUnit) extraUnit.value = 'kg';
}

function clearTabState(recipeId) {
  resetTabFields(recipeId);
  forgetTabStorage(recipeId);
  calc(recipeId);
}

async function resetTab(recipeId) {
  if (!(await confirmDialog({ message: t('calc.resetAllFields'), okLabel: 'Reset', danger: true }))) return;
  clearTabState(recipeId);
}

// ── Shared Today/Tomorrow day picker (opened by any recipe's Confirm) ──────────
const dayModal = document.getElementById('day-modal');
let dayModalTab = null;
function openDayModal(recipeId) { dayModalTab = recipeId; dayModal.classList.add('visible'); }
function closeDayModal() { dayModal.classList.remove('visible'); dayModalTab = null; }
if (dayModal) {
  dayModal.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = dayModalTab;
      closeDayModal();
      if (!t) return;
      saveDay(t, btn.dataset.day);
      touchTab(t); // confirming is using the tab, even if nothing else was typed after
    });
  });
  const cancel = document.getElementById('day-modal-cancel');
  if (cancel) cancel.addEventListener('click', closeDayModal);
  dayModal.addEventListener('click', (e) => { if (e.target === dayModal) closeDayModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dayModal.classList.contains('visible')) closeDayModal();
  });
}

// Coming back to the app after it was left open overnight. ⚠️ Only on the way BACK,
// never while it is on screen: a tab must not empty itself under the fingers of
// someone reading the recipe off it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  expireStaleTabs(visibleIds(), { withFields: true }).forEach(noteCleared);
});

// ── Static header / footer / modal wiring (elements exist in calculator.html) ──
document.getElementById('header-wa-btn').addEventListener('click', shareMarketOrder);
document.getElementById('header-back-btn').addEventListener('click', () => {
  // From the Log, Back returns to the last recipe; from a recipe it leaves to the app home.
  if (currentTab === 'log') switchTab(backFromLog());
  else window.location.href = 'index.html';
});
document.getElementById('log-footer-btn').addEventListener('click', () => switchTab('log'));
document.getElementById('settings-footer-btn').addEventListener('click', openSettings);
document.querySelector('.recipe-back-btn').addEventListener('click', closeRecipes);
document.getElementById('recipe-home-btn').addEventListener('click', goHomeFromRecipes);
document.querySelector('.loaf-modal-cancel').addEventListener('click', closeLoafModal);
document.querySelector('.loaf-modal-send').addEventListener('click', sendWithLoaves);
document.querySelector('.list-select-cancel').addEventListener('click', closeListPicker);
document.querySelector('.send-who-cancel').addEventListener('click', closeWhoPicker);

// ── Cross-module events ───────────────────────────────────────────────────────
// A recipe/config save re-renders everything (recipes now live in config; saveConfig
// already notifies, but the recipe editor also emits this for an immediate refresh).
document.addEventListener('recipes-saved', renderAll);

// ── Init ──────────────────────────────────────────────────────────────────────
initLogs(renderLog);
// Start the Firestore sync (re-renders on every remote change), then paint NOW from
// the synchronous cache/default so the tabs appear instantly and work offline — the
// dynamic tabs must not wait on the network (P17, local-first).
// ⚠️ THE LINKED CATALOGUE RECIPES ARE KEPT FRESH ALONGSIDE THE CONFIG, and the
// tabs are repainted when one arrives — a recipe corrected in the Catalogue has to
// reach the Calculator without a reload, which is the entire point of linking
// instead of copying.
initConfig(config => { syncLinkedRecipes(config, renderAll); renderAll(); });
renderAll();

// The orders clients have sent in themselves. It is given the two functions that touch
// the quantity fields rather than importing them: app.js is the entry point, so an
// import back from that module would be a cycle.
initClientOrders({ inspect: inspectQuantities, apply: applyQuantities });
