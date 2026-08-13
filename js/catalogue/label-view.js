// label-view.js — the label itself, on screen.
//
// ⚠️ IT IS A DRAFT FOR A HUMAN TO CHECK, AND THE SCREEN SAYS SO ONCE, PLAINLY, AND
// NEVER SCROLLS IT AWAY. The app knows what it was told about its ingredients. It
// does not know what else was on the bench this morning, what was substituted
// when the van did not come, or that a supplier quietly changed a recipe. A
// screen that looks like a finished label without saying that is the one way this
// feature can do harm.
//
// The switch decides what is WORKED OUT, not merely what is displayed — see
// buildLabel(). Asking for allergens only does not compute a nutrition table that
// is then hidden, so an ingredient with no nutrition cannot block an allergen
// label.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { buildLabel, ingredientLine, containsLine, LABEL_SHOWS } from './recipe-label-model.js';
import { NUTRIENTS } from '../allergen-model.js';
import {
  canPrintLabel, outputLanguage, labelWord, allergenName, nutrientName,
  labelLanguageNote, ingredientNamesNote, noCountryReason,
} from '../market.js';

const SHOW_LABELS = Object.freeze({
  allergens: 'Allergens',
  nutrition: 'Nutrition',
  both: 'Both',
});

// `location` is the venue's own document — its country decides what language the
// label is PRINTED in. It is not a preference and no screen may override it; see
// js/market.js for the law behind that.
//
// ⚠️⚠️ THIS FILE IMPORTS t(), AND THE RULE THAT LETS IT IS SHARPER THAN THE ONE
// IT REPLACES. Until 13 Aug 2026 no label file could import the dictionary at
// all — a coarse ban, and a correct one while this file held nothing but the
// label. But the screen AROUND the label is ordinary interface: a Copy button, a
// caveat, the sentence explaining why a label cannot be made. Leaving those in
// English gave an Italian bakery one screen in the wrong language.
//
// So the ban was replaced, HERE ONLY, by the invariant it was standing in for:
//
//   the label's WORDS come from outputLanguage(location) — the country, the law
//   the screen's words come from t()                     — the interface
//
// `lang` below is assigned once, from outputLanguage(), and every labelWord /
// allergenName / nutrientName call is passed it. tests/i18n-label-separation.test.mjs
// pins exactly that, and pins that no label file may import currentLanguage or
// setLanguage — the two ways the interface could get into the label by accident.
// js/market.js and js/catalogue/recipe-label-model.js keep the total ban: they
// have no chrome, so it costs them nothing.

export function renderLabel({ recipe, ingredients, recipesById, location, initialShows = 'both', onShowsChange }) {
  const tables = { ingredients, recipes: recipesById };
  let shows = LABEL_SHOWS.includes(initialShows) ? initialShows : 'both';
  const lang = outputLanguage(location);

  const body = el('div', { class: 'lab-body' });
  const root = el('div', { class: 'cat-view lab-view' });

  // ── The switch ──────────────────────────────────────────────────────────────
  const switcher = el('div', { class: 'lab-switch', role: 'group', 'aria-label': t('label.whatItShows') });
  const buttons = new Map();
  for (const key of LABEL_SHOWS) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button', text: SHOW_LABELS[key],
      onclick: () => { shows = key; paint(); if (onShowsChange) onShowsChange(key); },
    });
    buttons.set(key, btn);
    switcher.appendChild(btn);
  }
  root.appendChild(switcher);
  root.appendChild(body);

  function paintSwitch() {
    for (const [key, btn] of buttons) {
      const on = key === shows;
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function paint() {
    paintSwitch();

    // ⚠️⚠️ NO COUNTRY, NO LABEL — AND DELIBERATELY NOT A FALLBACK TO ENGLISH.
    // Every venue in production today is in the UK, so English would be right for
    // all of them and silently WRONG for the first Italian customer: an English
    // allergen label in Italy is not "a bit off", it is non-compliant. This is
    // the same shape as canLabel() refusing an undeclared recipe — the app would
    // rather say "I do not know" than print something that looks finished.
    if (!canPrintLabel(location)) {
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: t('label.blocked') }),
        el('p', { class: 'lab-blocked-text', text: noCountryReason() }),
      ]));
      return;
    }

    const label = buildLabel(recipe, tables, { shows });

    if (!label.ok) {
      // ⚠️ This screen should not normally be reachable when the recipe is not
      // declared — the recipe panel says so and hides the way in. It is handled
      // anyway: a recipe can lose an ingredient's declaration on another phone
      // between opening the screen and reading it, and the honest answer then is
      // the refusal rather than a stale label.
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: t('label.blocked') }),
        // ⚠️ A REAL PLURAL, not `n === 1 ?`. That ternary is English's rule
        // written into the code, and it cannot be translated by moving either half.
        el('p', { class: 'lab-blocked-text', text: label.reason === 'no-ingredients'
          ? t('label.blocked.noWeights')
          : t('label.blocked.notDeclared', { n: label.gaps.length }) }),
      ]));
      return;
    }

    const card = el('div', { class: 'lab-card' });
    card.appendChild(el('p', { class: 'lab-name', text: label.name || 'Recipe' }));

    if (shows !== 'nutrition') {
      // ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, not only summarised
      // underneath — that is what the regulation asks for, and it is also what a
      // person scanning a label actually reads.
      const list = el('p', { class: 'lab-ingredients' }, [`${labelWord('ingredients', lang)}: `]);
      label.ingredients.forEach((item, i) => {
        list.appendChild(el('span', {
          class: item.emphasise ? 'lab-ing lab-ing--allergen' : 'lab-ing',
          text: item.name,
        }));
        if (i < label.ingredients.length - 1) list.appendChild(document.createTextNode(', '));
      });
      list.appendChild(document.createTextNode('.'));
      card.appendChild(list);

      const contains = containsLine(label, lang);
      if (contains) card.appendChild(el('p', { class: 'lab-contains', text: contains }));
      if (label.mayContain.length) {
        card.appendChild(el('p', { class: 'lab-traces', text:
          `${labelWord('mayContain', lang)}: ${label.mayContain.map(c => allergenName(c, lang)).join(', ')}` }));
      }
    }

    if (shows !== 'allergens') {
      if (label.nutrition) {
        const table = el('table', { class: 'lab-nutrition' });
        const head = el('tr', {}, [
          el('th', { text: labelWord('typicalValues', lang) }),
          el('th', { class: 'lab-num', text: labelWord('per100g', lang) }),
        ]);
        table.appendChild(el('thead', {}, [head]));
        const tbody = el('tbody');
        for (const n of NUTRIENTS) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: nutrientName(n, lang) }),
            el('td', { class: 'lab-num', text: `${label.nutrition[n.key]} ${n.unit}` }),
          ]));
        }
        table.appendChild(tbody);
        card.appendChild(table);
        if (label.nutrition.lossPct > 0) {
          card.appendChild(el('p', { class: 'lab-yield', text:
            t('label.onFinishedWeight', { pct: label.nutrition.lossPct }) }));
        }
      } else {
        // ⚠️ SAID OUT LOUD. A label asked for nutrition that cannot be worked out
        // must not print the allergen half and look finished.
        card.appendChild(el('p', { class: 'lab-missing', text:
          t('label.noNutrition') }));
      }
    }

    body.replaceChildren(card, languageNote(), caveat(), copyRow(label));
  }

  // ⚠️ IMMEDIATELY UNDER THE CARD, NOT AT THE END OF A SCROLL. Somebody printing
  // a label in an English bakery while reading an Italian interface has to be
  // able to see, without asking, that the English is on purpose — and the day the
  // interface switch ships (R2) that is exactly the question they will have.
  //
  // ⚠️ AND THE SECOND LINE IS WHAT THE APP CANNOT DO. Ingredient names are typed
  // by hand in Orders and are NOT translated: an Italian venue must type Italian
  // names, or the label reads "Contiene: Wheat" — half translated, which is worse
  // than either language whole. Saying so is the only honest option available.
  function languageNote() {
    return el('div', { class: 'lab-language' }, [
      el('p', { class: 'lab-language-line', text: labelLanguageNote(location) }),
      el('p', { class: 'lab-language-line', text: ingredientNamesNote(location) }),
    ]);
  }

  function caveat() {
    return el('div', { class: 'lab-caveat' }, [
      el('p', { class: 'lab-caveat-title', text: t('label.caveat.title') }),
      el('p', { text: t('label.caveat.body') }),
    ]);
  }

  // Copying the plain text is the one thing that works whatever gets printed in
  // the end, and it costs nothing to offer now that printing is undecided.
  function copyRow(label) {
    const status = el('span', { class: 'lab-copy-status' });
    const btn = el('button', {
      class: 'cat-alg-sheet-btn lab-copy', type: 'button',
      onclick: async () => {
        // ⚠️ THE COPIED TEXT IS THE LABEL. Whatever gets printed in the end comes
        // from here, so it follows the same language — a copy in English pasted
        // onto Italian packaging is the whole defect this release prevents,
        // arriving through the one door nobody thought of.
        const lines = [label.name, `${labelWord('ingredients', lang)}: ${ingredientLine(label)}.`];
        const contains = containsLine(label, lang);
        if (contains) lines.push(contains);
        if (label.mayContain.length) {
          lines.push(`${labelWord('mayContain', lang)}: ${label.mayContain.map(c => allergenName(c, lang)).join(', ')}`);
        }
        if (label.nutrition) {
          lines.push(`${labelWord('typicalValues', lang)} ${labelWord('per100g', lang)}:`);
          NUTRIENTS.forEach(n => lines.push(`  ${nutrientName(n, lang)}: ${label.nutrition[n.key]} ${n.unit}`));
        }
        try {
          // ⚠️ RACED, NOT AWAITED FOREVER. navigator.clipboard.writeText can hang
          // indefinitely when the page is not focused — it did exactly that on the
          // client-ordering link in v251, leaving the button dead and the person
          // told nothing.
          await Promise.race([
            navigator.clipboard.writeText(lines.join('\n')),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          status.textContent = t('label.copied');
        } catch (e) {
          status.textContent = t('label.copyFailed');
        }
      },
    }, [t('label.copy'), status]);
    return btn;
  }

  paint();
  return { root };
}
