// catalogue-editor.js — add / edit / delete a catalogue recipe.
//
// Clones the safe editing pattern from js/recipes.js: work on a COPY, explicit
// confirm-gated Save, required-field validation before saving (jump + highlight),
// low-key Delete with a confirm, discard protection for unsaved edits, and an
// ingredient-name autocomplete built from the other recipes. Persists per document
// to recipes/{id} via the store (not into config).

import { canManageHere } from './firebase-catalogue.js';
import { el } from './dom.js';
import {
  findInvalidRecipe, unitOf, CATALOGUE_UNITS, isWeighableUnit, weighableTotalGrams,
  linkOf, normalizeLossPct, MAX_LOSS_PCT,
} from './catalogue-model.js';
import { openLinkPicker } from './ingredient-picker.js';
import { pricePerKg, formatRate } from '../price-model.js';

// Whole grams, no thousands separator — the same reading as the recipe view.
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

export function renderEditor({ recipe, allRecipes, app }) {
  // Working copy — nothing touches the stored recipe until Save.
  // ⚠️ ...i, NOT a hand-listed set of fields. This copy and cleanWorking() below
  // both rebuild every row, so any field named in neither is dropped on save —
  // which is how opening a recipe to fix a typo would have wiped every ingredient
  // link it had. Spreading the row keeps whatever it carries; only the fields the
  // editor actually edits are overwritten.
  const working = recipe
    ? {
      ...recipe,
      ingredients: recipe.ingredients.map(i => ({ ...i, unit: unitOf(i) })),
    }
    : { id: null, name: '', ingredients: [{ label: '', grams: '', unit: 'g' }], lossPct: 0 };

  let dirty = false;
  let showErrors = false;
  let busy = false; // guards against re-entrant Save/Delete while a confirm is open
  const markDirty = () => { dirty = true; };

  // Autocomplete pool: distinct ingredient names across the catalogue.
  const names = new Set();
  for (const r of allRecipes) {
    for (const ing of (r.ingredients || [])) {
      const n = String(ing.label || '').trim();
      if (n) names.add(n);
    }
  }
  const datalist = el('datalist', { id: 'cat-ingredient-names' },
    [...names].sort((a, b) => a.localeCompare(b)).map(n => el('option', { value: n })));

  const nameInput = el('input', {
    id: 'catRecipeName',
    class: 'cat-name-input', type: 'text', placeholder: 'Recipe name', value: working.name,
    'aria-label': 'Recipe name',
    oninput: (e) => { working.name = e.target.value; markDirty(); if (showErrors) validateUI(); },
  });

  // One ingredient = ONE row (name · amount · unit · remove), inside a single framed
  // list closed by a live Total — the same shape as the read-only recipe, so there is
  // one way to read a recipe, not two. It replaces a layout that gave each ingredient
  // two full-width boxes: 8 ingredients became 16 identical white cards with nothing
  // tying a name to its amount.
  const rowsContainer = el('div', { class: 'cat-ing-editrows' });
  const countEl = el('span', { class: 'cat-ing-count' });
  const totalEl = el('span', { class: 'cat-edit-total-num' });
  const totalNote = el('span', { class: 'cat-edit-total-note' });

  const totalRow = el('div', { class: 'cat-ing-editrow cat-edit-total' }, [
    el('span', { class: 'cat-edit-total-label', text: 'Total' }),
    totalEl,
    el('span', { class: 'cat-edit-total-unit', text: 'g' }),
  ]);

  // The weight the recipe actually adds up to, live as it is typed. Its absence is
  // what let a "Croissant (4 x 3500gr.)" quietly weigh 14153 g instead of 14000.
  // Pieces / to-taste rows carry no weight, so they are excluded — and said to be.
  function updateTotal() {
    totalEl.textContent = nf.format(weighableTotalGrams(working));
    const skipped = working.ingredients
      .filter(i => String(i.label || '').trim() && !isWeighableUnit(unitOf(i))).length;
    totalNote.textContent = skipped
      ? `${skipped} ${skipped === 1 ? 'ingredient is' : 'ingredients are'} not weighed (pieces / to taste) — not in the total`
      : '';
    totalNote.hidden = !skipped;
    countEl.textContent = String(working.ingredients.length);
  }

  function renderIngredientRows() {
    rowsContainer.replaceChildren();
    working.ingredients.forEach((ing, idx) => {
      const labelInput = el('input', {
        class: 'cat-lbl', type: 'text', placeholder: 'Ingredient', value: ing.label,
        list: 'cat-ingredient-names', 'aria-label': 'Ingredient name',
        oninput: (e) => { ing.label = e.target.value; markDirty(); updateTotal(); if (showErrors) validateUI(); },
      });
      const gramsInput = el('input', {
        class: 'cat-grm', type: 'number', min: '0', step: 'any', inputmode: 'decimal',
        placeholder: '0', value: ing.grams === '' || ing.grams === undefined ? '' : ing.grams,
        'aria-label': 'Amount',
        oninput: (e) => { ing.grams = e.target.value; markDirty(); updateTotal(); },
      });
      // Per-ingredient unit (g by default). Reuses the model's whitelist so the
      // editor and the scaling/import logic can never drift apart.
      const unitSelect = el('select', {
        class: 'cat-unit', 'aria-label': 'Unit',
        onchange: (e) => { ing.unit = e.target.value; markDirty(); updateTotal(); },
      }, CATALOGUE_UNITS.map(u => el('option', { value: u }, u)));
      unitSelect.value = unitOf(ing);
      const delIcon = el('button', {
        class: 'cat-del-icon', type: 'button', 'aria-label': 'Remove ingredient', icon: TRASH_SVG,
        onclick: () => {
          working.ingredients.splice(idx, 1);
          if (!working.ingredients.length) working.ingredients.push({ label: '', grams: '', unit: 'g' });
          markDirty();
          renderIngredientRows();
          if (showErrors) validateUI();
        },
      });
      // The link lives on its OWN line under the row, not as a fifth control in it.
      // At 296px the row already holds a name, an amount, a unit and a bin; a fifth
      // target takes its width from the ingredient NAME, which is the one thing that
      // has to stay readable. Under it there is room to say what it points at.
      rowsContainer.appendChild(el('div', { class: 'cat-ing-editgroup' }, [
        el('div', { class: 'cat-ing-editrow' }, [labelInput, gramsInput, unitSelect, delIcon]),
        linkRow(ing, idx),
      ]));
    });
    rowsContainer.appendChild(totalRow);
    updateTotal();
  }

  // What this row points at — an ingredient in Orders, or another recipe — and the
  // button that changes it. A row with no link is not an error: it is how every
  // recipe in the catalogue reads today, and it stays perfectly usable. It just
  // cannot contribute a cost, and says so.
  function linkRow(ing, idx) {
    const link = linkOf(ing);
    const button = el('button', {
      class: 'cat-ing-link' + (link ? ' linked' : ''), type: 'button',
      onclick: async () => {
        const chosen = await openLinkPicker({
          ingredients: app.ingredients(),
          recipes: app.allRecipes(),
          suppliers: app.suppliers(),
          excludeRecipeId: working.id,
          hasLink: !!linkOf(working.ingredients[idx]),
        });
        if (chosen === undefined) return;              // dismissed: change nothing

        const row = working.ingredients[idx];
        if (chosen === null) {
          delete row.kind;
          delete row.refId;
        } else {
          row.kind = chosen.kind;
          row.refId = chosen.refId;
          // Pre-fill the name only when the row has none. An existing label is the
          // wording somebody chose for THIS recipe ("strong flour" for an article
          // filed as "Flour T55"), and overwriting it would undo that every time
          // the link is corrected.
          if (!String(row.label || '').trim()) row.label = chosen.name;
        }
        markDirty();
        renderIngredientRows();
        if (showErrors) validateUI();
      },
    }, linkText(ing));
    return button;
  }

  // "→ Flour · Supplier · £2.00 / kg", or an invitation when there is no link.
  // The price is shown here because it is the number the cost is built from, and
  // seeing it beside the row is what catches a link to the wrong article.
  function linkText(ing) {
    const link = linkOf(ing);
    if (!link) return '+ Link to an ingredient';

    if (link.kind === 'recipe') {
      const sub = app.allRecipes().find(r => r.id === link.refId);
      return sub ? `→ ${sub.name}  ·  recipe` : '→ a recipe that no longer exists';
    }

    const ingredient = app.ingredients()[link.refId];
    if (!ingredient) return '→ an ingredient that no longer exists';
    const rate = pricePerKg(ingredient);
    const supplier = (app.suppliers()[ingredient.supplierId] || {}).name || '';
    return ['→ ' + (ingredient.name || 'Ingredient'), supplier,
      rate === null ? 'no price yet' : `${formatRate(rate)} / kg`]
      .filter(Boolean).join('  ·  ');
  }

  // Highlight the empty required fields (name, and every ingredient missing a label).
  function validateUI() {
    nameInput.classList.toggle('cat-invalid', showErrors && !String(working.name || '').trim());
    const labelInputs = rowsContainer.querySelectorAll('.cat-lbl');
    working.ingredients.forEach((ing, i) => {
      if (labelInputs[i]) {
        labelInputs[i].classList.toggle('cat-invalid', showErrors && !String(ing.label || '').trim());
      }
    });
  }

  // Trim labels, coerce grams to non-negative numbers, drop rows with no name.
  // Spreads each row first (see `working` above) so an ingredient link survives a
  // save; only the three fields this editor owns are rewritten.
  function cleanWorking() {
    return {
      ...working,
      name: String(working.name || '').trim(),
      ingredients: working.ingredients
        .map(i => ({ ...i, label: String(i.label || '').trim(), grams: Math.max(0, Number(i.grams) || 0), unit: unitOf(i) }))
        .filter(i => i.label),
    };
  }

  async function onSave() {
    if (busy) return;
    const clean = cleanWorking();
    const problem = findInvalidRecipe(clean);
    if (problem) {
      showErrors = true;
      renderIngredientRows();
      validateUI();
      if (problem === 'name') nameInput.focus();
      app.toast(
        problem === 'name' ? 'Please enter a recipe name.'
          : problem === 'weight' ? 'Enter an amount for at least one ingredient.'
            : 'Add at least one ingredient with a name.',
      );
      return;
    }
    busy = true;
    const ok = await app.confirm({ title: 'Save recipe?', message: 'Save these changes?', okLabel: 'Save' });
    if (!ok) { busy = false; return; }
    dirty = false;
    // Local-first: the store updates the list instantly and syncs in the background;
    // a rejected write is rolled back and surfaced by the store (no freeze here).
    app.saveRecipe(clean);
    app.toast(recipe ? 'Recipe saved.' : 'Recipe added.');
    app.showList();
  }

  async function onDelete() {
    if (busy) return;
    busy = true;
    // Route through the shared guard so the editor and the detail view share the
    // same confirm + Calculator-link warning. It deletes and navigates on success.
    const done = await app.confirmAndDelete(recipe);
    if (done) dirty = false;   // deleted + navigated away
    else busy = false;         // cancelled — stay in the editor
  }

  // Discard protection: Back with unsaved edits asks first.
  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({ title: 'Discard changes?', message: 'You have unsaved changes. Discard them?', okLabel: 'Discard', danger: true });
  });

  // How much weight this recipe loses on the way to being finished — evaporation in
  // the oven, mostly. It is the divisor of the cost per kilo: a dough that goes in
  // at 1000 g and comes out at 800 g costs 25% more per kilo than its ingredients
  // suggest, and leaving this at 0 is what makes a baked product look cheaper than
  // it is. Optional, and 0 for every recipe written before it existed.
  const lossInput = el('input', {
    id: 'catRecipeLoss', class: 'cat-loss-input', type: 'number',
    min: '0', max: String(MAX_LOSS_PCT), step: 'any', inputmode: 'decimal',
    placeholder: '0', value: working.lossPct || '',
    'aria-label': 'Weight lost while cooking, as a percentage',
    oninput: (e) => { working.lossPct = normalizeLossPct(e.target.value); markDirty(); },
  });

  const lossField = el('div', { class: 'cat-loss-field' }, [
    el('label', { class: 'cat-loss-label', for: 'catRecipeLoss', text: 'Weight lost while cooking' }),
    el('div', { class: 'cat-loss-row' }, [lossInput, el('span', { class: 'cat-loss-unit', text: '%' })]),
    el('p', { class: 'cat-loss-note', text:
      'Leave at 0 if nothing is lost. It only affects the cost per kilo, never the amounts.' }),
  ]);

  const addRowBtn = el('button', {
    class: 'cat-add-row', type: 'button', text: '+ Add ingredient',
    onclick: () => { working.ingredients.push({ label: '', grams: '', unit: 'g' }); markDirty(); renderIngredientRows(); if (showErrors) validateUI(); },
  });

  const actions = el('div', { class: 'cat-editor-actions' }, [
    el('button', { class: 'cat-save-btn', type: 'button', text: 'Save', onclick: onSave }),
    // ⚠️ Owner only, same as the detail screen. Staff may still edit and save.
    recipe && canManageHere() ? el('button', { class: 'cat-del-btn', type: 'button', onclick: onDelete }, [
      el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
      'Delete',
    ]) : null,
  ]);

  renderIngredientRows();

  return el('div', { class: 'cat-view cat-editor' }, [
    datalist,
    el('label', { for: 'catRecipeName', text: 'Recipe name' }),
    nameInput,
    el('div', { class: 'cat-ing-head' }, [
      el('label', { class: 'cat-ing-head-label', text: 'Ingredients' }),
      countEl,
    ]),
    rowsContainer,
    totalNote,
    addRowBtn,
    lossField,
    actions,
  ]);
}
