// registry.js — «Fornitori»: who you buy from, and what you buy from them.
//
// This is what used to sit behind the gear on the Orders screen, under a word that
// was wrong for it. A supplier's phone number and an ingredient's allergens are not
// SETTINGS — they are the records this business keeps — and nobody looks for their
// suppliers behind an ⚙. Worse, «fornitori» meant two different things inside
// Orders: tapping a supplier on the Order tab opens its ORDER, tapping the same
// supplier in the panel opened its RECORD. Same list, same word, two destinations.
//
// So the records moved to a screen of their own, one tap from the Home. The gear
// keeps what really is a setting.
//
// ⚠️ NO ROLE GATE ANYWHERE ON THE WAY IN, and that is deliberate rather than an
// oversight. The old panel was open to everybody in the location on purpose
// (adding a supplier and correcting a typo are ordinary work); only the
// irreversible half — Delete — asks canManageHere(), and firestore.rules refuses
// it regardless of what this screen chooses to draw (P2). Gating the DOOR would
// wall off the allergen form behind it, which is the one screen in this app that
// can send somebody to hospital — the exact trap v1.62.0 cost.
//
// NAVIGATION — a stack, so Back is honest at every depth:
//
//   Fornitori · Tutti gli ingredienti     (the page itself)
//     └─ one supplier: its record + everything it sells
//          ├─ its form
//          └─ one ingredient's form
//
// Each level below the first is a full-screen .mgmt-overlay with the app's standard
// header (Back on the left, title centred) — the same pattern the supplier's order
// screen and the read-only product list already use.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { buildSearchBox } from './search-box.js';
import { dayShort } from './suppliers.js';
import { NO_SUPPLIER_ID } from './no-supplier.js';
import { ingredientLabel } from './archive.js';
import { formatPricePerUnit } from '../price-model.js';
import { allergenState } from '../allergen-model.js';
import { buildIngredientForm } from './ingredient-form.js';
import {
  BACK_ICON, field, formActions, makeDayChecks, checkedDays, mgmtRow, reportFailure,
} from './mgmt-ui.js';

// data:    { suppliers(): [], ingredients(): [] } — live getters
// actions: { saveSupplier, saveIngredient, priceHistory, setSupplierActive,
//            setIngredientActive, deleteSupplier, deleteIngredient }
// -> { node, refresh() }
export function buildRegistry(data, actions) {
  let tab = 'suppliers';          // which of the two lists is on screen
  let query = '';                 // the search text for that list
  // Everything above the page itself. Each entry is { view, overlay }; Back pops one.
  const stack = [];

  const listHost = el('div', { class: 'reg-list-host' });

  // ── The two-way switch ──────────────────────────────────────────────────────
  // A .view-switch, not a .tab-bar, and the same pair the Order tab already uses:
  // these are two windows onto ONE set of records, not two different sections. It
  // is also the only two-way control in this app already measured at 320px.
  // ⚠️⚠️ THE WORDS ARE NOT PUT ON THESE BUTTONS HERE, and that is the whole point.
  // registry-main.js calls buildRegistry() at MODULE LOAD — before a venue is open, so
  // before the app knows which language it speaks. A t() on this line answers in the
  // starting language and keeps that answer for the life of the page: the two labels
  // read «Suppliers · All ingredients» on an Italian screen, in the app's own words,
  // for as long as it stayed open. Caught by driving it, not by reading it.
  //
  // ⚠️ AND IT IS THE EIGHTH SHAPE OF THAT DEFECT. tests/frozen-phrases.test.mjs looks
  // for a top-level CONST that calls t(); these calls sit inside a function, which is
  // normally the fix — except the function itself is called at module load. paintChrome()
  // below runs on every repaint instead, which is after the language is known.
  const suppliersBtn = el('button', {
    type: 'button', class: 'view-switch-btn active', role: 'tab', 'aria-selected': 'true',
    onClick: () => setTab('suppliers'),
  });
  const ingredientsBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'tab', 'aria-selected': 'false',
    onClick: () => setTab('ingredients'),
  });
  const viewSwitch = el('div', { class: 'view-switch', role: 'tablist' }, [suppliersBtn, ingredientsBtn]);

  // MOUNTED ONCE, ROWS REPAINTED — the same arrangement as the supplier list and
  // the flat ingredient list on the Order tab. A live snapshot from another phone
  // must never rip the search box out from under the finger typing into it.
  // Placeholder deliberately left empty here too — paintChrome() fills it.
  const search = buildSearchBox({
    value: query,
    // Stored immediately so an external refresh() keeps the text; the repaint is
    // the debounced half.
    onInput: text => { query = text; },
    onChange: paintList,
  });

  function setTab(next) {
    if (tab === next) return;
    tab = next;
    // Clear the search when switching, so one list's query never filters the other.
    query = '';
    search.input.value = '';
    paintList();
  }

  // Every word that is not a row: the two switch labels and the search placeholder.
  // Called from paintList(), so it runs again on every live snapshot AND after the
  // venue's language has arrived — see the note on the buttons above.
  function paintChrome() {
    suppliersBtn.textContent = t('orders.tab.suppliers');
    ingredientsBtn.textContent = t('ui.allIngredients');
    viewSwitch.setAttribute('aria-label', t('orders.registry.whichList'));
    [[suppliersBtn, tab === 'suppliers'], [ingredientsBtn, tab === 'ingredients']]
      .forEach(([btn, on]) => {
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
      });
    const ph = tab === 'suppliers' ? t('orders.searchASupplier') : t('orders.searchAnIngredient');
    search.input.placeholder = ph;
    // buildSearchBox copies the placeholder into aria-label at build time, when there
    // was none — so a screen reader would announce an unlabelled field (P18).
    search.input.setAttribute('aria-label', ph);
  }

  const node = el('div', {}, [viewSwitch, search.node, listHost]);

  // ── The two lists ───────────────────────────────────────────────────────────
  function paintList() {
    paintChrome();
    listHost.replaceChildren();
    if (tab === 'suppliers') paintSuppliers();
    else paintIngredients();
  }

  function matches(name) {
    const q = query.trim().toLowerCase();
    return !q || String(name || '').toLowerCase().includes(q);
  }

  function paintSuppliers() {
    const all = data.suppliers().slice().sort((a, b) => a.name.localeCompare(b.name));
    const visible = all.filter(s => matches(s.name));

    listHost.appendChild(el('button', {
      type: 'button', class: 'mgmt-add',
      onClick: () => openSupplierForm(null),
    }, t('orders.addSupplier')));

    if (!all.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noSuppliersYet') }));
      return;
    }
    if (!visible.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noSupplierMatchesYour') }));
      return;
    }

    // ⚠️ THE ROW OPENS THE SUPPLIER, IT DOES NOT OPEN A FORM. That is the whole
    // point of this screen existing: one level at a time, so what a supplier SELLS
    // is reachable without going through its address details first.
    const list = el('div', { class: 'mgmt-list' });
    const counts = countBySupplier();
    visible.forEach(s => list.appendChild(drillRow(
      s.name,
      // ⚠️ THE PLURAL IS IN THE DICTIONARY, never an `if` here: Italian and English
      // do not agree about when one form becomes the other, and a ternary in code
      // is a plural rule that only speaks English.
      [s.category, t('orders.productsCount', { n: counts[s.id] || 0 })].filter(Boolean).join(' · '),
      s.active !== false,
      () => openSupplier(s.id),
    )));
    listHost.appendChild(list);
  }

  // Every ingredient, A–Z, whoever sells it. ⚠️ NOT A CONVENIENCE — it is the
  // screen for going down a list of sixty-seven and declaring each one. Doing that
  // supplier by supplier means remembering which ones are done.
  function paintIngredients() {
    const supById = {};
    data.suppliers().forEach(s => { supById[s.id] = s.name; });
    const all = data.ingredients().slice().sort((a, b) => a.name.localeCompare(b.name));
    const visible = all.filter(i => matches(i.name));

    listHost.appendChild(el('button', {
      type: 'button', class: 'mgmt-add',
      onClick: () => openIngredientForm(null, null),
    }, t('orders.addIngredient')));

    if (!all.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noIngredientsYet') }));
      return;
    }
    if (!visible.length) {
      listHost.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noIngredientMatchesYour') }));
      return;
    }

    const list = el('div', { class: 'mgmt-list' });
    visible.forEach(i => list.appendChild(ingredientRow(i, supById[i.supplierId])));
    listHost.appendChild(list);
  }

  // How many products each supplier has. Built once per paint rather than filtered
  // per row: with 67 ingredients and 10 suppliers the per-row version is 670 passes
  // for a number that changes only when the data does.
  function countBySupplier() {
    const out = {};
    data.ingredients().forEach(i => {
      const key = i.supplierId || NO_SUPPLIER_ID;
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  }

  // A row that DRILLS IN: the whole row is the button, and it carries a chevron
  // saying so. Distinct from mgmtRow, whose row is inert and whose actions are the
  // links at its right-hand end.
  function drillRow(name, meta, active, onOpen) {
    return el('button', {
      type: 'button',
      class: 'mgmt-item reg-drill' + (active ? '' : ' inactive'),
      onClick: onOpen,
    }, [
      el('div', { class: 'mgmt-item-main' }, [
        el('span', { class: 'mgmt-item-name', text: name }),
        el('span', { class: 'mgmt-item-meta', text: meta }),
      ]),
      el('span', { class: 'reg-chevron', 'aria-hidden': 'true', icon: CHEVRON_SVG }),
    ]);
  }

  // ⚠️ THE ALLERGEN STATE IS ON THE ROW, and it is the only reason this list can
  // guide anybody through sixty-seven of them. Without it the list says which
  // ingredients exist; with it, it says which ones still have no answer.
  // `supplierName` is undefined ON A SUPPLIER'S OWN SCREEN, where naming the supplier
  // again would be noise.
  //
  // ⚠️ AND «undefined» MUST NOT FALL THROUGH TO «No supplier». The first draft did
  // `supplierName || t('orders.noSupplier')`, so every product on Aldo's own screen
  // said «Nessun fornitore» — a plain lie, on the screen that exists to say whose it
  // is. Found by looking at a screenshot after 34 driven checks had passed.
  function ingredientRow(item, supplierName) {
    const meta = [
      supplierName === undefined ? null : (supplierName || t('orders.noSupplier')),
      item.brand,
      formatPricePerUnit(item) || null,
    ].filter(Boolean).join(' · ');

    const row = drillRow(item.name, meta, item.active !== false,
      () => openIngredientForm(item, null));
    // ⚠️ A WORD, NEVER A COLOUR ALONE (P18, and the v1.63.0 rule). «Not declared»
    // and «contains none of the 14» look identical as an empty allergen list, and
    // only the verification stamp tells them apart.
    if (allergenState(item) === 'unknown') {
      row.querySelector('.mgmt-item-main').appendChild(
        el('span', { class: 'reg-flag', text: t('orders.notDeclaredShort') }));
    }
    return row;
  }

  // ── One supplier ────────────────────────────────────────────────────────────
  function openSupplier(id) {
    push(() => {
      const supplier = data.suppliers().find(s => s.id === id);
      // It can be gone: another phone may have deleted it while this was open.
      if (!supplier) { pop(); return null; }

      const body = el('div', { class: 'mgmt-scroll' });

      // Its own record, with the three actions. mgmtRow rather than a bespoke card:
      // Delete is gated inside it, and a second implementation of that gate is a
      // second place for it to be forgotten.
      const days = (list) => (list || []).map(dayShort).join(', ');
      const meta = [
        supplier.category,
        supplier.deliveryDays?.length ? `${t('orders.deliveryShort')} ${days(supplier.deliveryDays)}` : '',
        supplier.orderDays?.length ? `${t('orders.orderShort')} ${days(supplier.orderDays)}` : '',
        supplier.phone,
        supplier.email,
      ].filter(Boolean).join(' · ');

      body.appendChild(el('div', { class: 'mgmt-list' }, [
        mgmtRow(supplier.name, meta, supplier.active !== false,
          () => openSupplierForm(supplier),
          () => actions.setSupplierActive(supplier.id, supplier.active === false),
          // ⚠️ AFTER DELETING, STEP BACK OUT. Staying on the screen of something
          // that no longer exists leaves a Back arrow as the only way off a page
          // about nothing — and the next repaint would pop it anyway, which looks
          // like the app closing by itself.
          async () => { await actions.deleteSupplier(supplier.id); pop(); }),
      ]));

      const mine = data.ingredients()
        .filter(i => (i.supplierId || NO_SUPPLIER_ID) === supplier.id)
        .sort((a, b) => a.name.localeCompare(b.name));

      body.appendChild(el('h3', { class: 'mgmt-section-title', text: t('orders.whatTheySell') }));
      body.appendChild(el('button', {
        type: 'button', class: 'mgmt-add',
        // ⚠️ PRE-SET TO THIS SUPPLIER. Adding a product from inside Salvo's screen
        // and then having to pick Salvo from a list is the kind of re-asking that
        // makes a screen feel like a form rather than a place.
        onClick: () => openIngredientForm(null, supplier.id),
      }, t('orders.addIngredient')));

      if (!mine.length) {
        body.appendChild(el('p', { class: 'mgmt-empty', text: t('orders.noIngredientsYetAdd') }));
      } else {
        const list = el('div', { class: 'mgmt-list' });
        mine.forEach(i => list.appendChild(ingredientRow(i)));
        body.appendChild(list);
      }

      return overlay(supplier.name, body);
    });
  }

  // ── The supplier's own form ─────────────────────────────────────────────────
  function openSupplierForm(item) {
    push(() => {
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
        try { await actions.saveSupplier(item?.id || null, payload); pop(); }
        catch (err) {
          save.disabled = false;                       // let them try again
          await reportFailure('save', payload.name, err);
        }
      } }, t('ui.save'));

      const body = el('div', { class: 'mgmt-scroll' }, [
        el('div', { class: 'mgmt-form' }, [
          field(t('orders.field.name'), name),
          field(t('orders.field.category'), category),
          el('div', { class: 'mgmt-field' }, [
            el('span', { class: 'mgmt-field-label', text: t('orders.deliveryDaysWhenThey') }),
            el('div', { class: 'day-checks' }, deliveryChecks),
          ]),
          el('div', { class: 'mgmt-field' }, [
            el('span', { class: 'mgmt-field-label', text: t('orders.orderDaysWhenYou') }),
            el('div', { class: 'day-checks' }, orderChecks),
          ]),
          field(t('orders.phoneWhatsappDigitsOnly'), phone),
          field(t('orders.field.email'), email),
          formActions(save, pop),
        ]),
      ]);

      return overlay(item ? t('orders.editSupplier') : t('orders.newSupplier'), body);
    });
  }

  // ── One ingredient's form ───────────────────────────────────────────────────
  function openIngredientForm(item, presetSupplierId) {
    push(() => {
      const body = el('div', { class: 'mgmt-scroll' }, [
        buildIngredientForm({
          item,
          suppliers: data.suppliers(),
          preset: presetSupplierId,
          actions,
          onDone: pop,
          onCancel: pop,
        }),
      ]);
      return overlay(item ? t('orders.editIngredient') : t('orders.newIngredient'), body);
    });
  }

  // ── The overlay stack ───────────────────────────────────────────────────────
  function overlay(title, body) {
    return el('div', { class: 'mgmt-overlay' }, [
      el('header', { class: 'orders-header' }, [
        el('button', { type: 'button', class: 'orders-icon-btn', 'aria-label': t('ui.back'), icon: BACK_ICON, onClick: pop }),
        el('div', { class: 'orders-header-title' }, [el('h1', { text: title })]),
        // Keeps the title centred: the back button on the left needs a counterweight.
        el('span', { style: { width: '36px', flexShrink: '0' } }),
      ]),
      body,
    ]);
  }

  // `build` is a FUNCTION, not a node, so refresh() can redraw the level that is on
  // screen from live data without the caller knowing which level that is.
  function push(build) {
    const entry = { build, overlay: null };
    stack.push(entry);
    const node = build();
    if (!node) return;              // build() popped us (the thing is gone)
    entry.overlay = node;
    document.body.appendChild(node);
  }

  function pop() {
    const entry = stack.pop();
    entry?.overlay?.remove();
  }

  // ⚠️ REDRAW ONLY WHAT CANNOT BE TYPED INTO. A live snapshot arrives whenever
  // another phone saves; rebuilding a FORM would throw away half-typed allergen
  // ticks and a price nobody had saved yet. So the two forms are left alone and
  // only the list, or a supplier's screen, is repainted.
  //
  // ⚠️ AND THE TOP OF THE STACK IS REDRAWN, NOT JUST THE PAGE UNDERNEATH. A
  // supplier's screen is the one place a newly-added product has to appear, and it
  // is exactly where somebody adding sixty-seven of them is standing. Only the
  // first render was ever checked in this project before v1.60.1 deleted an
  // allergen card on the second one.
  function refresh() {
    paintList();
    const top = stack[stack.length - 1];
    if (!top || !top.overlay) return;
    if (top.overlay.querySelector('.mgmt-form')) return;   // a form: leave it be
    const next = top.build();
    if (!next) return;                                     // build() popped it
    top.overlay.replaceWith(next);
    top.overlay = next;
  }

  paintList();
  return { node, refresh };
}

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
