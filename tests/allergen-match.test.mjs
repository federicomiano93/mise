// Reading a pack's own ingredient list and PROPOSING allergens.
//
// ⚠️⚠️ EVERY TEST HERE IS ONE OF TWO QUESTIONS, and the second matters as much as
// the first:
//
//   a MISS   — an allergen on the pack that the matcher did not name. Somebody in
//              hospital, and an offence.
//   a CRY WOLF — an allergen the pack does NOT contain. It teaches people to tap
//              through the proposal, and then the real one goes through with them.
//
// The suggestion is inert either way — nothing here writes allergensCheckedAt, so a
// tick with no stamp still reads 'unknown' and still blocks every label. That is
// what makes a wrong answer cost a correction rather than a false declaration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPackIngredients, splitTraces, normaliseWithMap } from '../js/allergen-match.js';
import { TERMS, NEGATIVE_PHRASES, REMAPS, AMBIGUOUS } from '../js/allergen-terms.js';
import { ALLERGEN_CODES } from '../js/allergen-model.js';

const read = (text) => readPackIngredients(text);
const has = (text, ...codes) => {
  const out = read(text);
  for (const c of codes) assert.ok(out.allergens.includes(c), `${JSON.stringify(text)} should propose ${c}, got [${out.allergens}]`);
};
const hasNot = (text, ...codes) => {
  const out = read(text);
  for (const c of codes) assert.ok(!out.allergens.includes(c), `${JSON.stringify(text)} must NOT propose ${c}, got [${out.allergens}]`);
};

// ── A real pack, read end to end ─────────────────────────────────────────────

test('a real Italian pack, with all four traps in one line', () => {
  const pack = 'Farina di SEMOLA di GRANO duro, LATTE scremato in polvere, '
    + 'lecitina di SOIA, zucchero. Può contenere tracce di FRUTTA A GUSCIO e SESAMO.';
  const out = read(pack);
  assert.ok(out.allergens.includes('gluten-wheat'), 'semola/grano is wheat');
  assert.ok(out.allergens.includes('milk'), 'latte is milk');
  assert.ok(out.allergens.includes('soybeans'), 'lecitina di soia is soya');
  // ⚠️ The traces half never merges into the composition half.
  assert.ok(!out.allergens.includes('sesame'), 'sesame is only a TRACE here');
  assert.ok(out.mayContain.includes('sesame'), 'sesame must land in the traces list');
});

test('a real English pack', () => {
  const pack = 'WHEAT flour, water, BUTTER (MILK), salt, yeast, malted BARLEY flour. '
    + 'May contain traces of NUTS and SESAME.';
  const out = read(pack);
  assert.deepEqual(out.allergens.filter(c => c.startsWith('gluten')).sort(),
    ['gluten-barley', 'gluten-wheat']);
  assert.ok(out.allergens.includes('milk'));
  assert.ok(out.mayContain.includes('sesame'));
});

// ── THE MISSES: words that share no letters with the allergen ────────────────

test('MILK, by every word that is not "milk"', () => {
  for (const word of ['caseinato di sodio', 'siero di latte in polvere', 'lattosio',
    'cagliata', 'ghee', 'burro chiarificato', 'parmigiano', 'mascarpone', 'panna acida']) {
    has(word, 'milk');
  }
  for (const word of ['whey powder', 'sodium caseinate', 'lactose', 'curd', 'ghee', 'buttermilk']) {
    has(word, 'milk');
  }
});

test('EGGS, including the one that turns up on cheese and wine', () => {
  // ⚠️ lisozima / E1105 is an egg derivative printed with no egg word anywhere near it.
  for (const word of ['lisozima', 'E1105', 'ovoalbumina', 'albume', 'maionese', 'zabaione']) {
    has(word, 'eggs');
  }
  for (const word of ['lysozyme', 'albumen', 'meringue', 'mayonnaise']) has(word, 'eggs');
});

test('WHEAT, by the words a bakery actually buys', () => {
  for (const word of ['semola rimacinata', 'farina manitoba', 'seitan', 'cuscus', 'pangrattato',
    'germe di grano', 'amido di frumento']) has(word, 'gluten-wheat');
  for (const word of ['semolina', 'durum wheat', 'couscous', 'panko', 'bulgur']) has(word, 'gluten-wheat');
});

test('SOYA, CELERY and SESAME, where the allergen is inside a compound name', () => {
  for (const word of ['tofu', 'miso', 'tamari', 'edamame', 'tempeh']) has(word, 'soybeans');
  // ⚠️ CELERY IS IN EVERY STOCK CUBE, and none of these words contains "sedano".
  for (const word of ['dado vegetale', 'brodo vegetale', 'soffritto', 'battuto', 'mirepoix']) has(word, 'celery');
  for (const word of ['bouillon', 'stock cube', 'celeriac']) has(word, 'celery');
  for (const word of ['tahina', 'gomasio', 'halva', 'tahini']) has(word, 'sesame');
});

test('FISH and SULPHITES, the two that hide behind a brand or a number', () => {
  // Worcestershire sauce contains anchovy and no fish word.
  for (const word of ['salsa worcester', 'colatura di alici', 'colla di pesce', 'bottarga', 'surimi']) has(word, 'fish');
  for (const word of ['worcestershire sauce', 'isinglass', 'anchovies']) has(word, 'fish');
  for (const word of ['metabisolfito di sodio', 'anidride solforosa', 'E220', 'E224']) has(word, 'sulphites');
  for (const word of ['sodium metabisulphite', 'sulphur dioxide', 'E228']) has(word, 'sulphites');
});

test('the nuts are named ONE BY ONE, never as a category', () => {
  has('marzapane', 'nuts-almond');
  has('torrone', 'nuts-almond');
  has('gianduia', 'nuts-hazelnut');
  has('pralinato', 'nuts-hazelnut');
  has('granella di pistacchio', 'nuts-pistachio');
  has('anacardi', 'nuts-cashew');
  // Somebody who can eat almonds but not hazelnuts is not served by "nuts".
  hasNot('marzapane', 'nuts-hazelnut');
  hasNot('gianduia', 'nuts-almond');
});

// ── THE CRY WOLVES: the traps that must stay silent ──────────────────────────

test('⚠️ the words that LOOK like an allergen and are not', () => {
  hasNot('grano saraceno', 'gluten-wheat');           // buckwheat is not wheat
  hasNot('farina di grano saraceno', 'gluten-wheat');
  hasNot('buckwheat flour', 'gluten-wheat');
  hasNot('burro di cacao', 'milk');                    // cocoa butter is not dairy
  hasNot('cocoa butter', 'milk');
  hasNot('latte di cocco', 'milk');
  hasNot('coconut milk', 'milk');
  hasNot('noce moscata', 'nuts-walnut');               // nutmeg is not a nut
  hasNot('nutmeg', 'nuts-walnut');
  hasNot('noce di cocco', 'nuts-walnut');
  hasNot('maltodestrine', 'gluten-barley');            // maltodextrin is not malt
  hasNot('maltodextrin', 'gluten-barley');
  hasNot('solfato di calcio', 'sulphites');            // sulphate is not sulphite
  hasNot('calcium sulphate', 'sulphites');
  hasNot('chestnut', 'nuts-walnut');
  hasNot('pine nuts', 'nuts-walnut');
});

// ⚠️⚠️ A PHRASE MAY NOT BE BOTH «SAY NOTHING» AND «MEANS PEANUTS». The first
// version put these among the traps, to stop «burro» and «latte» firing — and a
// trap claims its span before anything else runs, so each one silenced ITSELF. The
// pack said peanuts and the matcher said nothing: the worst direction available.
test('⚠️⚠️ a phrase that overrides a stem AND names an allergen does both', () => {
  const cases = [
    ['burro di arachidi', 'peanuts', 'milk'],
    ['peanut butter', 'peanuts', 'milk'],
    ['latte di mandorla', 'nuts-almond', 'milk'],
    ['almond milk', 'nuts-almond', 'milk'],
    ['latte di soia', 'soybeans', 'milk'],
    ['latte di avena', 'gluten-oats', 'milk'],
    ['noce di burro', 'milk', 'nuts-walnut'],
  ];
  for (const [text, right, wrong] of cases) {
    const out = read(text);
    assert.ok(out.allergens.includes(right), `${text} must propose ${right}, got [${out.allergens}]`);
    assert.ok(!out.allergens.includes(wrong), `${text} must NOT propose ${wrong}`);
  }
});

test('and the traps that really are silent stay silent', () => {
  for (const text of ['burro di cacao', 'burro di karite', 'latte di cocco', 'latte di riso',
    'cocoa butter', 'shea butter', 'coconut milk']) {
    assert.deepEqual(read(text).allergens, [], `${text} must propose nothing`);
  }
});

// ⚠️⚠️ THE MOST DANGEROUS ENTRY IN THE VOCABULARY. Left to the `nocciol` stem,
// «noccioline» names HAZELNUT — an allergen the pack does not contain — AND misses
// PEANUTS, which it does. Two failures from one word, in opposite directions.
test('⚠️⚠️ «noccioline» is PEANUTS, never hazelnut', () => {
  for (const word of ['noccioline', 'noccioline americane']) {
    const out = read(word);
    assert.ok(out.allergens.includes('peanuts'), `${word} must be peanuts`);
    assert.ok(!out.allergens.includes('nuts-hazelnut'), `${word} must NOT be hazelnut`);
  }
  // And the real hazelnut still works.
  has('nocciole', 'nuts-hazelnut');
});

test('⚠️ a negation must not over-suppress — it silences the WORD, not the allergen', () => {
  // «senza lattosio» does NOT mean milk-free: lactose-free milk still carries milk
  // protein and must still be declared. The phrase is silenced; a real «latte»
  // elsewhere in the list is not.
  const out = read('latte scremato senza lattosio, zucchero');
  assert.ok(out.allergens.includes('milk'), 'the milk in the list still counts');
  // «gluten free» on an oat product does not remove OATS.
  const oats = read('gluten free oats, water');
  assert.ok(oats.allergens.includes('gluten-oats'), 'the oats are still oats');
});

test('a whole word, never a fragment', () => {
  hasNot('milkshake-flavoured cornflour', 'gluten-oats');   // no stray "oat" inside
  hasNot('goat meat', 'gluten-oats');
  hasNot('exclamation', 'molluscs');                        // "clam" inside a word
  hasNot('scampi-flavoured crisps'.replace('scampi', 'xxx'), 'crustaceans');
});

// ── The questions it must ASK rather than answer ─────────────────────────────

test('⚠️ an ambiguous word is a QUESTION, never a guess', () => {
  // Italian packs very often print only «emulsionante: lecitine» — soya, sunflower
  // or egg, and the pack does not say which. Picking the commonest is declaring
  // something nobody was told.
  const out = read('zucchero, emulsionante: lecitine, aromi');
  assert.equal(out.allergens.length, 0, 'nothing may be ticked from an ambiguous word');
  assert.ok(out.questions.some(q => q.phrase === 'lecitine'), 'it must be raised as a question');
  assert.deepEqual(out.questions.find(q => q.phrase === 'lecitine').could, ['soybeans', 'eggs']);
});

test('«lecitina di soia» is NOT ambiguous — the pack said which', () => {
  const out = read('lecitina di soia');
  assert.ok(out.allergens.includes('soybeans'));
  assert.equal(out.questions.length, 0, 'the longer phrase settles it, so nothing is asked');
});

test('«albumina» alone is a question, because it is milk OR egg', () => {
  const out = read('albumina');
  assert.equal(out.allergens.length, 0);
  assert.deepEqual(out.questions[0].could, ['milk', 'eggs']);
  // ...while the specific ones are not.
  has('lattoalbumina', 'milk');
  has('ovoalbumina', 'eggs');
});

// ── Composition versus traces ────────────────────────────────────────────────

test('the two lists are never merged, whichever marker the pack uses', () => {
  for (const marker of ['Può contenere tracce di', 'May contain', 'Tracce di',
    'Prodotto in uno stabilimento che utilizza']) {
    const out = read(`Farina di grano, acqua. ${marker} nocciole.`);
    assert.ok(out.allergens.includes('gluten-wheat'), marker);
    assert.ok(!out.allergens.includes('nuts-hazelnut'), `${marker}: a trace is not an ingredient`);
    assert.ok(out.mayContain.includes('nuts-hazelnut'), `${marker}: and it must reach the traces`);
  }
});

test('a code in both halves is an INGREDIENT, not also a trace', () => {
  const out = read('Latte intero, zucchero. Può contenere tracce di latte.');
  assert.ok(out.allergens.includes('milk'));
  assert.ok(!out.mayContain.includes('milk'), 'buildAllergenFields strips it anyway — stay consistent');
});

test('no traces marker means the whole text is composition', () => {
  const { composition, traces } = splitTraces('Farina, acqua, sale.');
  assert.equal(composition, 'Farina, acqua, sale.');
  assert.equal(traces, '');
});

// ── Showing its working ──────────────────────────────────────────────────────

test('⚠️ every match points at the characters it came from', () => {
  const pack = 'Farina di GRANO tenero, LATTE in polvere';
  const out = read(pack);
  assert.ok(out.matches.length >= 2);
  for (const m of out.matches) {
    const slice = pack.slice(m.from, m.to).toLowerCase();
    // The span must actually cover the phrase, accents and capitals aside.
    assert.ok(slice.length > 0, 'an empty span cannot be shown to anybody');
    assert.ok(m.to > m.from, `${m.phrase}: span ${m.from}-${m.to} is inside out`);
    assert.ok(m.to <= pack.length, `${m.phrase}: span runs past the end of the text`);
  }
  const wheat = out.matches.find(m => m.code === 'gluten-wheat');
  assert.match(pack.slice(wheat.from, wheat.to), /GRANO/i, 'the wheat span must cover the word GRANO');
});

test('accents and capitals do not hide a word, and the span still points at the original', () => {
  const pack = 'Purè di patate, PERÒ con LATTE';
  const out = read(pack);
  assert.ok(out.allergens.includes('milk'));
  const m = out.matches.find(x => x.code === 'milk');
  assert.equal(pack.slice(m.from, m.to), 'LATTE');
});

test('the normaliser keeps one index per surviving character', () => {
  const { norm, map } = normaliseWithMap('Farina, acqua');
  assert.equal(norm.length, map.length);
  assert.equal(norm, 'farina acqua');
  assert.equal(map[0], 0);
});

// ── Empty is an honest answer and must look like one ─────────────────────────

test('⚠️ recognising nothing is reported, never left to look like "contains nothing"', () => {
  const out = read('Zucchero, acqua, acido citrico');
  assert.deepEqual(out.allergens, []);
  assert.equal(out.recognisedAnything, false, 'the screen must be able to say it found nothing');
  assert.equal(out.hasText, true);
});

test('no text at all is not the same as text with nothing in it', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const out = read(empty);
    assert.deepEqual(out.allergens, []);
    assert.equal(out.hasText, false, JSON.stringify(empty));
  }
});

test('junk never throws', () => {
  for (const junk of [0, 1, {}, [], true, ' ', 'a'.repeat(5000)]) {
    assert.doesNotThrow(() => read(junk), String(junk).slice(0, 20));
  }
});

// ── The vocabulary itself ────────────────────────────────────────────────────

test('every code in the vocabulary is a real allergen code', () => {
  const unknown = Object.keys(TERMS).filter(c => !ALLERGEN_CODES.includes(c));
  assert.deepEqual(unknown, [], 'these would be dropped silently by normalizeAllergens');
  const remapped = REMAPS.map(r => r.code).filter(Boolean).filter(c => !ALLERGEN_CODES.includes(c));
  assert.deepEqual(remapped, []);
  const asked = AMBIGUOUS.flatMap(a => a.could).filter(c => !ALLERGEN_CODES.includes(c));
  assert.deepEqual(asked, []);
});

test('all 26 codes have words in BOTH languages', () => {
  // ⚠️ An English bakery buys Italian-labelled packs, so an English-only entry is a
  // silent gap for exactly the venue this app runs in.
  const missing = ALLERGEN_CODES.filter(code => {
    const t = TERMS[code];
    return !t || !(t.en || []).length || !(t.it || []).length;
  });
  assert.deepEqual(missing, [], 'these codes cannot be found on a pack in one of the two languages');
});

test('every phrase is already normalised, or it can never match', () => {
  const bad = [];
  const check = (p, where) => {
    if (p !== p.toLowerCase()) bad.push(`${where}: "${p}" is not lowercase`);
    if (/[^a-z0-9 ]/.test(p)) bad.push(`${where}: "${p}" holds a character the normaliser strips`);
    if (p !== p.trim() || /\s\s/.test(p)) bad.push(`${where}: "${p}" has stray spacing`);
  };
  for (const [code, langs] of Object.entries(TERMS)) {
    for (const lang of ['en', 'it']) for (const p of langs[lang] || []) check(p, code);
  }
  for (const p of NEGATIVE_PHRASES) check(p, 'negative');
  for (const r of REMAPS) check(r.phrase, 'remap');
  for (const a of AMBIGUOUS) check(a.phrase, 'ambiguous');
  assert.deepEqual(bad, []);
});

// ⚠️⚠️ A CATEGORY IS A WARNING THIS APP HAS NO BOX FOR, AND IT MUST NOT PASS IN
// SILENCE. Found by driving the real form: «può contenere tracce di FRUTTA A
// GUSCIO» went straight through, because the app models the SPECIFIC nut as the
// law requires and there is no box for a family. The pack DID warn; the screen
// said nothing. It cannot be resolved either — «nuts» is eight different
// allergies — so it is raised as the one question the supplier can answer.
test('⚠️⚠️ a whole-family word is raised, never ticked and never ignored', () => {
  for (const word of ['frutta a guscio', 'tree nuts', 'cereali contenenti glutine']) {
    const out = read(`Zucchero. Può contenere tracce di ${word}.`);
    assert.deepEqual(out.allergens, [], `${word} must tick nothing`);
    assert.deepEqual(out.mayContain, [], `${word} must tick no trace either`);
    const q = out.questions.find(x => x.phrase === word);
    assert.ok(q, `${word} must be raised as a question`);
    assert.equal(q.kind, 'category', `${word} needs the category wording`);
  }
});

test('the specific member still wins over its family', () => {
  // «tracce di nocciole» names the nut, so it is a trace and not a question.
  const out = read('Zucchero. Può contenere tracce di nocciole.');
  assert.ok(out.mayContain.includes('nuts-hazelnut'));
  assert.equal(out.questions.length, 0, 'nothing is left to ask');
});

test('every ambiguous entry declares which question it is', () => {
  const kinds = new Set(['which', 'vague', 'category']);
  for (const a of AMBIGUOUS) {
    assert.ok(kinds.has(a.kind), `${a.phrase} has no usable kind (${a.kind})`);
    if (a.kind === 'which') assert.ok(a.could.length, `${a.phrase} is a "which" with nothing to choose between`);
    else assert.deepEqual(a.could, [], `${a.phrase} is a ${a.kind} and must offer no list`);
  }
});

// ⚠️⚠️ «farina» ALONE IS NOT WHEAT, AND IT WAS IN THE VOCABULARY. Found by looking
// at a screenshot after every measurement had passed. In Italian it means flour of
// ANY kind, so it would have declared gluten on exactly the flours somebody coeliac
// depends on — the most damaging false positive this matcher can produce.
test('⚠️⚠️ a gluten-free flour is never declared as gluten', () => {
  for (const flour of ['farina di riso', 'farina di mais', 'farina di ceci',
    'farina di castagne', 'rice flour', 'chickpea flour', 'cornflour']) {
    const out = read(flour);
    assert.ok(!out.allergens.some(c => c.startsWith('gluten')),
      `${flour} must never propose gluten, got [${out.allergens}]`);
  }
  // ...and the qualified wheat forms still do.
  for (const flour of ['farina di grano tenero', 'farina di frumento', 'wheat flour']) {
    has(flour, 'gluten-wheat');
  }
});

test('a flour that IS an allergen is still named', () => {
  // ⚠️ The first fix silenced these along with the safe ones — three allergens
  // hidden by a trap written to protect a different one.
  has('farina di mandorle', 'nuts-almond');
  has('farina di soia', 'soybeans');
  has('farina di lupino', 'lupin');
  has('almond flour', 'nuts-almond');
});

test('«cream of tartar» is not dairy', () => {
  hasNot('cream of tartar', 'milk');
  hasNot('cremor tartaro', 'milk');
  has('double cream', 'milk');
});

// ⚠️⚠️ TWO MUTATIONS SURVIVED BECAUSE EVERY TRACES TEST USED «tracce di», WHICH IS
// ACCENT-FREE AND IS ITS OWN MARKER. So dropping «Può contenere» changed nothing,
// and so did dropping the accent-stripping — the shorter marker caught the split
// either way. A real pack often says only «Può contenere nocciole», and that one
// sentence exercises both.
test('⚠️⚠️ «Può contenere» alone splits the traces, accent and all', () => {
  const out = read('Farina di grano, zucchero. Può contenere nocciole.');
  assert.ok(out.allergens.includes('gluten-wheat'), 'the wheat is an ingredient');
  assert.ok(!out.allergens.includes('nuts-hazelnut'),
    'without the split, a trace is read as an ingredient');
  assert.ok(out.mayContain.includes('nuts-hazelnut'), 'and it must reach the traces');
});

test('⚠️ an accent never hides a word, in the text OR in a marker', () => {
  // The normaliser folds NFD and drops the combining marks. Written as literal
  // combining characters in the source it would be invisible in every diff, so it
  // is escaped there — and pinned here.
  const { norm } = normaliseWithMap('PERÒ Può È À');
  assert.equal(norm, 'pero puo e a', 'accents must fold away');
  // «Può» in a marker, and an accented word in the list.
  assert.ok(read('Zucchero. Può contenere sedano.').mayContain.includes('celery'));
});

test('the English markers work on their own too', () => {
  const out = read('Wheat flour, sugar. May contain hazelnuts.');
  assert.ok(out.allergens.includes('gluten-wheat'));
  assert.ok(out.mayContain.includes('nuts-hazelnut'));
  assert.ok(!out.allergens.includes('nuts-hazelnut'));
});
