// catalogue-detail.js — a single recipe: shows the base (unscaled) recipe
// immediately, with amounts column-aligned; a bottom "Total dough weight" input
// (starts empty) scales everything pro-rata AFTER a confirm; a Clear button
// (only once scaled) returns to the base; an Import button copies it into the
// Calculator.

import { t } from '../i18n.js';
import { canManageHere } from './firebase-catalogue.js';
import { el } from './dom.js';
import { currentSession } from '../firebase.js';
import { isSectionAllowed } from '../sections.js';
import {
  scaleCatalogue, baseAmounts, weighableTotalGrams, unitOf, batchWarning, formatWeight,
} from './catalogue-model.js';
import {
  getScaledTarget, setScaledTarget, clearScaledTarget, getIngredients, getRecipesById,
} from './catalogue-store.js';
import { costRecipe, partialCostText } from './recipe-cost-model.js';
import { recipeAllergens, canLabel, incompleteText, ALLERGEN_REASON_TEXT } from './recipe-allergen-model.js';
import { allergenLabel } from '../allergen-model.js';
import { formatRate } from '../price-model.js';
import { hasProcedure, normalizeSteps, unassignedRows, progressText, formatDuration } from './guided-model.js';

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

// What a kilo of this recipe costs, from the prices entered in Orders.
//
// ⚠️ THE NUMBER AND ITS CAVEAT ARE ONE ELEMENT, NEVER TWO. If some rows are not
// linked, the figure is the cost per kilo OF THE LINKED ROWS — a real, useful,
// PARTIAL answer — and showing it without the note beside it is the one way this
// screen can mislead: a food cost that reads complete and is too low.
//
// The whole panel is hidden when nothing at all is linked, rather than showing
// "£0.00" or an empty box on the hundreds of recipes nobody has linked yet.
function costPanel(recipe) {
  const result = costRecipe(recipe, {
    ingredients: getIngredients(),
    recipes: getRecipesById(),
  });

  const panel = el('div', { class: 'cat-cost-panel' });
  if (result.pricePerKg === null) {
    // Nothing linked at all: say what to do, once, quietly — and only when the
    // recipe has rows worth linking, so a brand-new empty recipe stays silent.
    if (!result.unpriced.length) { panel.hidden = true; return panel; }
    panel.appendChild(el('p', { class: 'cat-cost-none', text:
      t('cat.noCostYetLink') }));
    return panel;
  }

  panel.appendChild(el('div', { class: 'cat-cost-head' }, [
    el('span', { class: 'cat-cost-label', text: 'Cost' }),
    el('span', { class: 'cat-cost-value', text: `${formatRate(result.pricePerKg)} / kg` }),
  ]));

  // The weight it was worked out over, said plainly, because it is NOT the recipe
  // total whenever a row is unlinked — and a reader comparing the two numbers
  // deserves to know why they differ rather than doubting both.
  const over = result.lossPct > 0
    ? `over ${formatWeight(result.yieldGrams)} finished (${result.lossPct}% lost from ${formatWeight(result.costedGrams)})`
    : `over ${formatWeight(result.yieldGrams)}`;
  panel.appendChild(el('p', { class: 'cat-cost-basis', text: over }));

  const note = partialCostText(result);
  if (note) panel.appendChild(el('p', { class: 'cat-cost-partial', text: note }));

  return panel;
}

// What this recipe contains, for somebody at the counter being asked.
//
// ⚠️ IT IS THE COST PANEL'S TWIN AND ITS OPPOSITE. The panel above shows a
// PARTIAL number with "3 ingredients are not priced yet" beside it, because a
// slightly-too-low price is still a useful answer. Here a partial list is the
// dangerous one — the unlinked row could be the one with the hazelnuts — so when
// anything is missing this refuses to present a list at all and shows the JOB
// instead.
function allergenPanel(recipe, app) {
  const result = recipeAllergens(recipe, {
    ingredients: getIngredients(),
    recipes: getRecipesById(),
  });

  const panel = el('div', { class: 'cat-alg-panel' });

  // ⚠️⚠️ THE CARD FOLDS SHUT, AND WHAT STAYS OUTSIDE THE FOLD IS THE WHOLE DESIGN.
  // Federico, 23 Aug 2026: on an incomplete recipe this was nine lines — a head, a
  // warning and up to eight named rows — and it pushed the batch-weight box, the
  // thing the screen is opened for, two cards down the page.
  //
  // ⚠️ THE ANSWER IS NEVER BEHIND A TAP. This is the only screen in the app that can
  // send somebody to hospital. Closed, it still says «not declared», or on a complete
  // recipe still names what it contains — so somebody at the counter asked "are there
  // hazelnuts in this?" answers without touching anything. Only the JOB folds away:
  // which rows to go and fix, the traces, the caveat, the way to the label.
  //
  // ⚠️ AND IT OPENS CLOSED EVERY TIME. Remembering it open would quietly undo the
  // change on the screens he opens most.
  const body = el('div', { class: 'cat-alg-body', hidden: 'hidden' });
  const head = (statusEl) => {
    const btn = el('button', {
      class: 'cat-alg-head cat-alg-toggle', type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        const open = body.hidden;
        body.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.classList.toggle('cat-alg-toggle--open', open);
      },
    }, [
      el('span', { class: 'cat-alg-label', text: t('cat.alg.title') }),
      statusEl,
      el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
    ]);
    return btn;
  };

  if (!canLabel(result)) {
    // A brand-new empty recipe stays silent, like the cost panel does: there is
    // nothing to declare and nothing to go and fix.
    if (!result.gaps.length) { panel.hidden = true; return panel; }

    panel.appendChild(head(el('span', { class: 'cat-alg-blocked', text: t('cat.alg.notDeclared') })));
    panel.appendChild(body);
    body.appendChild(el('p', { class: 'cat-alg-warn', text: incompleteText(result) }));
    // ⚠️ NAME THE ROWS. "Incomplete" leaves somebody hunting through twenty
    // ingredients; this list IS the work, and it is why the panel appears long
    // before the data is in.
    const list = el('ul', { class: 'cat-alg-gaps' });
    for (const gap of result.gaps.slice(0, 8)) {
      list.appendChild(el('li', { text: `${gap.label} — ${reasonLabel(gap.reason)}` }));
    }
    if (result.gaps.length > 8) {
      list.appendChild(el('li', { class: 'cat-alg-more', text: t('cat.alg.andMore', { n: result.gaps.length - 8 }) }));
    }
    body.appendChild(list);
    // What IS known so far, marked as explicitly NOT an answer.
    if (result.allergens.length) {
      body.appendChild(el('p', { class: 'cat-alg-sofar',
        text: t('cat.alg.soFar', { list: result.allergens.map(allergenLabel).join(', ') }) }));
    }
    return panel;
  }

  panel.appendChild(head(el('span', { class: 'cat-alg-ok', text: t('cat.alg.declared') })));
  // ⚠️ OUTSIDE THE FOLD, DELIBERATELY. What a recipe contains is the answer somebody
  // at the counter needs in the moment they are asked; putting it behind a tap means
  // a rushed answer given without opening it.
  panel.appendChild(el('p', { class: 'cat-alg-list', text: result.allergens.length
    ? result.allergens.map(allergenLabel).join(', ')
    : t('cat.noneOfThe14') }));
  panel.appendChild(body);
  if (result.mayContain.length) {
    body.appendChild(el('p', { class: 'cat-alg-traces',
      text: t('cat.alg.mayContain', { list: result.mayContain.map(allergenLabel).join(', ') }) }));
  }
  // ⚠️ THE SENTENCE THAT MUST NOT BE DROPPED. The app gathers what it was told;
  // it cannot know what happened on the bench this morning, and a screen that
  // implies otherwise is worse than one that says nothing.
  //
  // ⚠️ It is INSIDE the fold, and that is a judgement worth stating: it qualifies an
  // answer that is already outside the fold, and somebody reading the list without
  // opening the card is reading what the SUPPLIER said either way. Anyone acting on
  // it — printing a label — opens the card to reach the button below.
  body.appendChild(el('p', { class: 'cat-alg-caveat', text:
    t('cat.fromTheSuppliersSpecifications2') }));

  // ⚠️ THE WAY TO THE LABEL EXISTS ONLY WHEN THERE IS A LABEL TO MAKE. Offering
  // it on a recipe with gaps would mean tapping through to a refusal — and the
  // refusal is already here, three lines above, naming exactly what is missing.
  body.appendChild(el('button', {
    class: 'cat-alg-label-btn', type: 'button',
    onclick: () => app.openLabel(recipe),
  }, [t('cat.makeALabel'), el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' })]));

  return panel;
}

// The seven reasons a row cannot be declared.
//
// ⚠️ RESOLVED HERE, NOT IN THE FROZEN CONSTANT. ALLERGEN_REASON_TEXT in
// recipe-allergen-model.js now holds KEYS: a module constant that called t() would be
// evaluated once, at first import — before a venue is open, so before the interface
// language is even known — and would render English for ever with a correct Italian
// translation sitting in the dictionary. Fourteen constants in this app did exactly
// that. The defect is WHEN, not WHAT.
function reasonLabel(reason) {
  const key = ALLERGEN_REASON_TEXT[reason];
  return key ? t(key) : reason;
}

// ── Guided mixing ─────────────────────────────────────────────────────────────
//
// The procedure, offered where the batch weight has just been chosen: the amounts
// the run reads are the ones this screen is showing, so the two sit together.
//
// ⚠️ THE RESUME OFFER IS PART OF THIS PANEL, not only the dialog on opening the
// catalogue. Somebody who dismissed that dialog, or who reopened the app hours
// later, still has a dough on the go — and the only other way back in would be to
// start again from step one.
function guidedPanel(recipe, app, getTarget) {
  const panel = el('div', { class: 'cat-guided-panel' });
  const steps = normalizeSteps(recipe.steps);
  const session = app.guidedSessionFor(recipe.id);

  if (!steps.length) {
    // Quiet, and honest about what it is for: hundreds of recipes will never have
    // one, and this must not read as something missing from each of them.
    panel.appendChild(el('button', {
      class: 'cat-guided-write', type: 'button',
      onclick: () => app.openGuidedEditor(recipe),
    }, [t('cat.writeTheMixingSteps')]));
    panel.appendChild(el('p', { class: 'cat-guided-hint', text:
      t('cat.aStepAtA') }));
    return panel;
  }

  if (session) {
    panel.appendChild(el('button', {
      class: 'cat-guided-go cat-guided-go--resume', type: 'button',
      onclick: () => app.resumeGuided(recipe),
    }, [`Resume the guided mix — ${progressText(session.stepIndex, normalizeSteps(session.snapshot.steps).length).toLowerCase()}`]));
  }

  panel.appendChild(el('button', {
    class: 'cat-guided-go', type: 'button',
    onclick: () => app.startGuided(recipe, getTarget()),
  }, [session ? t('cat.startAgainFromThe') : t('cat.guidedMixing')]));

  const timed = steps.reduce((sum, s) => sum + s.seconds, 0);
  panel.appendChild(el('p', { class: 'cat-guided-hint', text:
    `${steps.length} step${steps.length === 1 ? '' : 's'}${timed ? ` · ${formatDuration(timed)} of timers` : ''}` }));

  // ⚠️ THE WARNING TRAVELS WITH THE PROCEDURE. It is shown while writing the steps
  // and again at the end of a run, but somebody about to start deserves it too:
  // this is the moment they decide to trust it.
  const missed = unassignedRows(recipe);
  if (missed.length) {
    panel.appendChild(el('p', { class: 'cat-guided-warn', text:
      `Not in any step: ${missed.map(r => r.label).join(', ')}` }));
  }

  panel.appendChild(el('button', {
    class: 'cat-guided-edit', type: 'button', text: 'Edit the steps',
    onclick: () => app.openGuidedEditor(recipe),
  }));
  return panel;
}

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
    class: 'cat-zoom-close', type: 'button', 'aria-label': t('cat.exitFullScreen'),
    onclick: (e) => { e.stopPropagation(); setZoom(false); },
    icon: CLOSE_SVG,
  });

  const ingList = el('div', {
    class: 'cat-ing-list', role: 'button', tabindex: '0', 'aria-pressed': 'false',
    'aria-label': t('cat.viewRecipeFullScreen'),
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
    ingList.setAttribute('aria-label', on ? t('cat.exitFullScreen') : t('cat.viewRecipeFullScreen'));
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
    inputmode: 'numeric', 'aria-label': t('cat.totalDoughWeightIn'),
  });

  const clearBtn = el('button', {
    class: 'cat-clear-btn', type: 'button', hidden: 'hidden',
    text: t('cat.clearBackToBase'),
    onclick: () => { displayTarget = 0; gramsInput.value = ''; clearScaledTarget(recipe.id); renderRows(); },
  });

  const calcBtn = el('button', {
    class: 'cat-calc-btn', type: 'button', text: t('cat.calculate'), onclick: onCalculate,
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
      el('span', { class: 'cat-ing-name', text: t('cat.total') }),
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
      title: warning ? t('cat.thatIsAVery') : t('cat.calculateRecipe'),
      message: warning
        ? `${warning}\n\nCalculate ${recipe.name} for ${readable}?`
        : `Calculate ${recipe.name} for ${readable}?`,
      okLabel: t('ui.calculate'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    displayTarget = grams;
    setScaledTarget(recipe.id, displayTarget); // keep this batch until Clear / 12h
    renderRows();
  }

  const weightPanel = el('div', { class: 'cat-weight-panel' }, [
    el('label', { for: 'catGrams', text: t('cat.totalDoughWeight') }),
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
  // ⚠️ `hidden` IS SET AFTERWARDS, NOT PASSED TO el(), AND THAT IS THE WHOLE FIX.
  // el() ends in `node.setAttribute(key, value)`, and setAttribute('hidden', false)
  // writes the STRING "false" — the attribute is PRESENT, and `[hidden]` matches on
  // presence. So `hidden: !allowed` hid this button for EVERYBODY, including every
  // venue that does use the Calculator: the only way to copy a recipe into it was
  // gone. Assigning the property takes a real boolean and removes the attribute when
  // false. This was the only computed boolean handed to el() anywhere in the app.
  const importBtn = el('button', {
    class: 'cat-import-btn', type: 'button',
    onclick: () => app.importRecipe(recipe),
  }, [
    el('span', { icon: IMPORT_SVG, 'aria-hidden': 'true' }),
    t('cat.importIntoCalculator'),
  ]);
  importBtn.hidden = !isSectionAllowed(currentSession().location, 'calculator');

  // Low-key delete (P20 — de-emphasised destructive action): routed through the
  // shared guard, which warns if the recipe was imported into the Calculator and
  // navigates back to the list once deleted.
  //
  // ⚠️ OWNER ONLY, and it is absent rather than disabled. A recipe carries its
  // guided procedure, its ingredient links and whatever Food Cost products point
  // at it, none of which the button mentions. Staff keep every other action on
  // this screen — a disabled control just invites the tap that explains nothing.
  const deleteBtn = !canManageHere() ? null : el('button', {
    class: 'cat-detail-del', type: 'button',
    onclick: () => app.confirmAndDelete(recipe),
  }, [
    el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
    t('cat.deleteRecipe'),
  ]);

  renderRows();

  // The recipe name already lives in the green header (setHeader), so no title
  // here. The recipe + weight panel are wrapped in .cat-detail-top, which is made
  // at least a screenful tall (CSS min-height), so Import/Delete always land BELOW
  // the fold and are reached only by scrolling — never competing with the recipe.
  // The cost panel is REPLACED in place when new data arrives, never the whole
  // view: rebuilding the view would throw away a scaled batch the user is reading.
  const costHost = el('div', { class: 'cat-cost-host' }, [costPanel(recipe), allergenPanel(recipe, app)]);

  // The batch weight is read at the moment Start is tapped, not captured here:
  // choosing a weight and then starting the mix is one gesture, and a panel built
  // before the weight was typed would carry the old one into the dough.
  const guidedHost = el('div', { class: 'cat-guided-host' },
    [guidedPanel(recipe, app, () => displayTarget)]);

  const root = el('div', { class: 'cat-view' }, [
    // ⚠️ THE WEIGHT BOX SITS DIRECTLY UNDER THE RECIPE, and it did not until now.
    // Federico, 23 Aug 2026, from a photograph of Brioche on his own phone: scaling
    // the batch is the thing this screen is opened FOR, and it was below the cost
    // card and a nine-line allergen card — two cards and a scroll away from the
    // ingredients it rewrites. Nothing depends on the order: the cost panel is
    // replaced in place, and the guided panel reads the weight through a closure
    // rather than off the DOM.
    el('div', { class: 'cat-detail-top' }, [
      ingList,
      weightPanel,
      costHost,
      guidedHost,
    ]),
    el('div', { class: 'cat-detail-bottom' }, [
      importBtn,
      el('p', {
        class: 'cat-import-hint',
        text: t('cat.makesACopyYou'),
      }),
      deleteBtn,
    ]),
  ]);

  // ⚠️ WITHOUT THIS THE COST IS COMPUTED ONCE AND NEVER AGAIN. The ingredient
  // listener is still in flight while this screen is being opened — on a cold start,
  // offline, or simply a slow network — so the first paint can legitimately find no
  // prices at all. Computed once, the panel would say "no cost yet" for as long as
  // the screen stayed open, and the only way to see the real number would be to
  // leave and come back. It also keeps a price corrected in Orders, or the recipe
  // edited on another phone, from being a stale figure on an open screen.
  return {
    root,
    // ⚠️⚠️ THIS REBUILDS BOTH CARDS, AND THE ALLERGEN ONE IS WHY. It used to be
    // `costHost.replaceChildren(costPanel(...))` — one child, where the host holds
    // TWO — so the first data update to arrive while a recipe was open DELETED the
    // allergen card outright, with nothing on screen saying so. On the only screen in
    // this app that can send somebody to hospital, the line reading «not declared» —
    // or naming what the recipe contains — silently disappeared, and with it the way
    // to a label. Live from 11 Aug 2026 (v1.37.0) to 22 Aug 2026.
    //
    // ⚠️ IT WAS INVISIBLE TO EVERY CHECK BECAUSE OF *WHEN*: the card is present on the
    // first paint and destroyed by the NEXT snapshot, so anything that opens a recipe
    // and measures straight away — which is what every driven check did — sees it
    // there. Found by four independent reviewers reading the code, then reproduced by
    // editing the recipe from another connection with the screen open.
    //
    // ⚠️ AND REBUILDING IS RIGHT, NOT MERELY SAFE: an ingredient declared on another
    // phone must reach this screen. Leaving the card alone would fix the disappearance
    // and freeze the answer at whatever was known when the screen opened, which on
    // this screen is its own kind of wrong.
    refreshCost(latest) {
      const fresh = latest || recipe;
      // ⚠️ Carry the disclosure's state across the rebuild. Somebody reading the list
      // of rows still to declare must not have it shut under them because a price
      // arrived. Re-opened through the button's OWN handler so aria-expanded, the
      // class and the body's hidden attribute cannot drift apart.
      const openBefore = costHost.querySelector('.cat-alg-toggle')
        ?.getAttribute('aria-expanded') === 'true';
      const allergens = allergenPanel(fresh, app);
      costHost.replaceChildren(costPanel(fresh), allergens);
      if (openBefore) allergens.querySelector('.cat-alg-toggle')?.click();
    },
  };
}
