// help-content.js — PURE: what each screen of the app is for, in a few lines.
//
// It is only text and it is deliberately here, in one file, rather than written into
// each screen: an explanation that lives next to the thing it explains gets edited
// when the code does, and an explanation kept in one place gets READ as a set, which
// is how you notice that two of them contradict each other.
//
// ⚠️ SHORT ON PURPOSE. Three to five lines, and the last one is the trap — the thing
// somebody would otherwise learn by getting it wrong. A screen-by-screen manual is a
// thing people do not read and nobody keeps up to date, and an explanation that has
// drifted out of date is worse than none: it is believed.
//
// The wording is English like every other word in the app, so the two people in the
// bakery who do not read Italian get the same help as everyone else.

// Each entry: the screen's own name, and the lines. Kept as an ARRAY rather than one
// blob so the tests can hold each line to its own length, and so a line can never be
// lost inside a paragraph.
import { t } from './i18n.js';

export const HELP = {
  home: {
    title: 'Misé',
    lines: [
      'help.eachCardOpensOne',
      'help.yourWorkIsSaved',
      'help.everyScreenHasA',
      'help.aNumberOnA',
    ],
  },

  calculator: {
    title: 'Calculator',
    lines: [
      'help.typeHowManyPieces',
      'help.confirmSavesTheSheet',
      'help.theFieldsEmptyThemselves',
    ],
  },

  'client-orders': {
    title: 'help.ordersReceived',
    lines: [
      'help.ordersYourClientsTyped',
      'help.putInTheCalculator',
      'help.ifAClientChanges',
      'help.ordersForDaysAlready',
    ],
  },

  catalogue: {
    title: 'help.recipeCatalogue',
    lines: [
      'help.everyRecipeYouHave',
      'help.guidedMixingWalksA',
      'help.linkARowTo',
      'help.ifOnlySomeRows',
    ],
  },

  orders: {
    title: 'Orders',
    lines: [
      'help.whatToBuySupplier',
      'help.orderPlacedRecordsIt',
      'help.suggestedAmountsComeFrom',
    ],
  },

  suppliers: {
    title: 'section.suppliersAndIngredients',
    lines: [
      'help.suppliersEverythingYouBuy',
      'help.suppliersAllergensLiveHere',
      'help.suppliersPasteThePack',
    ],
  },

  foodcost: {
    title: 'help.foodCost',
    lines: [
      'help.whatAProductCosts',
      'help.typeTheSellingPrice',
      'help.itIsOnlyRight',
    ],
  },

  pastries: {
    title: 'Pastries',
    lines: [
      'help.whatToPutOut',
      'help.confirmKeepsARecord',
      'help.unlikeTheCalculatorA',
    ],
  },
};

export const SECTIONS = Object.keys(HELP);

export function helpFor(id) {
  return HELP[String(id || '')] || null;
}

// The message the dialog shows. Blank lines between, because .app-dialog-msg is
// `white-space: pre-line` — so the paragraphs survive without any markup.
// ⚠️ HELP CARRIES KEYS AND THIS IS WHERE THEY BECOME WORDS. The table used to hold
// calls to t() with a literal key, which run once when the module is imported — before a venue is open,
// so before the app knows which language to speak. Every help screen was therefore
// frozen in the app's starting language, however the venue was set. See the note in
// js/calculator-render.js: the same defect was in fourteen places.
export function helpText(id) {
  const entry = helpFor(id);
  return entry ? entry.lines.map(key => t(key)).join('\n\n') : '';
}

export function helpTitle(id) {
  const entry = helpFor(id);
  if (!entry) return '';
  // A title is a key unless it is a proper name (the product, a feature's own name),
  // which has none: t() returns the key unchanged when it does not know it, so a name
  // passes through untouched.
  return t(entry.title);
}
