// recipes.js — the Recipes editor (#recipe-overlay), now editing config.recipes[].
//
// Recipes are the base of the calculator. This editor manages the full list: add a
// new (empty) recipe, edit one (name, calc logic, ingredients with autocomplete from
// the ingredient registry, the designated leavening + its default % and show-knob
// flag, and whether it appears as a calculator tab — max 4), or delete one (blocked
// while products still point at it).
//
// It works on a deep copy of the live config and touches nothing until Save (with a
// confirm), which persists through the config store (Firestore + cache) and re-renders
// the calculator. Required fields are validated on Save. Recipes are SHARED (in
// config), no longer device-local localStorage.

import { t } from './i18n.js';
import { confirmDiscard } from './calculator-confirm.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { recipeTotal } from './calculator-dough-math.js';
import { getConfig, saveConfig } from './calculator-config-store.js';
import {
  cloneConfig, getRecipes, getIngredients, getProducts, LOGICS, MAX_VISIBLE_RECIPES,
} from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';

// recipeTotal is re-exported so any importer keeps its path unchanged.
export { recipeTotal };

const LOGIC_LABELS = { orders: t('calc.fromOrders'), total: t('calc.fromATotal'), both: t('calc.bothOrdersTotal') };

let working = null;       // deep copy being edited
let activeRecipe = null;  // null = the recipe list, an index = a recipe's detail
let freshlyAdded = false;
let showErrors = false;
let dirty = false;

function genId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }
function isBlank(s) { return !s || !String(s).trim(); }

function titleEl() { return document.querySelector('#recipe-overlay .recipe-overlay-title'); }
function contentEl() { return document.getElementById('recipe-content'); }
function recipes() {
  if (!Array.isArray(working.recipes)) working.recipes = [];
  return working.recipes;
}

function setHomeVisible(visible) {
  const btn = document.getElementById('recipe-home-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

function markDirty() { dirty = true; }

// How many products point at a recipe (the delete guard).
function productCountFor(recipeId) {
  return getProducts(working).filter(p => p.recipeId === recipeId).length;
}
// How many recipes are currently flagged visible (the ≤4 guard).
function visibleCount() { return recipes().filter(r => r.visible !== false).length; }

export function openRecipes() {
  working = cloneConfig(getConfig());
  activeRecipe = null;
  freshlyAdded = false;
  showErrors = false;
  dirty = false;
  renderEditor();
  document.getElementById('recipe-overlay').classList.add('visible');
}

function isEmptyRecipe(r) {
  return !r || (isBlank(r.name) && (!r.ingredients || r.ingredients.length === 0));
}

export async function closeRecipes() {
  if (activeRecipe !== null) {
    const r = recipes()[activeRecipe];
    if (freshlyAdded && isEmptyRecipe(r)) {
      if (!(await confirmDialog({ message: t('calc.discardThisNewRecipe'), okLabel: 'Discard', danger: true }))) return;
      recipes().splice(activeRecipe, 1);
    }
    freshlyAdded = false;
    activeRecipe = null;
    renderEditor();
    return;
  }
  if (!(await confirmDiscard(dirty))) return;
  document.getElementById('recipe-overlay').classList.remove('visible');
}

export async function goHomeFromRecipes() {
  if (!(await confirmDiscard(dirty))) return;
  window.location.href = 'index.html';
}

function renderEditor() {
  if (activeRecipe === null) renderRecipeList();
  else renderRecipeDetail(activeRecipe);
}

function deleteIcon(label, onDelete) {
  const btn = el('button', { class: 'cp-del-icon', type: 'button', 'aria-label': label }, icon('trash', 17));
  btn.addEventListener('click', onDelete);
  return btn;
}

// First recipe with a blank name or no named ingredient, or null if all are complete.
function findInvalid() {
  const rs = recipes();
  for (let i = 0; i < rs.length; i++) {
    if (isBlank(rs[i].name)) return i;
    const ings = rs[i].ingredients || [];
    if (ings.length === 0 || ings.some(g => isBlank(g.label))) return i;
  }
  return null;
}

async function saveRecipes() {
  const invalid = findInvalid();
  if (invalid !== null) {
    showErrors = true;
    activeRecipe = invalid;
    renderEditor();
    alertDialog(t('calc.pleaseGiveEveryRecipe'));
    return;
  }
  if (!(await confirmDialog({ message: t('calc.saveTheseChanges'), okLabel: 'Save' }))) return;
  try {
    await saveConfig(working);
    showErrors = false;
    dirty = false;
    freshlyAdded = false;
    activeRecipe = null;
    // Re-sync from the normalised, saved config (ids/keys may have been tidied).
    working = cloneConfig(getConfig());
    renderEditor();
    document.dispatchEvent(new CustomEvent('recipes-saved'));
  } catch (e) {
    alertDialog(t('calc.couldNotSaveCheck'));
  }
}

// ── Level 0: the recipe list ───────────────────────────────────────────────────
function renderRecipeList() {
  titleEl().textContent = 'Recipes';
  setHomeVisible(true);
  const content = contentEl();
  content.textContent = '';
  content.appendChild(el('p', { class: 'extra-help' },
    t('calc.yourRecipesTheBase') + MAX_VISIBLE_RECIPES + t('calc.canShowAsCalculator')));

  recipes().forEach((r, ri) => {
    const ings = (r.ingredients || []).length;
    const sub = LOGIC_LABELS[r.logic] + '  ·  ' + ings + (ings === 1 ? ' ingredient' : ' ingredients')
      + (r.visible !== false ? t('calc.shown') : t('calc.hidden'));
    const open = el('button', { class: 'drill-item wa-entry-open', type: 'button' }, [
      el('span', { class: 'wa-entry-text' }, [
        el('span', { class: 'wa-entry-name' }, r.name || t('calc.unnamedRecipe')),
        el('span', { class: 'wa-entry-sub' }, sub),
      ]),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    open.addEventListener('click', () => { freshlyAdded = false; activeRecipe = ri; renderEditor(); });
    const del = deleteIcon(t('calc.deleteRecipe'), () => deleteRecipe(ri));
    content.appendChild(el('div', { class: 'wa-entry-card' }, [open, del]));
  });

  const add = el('button', { class: 'cp-add-client', type: 'button' }, t('calc.addRecipe'));
  add.addEventListener('click', () => {
    recipes().push({
      id: genId('r'), name: '', logic: 'orders', ingredients: [],
      leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null,
      order: recipes().length, visible: visibleCount() < MAX_VISIBLE_RECIPES,
    });
    markDirty();
    freshlyAdded = true;
    activeRecipe = recipes().length - 1;
    renderEditor();
  });
  content.appendChild(add);

  // The list itself can be saved (e.g. after a delete or a visibility change).
  const save = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save');
  save.addEventListener('click', saveRecipes);
  content.appendChild(save);
}

async function deleteRecipe(ri) {
  const r = recipes()[ri];
  const used = productCountFor(r.id);
  if (used > 0) {
    alertDialog(t('calc.thisRecipeIsUsed') + used + (used === 1 ? ' product' : ' products') + '. Reassign or delete them in Settings → Products first.');
    return;
  }
  if (!(await confirmDialog({ message: t('calc.deleteThe') + (r.name || 'this') + t('calc.recipe'), okLabel: 'Delete', danger: true }))) return;
  recipes().splice(ri, 1);
  markDirty();
  activeRecipe = null;
  renderEditor();
}

// ── Level 1: a recipe's detail ─────────────────────────────────────────────────
function renderRecipeDetail(ri) {
  const r = recipes()[ri];
  if (!Array.isArray(r.ingredients)) r.ingredients = [];
  titleEl().textContent = t('calc.editRecipe');
  setHomeVisible(false);
  const content = contentEl();
  content.textContent = '';

  // Shared datalist for ingredient-name autocomplete (from the registry).
  const listId = 'ingredient-names';
  const datalist = el('datalist', { id: listId });
  for (const ing of getIngredients(working)) datalist.appendChild(el('option', { value: ing.name }));
  content.appendChild(datalist);

  // Name + delete.
  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: r.name || '', placeholder: t('calc.recipeName') });
  if (showErrors && isBlank(r.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { r.name = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.recipeName')),
    el('div', { class: 'cp-name-row' }, [nameInput, deleteIcon(t('calc.deleteRecipe'), () => deleteRecipe(ri))]),
  ]));

  // Calc logic.
  const logic = el('select', { class: 'cp-prod-dough', 'aria-label': t('calc.calcLogic') });
  for (const l of LOGICS) logic.appendChild(el('option', { value: l }, LOGIC_LABELS[l]));
  logic.value = LOGICS.includes(r.logic) ? r.logic : 'orders';
  logic.addEventListener('change', () => { r.logic = logic.value; markDirty(); renderEditor(); });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.howItCalculates')),
    logic,
  ]));

  // Ingredients.
  const ingField = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Ingredients')]);
  const showLeaveningPicker = (r.logic === 'orders' || r.logic === 'both');
  r.ingredients.forEach((ing, gi) => ingField.appendChild(ingredientRow(r, ing, gi, listId, showLeaveningPicker)));
  const addIng = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addIngredient'));
  addIng.addEventListener('click', () => {
    r.ingredients.push({ key: '', label: '', grams: 0 });
    markDirty();
    renderEditor();
  });
  ingField.appendChild(addIng);
  content.appendChild(ingField);

  // Leavening default % + show-knob (only when a leavening is designated and the
  // logic uses orders/both).
  if (showLeaveningPicker && r.leaveningKey) {
    const pct = el('input', {
      class: 'cp-prod-weight', type: 'number', min: '0', max: '100', step: '0.05',
      value: String(r.leaveningDefaultPct || 0), inputmode: 'decimal',
    });
    pct.addEventListener('input', () => { r.leaveningDefaultPct = +pct.value || 0; markDirty(); });
    const showCb = el('input', { type: 'checkbox' });
    showCb.checked = r.showLeavening !== false;
    showCb.addEventListener('change', () => { r.showLeavening = showCb.checked; markDirty(); });
    content.appendChild(el('div', { class: 'cp-field' }, [
      el('label', { class: 'cp-label' }, 'Leavening'),
      el('div', { class: 'cp-prod-card-row' }, [el('span', { class: 'cp-unit' }, 'Default'), pct, el('span', { class: 'cp-unit' }, '%')]),
      el('label', { class: 'cp-crate-label' }, [showCb, el('span', {}, t('calc.showTheAdjustKnob'))]),
    ]));
  }

  // Show as a calculator tab (≤4).
  const visCb = el('input', { type: 'checkbox' });
  visCb.checked = r.visible !== false;
  visCb.addEventListener('change', () => {
    if (visCb.checked && r.visible === false && visibleCount() >= MAX_VISIBLE_RECIPES) {
      visCb.checked = false;
      alertDialog('Only ' + MAX_VISIBLE_RECIPES + t('calc.recipesCanShowAs'));
      return;
    }
    r.visible = visCb.checked;
    markDirty();
  });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-crate-label' }, [visCb, el('span', {}, t('calc.showAsACalculator') + MAX_VISIBLE_RECIPES + ')')]),
  ]));

  const save = el('button', { class: 'cp-save-bottom', type: 'button' }, 'Save');
  save.addEventListener('click', saveRecipes);
  content.appendChild(save);
}

// One ingredient row: name (autocomplete) + grams + optional "leavening" radio + remove.
function ingredientRow(recipe, ing, gi, listId, showLeaveningPicker) {
  const nameInput = el('input', { class: 'cp-prod-name', type: 'text', value: ing.label || '', placeholder: 'Ingredient', list: listId });
  if (showErrors && isBlank(ing.label)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { ing.label = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });

  const grams = el('input', {
    class: 'cp-prod-weight', type: 'number', min: '0', step: '0.1',
    value: String(ing.grams != null ? ing.grams : 0), inputmode: 'decimal',
  });
  grams.addEventListener('input', () => { ing.grams = +grams.value || 0; markDirty(); });

  const del = deleteIcon(t('calc.removeIngredient'), () => {
    if (recipe.leaveningKey && recipe.leaveningKey === ing.key) recipe.leaveningKey = null;
    recipe.ingredients.splice(gi, 1);
    markDirty();
    renderEditor();
  });

  const rows = [
    el('div', { class: 'cp-prod-card-head' }, [nameInput, del]),
    el('div', { class: 'cp-prod-card-row' }, [grams, el('span', { class: 'cp-unit' }, 'g')]),
  ];

  // Designate this ingredient as the leavening (yeast/starter) for orders/both logics.
  if (showLeaveningPicker) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!(recipe.leaveningKey && recipe.leaveningKey === ing.key && ing.key);
    cb.addEventListener('change', () => {
      // Ensure this ingredient has a stable key to reference.
      if (!ing.key) ing.key = (ing.label || 'ing').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + gi;
      if (cb.checked) {
        recipe.leaveningKey = ing.key;
        if (!recipe.leaveningDefaultPct) recipe.leaveningDefaultPct = 1;
        if (recipe.baselinePct == null) recipe.baselinePct = recipe.leaveningDefaultPct;
      } else if (recipe.leaveningKey === ing.key) {
        recipe.leaveningKey = null;
      }
      markDirty();
      renderEditor();
    });
    rows.push(el('label', { class: 'cp-crate-label' }, [cb, el('span', {}, t('calc.thisIsTheLeavening'))]));
  }

  return el('div', { class: 'cp-prod-card' }, rows);
}
