// calculator-recipe-source.js — where a Calculator tab's ingredients come from. PURE.
//
// Federico, 14 Aug 2026: «calculator non ha più ricette proprie ma le prende da
// recipe catalogue». One recipe, in one place, edited in one screen — instead of
// the two copies that exist today and silently disagree the moment one is fixed.
//
// ⚠️⚠️ IT READS BOTH SHAPES, AND THAT IS THE WHOLE POINT OF SHIPPING IT FIRST.
// The rule this project paid for in July: the data moved before the code could
// read it, and the app was left with no weights at all, for everybody. So the
// code that understands BOTH the old shape (a tab carrying its own ingredients)
// and the new one (a tab pointing at a Catalogue recipe) goes live FIRST, works
// with today's untouched data, and only then is anything linked.
//
// No DOM, no Firestore. Every rule below is asserted in a unit test, because the
// numbers it decides are how much dough gets made.

import { ridOf } from './catalogue/guided-model.js';

// ── What can go wrong, named ─────────────────────────────────────────────────
//
// ⚠️ A LINKED RECIPE THAT CANNOT BE READ MUST REFUSE, NOT BAKE WITH NOTHING. An
// empty ingredient list computes perfectly happily and produces a dough of zero —
// which is the July defect wearing a different hat. Every problem below means the
// tab says what is wrong and calculates nothing.
export const PROBLEMS = Object.freeze({
  missing: 'missing',            // the Catalogue recipe is gone, or not loaded yet
  empty: 'empty',                // it exists but has no usable rows
  unweighable: 'unweighable',    // a row is a pinch / a piece / to taste
});

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Is this row something the Calculator can scale? The Calculator works in grams
// and multiplies everything by one factor; a row measured in pieces or "to taste"
// has no weight to multiply.
//
// ⚠️ IT BLOCKS THE WHOLE RECIPE AND NAMES THE ROW (decided 1 Aug 2026). Skipping
// it would produce a dough that is quietly light by exactly that ingredient —
// the one direction a recipe must not be wrong in.
export function isWeighable(row) {
  const unit = String(row?.unit || '').trim().toLowerCase();
  if (unit && unit !== 'g' && unit !== 'gr' && unit !== 'kg') return false;
  return num(row?.grams) > 0;
}

// Which Catalogue recipes a Calculator config actually needs.
//
// ⚠️⚠️ THIS IS WHY THE CALCULATOR MUST NEVER WATCH THE WHOLE COLLECTION. The
// Catalogue is built for 500+ recipes and the Calculator needs three; a listener
// on the collection would turn every app open from 3 reads into 500+ (P14). The
// same mistake was made and corrected on the Home's order badge (v207).
export function linkedRecipeIds(recipes) {
  const ids = (recipes || [])
    .map(r => String(r?.catalogueId || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function isLinked(recipe) {
  return !!String(recipe?.catalogueId || '').trim();
}

// The effective recipe a Calculator tab should use.
//
// Returns { name, ingredients, leaveningKey, linked, problem, problemRow }.
// `ingredients` is always the Calculator's own shape — { key, label, grams } —
// whichever side it came from, so nothing downstream has to know the difference.
export function resolveRecipe(recipe, catalogueById) {
  if (!recipe) return blank();

  // ── The shape today: the tab carries its own ingredients ──────────────────
  // Untouched by this release. A tab nobody has linked keeps working exactly as
  // it does now, which is what lets this ship before any data moves.
  if (!isLinked(recipe)) {
    return {
      name: recipe.name || '',
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      leaveningKey: recipe.leaveningKey || null,
      linked: false,
      problem: null,
      problemRow: '',
    };
  }

  const source = (catalogueById || {})[String(recipe.catalogueId).trim()];
  if (!source) {
    // ⚠️ NOT A FALLBACK TO THE OLD COPY. A stale copy is exactly what this change
    // exists to remove, and using one here would mean the app quietly bakes last
    // month's recipe whenever the network hiccups. Better to say so.
    return { ...blank(), name: recipe.name || '', linked: true, problem: PROBLEMS.missing };
  }

  const rows = Array.isArray(source.ingredients) ? source.ingredients : [];
  const usable = rows.filter(r => r && String(r.label || '').trim());
  if (!usable.length) {
    return { ...blank(), name: source.name || recipe.name || '', linked: true, problem: PROBLEMS.empty };
  }

  const blocker = usable.find(r => !isWeighable(r));
  if (blocker) {
    return {
      ...blank(),
      name: source.name || recipe.name || '',
      linked: true,
      problem: PROBLEMS.unweighable,
      problemRow: String(blocker.label || '').trim(),
    };
  }

  // ⚠️ THE KEY IS THE ROW'S OWN `rid`, NEVER ITS NAME AND NEVER ITS POSITION.
  // By name, renaming "Yeast" to "Fresh yeast" silently switches the leavening
  // knob off — and that is not hypothetical: the real Sourdough calls its
  // leavening "Starter" in the Calculator and "Sourdough starter" in the
  // Catalogue TODAY. By position, inserting one row at the top makes the yeast
  // step ask for the flour. Guided mixing settled this already; this reuses it.
  const ingredients = usable.map(r => ({
    key: ridOf(r) || String(r.label || '').trim(),
    label: String(r.label || '').trim(),
    grams: num(r.grams),
  }));

  const wanted = String(recipe.leaveningRid || '').trim();
  const leaveningKey = wanted && ingredients.some(i => i.key === wanted) ? wanted : null;

  return {
    name: source.name || recipe.name || '',
    ingredients,
    leaveningKey,
    linked: true,
    problem: null,
    problemRow: '',
  };
}

// ⚠️ A TAB THAT CANNOT BE CALCULATED MUST BE ASKED ABOUT, NOT GUESSED AT. This is
// the one function every screen should call before showing a number — the same
// shape as canLabel() on the allergen sheet, and for the same reason: an answer
// that LOOKS complete and is not is worse than no answer.
export function canCalculate(resolved) {
  return !!resolved && !resolved.problem && resolved.ingredients.length > 0;
}

// ⚠️ AND A LINKED RECIPE WHOSE LEAVENING IS GONE SAYS SO. The dough still
// calculates — every other ingredient is there — but the knob must not silently
// scale nothing while the screen goes on showing it.
export function leaveningLost(recipe, resolved) {
  return isLinked(recipe)
    && !!String(recipe?.leaveningRid || '').trim()
    && !resolved?.problem
    && !resolved?.leaveningKey;
}

function blank() {
  return { name: '', ingredients: [], leaveningKey: null, linked: false, problem: null, problemRow: '' };
}
