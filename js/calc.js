// calc.js — the per-recipe calculation, now fully data-driven. ONE generic calc(id)
// scales whatever recipe the config holds (any ingredients, any of the three calc
// logics), replacing the old hard-coded calcFocaccia/Brioche/Sourdough. Every DOM id
// is derived from the recipe id, so the dynamic tabs (built in calculator-render.js)
// and this module share the same naming.
//
// The dough math itself is the unified scaleRecipe (calculator-dough-math.js), fed by
// recipeSpec(recipe). For the 'total' logic the leavening is neutralised so the
// recipe scales purely pro-rata. The recipe is hidden until the first Confirm, then
// stays visible AND editable — the recipe sheet and the log are independent.

import { t } from './i18n.js';
import {
  computeRecipeTarget, getTabProducts, doughExtraGrams, isExtraDoughEnabled,
  getDivisorProducts, divisorTotal, splitDough, DIVISOR_MAX,
  isCrateEnabled, getCratePerBox, crateCount,
  getRecipeById, recipeSpec, showsLeaveningKnob,
} from './calculator-config.js';
import { getConfig } from './calculator-config-store.js';
import { el } from './calculator-render.js';
import { scaleRecipe } from './calculator-dough-math.js';
import { buildRecipeText } from './calculator-recipe-text.js';

export function showResult(id) { const e = document.getElementById(id); if (e) e.classList.add('visible'); }
export function hideResult(id) { const e = document.getElementById(id); if (e) e.classList.remove('visible'); }

// Reads a quantity input/select by id; 0 when absent or empty. Works for <input>/<select>.
function qtyOf(id) {
  const e = document.getElementById(id);
  return e ? (+e.value || 0) : 0;
}

// Extra dough for a recipe: a free amount in g/kg added on top (orders/both logics).
// 0 when the box is hidden for this recipe or the element does not exist (e.g. a
// 'total' recipe, which has no extra box).
export function extraDoughGramsFor(recipeId) {
  if (!isExtraDoughEnabled(getConfig(), recipeId)) return 0;
  const valEl = document.getElementById(recipeId + '-extra');
  if (!valEl) return 0;
  const unitEl = document.getElementById(recipeId + '-extra-unit');
  return doughExtraGrams(valEl.value, unitEl ? unitEl.value : 'g');
}

// The typed total (grams) for a 'total'/'both' recipe; 0 when the field is absent.
function totalInputFor(recipeId) {
  const e = document.getElementById(recipeId + '-total-input');
  return e ? Math.max(0, +e.value || 0) : 0;
}

// The leavening % in effect: the knob value when the recipe shows a knob, otherwise
// the recipe's default %.
function leaveningPctFor(recipe) {
  if (showsLeaveningKnob(recipe)) {
    const e = document.getElementById(recipe.id + '-param');
    if (e && e.value !== '') return +e.value || recipe.leaveningDefaultPct || 0;
  }
  return recipe.leaveningDefaultPct || 0;
}

// ── Per-recipe UI state (keyed by recipe id) ──────────────────────────────────
// `revealed` is whether a recipe's result card is shown (after the first Confirm).
const revealed = {};
export function markRevealed(id) {
  revealed[id] = true;
  try { localStorage.setItem('revealed-' + id, '1'); } catch (e) {}
}
export function clearRevealed(id) {
  revealed[id] = false;
  try { localStorage.removeItem('revealed-' + id); } catch (e) {}
}
export function restoreRevealed(id) {
  if (localStorage.getItem('revealed-' + id) === '1') revealed[id] = true;
}

// Confirm/Edit lock: a confirmed recipe greys its inputs and swaps Confirm for Edit;
// `logId` ties it to the log it confirmed so the next Confirm updates that same log.
const lockState = {};
export function getLock(id) { return lockState[id] || { locked: false, logId: null }; }

// Whether a recipe has something to confirm (target raw grams > 0).
function recipeReady(recipe) {
  return computeRecipeTarget(getConfig(), recipe, {
    getQty: qtyOf, extraGrams: extraDoughGramsFor(recipe.id), totalInput: totalInputFor(recipe.id),
  }) > 0;
}

// Reflect a recipe's lock state in its tab: grey/disable inputs when locked, and show
// the right control (Confirm when ready & unlocked, Edit when locked, neither otherwise).
export function applyTabState(id) {
  const recipe = getRecipeById(getConfig(), id);
  if (!recipe) return;
  const locked = getLock(id).locked;
  const ready = recipeReady(recipe);
  const root = document.getElementById('tab-' + id);
  if (root) {
    // The divisor is deliberately NOT in this list. Locking exists so the confirmed
    // quantities cannot drift away from the log that was saved from them; the divisor
    // is not a quantity, it is a display-only crate split that touches neither the
    // recipe nor the log. Disabling it protected nothing and killed it at the one
    // moment it is useful — recipe in hand, dough made, now split it into crates.
    root.querySelectorAll('input[type="number"], select.qty-select, select.extra-unit-select')
      .forEach(elm => { elm.disabled = locked; });
  }
  const dayBox = document.getElementById(id + '-day-confirm');
  const editBtn = document.getElementById(id + '-edit-btn');
  if (dayBox)  dayBox.style.display  = (ready && !locked) ? 'block' : 'none';
  if (editBtn) editBtn.style.display = (ready && locked)  ? 'block' : 'none';
}

export function setLock(id, locked, logId) {
  lockState[id] = { locked: !!locked, logId: logId || null };
  try { localStorage.setItem('lock-' + id, JSON.stringify(lockState[id])); } catch (e) {}
  applyTabState(id);
}

export function clearLock(id) {
  lockState[id] = { locked: false, logId: null };
  try { localStorage.removeItem('lock-' + id); } catch (e) {}
  applyTabState(id);
}

export function restoreLock(id) {
  try {
    const raw = localStorage.getItem('lock-' + id);
    if (raw) { const v = JSON.parse(raw); lockState[id] = { locked: !!v.locked, logId: v.logId || null }; }
  } catch (e) {}
}

// The computed ingredients for each recipe's last calculation: the single source of
// truth shared by the on-screen render and the Copy/WhatsApp export.
const lastRecipe = {};

function renderIngredients(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.textContent = '';
  for (const r of rows) {
    container.appendChild(el('div', { class: 'ing-row' }, [
      el('span', { class: 'ing-name' }, r.name),
      el('span', { class: 'ing-val' }, Math.round(r.grams) + ' g'),
    ]));
  }
}

// ── Divisor box (display-only crate split) ────────────────────────────────────
export function buildDivisorBox(id) {
  const box = document.getElementById(id + '-divisor-box');
  if (!box) return;
  box.textContent = '';
  if (getDivisorProducts(getConfig(), id).length === 0) { box.style.display = 'none'; return; }

  const select = el('select', { id: id + '-divisor-div', class: 'divisor-select', 'aria-label': t('calc.numberOfCrates') });
  for (let n = 0; n <= DIVISOR_MAX; n++) select.appendChild(el('option', { value: String(n) }, String(n)));
  select.addEventListener('change', () => updateDivisorBox(id));

  box.appendChild(el('div', { class: 'divisor-names', id: id + '-divisor-names' }, ''));
  box.appendChild(el('div', { class: 'divisor-row' }, [
    el('span', { class: 'divisor-total', id: id + '-divisor-total' }, '0'),
    el('span', { class: 'divisor-unit' }, 'g'),
    el('span', { class: 'divisor-sym' }, '÷'),
    select,
    el('span', { class: 'divisor-eq' }, '='),
    el('span', { class: 'divisor-result', id: id + '-divisor-result' }, '0'),
    el('span', { class: 'divisor-unit' }, 'g'),
  ]));
  updateDivisorBox(id);
}

export function updateDivisorBox(id) {
  const box = document.getElementById(id + '-divisor-box');
  if (!box) return;
  const namesEl = document.getElementById(id + '-divisor-names');
  if (!namesEl) { box.style.display = 'none'; return; }

  const active = getDivisorProducts(getConfig(), id).filter(p => qtyOf(p.qtyId) > 0);
  if (active.length === 0) { box.style.display = 'none'; return; }
  box.style.display = '';

  const names = [];
  for (const p of active) if (!names.includes(p.name)) names.push(p.name);
  namesEl.textContent = names.join(', ');

  const total = divisorTotal(getConfig(), id, qtyOf);
  const divEl = document.getElementById(id + '-divisor-div');
  const n = divEl ? (+divEl.value || 0) : 0;
  document.getElementById(id + '-divisor-total').textContent = Math.round(total);
  document.getElementById(id + '-divisor-result').textContent = Math.round(splitDough(total, n));
}

// Crate boxes: one per association that opted in and has a quantity.
function renderCrateBoxes(id) {
  const wrap = document.getElementById(id + '-crate-boxes');
  if (!wrap) return;
  wrap.textContent = '';
  for (const p of getTabProducts(getConfig(), id)) {
    if (!isCrateEnabled(p)) continue;
    const qty = qtyOf(p.qtyId);
    if (qty <= 0) continue;
    const perBox = getCratePerBox(p);
    const crates = crateCount(qty, perBox);
    wrap.appendChild(el('div', { class: 'crate-box' }, [
      el('div', { class: 'crate-box-title' }, p.name),
      el('div', { class: 'crate-count' }, [
        el('span', { class: 'crate-count-val' }, String(Math.round(crates * 10) / 10)),
        el('span', { class: 'crate-count-unit' }, ' box'),
      ]),
      el('div', { class: 'crate-sub' }, (perBox * p.weight) + 'g each box'),
    ]));
  }
}

// The generic calculation for one recipe: compute the target by logic, scale the
// recipe to it, render the ingredients, badge, total, divisor and crate boxes.
export function calc(id) {
  const config = getConfig();
  const recipe = getRecipeById(config, id);
  if (!recipe) return;

  const target = computeRecipeTarget(config, recipe, {
    getQty: qtyOf, extraGrams: extraDoughGramsFor(id), totalInput: totalInputFor(id),
  });
  const resultId = id + '-result';
  if (target <= 0) {
    hideResult(resultId);
    applyTabState(id);
    return;
  }

  const pct = leaveningPctFor(recipe);
  const spec = recipeSpec(recipe);
  if (recipe.logic === 'total') spec.leaveningKey = null; // pure pro-rata, no leavening adjust
  const scaled = scaleRecipe(spec, target, pct);
  const rows = recipe.ingredients.map((ing, i) => ({ name: ing.label, grams: scaled[i] || 0 }));
  renderIngredients(id + '-ingredients', rows);
  lastRecipe[id] = { rows, totalG: Math.round(target), name: recipe.name };

  const disp = document.getElementById(id + '-param-display');
  if (disp) disp.textContent = pct;
  const badge = document.getElementById(id + '-badge');
  if (badge) badge.textContent = Math.round(target) + ' g raw';
  const totalEl = document.getElementById(id + '-total');
  if (totalEl) totalEl.textContent = Math.round(target);

  updateDivisorBox(id);
  renderCrateBoxes(id);
  applyTabState(id);
  if (revealed[id]) showResult(resultId); else hideResult(resultId);
}

// Recipe text for the Copy/WhatsApp export, from the in-memory ingredient model.
function recipeTextFor(id) {
  const model = lastRecipe[id];
  if (!model) return '';
  return buildRecipeText(model.name, model.rows, model.totalG);
}

export function copyRecipe(id) {
  const btn = document.getElementById(id + '-copy-btn');
  navigator.clipboard.writeText(recipeTextFor(id)).then(() => {
    if (!btn) return;
    btn.textContent = t('calc.copied');
    setTimeout(() => { btn.textContent = t('calc.copyRecipe'); }, 2000);
  });
}

export function shareRecipeWA(id) {
  window.open('https://wa.me/?text=' + encodeURIComponent(recipeTextFor(id)), '_blank');
}
