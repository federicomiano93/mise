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

import { el } from './dom.js';
import { buildLabel, ingredientLine, containsLine, LABEL_SHOWS } from './recipe-label-model.js';
import { allergenLabel, NUTRIENTS } from '../allergen-model.js';

const SHOW_LABELS = Object.freeze({
  allergens: 'Allergens',
  nutrition: 'Nutrition',
  both: 'Both',
});

export function renderLabel({ recipe, ingredients, recipesById, initialShows = 'both', onShowsChange }) {
  const tables = { ingredients, recipes: recipesById };
  let shows = LABEL_SHOWS.includes(initialShows) ? initialShows : 'both';

  const body = el('div', { class: 'lab-body' });
  const root = el('div', { class: 'cat-view lab-view' });

  // ── The switch ──────────────────────────────────────────────────────────────
  const switcher = el('div', { class: 'lab-switch', role: 'group', 'aria-label': 'What the label shows' });
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
    const label = buildLabel(recipe, tables, { shows });

    if (!label.ok) {
      // ⚠️ This screen should not normally be reachable when the recipe is not
      // declared — the recipe panel says so and hides the way in. It is handled
      // anyway: a recipe can lose an ingredient's declaration on another phone
      // between opening the screen and reading it, and the honest answer then is
      // the refusal rather than a stale label.
      body.replaceChildren(el('div', { class: 'lab-blocked' }, [
        el('p', { class: 'lab-blocked-title', text: 'No label can be made' }),
        el('p', { class: 'lab-blocked-text', text: label.reason === 'no-ingredients'
          ? 'This recipe has no ingredients with a weight.'
          : `${label.gaps.length} ${label.gaps.length === 1 ? 'ingredient is' : 'ingredients are'} not declared. The recipe screen lists them.` }),
      ]));
      return;
    }

    const card = el('div', { class: 'lab-card' });
    card.appendChild(el('p', { class: 'lab-name', text: label.name || 'Recipe' }));

    if (shows !== 'nutrition') {
      // ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, not only summarised
      // underneath — that is what the regulation asks for, and it is also what a
      // person scanning a label actually reads.
      const list = el('p', { class: 'lab-ingredients' }, ['Ingredients: ']);
      label.ingredients.forEach((item, i) => {
        list.appendChild(el('span', {
          class: item.emphasise ? 'lab-ing lab-ing--allergen' : 'lab-ing',
          text: item.name,
        }));
        if (i < label.ingredients.length - 1) list.appendChild(document.createTextNode(', '));
      });
      list.appendChild(document.createTextNode('.'));
      card.appendChild(list);

      const contains = containsLine(label);
      if (contains) card.appendChild(el('p', { class: 'lab-contains', text: contains }));
      if (label.mayContain.length) {
        card.appendChild(el('p', { class: 'lab-traces', text:
          `May contain: ${label.mayContain.map(allergenLabel).join(', ')}` }));
      }
    }

    if (shows !== 'allergens') {
      if (label.nutrition) {
        const table = el('table', { class: 'lab-nutrition' });
        const head = el('tr', {}, [
          el('th', { text: 'Typical values' }),
          el('th', { class: 'lab-num', text: 'per 100 g' }),
        ]);
        table.appendChild(el('thead', {}, [head]));
        const tbody = el('tbody');
        for (const n of NUTRIENTS) {
          tbody.appendChild(el('tr', {}, [
            el('td', { text: n.label }),
            el('td', { class: 'lab-num', text: `${label.nutrition[n.key]} ${n.unit}` }),
          ]));
        }
        table.appendChild(tbody);
        card.appendChild(table);
        if (label.nutrition.lossPct > 0) {
          card.appendChild(el('p', { class: 'lab-yield', text:
            `Worked out on the finished weight — ${label.nutrition.lossPct}% is lost in baking.` }));
        }
      } else {
        // ⚠️ SAID OUT LOUD. A label asked for nutrition that cannot be worked out
        // must not print the allergen half and look finished.
        card.appendChild(el('p', { class: 'lab-missing', text:
          'No nutrition table: at least one ingredient has no values per 100 g yet. The allergens above are still complete.' }));
      }
    }

    body.replaceChildren(card, caveat(), copyRow(label));
  }

  function caveat() {
    return el('div', { class: 'lab-caveat' }, [
      el('p', { class: 'lab-caveat-title', text: 'Check this before it goes on food' }),
      el('p', { text:
        'It is built from what the suppliers declared and from the recipe as written. It cannot know about your own kitchen — shared benches, shared equipment — or about a substitution made this morning.' }),
    ]);
  }

  // Copying the plain text is the one thing that works whatever gets printed in
  // the end, and it costs nothing to offer now that printing is undecided.
  function copyRow(label) {
    const status = el('span', { class: 'lab-copy-status' });
    const btn = el('button', {
      class: 'cat-alg-sheet-btn lab-copy', type: 'button',
      onclick: async () => {
        const lines = [label.name, `Ingredients: ${ingredientLine(label)}.`];
        const contains = containsLine(label);
        if (contains) lines.push(contains);
        if (label.mayContain.length) lines.push(`May contain: ${label.mayContain.map(allergenLabel).join(', ')}`);
        if (label.nutrition) {
          lines.push('Typical values per 100 g:');
          NUTRIENTS.forEach(n => lines.push(`  ${n.label}: ${label.nutrition[n.key]} ${n.unit}`));
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
          status.textContent = 'Copied';
        } catch (e) {
          status.textContent = 'Could not copy — select the text above instead';
        }
      },
    }, ['Copy the text', status]);
    return btn;
  }

  paint();
  return { root };
}
