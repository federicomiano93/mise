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
import { isLinked } from './calculator-recipe-source.js';
import { effectiveRecipe } from './calculator-catalogue-link.js';
import { withRowIds } from './catalogue/guided-model.js';
import { getCatalogueRecipesOnce, stampRecipeRowIds } from './firebase.js';

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
    // ⚠️ A LINKED RECIPE KEEPS ITS INGREDIENTS IN THE CATALOGUE. Demanding them
    // here would refuse to save every tab the moment it was linked — the guard
    // would fire on the very change it is meant to allow.
    if (isLinked(rs[i])) continue;
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

  // ── How it calculates: three rows, each explaining itself ───────────────────
  //
  // ⚠️ A DROPDOWN CAN ONLY EXPLAIN THE OPTION ALREADY CHOSEN, and the question
  // here is what the DIFFERENCE is. Opened side by side, the three answers can be
  // compared BEFORE deciding rather than after.
  //
  // ⚠️ AND A TOOLTIP WAS NEVER AN OPTION: hovering needs a mouse, and an open
  // dropdown on a phone is drawn by the operating system, so the app cannot put a
  // word inside it. That would be an explanation invisible exactly where the app
  // is used — the v236 lesson, "Chromium is not the phone".
  const logicField = el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.howItCalculates')),
  ]);
  const current = LOGICS.includes(r.logic) ? r.logic : 'orders';
  LOGICS.forEach(l => {
    const chosen = l === current;
    const row = el('button', {
      type: 'button',
      class: 'cp-choice' + (chosen ? ' cp-choice--on' : ''),
      'aria-pressed': String(chosen),
    }, [
      el('span', { class: 'cp-choice-name' }, LOGIC_LABELS[l]),
      el('span', { class: 'cp-choice-why' }, t(`calc.logicHint.${l}`)),
    ]);
    row.addEventListener('click', () => {
      if (r.logic === l) return;
      r.logic = l;
      markDirty();
      renderEditor();
    });
    logicField.appendChild(row);
  });
  content.appendChild(logicField);

  // Ingredients.
  // Where this recipe's ingredients come from: its own list, or the Catalogue.
  content.appendChild(sourceBox(r));

  const showLeaveningPicker = (r.logic === 'orders' || r.logic === 'both');
  const linked = isLinked(r);
  const resolved = effectiveRecipe(r);

  const ingField = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, 'Ingredients')]);

  if (linked) {
    // ⚠️ READ-ONLY, AND THAT IS THE POINT (Federico, 14 Aug 2026): the recipe is
    // edited in the Catalogue and nowhere else. Two screens that can both change
    // the same amounts is exactly the disagreement this whole change removes.
    if (resolved.problem) {
      ingField.appendChild(el('p', { class: 'cp-hint cp-source-problem' },
        problemText(resolved)));
    } else {
      resolved.ingredients.forEach(ing => {
        ingField.appendChild(el('div', { class: 'cp-prod-card cp-readonly-row' }, [
          el('span', { class: 'cp-readonly-name' }, ing.label),
          el('span', { class: 'cp-readonly-grams' }, String(ing.grams) + ' g'),
        ]));
      });
      ingField.appendChild(el('div', { class: 'cp-hint' }, t('calc.editedInCatalogue')));
    }
  } else {
    r.ingredients.forEach((ing, gi) => ingField.appendChild(ingredientRow(r, ing, gi, listId, showLeaveningPicker)));
    const addIng = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addIngredient'));
    addIng.addEventListener('click', () => {
      r.ingredients.push({ key: '', label: '', grams: 0 });
      markDirty();
      renderEditor();
    });
    ingField.appendChild(addIng);
  }
  content.appendChild(ingField);

  // ── Leavening: ONE bounded box ──────────────────────────────────────────────
  //
  // ⚠️ IT USED TO BE A TICK ON EVERY INGREDIENT ROW. Choosing which ingredient is
  // the yeast meant scanning N checkboxes — NINE of them on the real focaccia —
  // and the box below only appeared AFTER one was ticked, so the setting was
  // split across two places a screen apart. A dropdown is one control, in one
  // place, that also says what the current answer IS without hunting for a tick.
  if (showLeaveningPicker) {
    content.appendChild(leaveningBox(r));
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
  // ⚠️ THE LEAVENING DROPDOWN HAS TO FOLLOW THIS FIELD AS IT IS TYPED, and the old
  // tick did not need to because it sat ON this row. Moving the picker into its
  // own box put the ingredient's NAME and the list of names in two places, and the
  // list is only built when the editor re-renders — which typing deliberately does
  // NOT do, or the field would lose focus after every keystroke. Without this, you
  // name an ingredient and the dropdown still offers "Unnamed ingredient".
  //
  // Found by looking at the screenshot: the driver picked the yeast by name and
  // got "Nothing rises in this recipe", because the name it searched for was not
  // in the list yet.
  nameInput.addEventListener('input', () => {
    ing.label = nameInput.value;
    nameInput.classList.remove('cp-invalid');
    syncLeaveningOption(ing, gi);
    markDirty();
  });

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

  // ⚠️ THE "this is the leavening" TICK IS GONE FROM HERE, and that is the point
  // of this change. It was one checkbox on EVERY row — nine on the real focaccia —
  // to answer a question with exactly one answer. It now lives once, as a
  // dropdown, in the Leavening box below the ingredient list (see leaveningBox).
  //
  // A row that IS the leavening says so quietly, so the answer is still visible
  // where the ingredients are, without being editable in two places.
  if (showLeaveningPicker && ing.key && recipe.leaveningKey === ing.key) {
    rows.push(el('div', { class: 'cp-hint cp-is-leavening' }, t('calc.thisIsTheLeavening')));
  }

  return el('div', { class: 'cp-prod-card' }, rows);
}

// ── The Leavening box ────────────────────────────────────────────────────────
//
// One bounded block holding the three things that belong together: WHICH
// ingredient is the leavening, what percentage a phone starts from, and whether
// the tab shows the knob at all.
//
// ⚠️⚠️ THE PERCENTAGE STAYS, AND THAT IS A DELIBERATE DEPARTURE FROM THE PLAN,
// which said to remove it as a duplicate of the knob in the tab. It is NOT a
// duplicate: the knob is saved per PHONE (localStorage `param-<recipeId>`, added
// in v233), while this number lives in Firestore and is the value EVERY phone
// starts from — a new device, or one that has had its data cleared, has nothing
// else to read. Remove it and the shared starting point can never be corrected
// again: the real Sourdough would sit at 18% for ever on every new phone, with
// no screen anywhere able to change it.
//
// What the plan was right about is the duplication of EFFORT, and that is fixed
// by saying plainly which number is which.
function leaveningBox(recipe) {
  // ⚠️ WHEN LINKED, THE ROWS COME FROM THE CATALOGUE and the choice is stored as
  // leaveningRid — the row's own id. Offering the tab's own leftover list here
  // would let somebody pick an ingredient the dough no longer contains.
  const src = effectiveRecipe(recipe);
  const linkedRows = isLinked(recipe) ? src.ingredients : null;
  const rows = [el('label', { class: 'cp-label' }, t('calc.leavening'))];

  // ⚠️ THE EMPTY OPTION IS FIRST AND IS A REAL ANSWER. A recipe may legitimately
  // have no leavening (nothing rises), and without it the only way back from a
  // wrong choice would be to pick a different wrong one.
  const select = el('select', { class: 'cp-prod-dough', 'aria-label': t('calc.leavening') });
  select.appendChild(el('option', { value: '' }, t('calc.leaveningNone')));
  (linkedRows || recipe.ingredients).forEach((ing, i) => {
    // An ingredient with no key cannot be pointed at yet; it gets one the moment
    // it is chosen, exactly as the old tick did.
    const value = ing.key || `#${i}`;
    const option = el('option', { value }, ing.label || t('calc.unnamedIngredient'));
    select.appendChild(option);
  });
  select.value = (linkedRows ? recipe.leaveningRid : recipe.leaveningKey) || '';

  select.addEventListener('change', () => {
    const picked = select.value;
    if (!picked) {
      if (linkedRows) recipe.leaveningRid = null; else recipe.leaveningKey = null;
    } else {
      const index = picked.startsWith('#') ? Number(picked.slice(1)) : -1;
      const ing = index >= 0 ? recipe.ingredients[index]
        : recipe.ingredients.find(i => i.key === picked);
      if (ing) {
        if (!ing.key) {
          ing.key = (ing.label || 'ing').toLowerCase().replace(/[^a-z0-9]+/g, '-')
            + '-' + recipe.ingredients.indexOf(ing);
        }
        if (linkedRows) recipe.leaveningRid = ing.key; else recipe.leaveningKey = ing.key;
        if (!recipe.leaveningDefaultPct) recipe.leaveningDefaultPct = 1;
        if (recipe.baselinePct == null) recipe.baselinePct = recipe.leaveningDefaultPct;
      }
    }
    markDirty();
    renderEditor();
  });

  rows.push(select);
  // ⚠️ A LINE THAT EXPLAINS, NOT A TOOLTIP. Hovering needs a mouse, and the open
  // dropdown is drawn by the phone's own operating system — the app cannot put a
  // word inside it. .cp-hint is the app's existing explanation line.
  rows.push(el('div', { class: 'cp-hint' }, t('calc.leaveningHint')));

  // The rest of the box only means anything once something IS the leavening.
  if (recipe.leaveningKey) {
    const pct = el('input', {
      class: 'cp-prod-weight', type: 'number', min: '0', max: '100', step: '0.05',
      value: String(recipe.leaveningDefaultPct || 0), inputmode: 'decimal',
    });
    pct.addEventListener('input', () => {
      recipe.leaveningDefaultPct = +pct.value || 0;
      markDirty();
    });

    const showCb = el('input', { type: 'checkbox' });
    showCb.checked = recipe.showLeavening !== false;
    showCb.addEventListener('change', () => {
      recipe.showLeavening = showCb.checked;
      markDirty();
      renderEditor();
    });

    rows.push(el('div', { class: 'cp-prod-card-row' }, [
      el('span', { class: 'cp-unit' }, t('calc.leaveningStartAt')), pct,
      el('span', { class: 'cp-unit' }, '%'),
    ]));
    // ⚠️ THE HINT CHANGES WITH THE ANSWER. With the knob on, this number is where
    // every phone STARTS; with it off, it is the only number there is. Saying so
    // is what makes keeping the field honest rather than confusing.
    rows.push(el('div', { class: 'cp-hint' }, recipe.showLeavening !== false
      ? t('calc.leaveningPctHintKnob')
      : t('calc.leaveningPctHintFixed')));

    rows.push(el('label', { class: 'cp-crate-label' },
      [showCb, el('span', {}, t('calc.showTheAdjustKnob'))]));
    rows.push(el('div', { class: 'cp-hint' }, t('calc.leaveningKnobHint')));
  }

  return el('div', { class: 'cp-field cp-leavening' }, rows);
}

// Keep one option's words in step with the row being typed into, WITHOUT
// re-rendering — a re-render here would take the focus out of the field after
// every keystroke. The option is found by the same value leaveningBox() gave it.
function syncLeaveningOption(ing, index) {
  const select = document.querySelector('.cp-leavening select');
  if (!select) return;
  const value = ing.key || `#${index}`;
  const option = [...select.options].find(o => o.value === value);
  if (option) option.textContent = ing.label || t('calc.unnamedIngredient');
}

// ── Where a tab's ingredients come from ──────────────────────────────────────
//
// Federico, 14 Aug 2026: «calculator non ha più ricette proprie ma le prende da
// recipe catalogue». One recipe, in one place, edited in one screen.
//
// ⚠️ THE LIST OF CATALOGUE RECIPES IS READ WHEN THIS SCREEN IS OPENED, ONCE. Rare
// and deliberate — never on the app's boot path, where it would be the v207 cost
// mistake again.
let catalogueList = null;

function sourceBox(recipe) {
  const rows = [el('label', { class: 'cp-label' }, t('calc.recipeSource'))];
  const linked = isLinked(recipe);

  const select = el('select', { class: 'cp-prod-dough', 'aria-label': t('calc.recipeSource') });
  select.appendChild(el('option', { value: '' }, t('calc.sourceOwn')));
  (catalogueList || []).forEach(c => {
    select.appendChild(el('option', { value: c.id }, c.name || t('calc.unnamedRecipe')));
  });
  select.value = linked ? String(recipe.catalogueId) : '';

  select.addEventListener('change', () => link(recipe, select.value));
  rows.push(select);
  rows.push(el('div', { class: 'cp-hint' }, linked
    ? t('calc.sourceLinkedHint')
    : t('calc.sourceOwnHint')));

  // The names arrive after the first paint; repaint once they do.
  if (catalogueList === null) {
    catalogueList = [];
    getCatalogueRecipesOnce()
      .then(list => { catalogueList = list; renderEditor(); })
      .catch(err => console.warn('The Catalogue could not be listed:', err));
  }

  return el('div', { class: 'cp-field' }, rows);
}

// ⚠️ LINKING STAMPS A STABLE id ON EVERY CATALOGUE ROW FIRST, and that order is
// the whole reason this is not a one-line assignment. The twelve recipes in the
// Catalogue carry no row ids — they predate the guided-mixing work that mints
// them on save — and the Calculator finds the leavening BY that id. Without this
// step the leavening would fall straight back to matching by NAME, which is the
// defect being designed out: the real Sourdough calls it "Starter" in one place
// and "Sourdough starter" in the other.
//
// withRowIds is idempotent, so a recipe already carrying ids is untouched.
async function link(recipe, catalogueId) {
  if (!catalogueId) {
    // ⚠️ UNLINKING LEAVES THE TAB WITH NOTHING RATHER THAN A STALE COPY. Its own
    // ingredient list was left behind when it was linked; silently resurrecting
    // it would bring back exactly the copy this change removed.
    delete recipe.catalogueId;
    delete recipe.leaveningRid;
    markDirty();
    renderEditor();
    return;
  }

  const source = (catalogueList || []).find(c => c.id === catalogueId);
  if (!source) return;

  try {
    const stamped = withRowIds(Array.isArray(source.ingredients) ? source.ingredients : []);
    await stampRecipeRowIds(catalogueId, stamped);
    source.ingredients = stamped;
  } catch (err) {
    console.error('Could not give the Catalogue rows stable ids:', err);
    alertDialog(t('calc.sourceLinkFailed'));
    return;
  }

  recipe.catalogueId = catalogueId;
  // The leavening has to be chosen again: it now points at a row in a different
  // recipe, and guessing by name is the thing being avoided.
  delete recipe.leaveningRid;
  markDirty();
  renderEditor();
}

function problemText(resolved) {
  if (resolved.problem === 'unweighable') {
    return t('calc.sourceUnweighable', { row: resolved.problemRow });
  }
  if (resolved.problem === 'empty') return t('calc.sourceEmpty');
  return t('calc.sourceMissing');
}
