// calculator-recipe-text.js — PURE text builder for the Copy/WhatsApp recipe
// export (no DOM, no Firebase, no storage), so it is unit-testable in isolation
// (P15 — the owner cannot read code). It takes the same ingredient data that
// feeds the on-screen render — a [{ name, grams }] list plus the total grams —
// so the export no longer re-reads the rendered DOM markup.

// Plain ASCII divider: the box-drawing character used before (U+2500) renders as
// a "missing glyph" box on some phone/WhatsApp fonts.
const SEP = '-'.repeat(22);

// One aligned "name:   value g" line, padded exactly as the old export did.
function fmtLine(name, val) {
  return (name + ':').padEnd(11) + String(val).padStart(5) + ' g';
}

// One ingredient → its export line(s). "Flour uniqua blue" is split onto two
// lines ("Flour uniqua" as a bare label, then "blue:" with the value) so the
// long name does not overflow — preserved exactly from the original export.
// ⚠️⚠️ THESE TWO ARE NOT PHRASES AND MUST NEVER BE TRANSLATED. "Flour uniqua
// blue" is an INGREDIENT NAME somebody typed into their own recipe, and this line
// COMPARES against it. Translated, the comparison would look for the Italian
// words, never match, and the special two-line formatting would silently stop
// happening — with nothing on screen to say why. The automatic extraction pass of
// 13 Aug 2026 turned both into dictionary keys; this is that being undone.
//
// The same shape as the weekday ids and the section keys in DATA_WORDS: an
// English word that is DATA, not a label. It cannot go in DATA_WORDS because it
// is one venue's ingredient rather than the app's own vocabulary — so it is
// pinned by tests/calculator-recipe-text.test.mjs instead.
const FLOUR_UNIQUA_BLUE = 'Flour uniqua blue';
const FLOUR_UNIQUA = 'Flour uniqua';

function formatIngredient(name, val) {
  if (name === FLOUR_UNIQUA_BLUE) {
    return [FLOUR_UNIQUA, fmtLine('blue', val)];
  }
  return [fmtLine(name, val)];
}

// Build the full recipe text from a recipe name, its ingredient rows and total.
// name: the recipe's name (shown uppercased on the first line). rows: [{ name,
// grams }]. totalG: integer grams. Returns '' when there are no rows.
import { t } from './i18n.js';

export function buildRecipeText(name, rows, totalG) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const title = String(name || 'Recipe').toUpperCase();
  return [
    title + '  ' + (totalG / 1000).toFixed(1) + ' kg',
    SEP,
    ...rows.flatMap(r => formatIngredient(r.name, Math.round(r.grams))),
  ].join('\n');
}
