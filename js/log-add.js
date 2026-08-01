// log-add.js — manual log creation from inside the Log section ("+ Add log"). Lets
// the user pick a recipe, enter quantities (and/or a typed total, by the recipe's
// logic), choose Today/Tomorrow and save a brand-new log exactly like a calculator
// Confirm would (same generic buildSheet + createAndSave). Independent of the
// calculator screen — the recipe and the log stay separate.

import { el } from './calculator-render.js';
import { getConfig } from './calculator-config-store.js';
import { getRecipes, getRecipeById, getTabProducts, getDivisorIncluded } from './calculator-config.js';
import { logTimestamp } from './log-time.js';
import { confirmDiscard } from './calculator-confirm.js';
import { buildSheet, buildLogText, recipeSnapshot } from './log-model.js';
import { createAndSave } from './log-store.js';
import { qtyRow } from './log-qty.js';
import { confirmDialog } from './confirm-dialog.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

let state = null; // { recipeId, forDay, items[], totalInput } or null when closed

export function openLogAdd() {
  state = { recipeId: null, forDay: null, items: [], totalInput: 0 };
  render();
  updateSaveBtn();
  document.getElementById('logadd-overlay').classList.add('visible');
}

function isDirty() {
  if (!state) return false;
  return !!(state.recipeId || state.forDay || num(state.totalInput) > 0 || state.items.some(it => num(it.qty) > 0));
}

async function close(saved) {
  if (!saved && !(await confirmDiscard(isDirty()))) return;
  document.getElementById('logadd-overlay').classList.remove('visible');
  state = null;
}

// Load the chosen recipe's products (quantities start at 0). 'total' recipes have no
// products — only a typed total.
function loadRecipe(id) {
  const recipe = getRecipeById(getConfig(), id);
  state.recipeId = id;
  state.totalInput = 0;
  const hasOrders = recipe && (recipe.logic === 'orders' || recipe.logic === 'both');
  state.items = hasOrders ? getTabProducts(getConfig(), id).map(p => ({
    id: p.id, name: p.name, clientName: p.clientName, weightG: p.weight, kind: p.kind,
    crate: p.crate || { show: false, perBox: 20 }, qty: 0,
  })) : [];
  render();
  updateSaveBtn();
}

function updateSaveBtn() {
  const b = document.getElementById('logadd-save-btn');
  if (!b) return;
  const ready = !!(state && state.recipeId && state.forDay);
  b.disabled = !ready;
  b.classList.toggle('dirty', ready);
}

function render() {
  const c = document.getElementById('logadd-content');
  c.textContent = '';

  // Recipe chooser (required, first).
  c.appendChild(el('div', { class: 'cp-label' }, 'Recipe'));
  const choices = el('div', { class: 'logday-choices' });
  const recipes = getRecipes(getConfig());
  if (!recipes.length) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, 'No recipes yet. Add one in Settings → Recipes.'));
    return;
  }
  for (const r of recipes) {
    const btn = el('button', { class: 'logday-choice' + (state.recipeId === r.id ? ' selected' : ''), type: 'button' }, r.name);
    btn.addEventListener('click', () => loadRecipe(r.id));
    choices.appendChild(btn);
  }
  c.appendChild(choices);

  if (!state.recipeId) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, 'Pick a recipe to enter quantities.'));
    return;
  }
  const recipe = getRecipeById(getConfig(), state.recipeId);
  const hasOrders = recipe && (recipe.logic === 'orders' || recipe.logic === 'both');
  const hasTotal = recipe && (recipe.logic === 'total' || recipe.logic === 'both');

  // Today / Tomorrow (required).
  c.appendChild(el('div', { class: 'cp-label' }, 'When is this dough for?'));
  const dayChoices = el('div', { class: 'logday-choices' });
  for (const d of ['today', 'tomorrow']) {
    const btn = el('button', { class: 'logday-choice' + (state.forDay === d ? ' selected' : ''), type: 'button' }, d === 'today' ? 'Today' : 'Tomorrow');
    btn.addEventListener('click', () => { state.forDay = d; render(); updateSaveBtn(); });
    dayChoices.appendChild(btn);
  }
  c.appendChild(dayChoices);

  // Typed total (total/both logic).
  if (hasTotal) {
    const input = el('input', { type: 'number', class: 'cp-prod-weight', min: '0', step: '1', value: String(num(state.totalInput)), inputmode: 'numeric' });
    input.addEventListener('input', () => { state.totalInput = num(input.value); });
    c.appendChild(el('div', { class: 'cp-field' }, [
      el('label', { class: 'cp-label' }, 'Total dough (g)'),
      el('div', { class: 'cp-prod-card-row' }, [input, el('span', { class: 'cp-unit' }, 'g')]),
    ]));
  }

  // Quantities, grouped by client (orders/both).
  if (hasOrders) {
    c.appendChild(el('div', { class: 'cp-label' }, 'Products — quantities only'));
    if (!state.items.length) c.appendChild(el('div', { class: 'cp-empty-hint' }, 'No products for this recipe.'));
    let lastClient = null;
    let card = null;
    for (const it of state.items) {
      if (it.clientName !== lastClient || card === null) {
        lastClient = it.clientName;
        card = el('div', { class: 'card' }, [el('div', { class: 'card-title' }, it.clientName || 'Client')]);
        c.appendChild(card);
      }
      card.appendChild(qtyRow(it, (q) => { it.qty = q; }));
    }
  }

  const save = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save log');
  save.addEventListener('click', commit);
  c.appendChild(save);
}

// Build and save a brand-new log — same generic math/shape as a calculator Confirm.
async function commit() {
  if (!state || !state.recipeId || !state.forDay) return;
  if (!(await confirmDialog({ message: 'Save this log?', okLabel: 'Save' }))) return;
  const recipe = getRecipeById(getConfig(), state.recipeId);
  if (!recipe) return;
  const items = state.items.map(it => ({
    id: it.id, name: it.name, clientName: it.clientName,
    qty: num(it.qty), weightG: num(it.weightG), kind: it.kind, crate: it.crate,
  }));
  const divisor = { includedIds: getDivisorIncluded(getConfig(), state.recipeId), n: 0 };
  const sheet = buildSheet({
    recipe, items, extraGrams: 0, totalInput: num(state.totalInput),
    leaveningPct: recipe.leaveningDefaultPct, divisor,
  });
  const text = buildLogText(items, [], { grams: 0, value: 0, unit: 'g' });
  const version = {
    calculatedBy: '', at: logTimestamp(), kind: 'create',
    items, occasional: [], sheet, text, recipe: recipeSnapshot(recipe),
  };
  createAndSave({ dough: recipe.name, recipeId: state.recipeId, forDay: state.forDay, version, createdAtMs: Date.now(), origin: 'manual' });
  close(true);
}

// ── Wiring (elements exist in calculator.html) ────────────────────────────────
document.querySelector('.logadd-back-btn').addEventListener('click', () => close(false));
document.getElementById('logadd-save-btn').addEventListener('click', commit);
