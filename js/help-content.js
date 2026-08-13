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
      t('help.eachCardOpensOne'),
      t('help.yourWorkIsSaved'),
      t('help.everyScreenHasA'),
      t('help.aNumberOnA'),
    ],
  },

  calculator: {
    title: 'Calculator',
    lines: [
      t('help.typeHowManyPieces'),
      t('help.confirmSavesTheSheet'),
      t('help.theFieldsEmptyThemselves'),
    ],
  },

  'client-orders': {
    title: t('help.ordersReceived'),
    lines: [
      t('help.ordersYourClientsTyped'),
      t('help.putInTheCalculator'),
      t('help.ifAClientChanges'),
      t('help.ordersForDaysAlready'),
    ],
  },

  catalogue: {
    title: t('help.recipeCatalogue'),
    lines: [
      t('help.everyRecipeYouHave'),
      t('help.guidedMixingWalksA'),
      t('help.linkARowTo'),
      t('help.ifOnlySomeRows'),
    ],
  },

  orders: {
    title: 'Orders',
    lines: [
      t('help.whatToBuySupplier'),
      t('help.orderPlacedRecordsIt'),
      t('help.suggestedAmountsComeFrom'),
    ],
  },

  foodcost: {
    title: t('help.foodCost'),
    lines: [
      t('help.whatAProductCosts'),
      t('help.typeTheSellingPrice'),
      t('help.itIsOnlyRight'),
    ],
  },

  pastries: {
    title: 'Pastries',
    lines: [
      t('help.whatToPutOut'),
      t('help.confirmKeepsARecord'),
      t('help.unlikeTheCalculatorA'),
    ],
  },
};

export const SECTIONS = Object.keys(HELP);

export function helpFor(id) {
  return HELP[String(id || '')] || null;
}

// The message the dialog shows. Blank lines between, because .app-dialog-msg is
// `white-space: pre-line` — so the paragraphs survive without any markup.
export function helpText(id) {
  const entry = helpFor(id);
  return entry ? entry.lines.join('\n\n') : '';
}

export function helpTitle(id) {
  const entry = helpFor(id);
  return entry ? entry.title : '';
}
