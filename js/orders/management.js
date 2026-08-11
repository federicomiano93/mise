// management.js — management panel (settings icon).
//
// isAdmin is hardcoded true for now (placeholder — real role checks arrive with
// real auth; note the panel being open is UX only, the Firestore rules still
// validate every write). Lets an admin add/edit/deactivate/delete suppliers (with
// delivery days, order days and contact details) and ingredients (with supplier,
// category and unit). "Deactivate" sets active:false (reversible, hides from the
// order screen); "Delete" removes the document permanently (irreversible, gated
// by a strong confirm and by the Firestore rules).
//
// data: { suppliers(): [], ingredients(): [] } — live getters from orders-main.
// actions: { onClose, saveSupplier(id,payload), saveIngredient(id,payload),
//            setSupplierActive(id,bool), setIngredientActive(id,bool),
//            deleteSupplier(id), deleteIngredient(id) }

import { el } from './dom.js';
import { renderNotificationSettings } from './notifications.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { NO_SUPPLIER_ID } from './no-supplier.js';
import { buildSearchBox } from './search-box.js';
import {
  CURRENCY, PRICE_UNITS, PRICE_UNIT_LABELS,
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

export const isAdmin = true; // placeholder until real auth/roles exist

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

export function buildManagement(data, actions) {
  let tab = 'suppliers';
  let view = { type: 'list' };
  let listQuery = ''; // search text for the current list (Suppliers / Ingredients)

  const content = el('div', { class: 'mgmt-scroll' });
  // Three tabs, not four: measured on a phone, the bar is already full at three (the
  // longest label wants 81px and has 78). So the settings that are not a list live
  // together under "General" instead of getting a tab each.
  const tabBar = el('nav', { class: 'tab-bar' }, [
    tabButton('Suppliers', 'suppliers'),
    tabButton('Ingredients', 'ingredients'),
    tabButton('General', 'general'),
  ]);

  // The header button is a context-aware Back arrow (matches the app's drill-in
  // pattern): inside a form it returns to the list; on a list it closes the panel.
  const overlay = el('div', { class: 'mgmt-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', { type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back', icon: BACK_ICON, onClick: handleBack }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'Management' })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    tabBar,
    content,
  ]);

  function handleBack() {
    if (view.type === 'supplierForm' || view.type === 'ingredientForm') {
      view = { type: 'list' };
      render();
    } else {
      actions.onClose();
    }
  }

  function tabButton(label, key) {
    return el('button', { type: 'button', class: 'tab', dataset: { tab: key },
      // Clear the search when switching tab, so one list's query never filters another.
      onClick: () => { tab = key; view = { type: 'list' }; listQuery = ''; render(); } }, label);
  }

  function render() {
    tabBar.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    content.textContent = '';
    if (view.type === 'supplierForm') content.appendChild(supplierForm(view.item));
    else if (view.type === 'ingredientForm') content.appendChild(ingredientForm(view.item));
    else if (tab === 'general') renderGeneral();
    else if (tab === 'suppliers') renderSupplierList();
    else renderIngredientList();
  }

  // Everything that is a setting rather than a list: how the order screen looks, then
  // the alerts.
  function renderGeneral() {
    content.appendChild(el('h3', { class: 'mgmt-section-title', text: 'Order screen' }));
    content.appendChild(buildStockToggle());
    content.appendChild(buildHistoryDaysField());

    content.appendChild(el('h3', { class: 'mgmt-section-title', text: 'Alerts' }));
    const box = el('div', { class: 'mgmt-notif' });
    content.appendChild(box);
    renderNotificationSettings(box);
  }

  // Show or hide the Stock box on every order row, for EVERY phone (it is stored in
  // Firestore, not on this device). Applied on the tap, like the notification control
  // above it — there is nothing to lose by getting it wrong, and one more tap undoes it.
  function buildStockToggle() {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = data.ordersConfig().showStock;

    cb.addEventListener('change', async () => {
      const wanted = cb.checked;
      cb.disabled = true;
      try {
        await actions.saveOrdersConfig({ showStock: wanted });
      } catch (err) {
        cb.checked = !wanted;          // put the box back to what is actually stored
        await reportFailure('save', 'Show stock', err);
      } finally {
        cb.disabled = false;
      }
    });

    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-toggle' }, [cb, el('span', { text: 'Show the Stock box on order rows' })]),
      el('p', { class: 'notif-note', text:
        'Turn this off if you do not count what is left before ordering. Suggested quantities keep working: with no stock entered they become your usual order amount.' }),
    ]);
  }

  // How far back the History tab reaches before asking. The app is mostly used by
  // kitchen staff, who need this week's orders rather than last month's — but this
  // HIDES and never deletes, which is why the note under it says so out loud.
  //
  // Saved on `change` (blur or Enter), not on every keystroke: typing "20" passes
  // through "2", and saving that would push a 2-day window onto every phone in the
  // bakery for as long as it takes to type the second digit.
  function buildHistoryDaysField() {
    const input = el('input', {
      type: 'number', min: '1', max: '365', inputmode: 'numeric',
      class: 'mgmt-input', id: 'history-days-input',
    });
    input.value = String(data.ordersConfig().historyDays);

    input.addEventListener('change', async () => {
      const stored = data.ordersConfig().historyDays;
      const wanted = Math.floor(Number(input.value));
      // Refuse rather than store: an empty box or a 0 would render an EMPTY History,
      // which reads as "the orders have been deleted" — the one impression this
      // feature must never give.
      if (!Number.isFinite(wanted) || wanted < 1 || wanted > 365) {
        input.value = String(stored);
        return;
      }
      if (wanted === stored) return;

      input.disabled = true;
      try {
        await actions.saveOrdersConfig({ historyDays: wanted });
      } catch (err) {
        input.value = String(stored);   // put the box back to what is actually stored
        await reportFailure('save', 'Days of history', err);
      } finally {
        input.disabled = false;
      }
    });

    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-field-label', for: 'history-days-input',
        text: 'Days of past orders shown in History' }),
      el('div', { class: 'mgmt-days-row' }, [input, el('span', { text: 'days' })]),
      el('p', { class: 'notif-note', text:
        'Older orders are never deleted — they stay one tap away under "Show older orders", and suggested quantities keep learning from all of them.' }),
    ]);
  }

  // ── Lists ─────────────────────────────────────────────────────────────────
  // Search box + Add button + a filtered list, shared by both lists. Only the list
  // is repainted per keystroke (never the search box), so the input keeps focus
  // while typing; the query lives in listQuery so an external refresh() keeps it.
  function renderSearchableList({ items, addLabel, placeholder, onAdd, rowFor, emptyText, noMatchText }) {
    const search = buildSearchBox({
      value: listQuery,
      placeholder,
      // Stored immediately so an external refresh() keeps the text; the repaint is
      // the debounced half.
      onInput: text => { listQuery = text; },
      onChange: paint,
    });
    const listEl = el('div', { class: 'mgmt-list' });

    function paint() {
      const q = listQuery.trim().toLowerCase();
      const all = items().slice().sort((a, b) => a.name.localeCompare(b.name));
      const visible = q ? all.filter(it => (it.name || '').toLowerCase().includes(q)) : all;
      listEl.replaceChildren();
      if (!all.length) listEl.appendChild(el('p', { class: 'mgmt-empty', text: emptyText }));
      else if (!visible.length) listEl.appendChild(el('p', { class: 'mgmt-empty', text: noMatchText }));
      else visible.forEach(it => listEl.appendChild(rowFor(it)));
    }

    paint();
    content.appendChild(search.node);
    content.appendChild(el('button', { type: 'button', class: 'mgmt-add', onClick: onAdd }, addLabel));
    content.appendChild(listEl);
  }

  function renderSupplierList() {
    renderSearchableList({
      items: () => data.suppliers(),
      addLabel: '+ Add supplier',
      placeholder: 'Search a supplier…',
      onAdd: () => { view = { type: 'supplierForm', item: null }; render(); },
      emptyText: 'No suppliers yet.',
      noMatchText: 'No supplier matches your search.',
      rowFor: (s) => {
        const meta = [s.category, (s.deliveryDays || []).join(', ')].filter(Boolean).join(' · ');
        return mgmtRow(s.name, meta, s.active !== false,
          () => { view = { type: 'supplierForm', item: s }; render(); },
          () => actions.setSupplierActive(s.id, s.active === false),
          () => actions.deleteSupplier(s.id));
      },
    });
  }

  function renderIngredientList() {
    const supById = {};
    data.suppliers().forEach(s => { supById[s.id] = s.name; });
    renderSearchableList({
      items: () => data.ingredients(),
      addLabel: '+ Add ingredient',
      placeholder: 'Search an ingredient…',
      onAdd: () => { view = { type: 'ingredientForm', item: null }; render(); },
      emptyText: 'No ingredients yet.',
      noMatchText: 'No ingredient matches your search.',
      rowFor: (i) => {
        // The price is on the row, and "No price" is said out loud when there is
        // none — that is what turns this list into the list of what is still to be
        // filled in. Every ingredient starts without one and nothing migrates them.
        const meta = [supById[i.supplierId] || 'No supplier', i.brand, i.weight,
                      formatPricePerUnit(i) || 'No price'].filter(Boolean).join(' · ');
        return mgmtRow(i.name, meta, i.active !== false,
          () => { view = { type: 'ingredientForm', item: i }; render(); },
          () => actions.setIngredientActive(i.id, i.active === false),
          () => actions.deleteIngredient(i.id));
      },
    });
  }

  // Report a failed write. Every write in this panel used to drop its promise, so a
  // rejection (network down, or a Firestore rule refusing the payload) left the
  // operator looking at an unchanged row with no idea anything had gone wrong.
  //
  // A dialog, not the Orders status line: this panel is a full-screen overlay, so
  // #orders-status is BEHIND it and would never be read. alertDialog sits at
  // z-index 10000, above the overlay.
  async function reportFailure(action, name, err) {
    console.error(`${action} failed:`, err);
    await alertDialog(
      `Could not ${action} "${name}". Check your network and try again.`,
      { title: 'Not saved' },
    );
  }

  // A row with three actions: Edit, Deactivate/Activate (reversible), Delete
  // (permanent). Deactivate confirms only when hiding; Delete always confirms with
  // a strong, irreversible warning and is styled low-key in danger red (P20).
  function mgmtRow(name, meta, active, onEdit, onToggle, onDelete) {
    return el('div', { class: 'mgmt-item' + (active ? '' : ' inactive') }, [
      el('div', { class: 'mgmt-item-main' }, [
        el('span', { class: 'mgmt-item-name', text: name }),
        el('span', { class: 'mgmt-item-meta', text: meta }),
      ]),
      el('div', { class: 'mgmt-item-actions' }, [
        el('button', { type: 'button', class: 'mgmt-link', onClick: onEdit }, 'Edit'),
        el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
          // Confirm before deactivating (guards against accidental taps);
          // reactivating is harmless and needs no confirmation.
          if (active) {
            const ok = await confirmDialog({
              message: `Deactivate "${name}"? It will be hidden from the order screen. You can reactivate it later.`,
              okLabel: 'Deactivate', danger: true,
            });
            if (!ok) return;
          }
          try { await onToggle(); }
          catch (err) { await reportFailure(active ? 'deactivate' : 'activate', name, err); }
        } }, active ? 'Deactivate' : 'Activate'),
        el('button', { type: 'button', class: 'mgmt-link danger', onClick: async () => {
          const ok = await confirmDialog({
            message: `Permanently delete "${name}"? This cannot be undone.`,
            okLabel: 'Delete', danger: true,
          });
          if (!ok) return;
          try { await onDelete(); }
          catch (err) { await reportFailure('delete', name, err); }
        } }, 'Delete'),
      ]),
    ]);
  }

  // ── Forms ───────────────────────────────────────────────────────────────────
  function field(labelText, input) {
    return el('label', { class: 'mgmt-field' }, [el('span', { class: 'mgmt-field-label', text: labelText }), input]);
  }

  // Build one weekday checkbox group (used for both delivery days and order days).
  function makeDayChecks(selectedDays) {
    return WEEKDAYS.map(day => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = (selectedDays || []).includes(day);
      cb.dataset.day = day;
      return el('label', { class: 'day-check' }, [cb, el('span', { text: day.slice(0, 3) })]);
    });
  }
  function checkedDays(checks) {
    return checks.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.dataset.day);
  }

  function supplierForm(item) {
    const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
    const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
    const phone = el('input', { type: 'tel', class: 'mgmt-input', value: item?.phone || '', placeholder: 'e.g. 447700900123' });
    const email = el('input', { type: 'email', class: 'mgmt-input', value: item?.email || '' });

    const deliveryChecks = makeDayChecks(item?.deliveryDays);
    const orderChecks = makeDayChecks(item?.orderDays);

    const save = el('button', { type: 'button', class: 'btn-primary', onClick: async () => {
      if (!name.value.trim()) { name.focus(); return; }
      save.disabled = true;
      const payload = {
        name: name.value.trim(),
        category: category.value.trim(),
        phone: phone.value.trim(),
        email: email.value.trim(),
        deliveryDays: checkedDays(deliveryChecks),
        orderDays: checkedDays(orderChecks),
        active: item ? item.active !== false : true,
      };
      try { await actions.saveSupplier(item?.id || null, payload); view = { type: 'list' }; render(); }
      catch (err) {
        save.disabled = false;                       // let them try again
        await reportFailure('save', payload.name, err);
      }
    } }, 'Save');

    return el('div', { class: 'mgmt-form' }, [
      el('h2', { class: 'mgmt-form-title', text: item ? 'Edit supplier' : 'New supplier' }),
      field('Name', name),
      field('Category', category),
      el('div', { class: 'mgmt-field' }, [
        el('span', { class: 'mgmt-field-label', text: 'Delivery days — when they deliver' }),
        el('div', { class: 'day-checks' }, deliveryChecks),
      ]),
      el('div', { class: 'mgmt-field' }, [
        el('span', { class: 'mgmt-field-label', text: 'Order days — when you place the order' }),
        el('div', { class: 'day-checks' }, orderChecks),
      ]),
      field('Phone (WhatsApp, digits only)', phone),
      field('Email', email),
      formActions(save),
    ]);
  }

  // What the price box is called, per purchase form. Spelled out per unit rather
  // than assembled from the unit code, because "Price per pcs" is not English and
  // the label is the only place the ex-VAT rule can be stated.
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
    kg: 'The price of ONE KILO, not of the pack — a 25 kg sack at £180 is 7.20.',
    l: 'The price of ONE LITRE, not of the container — a 5 l tin at £30 is 6.00.',
    pcs: 'The price of ONE PIECE, not of the box — a box of 100 at £3.50 is 0.035.',
  });

  // ── The price block inside the ingredient form ──────────────────────────────
  // One number and a unit. The rate is typed rather than derived from a pack
  // price ÷ pack size: that second box asked again for the pack weight the
  // ingredient already carries in its own Weight field a few lines above
  // ("2.27kg"), and two boxes holding one fact drift apart.
  //
  // Returns { node, read() } so the form above can stay readable.
  function priceBlock(item) {
    const unitSelect = el('select', { class: 'mgmt-input' });
    unitSelect.appendChild(el('option', { value: '', text: '— No price —' }));
    PRICE_UNITS.forEach(u => {
      const opt = el('option', { value: u, text: PRICE_UNIT_LABELS[u] });
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
      el('span', { class: 'mgmt-field-label', text: 'Weight of one piece (kg)' }),
      pieceWeight,
      el('p', { class: 'notif-note', text:
        'Needed only to use this in a recipe written in grams — one egg is about 0.055, a vanilla pod about 0.0035.' }),
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
      el('h3', { class: 'mgmt-section-title', text: 'Price' }),
      field('How it is bought', unitSelect),
      el('label', { class: 'mgmt-field' }, [rateLabel, rate, rateHint]),
      pieceField,
      summary,
      item ? priceHistoryBlock(item) : null,
    ]);

    return { node, read };
  }

  // The append-only record of what this ingredient has cost. Loaded only when
  // asked for: it is a separate read per ingredient, and nobody opening the form to
  // fix a spelling needs it (P14).
  function priceHistoryBlock(item) {
    const list = el('div', { class: 'mgmt-price-history' });
    const button = el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        const entries = await actions.priceHistory(item.id);
        list.replaceChildren();
        button.remove();
        if (!entries.length) {
          list.appendChild(el('p', { class: 'mgmt-empty', text: 'No price recorded yet.' }));
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
        button.textContent = 'Price history';
        await reportFailure('load the price history for', item.name, err);
      }
    } }, 'Price history');

    return el('div', { class: 'mgmt-field' }, [button, list]);
  }

  // "10 Aug 2026" from an ISO stamp. Anything unreadable falls back to the raw
  // value rather than to "Invalid Date", which tells the reader nothing.
  function shortDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Allergens and nutrition ─────────────────────────────────────────────────
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
    const GROUP_TITLE = { gluten: 'Cereals containing gluten', nuts: 'Nuts' };
    const sections = [];
    for (const group of ALLERGEN_GROUPS) {
      const codes = ALLERGENS.filter(a => a.group === group).map(a => a.code);
      if (codes.length > 1) {
        sections.push(el('p', { class: 'alg-group', text: GROUP_TITLE[group] || group }));
        codes.forEach(code => sections.push(tickRow(code)));
      }
    }
    const singles = ALLERGENS.filter(a => ALLERGENS.filter(x => x.group === a.group).length === 1);
    sections.push(el('p', { class: 'alg-group', text: 'The rest' }));
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
      return buildAllergenFields({ allergens: contains, mayContain: may, checkedAt: stamp, nutrition });
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
        ? 'No nutrition yet.'
        : (missing.length ? `Nutrition: ${missing.length} of ${NUTRIENTS.length} still empty.` : 'Nutrition complete.');

      if (state === 'unknown') {
        status.textContent = `Not checked yet — this ingredient blocks any label it is used in. ${nutritionNote}`;
        status.className = 'alg-status alg-status--unknown';
        return;
      }
      const when = (checkedAt(draft) || '').slice(0, 10);
      const what = state === 'none'
        ? 'contains none of the 14'
        : draft.allergens.map(allergenLabel).join(', ');
      status.textContent = `Checked${when ? ` ${when}` : ''} — ${what}. ${nutritionNote}`;
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
      el('span', { class: 'mgmt-field-label', text: 'Allergens and nutrition' }),
      status,
      el('p', { class: 'notif-note', text:
        'Copy this from the supplier’s specification, not from memory. "traces" is what the supplier declares — it cannot know about your own kitchen.' }),
      el('div', { class: 'alg-list' }, sections),
      el('label', { class: 'day-check alg-checked' }, [checked, el('span', { text: 'I have checked the supplier’s specification' })]),
      el('p', { class: 'mgmt-field-label alg-nut-title', text: 'Per 100 g' }),
      nutritionGrid,
    ]);

    return { root, read };
  }

  function ingredientForm(item) {
    const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
    const brand = el('input', { type: 'text', class: 'mgmt-input', value: item?.brand || '', placeholder: 'e.g. Galbani' });
    const weight = el('input', { type: 'text', class: 'mgmt-input', value: item?.weight || '', placeholder: 'e.g. 2.27kg' });
    const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
    // "unit" is now the ORDER unit (how you count the order: casse, box), shown
    // next to the quantity — not a unit of measure. Same field, new meaning.
    const unit = el('input', { type: 'text', class: 'mgmt-input', value: item?.unit || '', placeholder: 'e.g. casse, box' });

    // "No supplier" is a real answer, not a missing one: the supermarket, the cash
    // & carry, the shop down the road. It is FIRST and it is the default for a new
    // ingredient — a forgotten pick then lands in a visible bucket of its own
    // instead of silently joining whichever supplier happens to sort first.
    //
    // It also catches an ingredient whose supplier was deleted: its stored id
    // matches nothing, so no <option> is selected and the browser falls back to the
    // first one, which is precisely where that ingredient now belongs.
    const supplierSelect = el('select', { class: 'mgmt-input' });
    supplierSelect.appendChild(el('option', { value: NO_SUPPLIER_ID, text: '— No supplier —' }));
    data.suppliers().slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      const opt = el('option', { value: s.id, text: s.name });
      if (item?.supplierId === s.id) opt.selected = true;
      supplierSelect.appendChild(opt);
    });

    const price = priceBlock(item);
    const allergens = allergenBlock(item);

    const save = el('button', { type: 'button', class: 'btn-primary', onClick: async () => {
      // The supplier is no longer required — only the name is.
      if (!name.value.trim()) { name.focus(); return; }
      save.disabled = true;

      // Every price field is in the patch, as a number or as null, because this is
      // a MERGE write: a field left out keeps whatever it had, so emptying the
      // boxes could never actually remove a price.
      const patch = pricePatch(price.read(), new Date().toISOString());
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
      const record = patch.pricePerUnit !== null && priceChanged(item, patch)
        ? priceRecord({ ...item, supplierId: payload.supplierId }, patch, patch.priceUpdatedAt)
        : null;

      try { await actions.saveIngredient(item?.id || null, payload, record); view = { type: 'list' }; render(); }
      catch (err) {
        save.disabled = false;                       // let them try again
        await reportFailure('save', payload.name, err);
      }
    } }, 'Save');

    return el('div', { class: 'mgmt-form' }, [
      el('h2', { class: 'mgmt-form-title', text: item ? 'Edit ingredient' : 'New ingredient' }),
      field('Name', name),
      field('Supplier', supplierSelect),
      field('Brand', brand),
      field('Weight', weight),
      field('Category', category),
      field('Order unit', unit),
      price.node,
      allergens.root,
      formActions(save),
    ]);
  }

  function formActions(saveBtn) {
    return el('div', { class: 'mgmt-form-actions' }, [
      el('button', { type: 'button', class: 'btn-secondary', onClick: () => { view = { type: 'list' }; render(); } }, 'Cancel'),
      saveBtn,
    ]);
  }

  render();

  // Only re-render from outside (live data change) when not in the middle of a form.
  return { overlay, refresh: () => { if (view.type === 'list') render(); } };
}
