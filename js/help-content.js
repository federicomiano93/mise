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
export const HELP = {
  home: {
    title: 'Misé',
    lines: [
      'Each card opens one part of the day: what to bake, what to buy, what it costs.',
      'Your work is saved as you go — on this phone and online, so another phone sees it too.',
      'Every screen has a ? like this one. It explains that screen in a few lines.',
      'A number on a card means something there is waiting for you.',
    ],
  },

  calculator: {
    title: 'Calculator',
    lines: [
      'Type how many pieces each client has asked for. The app works out the total dough and every ingredient.',
      'Confirm saves the sheet to the Log and locks the fields until you tap Edit.',
      'The fields empty themselves on a new work day — which starts at 4am, not at midnight.',
    ],
  },

  'client-orders': {
    title: 'Orders received',
    lines: [
      'Orders your clients typed themselves, from their own link.',
      '"Put in the calculator" fills that client\'s quantity boxes for you. Nothing moves until you tap it.',
      'If a client changes an order AFTER you have used it, this screen turns red and says so.',
      'Orders for days already gone are not shown here — this screen is what is still coming.',
    ],
  },

  catalogue: {
    title: 'Recipe catalogue',
    lines: [
      'Every recipe you have, searchable. Open one and scale it to any total weight in kg.',
      'Guided mixing walks a recipe step by step with timers — keep that screen open, or the alarm cannot ring.',
      'Link a row to an ingredient and the recipe can tell you what a kilo of it costs.',
      'If only some rows are linked, the cost shown is of THOSE rows — not of the whole recipe.',
    ],
  },

  orders: {
    title: 'Orders',
    lines: [
      'What to buy, supplier by supplier. Order is how many you need; Stock is what you still have.',
      '"Order placed" records it and clears the row, so the screen always shows what is left to do.',
      'Suggested amounts come from your last 8 orders of that item, so they mean nothing until you have placed a few.',
    ],
  },

  foodcost: {
    title: 'Food cost',
    lines: [
      'What a product costs to make, and what it earns.',
      'Type the selling price as it is on the label, WITH VAT. The app works the cost out on the price without VAT.',
      'It is only right if the ingredients have prices. An unpriced one is left out, and the answer comes out too low.',
    ],
  },

  pastries: {
    title: 'Pastries',
    lines: [
      'What to put out to prove, as one standing list per weekday.',
      'Confirm keeps a record of the night and locks the list until 4am.',
      'Unlike the Calculator, a new day does NOT empty it: the list is what you normally do on that weekday.',
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
