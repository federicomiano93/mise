// foodcost-editor.js — one product, on one page.
//
// ONE PAGE, NOT A WIZARD (the design's decision): the fields that only apply to
// one way of selling appear and disappear with the choice, rather than the product
// being built through a sequence nobody can go back through.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the
// stored product until Save, Save is confirmed, the required field is validated
// before saving, Delete is low-key and confirmed, and leaving with unsaved edits
// asks first.

import { t } from '../i18n.js';
import { canManageHere } from './firebase-foodcost.js';
import { el } from './dom.js';
import {
  VAT_RATES, SELLING_MODES, costProduct, blockerText, statusFor,
  snapshotWorthTaking, productSnapshot, normalizeProduct,
} from './foodcost-model.js';
import { CURRENCY, formatRate, formatMoney, pricePerKg } from '../price-model.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// Keys, resolved at draw time — see js/calculator-render.js.
const STATUS_TEXT = { green: 'fc.onTarget', amber: 'fc.slightlyOverTarget', red: 'fc.overTarget' };

export function renderEditor({ product, app }) {
  // A working COPY. Nothing reaches the stored product until Save.
  const working = product
    ? JSON.parse(JSON.stringify(normalizeProduct(product)))
    : {
      id: null, name: '', components: [], packaging: [],
      sellingMode: null, piecesPerBatch: null, sellingPrice: null,
      vatRate: null, foodCostTarget: null,
    };

  let dirty = false;
  let busy = false;
  let showErrors = false;
  const markDirty = () => { dirty = true; };

  // ── The answer, live ───────────────────────────────────────────────────────
  const answer = el('div', { class: 'fc-answer' });

  function paintAnswer() {
    const result = costProduct(working, app.tables());
    answer.replaceChildren();

    if (result.foodCostPct === null) {
      answer.className = 'fc-answer muted';
      answer.appendChild(el('p', { class: 'fc-answer-none', text: t('fc.notCostedYet') }));
      // Everything still missing, in the order a person would fill it in — not
      // just the first one, so the screen is a checklist rather than a drip-feed.
      const list = el('ul', { class: 'fc-blockers' });
      result.blockers.forEach(key => {
        list.appendChild(el('li', { text: blockerText(key) }));
      });
      answer.appendChild(list);
      return;
    }

    const status = result.status;
    answer.className = `fc-answer ${status || 'none'}`;
    answer.appendChild(el('div', { class: 'fc-answer-head' }, [
      el('span', { class: 'fc-answer-label', text: t('fc.foodCost') }),
      el('span', { class: 'fc-answer-value', text: `${result.foodCostPct}%` }),
    ]));

    const unit = working.sellingMode === 'weight' ? 'per kg' : 'per piece';
    answer.appendChild(el('p', { class: 'fc-answer-basis', text:
      `${formatRate(result.unitCost)} to make ${unit}  ·  ${formatMoney(result.netUnitPrice)} net  ·  ${formatMoney(result.margin)} margin` }));

    if (status) answer.appendChild(el('p', { class: 'fc-answer-status', text: t(STATUS_TEXT[status]) }));

    // ⚠️ A PARTIAL COST MUST NEVER LOOK COMPLETE. If a recipe inside this product
    // is only partly priced, the percentage is real but too LOW — the one
    // direction a food cost must not be wrong in.
    if (result.partial) {
      answer.appendChild(el('p', { class: 'fc-answer-partial', text:
        t('fc.partOfThisProduct') }));
    }
  }

  // ── Name ───────────────────────────────────────────────────────────────────
  const nameInput = el('input', {
    id: 'fcName', class: 'fc-input', type: 'text', placeholder: t('fc.productName'),
    value: working.name, 'aria-label': t('fc.productName'),
    oninput: e => { working.name = e.target.value; markDirty(); if (showErrors) validateUI(); },
  });

  // ── What it is made of ─────────────────────────────────────────────────────
  const componentRows = el('div', { class: 'fc-rows' });
  const packagingRows = el('div', { class: 'fc-rows' });

  function lineRow({ list, index, entry, kind }) {
    const isRecipe = kind === 'recipe';
    const options = isRecipe ? app.recipeOptions() : app.packagingOptions();
    const idKey = isRecipe ? 'recipeId' : 'ingredientId';
    const qtyKey = isRecipe ? 'qtyKg' : 'qtyPcs';

    const select = el('select', {
      class: 'fc-input fc-select', 'aria-label': isRecipe ? 'Recipe' : 'Packaging item',
      onchange: e => { entry[idKey] = e.target.value; markDirty(); repaint(); },
    }, [
      el('option', { value: '' }, isRecipe ? t('fc.chooseARecipe') : t('fc.chooseAnItem')),
      ...options.map(o => el('option', { value: o.id }, o.label)),
    ]);
    select.value = entry[idKey] || '';

    const qty = el('input', {
      class: 'fc-input fc-qty', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0', value: entry[qtyKey] || '',
      'aria-label': isRecipe ? 'Kilos' : 'Pieces',
      oninput: e => { entry[qtyKey] = Number(e.target.value) || 0; markDirty(); repaint(); },
    });

    const remove = el('button', {
      class: 'fc-del-icon', type: 'button', icon: TRASH_SVG,
      'aria-label': isRecipe ? t('fc.removeRecipe') : t('fc.removePackagingItem'),
      onclick: () => { list.splice(index, 1); markDirty(); repaint(); },
    });

    // What this line costs, under it — the number that shows WHICH line is heavy.
    const note = el('p', { class: 'fc-line-note', text: lineNote(entry, kind) });

    return el('div', { class: 'fc-line' }, [
      el('div', { class: 'fc-line-row' }, [select, qty, el('span', { class: 'fc-line-unit', text: isRecipe ? 'kg' : 'pcs' }), remove]),
      note,
    ]);
  }

  function lineNote(entry, kind) {
    if (kind === 'recipe') {
      const recipe = app.tables().recipes[entry.recipeId];
      if (!recipe) return entry.recipeId ? t('fc.thisRecipeNoLonger') : '';
      const costed = costRecipe(recipe, app.tables());
      if (costed.pricePerKg === null) return t('fc.thisRecipeIsNot');
      const line = (Number(entry.qtyKg) || 0) * costed.pricePerKg;
      return `${formatRate(costed.pricePerKg)} / kg  ·  ${formatMoney(line)}${costed.partial ? '  ·  partly priced' : ''}`;
    }
    const ingredient = app.tables().ingredients[entry.ingredientId];
    if (!ingredient) return entry.ingredientId ? t('fc.thisItemNoLonger') : '';
    if (ingredient.priceUnit !== 'pcs') {
      // Counted in pieces, so it has to be BOUGHT by the piece. Said plainly
      // rather than silently costing nothing.
      return t('fc.pricedByWeightSet');
    }
    const each = Number(ingredient.pricePerUnit) || 0;
    return `${formatRate(each)} each  ·  ${formatMoney((Number(entry.qtyPcs) || 0) * each)}`;
  }

  function repaintLines() {
    componentRows.replaceChildren();
    working.components.forEach((entry, index) => {
      componentRows.appendChild(lineRow({ list: working.components, index, entry, kind: 'recipe' }));
    });
    packagingRows.replaceChildren();
    working.packaging.forEach((entry, index) => {
      packagingRows.appendChild(lineRow({ list: working.packaging, index, entry, kind: 'packaging' }));
    });
  }

  // ── How it is sold ─────────────────────────────────────────────────────────
  const modeSelect = el('select', {
    id: 'fcMode', class: 'fc-input', 'aria-label': t('fc.howItIsSold'),
    onchange: e => {
      working.sellingMode = e.target.value || null;
      markDirty();
      repaint();
    },
  }, [
    el('option', { value: '' }, t('fc.choose')),
    el('option', { value: 'piece' }, t('fc.byThePiece')),
    el('option', { value: 'weight' }, t('fc.byWeightPerKg')),
  ]);
  modeSelect.value = working.sellingMode || '';

  const piecesInput = numberInput('fcPieces', t('fc.howManyPiecesCome'),
    working.piecesPerBatch, v => { working.piecesPerBatch = v; });
  const piecesField = field(t('fc.piecesPerBatch'), piecesInput,
    t('fc.howManyFinishedPieces'));

  // ⚠️ GROSS, and the label says so. The number typed here is the one on the
  // label; the app takes the VAT out before working out the food cost.
  const priceInput = numberInput('fcPrice', t('fc.sellingPriceIncludingVat'),
    working.sellingPrice, v => { working.sellingPrice = v; });

  // A dropdown of the UK rates plus a free field, because which rate applies to a
  // bakery product is a question for an accountant, not for this app.
  const vatSelect = el('select', {
    id: 'fcVat', class: 'fc-input', 'aria-label': t('fc.vatRate'),
    onchange: e => {
      const value = e.target.value;
      working.vatRate = value === 'other' ? working.vatRate : (value === '' ? null : Number(value));
      vatOther.hidden = value !== 'other';
      markDirty();
      repaint();
    },
  }, [
    el('option', { value: '' }, t('fc.choose')),
    ...VAT_RATES.map(rate => el('option', { value: String(rate) },
      rate === 20 ? '20% — standard' : rate === 5 ? '5% — reduced' : '0% — zero-rated')),
    el('option', { value: 'other' }, t('fc.anotherRate')),
  ]);
  const vatOther = numberInput('fcVatOther', t('fc.anotherVatRateAs'),
    null, v => { working.vatRate = v; });
  vatOther.hidden = true;
  if (working.vatRate !== null && !VAT_RATES.includes(working.vatRate)) {
    vatSelect.value = 'other';
    vatOther.value = String(working.vatRate);
    vatOther.hidden = false;
  } else if (working.vatRate !== null) {
    vatSelect.value = String(working.vatRate);
  }

  const targetInput = numberInput('fcTarget', t('fc.foodCostTargetAs'),
    working.foodCostTarget, v => { working.foodCostTarget = v; });

  function numberInput(id, label, value, set) {
    return el('input', {
      id, class: 'fc-input fc-number', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0', 'aria-label': label,
      value: value === null || value === undefined ? '' : String(value),
      oninput: e => {
        const raw = e.target.value;
        set(raw === '' ? null : Number(raw));
        markDirty();
        repaint();
      },
    });
  }

  function field(labelText, input, note) {
    return el('div', { class: 'fc-field' }, [
      el('label', { class: 'fc-label', for: input.id, text: labelText }),
      input,
      note ? el('p', { class: 'fc-note', text: note }) : null,
    ]);
  }

  function repaint() {
    // The pieces field only exists for something sold by the piece; for something
    // sold by weight it is not merely irrelevant, it is a number that would mean
    // nothing and invite being filled in.
    piecesField.hidden = working.sellingMode !== 'piece';
    repaintLines();
    paintAnswer();
  }

  function validateUI() {
    nameInput.classList.toggle('fc-invalid', showErrors && !String(working.name || '').trim());
  }

  // ── Save / delete ──────────────────────────────────────────────────────────
  async function onSave() {
    if (busy) return;
    // The ONE required field. Everything else may be missing — the answer panel
    // says what, and refusing the save would mean losing the work.
    if (!String(working.name || '').trim()) {
      showErrors = true;
      validateUI();
      nameInput.focus();
      app.toast(t('fc.pleaseEnterAProduct'));
      return;
    }

    busy = true;
    const ok = await app.confirm({ title: t('fc.saveProduct'), message: t('fc.saveTheseChanges'), okLabel: t('ui.save') });
    if (!ok) { busy = false; return; }

    const clean = { ...working, name: String(working.name).trim() };
    // A margin is recorded only when the PRICE or the COMPOSITION changed, and only
    // when there is a real answer to record. Renaming a product records nothing —
    // a history of non-events cannot answer "when did this change?".
    const result = costProduct(clean, app.tables());
    const snapshot = result.foodCostPct !== null && snapshotWorthTaking(product, clean)
      ? productSnapshot(clean, result, new Date().toISOString(), app.tables())
      : null;

    dirty = false;
    app.saveProduct(clean, snapshot);
    app.toast(product ? t('fc.productSaved') : t('fc.productAdded'));
    app.showList();
  }

  async function onDelete() {
    if (busy) return;
    busy = true;
    const ok = await app.confirm({
      title: t('fc.deleteProduct'),
      message: `Delete “${product.name || 'this product'}”? This cannot be undone, and its margin history goes with it.`,
      okLabel: t('ui.delete'), danger: true,
    });
    if (!ok) { busy = false; return; }
    dirty = false;
    app.deleteProduct(product.id);
    app.toast(t('fc.productDeleted'));
    app.showList();
  }

  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({
      title: t('fc.discardChanges'), message: t('fc.youHaveUnsavedChanges'),
      okLabel: t('ui.discard'), danger: true,
    });
  });

  const historyBtn = product
    ? el('button', { class: 'fc-link', type: 'button', text: t('fc.marginHistory'),
      onclick: () => app.openHistory(product) })
    : null;

  repaint();

  const root = el('div', { class: 'fc-view fc-editor' }, [
    answer,

    field('Name', nameInput),

    el('h2', { class: 'fc-section', text: t('fc.madeOf') }),
    componentRows,
    el('button', { class: 'fc-add-row', type: 'button', text: t('fc.addRecipe'),
      onclick: () => { working.components.push({ recipeId: '', qtyKg: 0 }); markDirty(); repaint(); } }),

    el('h2', { class: 'fc-section', text: 'Packaging' }),
    packagingRows,
    el('button', { class: 'fc-add-row', type: 'button', text: t('fc.addPackaging'),
      onclick: () => { working.packaging.push({ ingredientId: '', qtyPcs: 0 }); markDirty(); repaint(); } }),
    el('p', { class: 'fc-note', text:
      t('fc.boxesBagsRibbonAnything') }),

    el('h2', { class: 'fc-section', text: t('fc.howItIsSold') }),
    field('Sold', modeSelect),
    piecesField,
    field(`Selling price, including VAT (${CURRENCY})`, priceInput,
      t('fc.thePriceOnThe')),
    field(t('fc.vatRate'), vatSelect),
    vatOther,
    field(t('fc.foodCostTarget'), targetInput,
      t('fc.theShareOfThe')),

    el('div', { class: 'fc-actions' }, [
      el('button', { class: 'fc-save', type: 'button', text: 'Save', onclick: onSave }),
      historyBtn,
      // ⚠️ Owner only. Deleting a product takes its margin history with it, and
      // that history cannot be rebuilt — a snapshot exists only where somebody
      // changed something, on the day they changed it. The trash icons on the
      // component rows above are NOT this: they edit the working copy and touch
      // nothing until Save, so they stay available to everybody.
      product && canManageHere() ? el('button', { class: 'fc-delete', type: 'button', onclick: onDelete }, [
        el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }), t('fc.deleteProduct2'),
      ]) : null,
    ]),
  ]);

  return {
    root,
    // ⚠️ WITHOUT THIS THE CHOOSERS ARE BUILT ONCE, FROM WHATEVER HAD ARRIVED.
    // The recipe and ingredient listeners are still in flight while this screen is
    // being opened — on a cold start, offline, or a slow network — so "+ Add
    // recipe" could produce a menu with nothing in it, and it would STAY empty for
    // as long as the screen was open. The only way to see the recipes would be to
    // leave and come back.
    //
    // The rows are left alone while somebody is typing in one of them: rebuilding
    // an input under the finger loses the focus and the half-typed number. The
    // answer panel is always safe to repaint — it holds no input.
    refreshData() {
      const typing = componentRows.contains(document.activeElement)
        || packagingRows.contains(document.activeElement);
      if (!typing) repaintLines();
      paintAnswer();
    },
  };
}
