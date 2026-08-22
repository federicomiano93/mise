// ingredient-form.js — one supplier product's whole record.
//
// Name, supplier, brand, pack weight, category and order unit; then what it COSTS
// (for whoever may see money); then what is IN it — the fourteen allergens, the
// pack's own ingredient list, and the nutrition panel.
//
// It lived inside management.js, reached through a gear labelled «Settings». It is
// not a setting: it is the record this bakery keeps about something it buys, and it
// is the screen the whole allergen job happens on. It moved out with the rest of the
// records (js/orders/registry.js) and is imported by that screen alone.
//
// ⚠️ NOTHING HERE IS HIDDEN BY ROLE EXCEPT THE PRICE, and that one is not really
// hidden either — see mayPrice below. The allergen block is drawn for everybody,
// deliberately: it is the one part of this app that can send somebody to hospital,
// and the person who gets asked «are there nuts in this?» is whoever is at the
// counter (the v1.62.0 lesson — a gate on a container gates everything put inside).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { NO_SUPPLIER_ID } from './no-supplier.js';
import { field, formActions, reportFailure, shortDate } from './mgmt-ui.js';
import {
  CURRENCY, PRICE_UNITS, priceUnitLabel,
  pricePatch, priceChanged, priceRecord, pricePerKg,
  formatPricePerUnit, formatRate, costReasonText,
} from '../price-model.js';
// ⚠️ From js/ ROOT, not from a feature folder — see the header of that file. What
// an ingredient declares is typed HERE, in Orders, and read by the catalogue and
// by the labels screen, so the judgement lives in one place for all three.
import {
  ALLERGENS, ALLERGEN_GROUPS, NUTRIENTS,
  allergenLabel, allergenState, checkedAt, isDeclared,
  missingNutrients, buildAllergenFields,
} from '../allergen-model.js';
// Reading the pack's own ingredient list. PURE, and also from js/ ROOT: the
// vocabulary it walks is the same one a label is built from, so a second copy is
// the copy that quietly disagrees about what is in somebody's food.
import { readPackIngredients } from '../allergen-match.js';

// ── The price block ───────────────────────────────────────────────────────────
// One number and a unit. The rate is typed rather than derived from a pack
// price ÷ pack size: that second box asked again for the pack weight the
// ingredient already carries in its own Weight field a few lines above
// ("2.27kg"), and two boxes holding one fact drift apart.
//
// Returns { node, read() } so the form below can stay readable.
function priceBlock(item, actions) {
  // What the price box is called, per purchase form. Spelled out per unit rather
  // than assembled from the unit code, because "Price per pcs" is not English and
  // the label is the only place the ex-VAT rule can be stated.
  //
  // ⚠️ BUILT WHEN THE FORM IS DRAWN, NEVER AT MODULE LOAD. A module is evaluated
  // once, at first import — before a venue is open — so a t() in a module constant
  // freezes in the app's starting language whatever the venue says. That defect was
  // in fourteen places on 21 Aug (v1.57.0); this is the shape that avoids it.
  const RATE_LABEL = Object.freeze({
    kg: `Price per kg (${CURRENCY}, excluding VAT)`,
    l: `Price per litre (${CURRENCY}, excluding VAT)`,
    pcs: `Price per piece (${CURRENCY}, excluding VAT)`,
  });

  // The worked example under the box. It exists to pre-empt the ONE mistake this
  // form cannot detect: the invoice total typed where the rate belongs. 180 and
  // 7.20 are both perfectly valid numbers, so nothing can reject the wrong one —
  // it just makes every recipe using that ingredient cost twenty-five times too
  // much, on a screen where the answer is a percentage nobody can eyeball.
  const RATE_HINT = Object.freeze({
    kg: t('orders.thePriceOfOne'),
    l: t('orders.thePriceOfOne2'),
    pcs: t('orders.thePriceOfOne3'),
  });

  const unitSelect = el('select', { class: 'mgmt-input' });
  unitSelect.appendChild(el('option', { value: '', text: t('orders.noPrice2') }));
  PRICE_UNITS.forEach(u => {
    const opt = el('option', { value: u, text: priceUnitLabel(u) });
    if (item?.priceUnit === u) opt.selected = true;
    unitSelect.appendChild(opt);
  });

  // step="any" on both of them. A step of 0.01 makes the browser REFUSE 0.0035
  // as invalid — silently, by leaving the box empty on submit — and that is
  // exactly the number a vanilla pod weighs AND the number a gelatine leaf
  // costs, so it is the wrong step for the rate as well as for the weight.
  const money = (value, placeholder) => el('input', {
    type: 'number', class: 'mgmt-input', min: '0', step: 'any',
    inputmode: 'decimal', value: value ?? '', placeholder,
  });
  const rate = money(item?.pricePerUnit, 'e.g. 7.20');
  const pieceWeight = money(item?.unitWeightKg, 'e.g. 0.055');

  const rateLabel = el('span', { class: 'mgmt-field-label' });
  const rateHint = el('p', { class: 'notif-note' });
  // Two lines, not one. A per-piece price can be perfectly complete as a PRICE
  // and still be unusable in a recipe written in grams, and a summary that only
  // showed "£2.10 / each" would look finished while the ingredient silently
  // stayed out of every cost. The numbers go on top, what is still missing
  // underneath.
  const summaryMain = el('span', { class: 'mgmt-price-main' });
  const summaryNote = el('span', { class: 'mgmt-price-note' });
  const summary = el('p', { class: 'mgmt-price-summary' }, [summaryMain, summaryNote]);

  const pieceField = el('label', { class: 'mgmt-field' }, [
    el('span', { class: 'mgmt-field-label', text: t('orders.weightOfOnePiece') }),
    pieceWeight,
    el('p', { class: 'notif-note', text: t('orders.neededOnlyToUse') }),
  ]);

  function read() {
    return {
      priceUnit: unitSelect.value || null,
      pricePerUnit: rate.value,
      unitWeightKg: pieceWeight.value,
    };
  }

  // The live line under the boxes. It answers the only question that matters —
  // what does a kilo of this cost — while the boxes are still being typed into,
  // so a misplaced decimal point is visible before Save rather than after.
  function refresh() {
    const unit = unitSelect.value;
    pieceField.hidden = unit !== 'pcs';
    rateLabel.textContent = RATE_LABEL[unit] || `Price (${CURRENCY}, excluding VAT)`;
    rateHint.textContent = RATE_HINT[unit] || '';
    rateHint.hidden = !RATE_HINT[unit];

    const draft = pricePatch(read(), null);
    if (draft.pricePerUnit === null) {
      summaryMain.textContent = costReasonText(draft);
      summaryNote.textContent = '';
      summary.className = 'mgmt-price-summary muted';
      return;
    }
    const perKg = pricePerKg(draft);
    // For a per-piece price the price per KILO is the derived number, and it is
    // the one every recipe cost is built from — so it is spelled out rather than
    // left to be worked out from a piece weight.
    const parts = [formatPricePerUnit(draft)];
    if (unit === 'pcs' && perKg !== null) parts.push(`${formatRate(perKg)} / kg`);
    summaryMain.textContent = parts.filter(Boolean).join('  ·  ');
    // Empty whenever the ingredient IS costable, so the note only ever appears
    // when there is something left to do.
    summaryNote.textContent = costReasonText(draft);
    summary.className = 'mgmt-price-summary';
  }

  [unitSelect, rate, pieceWeight].forEach(input => {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  });
  refresh();

  const node = el('div', {}, [
    el('h3', { class: 'mgmt-section-title', text: t('orders.section.price') }),
    field(t('orders.howItIsBought'), unitSelect),
    el('label', { class: 'mgmt-field' }, [rateLabel, rate, rateHint]),
    pieceField,
    summary,
    item ? priceHistoryBlock(item, actions) : null,
  ]);

  return { node, read };
}

// The append-only record of what this ingredient has cost. Loaded only when
// asked for: it is a separate read per ingredient, and nobody opening the form to
// fix a spelling needs it (P14).
function priceHistoryBlock(item, actions) {
  const list = el('div', { class: 'mgmt-price-history' });
  const button = el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
    button.disabled = true;
    button.textContent = t('orders.loading');
    try {
      const entries = await actions.priceHistory(item.id);
      list.replaceChildren();
      button.remove();
      if (!entries.length) {
        list.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noPriceRecordedYet') }));
        return;
      }
      entries.forEach(entry => {
        list.appendChild(el('div', { class: 'mgmt-price-row' }, [
          el('span', { class: 'mgmt-price-rate', text: formatPricePerUnit(entry) }),
          el('span', { class: 'mgmt-price-when', text: shortDate(entry.recordedAt) }),
        ]));
      });
    } catch (err) {
      button.disabled = false;
      button.textContent = t('orders.priceHistory');
      await reportFailure('load the price history for', item.name, err);
    }
  } }, t('orders.priceHistory'));

  return el('div', { class: 'mgmt-field' }, [button, list]);
}

// ── Allergens and nutrition ───────────────────────────────────────────────────
//
// ⚠️ THE TICK THAT SAYS "I HAVE CHECKED THIS" IS A DELIBERATE ACT, NOT A SIDE
// EFFECT OF SAVING. If opening this form and pressing Save were enough to stamp
// an ingredient as verified, then correcting a spelling would declare it
// allergen-free — and that declaration is the one thing here that can put
// somebody in hospital. It has to be somebody saying so, on purpose.
function allergenBlock(item) {
  const boxes = new Map();   // code -> { contains, may }

  function tickRow(code) {
    const contains = el('input', { type: 'checkbox' });
    const may = el('input', { type: 'checkbox' });
    contains.checked = (item?.allergens || []).includes(code);
    may.checked = (item?.mayContain || []).includes(code);
    boxes.set(code, { contains, may });
    return el('div', { class: 'alg-row' }, [
      el('span', { class: 'alg-name', text: allergenLabel(code) }),
      el('label', { class: 'day-check alg-tick', title: `Contains ${allergenLabel(code)}` },
        [contains, el('span', { text: 'has' })]),
      el('label', { class: 'day-check alg-tick alg-tick--may', title: `May contain traces of ${allergenLabel(code)}` },
        [may, el('span', { text: 'traces' })]),
    ]);
  }

  // The two groups the law makes us name individually get their own heading, so
  // 26 boxes read as a structured list rather than a wall of ticks.
  const GROUP_TITLE = { gluten: t('orders.cerealsContainingGluten'), nuts: 'Nuts' };
  const sections = [];
  for (const group of ALLERGEN_GROUPS) {
    const codes = ALLERGENS.filter(a => a.group === group).map(a => a.code);
    if (codes.length > 1) {
      sections.push(el('p', { class: 'alg-group', text: GROUP_TITLE[group] || group }));
      codes.forEach(code => sections.push(tickRow(code)));
    }
  }
  const singles = ALLERGENS.filter(a => ALLERGENS.filter(x => x.group === a.group).length === 1);
  sections.push(el('p', { class: 'alg-group', text: t('orders.theRest') }));
  singles.forEach(a => sections.push(tickRow(a.code)));

  const checked = el('input', { type: 'checkbox' });
  checked.checked = isDeclared(item);
  const status = el('p', { class: 'alg-status' });

  const nutrients = new Map();
  const nutritionGrid = el('div', { class: 'alg-nutrition' });
  for (const n of NUTRIENTS) {
    const input = el('input', {
      type: 'number', inputmode: 'decimal', step: 'any', min: '0', class: 'mgmt-input alg-num',
      value: item?.nutrition && item.nutrition[n.key] != null ? String(item.nutrition[n.key]) : '',
    });
    nutrients.set(n.key, input);
    nutritionGrid.appendChild(el('label', { class: 'alg-nut-field' }, [
      el('span', { class: 'alg-nut-label', text: `${n.label} (${n.unit})` }),
      input,
    ]));
  }

  // ── The pack's own ingredient list, and what the app makes of it ────────────
  //
  // ⚠️⚠️ IT PROPOSES, IT NEVER DECLARES. Reading the pack pre-ticks the boxes
  // above and nothing else: `allergensCheckedAt` is untouched, so until somebody
  // presses the verification tick the ingredient still reads 'unknown' and still
  // blocks every label. A wrong suggestion costs a correction, never a false
  // declaration — that is what makes offering one safe at all.
  //
  // ⚠️ AND IT NEVER UNTICKS. Somebody who ticked a box by hand knows something
  // the pack does not say; a machine must not take it away.
  const packBox = el('textarea', {
    class: 'mgmt-input alg-pack-text', rows: '4',
    placeholder: t('orders.pack.placeholder'),
    'aria-label': t('orders.pack.label'),
  });
  packBox.value = item?.packIngredients || '';
  const packResult = el('div', { class: 'alg-pack-result' });

  function suggest() {
    packResult.replaceChildren();
    const text = packBox.value;
    const out = readPackIngredients(text);

    if (!out.hasText) {
      packResult.appendChild(el('p', { class: 'alg-pack-note', text: t('orders.pack.nothingTyped') }));
      return;
    }

    let added = 0;
    for (const code of out.allergens) {
      const pair = boxes.get(code);
      if (pair && !pair.contains.checked) { pair.contains.checked = true; added += 1; }
    }
    for (const code of out.mayContain) {
      const pair = boxes.get(code);
      if (pair && !pair.may.checked && !pair.contains.checked) { pair.may.checked = true; added += 1; }
    }
    refresh();

    // ⚠️ THE EVIDENCE, NOT JUST THE VERDICT. Re-drawing the pasted text with the
    // recognised words marked turns «did it find everything?» — which nobody can
    // answer — into «is there anything left in the grey worth checking?», which
    // anybody can. An extractor that cannot point at its reasons cannot be
    // checked by the person legally responsible for the answer.
    const marked = el('p', { class: 'alg-pack-marked' });
    let at = 0;
    for (const m of out.matches) {
      if (m.from > at) marked.appendChild(el('span', { text: text.slice(at, m.from) }));
      marked.appendChild(el('mark', {
        class: 'alg-pack-hit' + (m.traces ? ' alg-pack-hit--traces' : ''),
        title: allergenLabel(m.code),
        text: text.slice(m.from, m.to),
      }));
      at = m.to;
    }
    if (at < text.length) marked.appendChild(el('span', { text: text.slice(at) }));
    packResult.appendChild(marked);

    packResult.appendChild(el('p', {
      class: 'alg-pack-note',
      text: out.recognisedAnything
        // ⚠️ «Ticked 0 boxes» READS AS A FAILURE and is not one — it is what you
        // get every time you read the same pack twice, or correct a typo. Found
        // by looking at a screenshot: the words were plainly highlighted above
        // and the sentence underneath said nothing had happened.
        ? (added ? t('orders.pack.ticked', { n: added }) : t('orders.pack.alreadyTicked'))
        // ⚠️ RECOGNISING NOTHING IS AN ANSWER AND MUST LOOK LIKE ONE. Silence here
        // would be read as «this pack contains nothing», which is the single
        // worst thing this feature could say.
        : t('orders.pack.recognisedNothing'),
    }));

    // ⚠️ WHAT IT CANNOT ANSWER IS ASKED, NEVER GUESSED. An Italian pack very often
    // prints only «emulsionante: lecitine» — soya, sunflower or egg, and the pack
    // does not say which. Choosing the commonest is declaring something nobody
    // was told.
    for (const q of out.questions) {
      const word = text.slice(q.from, q.to);
      const names = q.could.map(allergenLabel).filter(Boolean).join(' / ');
      // ⚠️ A CATEGORY IS ITS OWN QUESTION, and it is the one the pack itself
      // raises: «può contenere tracce di FRUTTA A GUSCIO» is a real warning that
      // this app has no box for, because the law wants the specific nut. Left in
      // the vague bucket it would read as «might hide something», which
      // understates a warning the supplier actually printed.
      let line;
      if (q.kind === 'category') line = t('orders.pack.questionCategory', { word });
      else if (names) line = t('orders.pack.questionWhich', { word, options: names });
      else line = t('orders.pack.questionVague', { word });
      packResult.appendChild(el('p', { class: 'alg-pack-question', text: line }));
    }

    // The rule the whole screen rests on, restated where the temptation is.
    packResult.appendChild(el('p', { class: 'alg-pack-note alg-pack-warn', text: t('orders.pack.stillYours') }));
  }

  const suggestBtn = el('button', {
    class: 'mgmt-btn alg-pack-btn', type: 'button', text: t('orders.pack.suggest'),
    onclick: suggest,
  });

  function read() {
    const contains = [];
    const may = [];
    for (const [code, pair] of boxes) {
      if (pair.contains.checked) contains.push(code);
      if (pair.may.checked) may.push(code);
    }
    const nutrition = {};
    for (const [key, input] of nutrients) nutrition[key] = input.value === '' ? null : input.value;
    // ⚠️ The stamp is KEPT when it exists, so re-saving does not silently move
    // the verification date and make a two-year-old check look like today's.
    const stamp = checked.checked ? (checkedAt(item) || new Date().toISOString()) : '';
    return buildAllergenFields({
      allergens: contains, mayContain: may, checkedAt: stamp, nutrition,
      packIngredients: packBox.value,
    });
  }

  // The live line at the top: which of the three states this ingredient is in.
  // ⚠️ It says "not checked" in the app's warning colour on purpose — an
  // ingredient nobody has declared blocks every label it appears in, and that
  // has to look like a job rather than a blank.
  function refresh() {
    const draft = read();
    const state = allergenState(draft);
    const missing = missingNutrients({ nutrition: draft.nutrition });
    const nutritionNote = missing.length === NUTRIENTS.length
      ? t('orders.noNutritionYet')
      : (missing.length
        ? t('orders.nutritionStillEmpty', { n: missing.length, total: NUTRIENTS.length })
        : t('orders.nutritionComplete'));

    if (state === 'unknown') {
      status.textContent = t('orders.allergen.notCheckedYet', { note: nutritionNote });
      status.className = 'alg-status alg-status--unknown';
      return;
    }
    const when = (checkedAt(draft) || '').slice(0, 10);
    const what = state === 'none'
      ? t('orders.allergen.containsNone')
      : draft.allergens.map(allergenLabel).join(', ');
    // ⚠️ TWO WHOLE SENTENCES, not one with a hole in it. The date is optional, and
    // «Checked 2026-08-21 — …» / «Verificato il 2026-08-21 — …» differ by more than
    // the gap: Italian needs «il» before the date and English needs nothing.
    status.textContent = when
      ? t('orders.allergen.checkedOn', { date: when, what, note: nutritionNote })
      : t('orders.allergen.checkedNoDate', { what, note: nutritionNote });
    status.className = 'alg-status alg-status--ok';
  }

  [...boxes.values()].forEach(p => {
    p.contains.addEventListener('change', refresh);
    p.may.addEventListener('change', refresh);
  });
  nutrients.forEach(input => input.addEventListener('input', refresh));
  checked.addEventListener('change', refresh);
  refresh();

  const root = el('div', { class: 'mgmt-field alg-block' }, [
    el('span', { class: 'mgmt-field-label', text: t('orders.allergensAndNutrition') }),
    status,
    el('p', { class: 'notif-note', text: t('orders.copyThisFromThe') }),
    // ⚠️ THE PACK BOX SITS ABOVE THE 52 TICK BOXES, not below them. It is the
    // fast way to fill them in; below, it would be the thing you find after
    // doing the job by hand.
    el('div', { class: 'alg-pack' }, [
      el('span', { class: 'mgmt-field-label', text: t('orders.pack.label') }),
      el('p', { class: 'notif-note', text: t('orders.pack.help') }),
      packBox,
      suggestBtn,
      packResult,
    ]),
    el('div', { class: 'alg-list' }, sections),
    el('label', { class: 'day-check alg-checked' }, [checked, el('span', { text: t('orders.iHaveCheckedThe') })]),
    el('p', { class: 'mgmt-field-label alg-nut-title', text: t('orders.per100G') }),
    nutritionGrid,
  ]);

  return { root, read };
}

// ── The form ──────────────────────────────────────────────────────────────────
//
// item      — the ingredient being edited, or null for a new one
// suppliers — every supplier, for the picker
// preset    — a supplier id to start on when adding from inside a supplier's screen
// actions   — { saveIngredient(id, payload, record, writePrice), priceHistory(id) }
// onDone / onCancel — where the screen goes afterwards
export function buildIngredientForm({ item, suppliers, preset, actions, onDone, onCancel }) {
  const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
  const brand = el('input', { type: 'text', class: 'mgmt-input', value: item?.brand || '', placeholder: t('orders.eGGalbani') });
  const weight = el('input', { type: 'text', class: 'mgmt-input', value: item?.weight || '', placeholder: 'e.g. 2.27kg' });
  const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
  // "unit" is now the ORDER unit (how you count the order: casse, box), shown
  // next to the quantity — not a unit of measure. Same field, new meaning.
  const unit = el('input', { type: 'text', class: 'mgmt-input', value: item?.unit || '', placeholder: t('orders.eGCasseBox') });

  // "No supplier" is a real answer, not a missing one: the supermarket, the cash
  // & carry, the shop down the road. It is FIRST and it is the default for a new
  // ingredient — a forgotten pick then lands in a visible bucket of its own
  // instead of silently joining whichever supplier happens to sort first.
  //
  // It also catches an ingredient whose supplier was deleted: its stored id
  // matches nothing, so no <option> is selected and the browser falls back to the
  // first one, which is precisely where that ingredient now belongs.
  //
  // ⚠️ `preset` IS ONLY FOR A NEW ONE. Adding from inside Salvo's screen should
  // start on Salvo — but applying it to an EXISTING ingredient would silently
  // re-file somebody else's product the moment its form was opened from the wrong
  // place.
  const startOn = item ? item.supplierId : (preset || NO_SUPPLIER_ID);
  const supplierSelect = el('select', { class: 'mgmt-input' });
  supplierSelect.appendChild(el('option', { value: NO_SUPPLIER_ID, text: t('orders.noSupplier2') }));
  suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
    const opt = el('option', { value: s.id, text: s.name });
    if (startOn === s.id) opt.selected = true;
    supplierSelect.appendChild(opt);
  });

  // ⚠️ THE PRICE IS ONLY DRAWN FOR SOMEBODY WHO MAY SEE MONEY. An employee's
  // form has no price at all — not a disabled one — because a disabled field
  // still SHOWS the rate, and showing it is precisely what moving the price out
  // of the ingredient document was for.
  const mayPrice = canManageHere();
  const price = mayPrice ? priceBlock(item, actions) : null;
  const allergens = allergenBlock(item);

  const save = el('button', { type: 'button', class: 'btn-primary', onClick: async () => {
    // The supplier is no longer required — only the name is.
    if (!name.value.trim()) { name.focus(); return; }
    save.disabled = true;

    // Every price field is in the patch, as a number or as null, because this is
    // a MERGE write: a field left out keeps whatever it had, so emptying the
    // boxes could never actually remove a price.
    // An employee sends no price fields at all, so splitPriceFields writes an
    // empty price document — and saveIngredientWithPrice is told not to write
    // one, because a batch is all-or-nothing and a refused price write would
    // fail the whole save of an ordinary rename.
    const patch = mayPrice ? pricePatch(price.read(), new Date().toISOString()) : {};
    const payload = {
      name: name.value.trim(),
      supplierId: supplierSelect.value,
      brand: brand.value.trim(),
      weight: weight.value.trim(),
      category: category.value.trim() || 'Other',
      unit: unit.value.trim(),
      active: item ? item.active !== false : true,
      ...patch,
      ...allergens.read(),
    };

    // Record the price only when it is COMPLETE and actually different. Saving
    // the form to correct a spelling must not plant an identical entry — a
    // history of non-events cannot answer "when did this go up?" — and removing
    // a price is not a price, so it records nothing.
    const record = mayPrice && patch.pricePerUnit !== null && priceChanged(item, patch)
      ? priceRecord({ ...item, supplierId: payload.supplierId }, patch, patch.priceUpdatedAt)
      : null;

    try {
      await actions.saveIngredient(item?.id || null, payload, record, mayPrice);
      onDone?.();
    }
    catch (err) {
      save.disabled = false;                       // let them try again
      await reportFailure('save', payload.name, err);
    }
  } }, t('ui.save'));

  return el('div', { class: 'mgmt-form' }, [
    el('h2', { class: 'mgmt-form-title', text: item ? t('orders.editIngredient') : t('orders.newIngredient') }),
    field('Name', name),
    field('Supplier', supplierSelect),
    field('Brand', brand),
    field('Weight', weight),
    field('Category', category),
    field(t('orders.orderUnit'), unit),
    ...(price ? [price.node] : []),
    allergens.root,
    formActions(save, onCancel),
  ]);
}
