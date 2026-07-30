// catalogue-detail.js — a single recipe: shows the base (unscaled) recipe
// immediately, with amounts column-aligned; a bottom "Total dough weight" input
// (starts empty) scales everything pro-rata AFTER a confirm; a Clear button
// (only once scaled) returns to the base; an Import button copies it into the
// Calculator.

import { el } from './dom.js';
import { currentSession } from '../firebase.js';
import { isSectionAllowed } from '../sections.js';
import {
  scaleCatalogue, baseAmounts, weighableTotalGrams, unitOf, batchWarning, formatWeight,
} from './catalogue-model.js';
import { getScaledTarget, setScaledTarget, clearScaledTarget } from './catalogue-store.js';

const IMPORT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
// Close (exit full screen) button icon. Static SVG only.
const CLOSE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// Whole grams only: values are already rounded in the model, and maximumFractionDigits:0
// is a belt-and-suspenders guard so nothing ever shows a decimal. useGrouping:false
// drops the thousands separator (e.g. 1000 g, not 1,000 g) — Federico's preference.
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });
// Split each amount into number + unit so they line up in two straight columns
// (numbers right-aligned, units left-aligned) no matter how long the name is. A
// 'to taste' row (value null) has no number and shows the phrase in the unit slot.
const amountParts = (value, unit) => value === null ? { num: '', unit: 'to taste' } : { num: nf.format(value), unit };
const amountEl = ({ num, unit }) => el('span', { class: 'cat-ing-amt' }, [
  el('span', { class: 'cat-ing-num', text: num }),
  el('span', { class: 'cat-ing-unit', text: unit }),
]);

export function renderDetail({ recipe, app }) {
  // Restore a recently calculated batch (kept per device until Clear or 12h), so
  // leaving and reopening the recipe shows the same scaled amounts. 0 = base.
  let displayTarget = getScaledTarget(recipe.id) || 0;

  // The rows live in an inner container so re-rendering (renderRows) never wipes
  // the zoom button that sits alongside them inside .cat-ing-list.
  const ingRows = el('div', { class: 'cat-ing-rows' });

  // Tap-to-zoom: a tap on the recipe expands it into a full-screen overlay (bigger
  // figures, readable across the room); tapping again — the × button, or Escape —
  // returns to normal. A CSS fixed overlay is used, NOT the Fullscreen API, because
  // iOS Safari blocks that API for non-video elements.
  let zoomed = false;

  // Close (×) lives inside the overlay and only shows while zoomed.
  const closeBtn = el('button', {
    class: 'cat-zoom-close', type: 'button', 'aria-label': 'Exit full screen',
    onclick: (e) => { e.stopPropagation(); setZoom(false); },
    icon: CLOSE_SVG,
  });

  const ingList = el('div', {
    class: 'cat-ing-list', role: 'button', tabindex: '0', 'aria-pressed': 'false',
    'aria-label': 'View recipe full screen',
    onclick: () => setZoom(!zoomed),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(!zoomed); }
      else if (e.key === 'Escape' && zoomed) { e.preventDefault(); setZoom(false); }
    },
  }, [ingRows, closeBtn]);

  function setZoom(on) {
    zoomed = on;
    ingList.classList.toggle('cat-ing-list--zoom', on);
    ingList.setAttribute('aria-pressed', on ? 'true' : 'false');
    ingList.setAttribute('aria-label', on ? 'Exit full screen' : 'View recipe full screen');
    // Lock the page behind the overlay so it can't scroll under it.
    document.body.classList.toggle('cat-zoom-lock', on);
    if (on) { try { ingList.focus({ preventScroll: true }); } catch (e) { /* best-effort */ } }
  }

  // GRAMS, like the recipe rows and the Total right above it — type 17500 and you get
  // 17500 g. The field used to take kilograms while everything around it read in grams,
  // so "17500" was taken as 17500 kg and quietly produced a 17.5-tonne batch.
  const gramsInput = el('input', {
    id: 'catGrams', type: 'number', min: '0', step: '1',
    value: displayTarget > 0 ? String(Math.round(displayTarget)) : '', placeholder: '0',
    inputmode: 'numeric', 'aria-label': 'Total dough weight in grams',
  });

  const clearBtn = el('button', {
    class: 'cat-clear-btn', type: 'button', hidden: 'hidden',
    text: 'Clear — back to base recipe',
    onclick: () => { displayTarget = 0; gramsInput.value = ''; clearScaledTarget(recipe.id); renderRows(); },
  });

  const calcBtn = el('button', {
    class: 'cat-calc-btn', type: 'button', text: 'Calculate', onclick: onCalculate,
  });

  function renderRows() {
    ingRows.replaceChildren();
    const scaled = displayTarget > 0;
    const amounts = scaled ? scaleCatalogue(recipe, displayTarget) : baseAmounts(recipe);
    recipe.ingredients.forEach((ing, i) => {
      ingRows.appendChild(el('div', { class: 'cat-ing-row' }, [
        el('span', { class: 'cat-ing-name', text: ing.label }),
        amountEl(amountParts(amounts[i], unitOf(ing))),
      ]));
    });
    // Total = the WEIGHABLE mass in grams (weight + volume rows): when scaled it is
    // the target, at base the recipe's own weighable total. Non-weight rows (pieces /
    // to-taste) are shown above but never enter this total.
    const total = scaled ? displayTarget : weighableTotalGrams(recipe);
    ingRows.appendChild(el('div', { class: 'cat-ing-row cat-ing-total' }, [
      el('span', { class: 'cat-ing-name', text: 'Total' }),
      amountEl({ num: nf.format(total), unit: 'g' }),
    ]));
    clearBtn.hidden = !scaled;
  }

  async function onCalculate() {
    const grams = parseFloat(gramsInput.value);
    if (!isFinite(grams) || grams <= 0) { // empty / 0 → base recipe
      displayTarget = 0;
      clearScaledTarget(recipe.id);
      renderRows();
      return;
    }
    // The confirm always spells the amount out BOTH ways (17500 g / 17.5 kg), so a
    // wrong order of magnitude is caught by eye before anything is scaled. A batch
    // outside any plausible size gets a louder title and an explicit warning line.
    const warning = batchWarning(grams, weighableTotalGrams(recipe));
    const readable = `${nf.format(grams)} g (${formatWeight(grams)})`;
    const ok = await app.confirm({
      title: warning ? 'That is a very large batch' : 'Calculate recipe?',
      message: warning
        ? `${warning}\n\nCalculate ${recipe.name} for ${readable}?`
        : `Calculate ${recipe.name} for ${readable}?`,
      okLabel: 'Calculate',
    });
    if (!ok) return;
    displayTarget = grams;
    setScaledTarget(recipe.id, displayTarget); // keep this batch until Clear / 12h
    renderRows();
  }

  const weightPanel = el('div', { class: 'cat-weight-panel' }, [
    el('label', { for: 'catGrams', text: 'Total dough weight' }),
    el('div', { class: 'cat-weight-input' }, [
      el('div', { class: 'cat-field' }, [gramsInput, el('span', { class: 'unit', text: 'g' })]),
      calcBtn,
    ]),
    clearBtn,
  ]);
  // No weighable ingredients (all pieces / to-taste) → nothing to scale by weight,
  // so hide the whole panel. getScaledTarget stays 0 in that case too.
  if (weighableTotalGrams(recipe) <= 0) weightPanel.hidden = true;

  // "Import into Calculator" WRITES the Calculator's configuration. A location
  // that does not use the Calculator is refused that write by the rules, so the
  // button would only ever produce a permission error: hide it instead.
  const importBtn = el('button', {
    class: 'cat-import-btn', type: 'button',
    hidden: !isSectionAllowed(currentSession().location, 'calculator'),
    onclick: () => app.importRecipe(recipe),
  }, [
    el('span', { icon: IMPORT_SVG, 'aria-hidden': 'true' }),
    'Import into Calculator',
  ]);

  // Low-key delete (P20 — de-emphasised destructive action): routed through the
  // shared guard, which warns if the recipe was imported into the Calculator and
  // navigates back to the list once deleted.
  const deleteBtn = el('button', {
    class: 'cat-detail-del', type: 'button',
    onclick: () => app.confirmAndDelete(recipe),
  }, [
    el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
    'Delete recipe',
  ]);

  renderRows();

  // The recipe name already lives in the green header (setHeader), so no title
  // here. The recipe + weight panel are wrapped in .cat-detail-top, which is made
  // at least a screenful tall (CSS min-height), so Import/Delete always land BELOW
  // the fold and are reached only by scrolling — never competing with the recipe.
  return el('div', { class: 'cat-view' }, [
    el('div', { class: 'cat-detail-top' }, [
      ingList,
      weightPanel,
    ]),
    el('div', { class: 'cat-detail-bottom' }, [
      importBtn,
      el('p', {
        class: 'cat-import-hint',
        text: 'Makes a copy you can tweak just for the Calculator — the catalogue recipe stays untouched.',
      }),
      deleteBtn,
    ]),
  ]);
}
