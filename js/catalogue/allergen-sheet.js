// allergen-sheet.js — the screen you CONSULT about allergens, plus the work list
// that says which ingredients to declare first.
//
// Two audiences, and they want opposite things:
//
//   Somebody at the counter, asked "does this contain nuts?", wants an answer NOW
//   and needs to be able to see instantly that a recipe has no answer yet.
//
//   Somebody filling the data in wants to know where to start — and the honest
//   answer is almost never "at the top of a list of 65". A handful of ingredients
//   appear in nearly everything, so declaring six can unblock twenty recipes while
//   the other fifty-nine matter to one recipe each.
//
// ⚠️ RESHAPED 22 Aug 2026 ON FEDERICO'S INSTRUCTION, after he opened it expecting
// to read what a recipe contains and found a to-do list. Top to bottom it is now:
// what the LAW requires here · where things stand · a search · the work · every
// recipe with its own allergens. The work lists stayed (his decision) because with
// nothing linked yet they are still the only thing this screen can tell him — but
// they are capped at six and step out of the way while he is searching.

import { t } from '../i18n.js';
import { el } from './dom.js';
// ⚠️ canLabel() is NOT imported here on purpose: rowState() asks it, so this
// screen has exactly one place that decides whether a recipe has an answer. Two
// callers of canLabel() side by side is how a row and its pill start disagreeing.
import {
  recipeAllergens, blockingIngredients, unlinkedRowNames,
  incompleteText, rowState, rowIsBlocked,
} from './recipe-allergen-model.js';
import { ALLERGEN_GROUPS } from '../allergen-model.js';
import {
  canPrintLabel, countryOf, outputLanguage, allergenGroupName, allergenGroupCodes, allergenName,
} from '../market.js';
import { filterByName } from './catalogue-model.js';
import { buildCatalogueSearch } from './search-box.js';

// Six, not twelve. Twelve was chosen when the work box was the FIRST thing on this
// screen; it no longer is, and a plan longer than a glance turns back into the flat
// list it exists to replace.
const WORK_LIMIT = 6;

export function renderAllergenSheet({
  recipes, ingredients, recipesById, getLocation,
  initialQuery = '', onQueryChange, onOpen,
}) {
  let query = initialQuery;
  let currentRecipes = Array.isArray(recipes) ? recipes : [];
  let tables = { ingredients, recipes: recipesById };
  // ⚠️⚠️ A GETTER, NOT A VALUE, AND IT IS LOAD-BEARING. This screen is drawn
  // before the session is guaranteed ready — the catalogue's own comment records
  // that the LIST had exactly this defect and nobody saw it for weeks. Captured
  // once, a null location would print "nobody has said which country" for ever, on
  // the card whose whole job is naming what the law requires HERE.
  const readLocation = typeof getLocation === 'function' ? getLocation : () => null;

  const root = el('div', { class: 'cat-view alg-sheet' });

  // ── What the law requires here ──────────────────────────────────────────────
  //
  // ⚠️ THE COUNTRY DECIDES THESE WORDS, NEVER THE INTERFACE LANGUAGE. A
  // food-label word follows where the food is SOLD — so a UK bakery reads "Wheat"
  // even with the app in Italian, and that is the law, not an oversight.
  //
  // ⚠️ AND NO COUNTRY MEANS NO LIST, deliberately — never a quiet fallback to the
  // UK. Every venue in production today is British, which is exactly what would
  // make the wrong answer invisible for the first Italian one.
  // A bare wrapper on purpose: it carries no styling, so giving it a class would
  // trip the "every class styles something" guard for no gain. The card inside is
  // .alg-sheet-law and that is what anything looking for it should ask for.
  const lawHost = el('div', {});
  root.appendChild(lawHost);
  let lawCountry;   // undefined until the card has been built once

  // ── Where things stand ──────────────────────────────────────────────────────
  const summary = el('div', { class: 'alg-sheet-summary' });
  root.appendChild(summary);

  // ── The search ──────────────────────────────────────────────────────────────
  //
  // ⚠️ RECIPE NAMES ONLY, NOT ALLERGENS, and that is a safety decision rather than
  // a shortcut. With nothing declared, searching "nuts" returns ZERO recipes — and
  // an empty result on an allergen search reads as "nothing here contains nuts",
  // which is the exact failure this whole feature exists to prevent. Worth
  // revisiting once ingredients are actually declared, and only with the screen
  // saying how many recipes it could not check.
  const { node: search } = buildCatalogueSearch({
    value: query,
    placeholder: t('cat.searchARecipe'),
    ariaLabel: t('cat.searchARecipeBy'),
    onInput: (text) => {
      query = text;
      if (onQueryChange) onQueryChange(query);
    },
    onChange: () => paint(),
  });
  root.appendChild(search);

  const panel = el('div', { class: 'cat-list-panel' });
  root.appendChild(panel);

  // ⚠️⚠️ THE WORK LISTS SIT BELOW THE RECIPES, AND THAT IS FEDERICO'S LAYOUT READ
  // LITERALLY: «sotto la barra di ricerca metti tutte le ricette». Built between
  // the search and the recipes first, and MEASURED at 390×844: the work box is
  // 296px (331px at 320px wide), which pushed the first recipe to 650px down and
  // left TWO of four recipes on screen — on the screen somebody opens to look a
  // recipe up. Below them it costs nothing: law card 126 + summary 80 + search 48,
  // so the recipes start around 254px.
  //
  // ⚠️ AND THEY ARE KEPT, WHICH WAS HIS OTHER DECISION. Moving beats cutting: with
  // nothing linked yet they are the only thing this screen can tell him, and
  // dropping them would undo v1.38.1. The two instructions do not conflict once
  // the box is somewhere else.
  const workHost = el('div', {});
  root.appendChild(workHost);

  // ⚠️ THE CAVEAT BELONGS ON THIS SCREEN TOO, not only on the recipe. This is the
  // one somebody would photograph and pin up, and a pinned sheet with no caveat
  // outlives every conversation about what it does not cover. It is appended once,
  // outside paint(), so no repaint can drop it.
  root.appendChild(el('p', { class: 'alg-sheet-caveat', text:
    t('cat.fromTheSuppliersSpecifications') }));

  // ⚠️ THE LAW CARD IS REBUILT ONLY WHEN THE COUNTRY ACTUALLY CHANGES. Rebuilding
  // it on every data refresh would slam the fold shut under whoever had just
  // opened it — which is precisely the defect v1.60.1 shipped as a hotfix, on this
  // same kind of card, and it went unnoticed for eleven days.
  function paintLaw(loc) {
    const country = countryOf(loc);
    if (lawCountry !== undefined && country === lawCountry) return;
    lawCountry = country;
    const openBefore = lawHost.querySelector('.cat-alg-toggle')
      ?.getAttribute('aria-expanded') === 'true';
    const card = lawCard(loc);
    lawHost.replaceChildren(card);
    // Carried across through the button's OWN handler, so the open state and the
    // markup can never drift apart.
    if (openBefore) card.querySelector('.cat-alg-toggle')?.click();
  }

  function paint() {
    const loc = readLocation();
    paintLaw(loc);
    const lang = outputLanguage(loc);
    const rows = currentRecipes.map(recipe => {
      const result = recipeAllergens(recipe, tables);
      return { recipe, result, state: rowState(result) };
    });

    // The counts describe the WHOLE catalogue, never the filtered slice — a
    // summary that changed while you typed would be answering a different question
    // from the one it is labelled with.
    const declaredCount = rows.filter(r => !rowIsBlocked(r.state)).length;
    const blockedCount = rows.length - declaredCount;
    summary.replaceChildren(
      el('p', { class: 'alg-sheet-count', text:
        t('cat.sheet.declaredCount', { n: declaredCount, total: rows.length }) }),
      el('p', { class: 'alg-sheet-sub', text: blockedCount
        ? t('cat.sheet.blockedCount', { n: blockedCount })
        : t('cat.everyRecipeCanBe') }),
    );

    paintWork();
    paintRows(rows, lang);
  }

  // ── The work, in the order it has to be done ────────────────────────────────
  //
  // ⚠️ LINKING COMES BEFORE DECLARING, AND THE SCREEN SAYS SO. An ingredient's
  // declaration cannot reach a recipe that does not point at it, so a sheet that
  // only ever said "declare these" was silent on the job that comes first — and on
  // the real data, where nothing was linked at all, it was silent full stop.
  //
  // ⚠️ HIDDEN WHILE SEARCHING. These describe the whole catalogue; leaving them up
  // over a filtered list of one recipe makes them look like that recipe's job.
  function paintWork() {
    workHost.replaceChildren();
    if (query.trim()) return;

    const unlinked = unlinkedRowNames(currentRecipes);
    const work = blockingIngredients(currentRecipes, tables);

    if (unlinked.length) {
      workHost.appendChild(workBox(
        t('cat.linkTheseRowsFirst'), t('cat.aRecipeRowHas'),
        unlinked, item => item.rows, 'cat.nRows',
      ));
    }
    if (work.length) {
      workHost.appendChild(workBox(
        unlinked.length ? t('cat.thenDeclareThese') : t('cat.declareTheseFirst'),
        t('cat.eachOneIsHolding'),
        work, item => item.blocks, 'cat.nRecipes',
      ));
    }
  }

  function paintRows(rows, lang) {
    // ⚠️ BLOCKED RECIPES COME FIRST. A list in alphabetical order buries the ones
    // with no answer among the ones that have one, and this screen's whole job is
    // making "we do not know" impossible to miss. The search filters WITHIN that
    // order rather than replacing it.
    const visible = filterByName(rows.map(r => r.recipe), query);
    const keep = new Set(visible);
    const shown = rows.filter(r => keep.has(r.recipe));

    const byName = (a, b) => String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''));
    const ordered = [
      ...shown.filter(r => rowIsBlocked(r.state)).sort(byName),
      ...shown.filter(r => !rowIsBlocked(r.state)).sort(byName),
    ];

    panel.replaceChildren();
    if (!ordered.length) {
      panel.appendChild(el('p', { class: 'cat-empty', text: currentRecipes.length
        ? t('cat.noRecipeMatchesYour')
        : t('cat.noRecipesYet') }));
      return;
    }
    for (const row of ordered) panel.appendChild(recipeRow(row, lang));
  }

  // ── One recipe, in one of four states ───────────────────────────────────────
  //
  // ⚠️⚠️ A BLOCKED ROW NAMES NO ALLERGEN AT ALL, and this is the line to defend.
  // A recipe with two of six rows declared does have partial knowledge, and the
  // RECIPE screen shows it — with room for the sentence saying it is not the full
  // list. Here, on a screen somebody scrolls while a customer waits, a red row
  // that nevertheless prints "Milk, Wheat" is read as the answer, and the row that
  // is missing could be the one with the hazelnuts.
  //
  // ⚠️ AND THE STATE IS A WORD, NEVER COLOUR ALONE (P18, and a red edge is
  // invisible to a colour-blind reader and to a photocopy of this screen).
  function recipeRow({ recipe, result, state }, lang) {
    const blocked = rowIsBlocked(state);

    let line;
    if (state === 'declared-listed') {
      line = result.allergens.map(code => allergenName(code, lang)).join(', ');
    } else if (state === 'declared-none') {
      line = t('cat.noneOfThe14');
    } else if (state === 'nothing-yet') {
      // ⚠️ "0 INGREDIENTS TO SORT OUT" IS NONSENSE, AND IT SHIPPED INTO THE FIRST
      // RUN OF THIS SCREEN. An empty recipe is incomplete — nobody has said it
      // contains nothing — but it has no gaps to count.
      line = t('cat.nothingInItYet');
    } else {
      line = incompleteText(result);
    }

    return el('button', {
      class: 'alg-sheet-row' + (blocked ? ' alg-sheet-row--blocked' : ''),
      type: 'button',
      onclick: () => onOpen(recipe),
    }, [
      el('span', { class: 'alg-sheet-row-main' }, [
        el('span', { class: 'alg-sheet-row-top' }, [
          el('span', { class: 'alg-sheet-name', text: recipe.name || t('cat.noName') }),
          el('span', {
            class: 'alg-sheet-pill ' + (blocked ? 'alg-sheet-pill--blocked' : 'alg-sheet-pill--ok'),
            text: blocked ? t('cat.sheet.rowNotDeclared') : t('cat.sheet.rowDeclared'),
          }),
        ]),
        el('span', { class: 'alg-sheet-what', text: line }),
      ]),
      el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
    ]);
  }

  paint();

  return {
    root,
    // ⚠️ THE SEARCH FIELD IS MOUNTED ONCE AND NEVER REBUILT. Repainting it on a
    // snapshot wipes the text and the keyboard out from under whoever is typing.
    // Only the summary, the work boxes and the rows are replaced.
    refresh(newRecipes, newIngredients, newRecipesById) {
      currentRecipes = Array.isArray(newRecipes) ? newRecipes : [];
      tables = { ingredients: newIngredients, recipes: newRecipesById };
      paint();
    },
  };
}

// ── The fourteen the law names, for this venue's country ─────────────────────

function lawCard(location) {
  const panel = el('div', { class: 'cat-alg-panel alg-sheet-law' });

  if (!canPrintLabel(location)) {
    panel.appendChild(el('div', { class: 'cat-alg-head' }, [
      el('span', { class: 'cat-alg-label', text: t('cat.sheet.theLawHere') }),
    ]));
    panel.appendChild(el('p', { class: 'cat-alg-warn', text: t('cat.sheet.noCountry') }));
    return panel;
  }

  const lang = outputLanguage(location);

  // ⚠️ THE ANSWER STAYS OUTSIDE THE FOLD, ONLY THE DETAIL FOLDS — the same rule
  // the recipe's own allergen card follows since v1.60.0. All fourteen groups are
  // readable without touching anything; what folds is which specific cereals and
  // nuts sit inside two of them, which nobody at a counter needs told.
  const body = el('div', { class: 'cat-alg-body', hidden: 'hidden' });
  const btn = el('button', {
    class: 'cat-alg-head cat-alg-toggle', type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      const open = body.hidden;
      body.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('cat-alg-toggle--open', open);
    },
  }, [
    el('span', { class: 'cat-alg-label', text: t('cat.sheet.theLawHere') }),
    el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' }),
  ]);

  panel.appendChild(btn);
  panel.appendChild(el('p', { class: 'alg-sheet-law-list', text:
    ALLERGEN_GROUPS.map(g => allergenGroupName(g, lang)).filter(Boolean).join(' · ') }));
  panel.appendChild(body);

  body.appendChild(el('p', { class: 'alg-sheet-law-sub', text: t('cat.sheet.theSpecificOnes') }));
  for (const group of ALLERGEN_GROUPS) {
    const codes = allergenGroupCodes(group, lang);
    if (!codes.length) continue;
    body.appendChild(el('p', { class: 'alg-sheet-law-group' }, [
      el('span', { class: 'alg-sheet-law-group-name', text: allergenGroupName(group, lang) }),
      el('span', { class: 'alg-sheet-law-group-codes', text: codes.join(', ') }),
    ]));
  }
  // ⚠️ THE SAME SHAPE js/staff/language.js:122 USES, deliberately — one pattern for
  // one job. It is a COMPUTED key, so tests/i18n-keys-exist.test.mjs cannot verify
  // it: written as a concatenation it read the literal `country.` and the guard
  // fired. tests/market.test.mjs now pins both `country.GB.in` and `country.IT.in`
  // in both dictionaries, which is what the scanner would have done and covers the
  // other call site too.
  body.appendChild(el('p', { class: 'cat-alg-caveat', text:
    t('cat.sheet.namesFollowCountry', { country: t(`country.${countryOf(location)}.in`) }) }));

  return panel;
}

// A named list of things to go and do, busiest first.
function workBox(title, sub, items, count, unitKey) {
  const box = el('div', { class: 'alg-sheet-work' }, [
    el('p', { class: 'alg-sheet-work-title', text: title }),
    el('p', { class: 'alg-sheet-work-sub', text: sub }),
  ]);
  const ul = el('ul', { class: 'alg-sheet-work-list' });
  for (const item of items.slice(0, WORK_LIMIT)) {
    ul.appendChild(el('li', {}, [
      el('span', { class: 'alg-sheet-work-name', text: item.name }),
      el('span', { class: 'alg-sheet-work-n', text: t(unitKey, { n: count(item) }) }),
    ]));
  }
  if (items.length > WORK_LIMIT) {
    ul.appendChild(el('li', { class: 'alg-sheet-work-more', text:
      t('cat.andMore', { n: items.length - WORK_LIMIT }) }));
  }
  box.appendChild(ul);
  return box;
}
