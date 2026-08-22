// allergen-terms.js — the words that mean an allergen, in English and Italian.
//
// ⚠️⚠️ THIS FILE IS DATA FOR A SUGGESTION, NEVER A DECLARATION. Nothing here ever
// writes `allergensCheckedAt`. A match pre-ticks a box and shows the person WHICH
// WORDS it matched; the box means nothing until a human presses the verification
// tick, exactly as before. js/allergen-model.js:123 already guarantees that — an
// ingredient with ticks and no stamp still reads 'unknown' and still blocks every
// label. That is what makes a wrong suggestion cost a correction rather than a
// false declaration.
//
// ⚠️ ZERO IMPORTS, ON PURPOSE. It is pure data, it is imported by a pure matcher,
// and both are unit-tested at the repo root.
//
// ⚠️ BOTH LANGUAGES ALWAYS, WHATEVER THE COUNTRY. This is the exact opposite of the
// label rule next door in js/market.js: a label's words follow where the food is
// SOLD, but a pack's words follow where the pack was PRINTED. An English bakery
// buys Italian-labelled flour and Italian mozzarella, so an English-only matcher
// would silently read half the store cupboard as allergen-free.
//
// ⚠️ THE ENTRIES THAT EARN THIS FILE ARE THE ONES THAT SHARE NO LETTERS WITH THE
// ALLERGEN. Anybody can match "milk" in "milk powder". The silent misses are
// `caseinato`, `siero`, `lattosio`, `lisozima`, `semola`, `tahina`, `brodo`,
// `metabisolfito` — words a person scanning a pack in a hurry also misses, which
// is the whole reason to have a machine read it.

// ── The fourteen, by the words that name them ────────────────────────────────
//
// Every phrase is lowercase and accent-free: the matcher normalises the pack text
// the same way before comparing, so `però` and `pero` are one thing.
export const TERMS = Object.freeze({
  // 1 — cereals containing gluten, named individually
  'gluten-wheat': Object.freeze({
    // ⚠️ «farina» ALONE IS NOT WHEAT, AND IT WAS IN THIS LIST. Found by looking at a
    // screenshot after every measurement had passed: the highlighted text read
    // «FARINA di SEMOLA di GRANO» with «Farina» marked as wheat. In Italian it means
    // flour of ANY kind — rice, maize, chickpea — so it would have declared gluten
    // on a gluten-free flour, which is the most damaging false positive available
    // here. The qualified forms below cover every real case.
    en: ['wheat', 'wheat flour', 'wholewheat', 'wholemeal', 'durum', 'durum wheat', 'semolina',
      'spelt flour', 'couscous', 'bulgur', 'bulghur', 'freekeh', 'seitan', 'panko',
      'breadcrumbs', 'wheat starch', 'wheat protein', 'wheat bran', 'wheat germ', 'vital gluten'],
    it: ['grano', 'grano tenero', 'grano duro', 'farina di grano', 'farina di frumento', 'frumento',
      'semola', 'semola rimacinata', 'semolino', 'manitoba', 'cuscus', 'couscous', 'bulgur',
      'seitan', 'pangrattato', 'pan grattato', 'amido di frumento', 'amido di grano',
      'glutine di frumento', 'crusca di frumento', 'germe di grano', 'farro'],
  }),
  'gluten-rye': Object.freeze({
    en: ['rye', 'rye flour', 'pumpernickel'],
    it: ['segale', 'farina di segale'],
  }),
  'gluten-barley': Object.freeze({
    en: ['barley', 'barley flour', 'malt', 'malted barley', 'malt extract', 'malt flour', 'pearl barley'],
    it: ['orzo', 'farina di orzo', 'malto', 'malto d orzo', 'estratto di malto', 'orzo perlato'],
  }),
  'gluten-oats': Object.freeze({
    en: ['oat', 'oats', 'oatmeal', 'rolled oats', 'oat flour', 'oat bran', 'porridge oats'],
    it: ['avena', 'fiocchi di avena', 'farina di avena', 'crusca di avena'],
  }),
  'gluten-spelt': Object.freeze({
    en: ['spelt', 'dinkel'],
    it: ['spelta'],
  }),
  'gluten-kamut': Object.freeze({
    en: ['kamut', 'khorasan', 'khorasan wheat'],
    it: ['kamut', 'grano khorasan'],
  }),

  // 8 — tree nuts, named individually
  'nuts-almond': Object.freeze({
    en: ['almond', 'almonds', 'ground almonds', 'almond flour', 'almond paste', 'marzipan',
      'frangipane', 'amaretti', 'praline', 'nougat', 'almond milk', 'almond butter'],
    it: ['mandorla', 'mandorle', 'farina di mandorle', 'pasta di mandorle', 'marzapane',
      'frangipane', 'amaretti', 'torrone', 'croccante', 'latte di mandorla', 'granella di mandorle'],
  }),
  'nuts-hazelnut': Object.freeze({
    en: ['hazelnut', 'hazelnuts', 'filbert', 'gianduja', 'gianduia', 'praline paste', 'hazelnut paste'],
    it: ['nocciola', 'nocciole', 'granella di nocciole', 'pasta di nocciole', 'gianduia',
      'gianduja', 'pralinato', 'farina di nocciole'],
  }),
  'nuts-walnut': Object.freeze({
    en: ['walnut', 'walnuts', 'walnut oil'],
    it: ['noci', 'noce', 'gherigli', 'gheriglio', 'olio di noci', 'noci sgusciate'],
  }),
  'nuts-cashew': Object.freeze({
    en: ['cashew', 'cashews', 'cashew nut', 'cashew butter'],
    it: ['anacardi', 'anacardio'],
  }),
  'nuts-pecan': Object.freeze({ en: ['pecan', 'pecans', 'pecan nut'], it: ['noci pecan', 'pecan'] }),
  'nuts-brazil': Object.freeze({ en: ['brazil nut', 'brazil nuts'], it: ['noci del brasile', 'noce del brasile'] }),
  'nuts-pistachio': Object.freeze({
    en: ['pistachio', 'pistachios', 'pistachio paste'],
    it: ['pistacchio', 'pistacchi', 'granella di pistacchio', 'pasta di pistacchio', 'pesto di pistacchio'],
  }),
  'nuts-macadamia': Object.freeze({
    en: ['macadamia', 'macadamia nut', 'queensland nut'], it: ['macadamia', 'noci macadamia'],
  }),

  // the remaining 12 categories
  'celery': Object.freeze({
    // ⚠️ CELERY IS THE ONE THAT HIDES. It is in almost every stock cube and every
    // soffritto, and none of those words contains "celery" or "sedano".
    en: ['celery', 'celeriac', 'celery salt', 'celery seed', 'celery extract',
      'stock cube', 'bouillon', 'mirepoix', 'vegetable stock', 'vegetable bouillon'],
    it: ['sedano', 'sedano rapa', 'semi di sedano', 'estratto di sedano',
      'dado', 'dado vegetale', 'brodo vegetale', 'soffritto', 'battuto', 'mirepoix'],
  }),
  'crustaceans': Object.freeze({
    // ⚠️ NOT ONE DERIVATIVE SHARES A STEM WITH THE BASE WORD, in either language.
    en: ['crustacean', 'crustaceans', 'prawn', 'prawns', 'shrimp', 'shrimps', 'crab', 'lobster',
      'langoustine', 'scampi', 'crayfish', 'krill', 'shrimp paste'],
    it: ['crostacei', 'crostaceo', 'gambero', 'gamberi', 'gamberetti', 'mazzancolle', 'scampi',
      'astice', 'aragosta', 'granchio', 'canocchia', 'cicala di mare', 'krill'],
  }),
  'eggs': Object.freeze({
    en: ['egg', 'eggs', 'egg white', 'egg yolk', 'dried egg', 'pasteurised egg', 'pasteurized egg',
      'albumen', 'ovalbumin', 'ovomucoid', 'lysozyme', 'e1105', 'mayonnaise', 'meringue',
      'custard', 'aioli', 'hollandaise', 'bearnaise', 'egg pasta'],
    it: ['uova', 'uovo', 'albume', 'tuorlo', 'uovo pastorizzato', 'uovo in polvere', 'ovoprodotto',
      'ovoalbumina', 'ovotransferrina', 'lisozima', 'e1105', 'maionese', 'meringa',
      'crema pasticcera', 'zabaione', 'pasta all uovo'],
  }),
  'fish': Object.freeze({
    en: ['fish', 'anchovy', 'anchovies', 'cod', 'tuna', 'salmon', 'sardine', 'sardines', 'herring',
      'mackerel', 'worcestershire', 'worcester sauce', 'fish sauce', 'nam pla', 'garum',
      'isinglass', 'bottarga', 'surimi', 'caviar'],
    it: ['pesce', 'acciughe', 'acciuga', 'alici', 'colatura di alici', 'tonno', 'salmone', 'sarde',
      'sardine', 'aringa', 'sgombro', 'bottarga', 'surimi', 'salsa worcester', 'caviale',
      'uova di pesce', 'ittiocolla', 'colla di pesce'],
  }),
  'lupin': Object.freeze({
    en: ['lupin', 'lupine', 'lupin flour', 'lupin protein', 'lupin bran'],
    it: ['lupini', 'lupino', 'farina di lupino', 'proteine di lupino'],
  }),
  'milk': Object.freeze({
    // ⚠️ THE LONGEST LIST, AND MOST OF IT DOES NOT CONTAIN "milk" OR "latte".
    en: ['milk', 'buttermilk', 'butterfat', 'butter oil', 'cream', 'creme fraiche', 'cheese',
      'curd', 'whey', 'whey powder', 'whey protein', 'casein', 'caseinate', 'sodium caseinate',
      'calcium caseinate', 'lactose', 'lactalbumin', 'lactoglobulin', 'milk powder',
      'skimmed milk powder', 'milk solids', 'milk protein', 'ghee', 'yoghurt', 'yogurt',
      'quark', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'condensed milk',
      'evaporated milk', 'dulce de leche', 'butter'],
    it: ['latte', 'latte intero', 'latte scremato', 'latte in polvere', 'latte condensato',
      'burro', 'burro chiarificato', 'panna', 'panna acida', 'crema di latte', 'formaggio',
      'latticini', 'siero di latte', 'siero', 'proteine del latte', 'grassi del latte',
      'caseina', 'caseinato', 'caseinato di sodio', 'lattosio', 'lattoalbumina',
      'lattoglobulina', 'cagliata', 'yogurt', 'ricotta', 'mascarpone', 'mozzarella',
      'parmigiano', 'grana padano', 'pecorino', 'provolone', 'stracchino'],
  }),
  'molluscs': Object.freeze({
    en: ['mollusc', 'molluscs', 'mollusk', 'mussel', 'mussels', 'clam', 'clams', 'oyster',
      'oysters', 'squid', 'calamari', 'octopus', 'cuttlefish', 'snail', 'scallop', 'scallops',
      'whelk', 'winkle', 'abalone', 'oyster sauce', 'squid ink'],
    it: ['molluschi', 'mollusco', 'cozze', 'vongole', 'ostriche', 'calamari', 'totani', 'polpo',
      'moscardini', 'seppia', 'nero di seppia', 'lumache', 'capesante', 'salsa di ostriche'],
  }),
  'mustard': Object.freeze({
    en: ['mustard', 'mustard seed', 'mustard flour', 'mustard powder', 'dijon', 'mustard oil'],
    // ⚠️ «mostarda» shares no stem with «senape» and is usually made with mustard essence.
    it: ['senape', 'semi di senape', 'farina di senape', 'senape di dijon', 'mostarda'],
  }),
  'peanuts': Object.freeze({
    // ⚠️ A LEGUME AND ITS OWN GROUP — a separate allergy from tree nuts.
    en: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'arachis', 'arachis oil',
      'monkey nut', 'peanut butter', 'satay'],
    it: ['arachidi', 'arachide', 'olio di arachide', 'olio di semi di arachide',
      'burro di arachidi', 'pasta di arachidi', 'noccioline', 'noccioline americane'],
  }),
  'sesame': Object.freeze({
    en: ['sesame', 'sesame seed', 'sesame seeds', 'sesame oil', 'tahini', 'tahina',
      'gomasio', 'halva', 'zaatar', 'hummus'],
    it: ['sesamo', 'semi di sesamo', 'olio di sesamo', 'tahina', 'tahini', 'gomasio', 'halva'],
  }),
  'soybeans': Object.freeze({
    en: ['soya', 'soy', 'soybean', 'soybeans', 'soja', 'soya flour', 'soya protein',
      'soya lecithin', 'soy lecithin', 'tofu', 'tempeh', 'miso', 'tamari', 'soy sauce',
      'edamame', 'natto', 'okara', 'yuba', 'textured vegetable protein'],
    it: ['soia', 'farina di soia', 'olio di soia', 'proteine della soia', 'lecitina di soia',
      'tofu', 'tempeh', 'miso', 'tamari', 'salsa di soia', 'edamame'],
  }),
  'sulphites': Object.freeze({
    en: ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulphur dioxide', 'sulfur dioxide',
      'metabisulphite', 'metabisulfite', 'sodium metabisulphite', 'potassium metabisulphite',
      'bisulphite', 'e220', 'e221', 'e222', 'e223', 'e224', 'e226', 'e227', 'e228'],
    it: ['solfiti', 'solfito', 'anidride solforosa', 'metabisolfito', 'metabisolfito di sodio',
      'metabisolfito di potassio', 'bisolfito', 'e220', 'e221', 'e222', 'e223', 'e224',
      'e226', 'e227', 'e228'],
  }),
});

// ── Phrases that must NOT fire, however much they look like one ──────────────
//
// ⚠️ MATCHED FIRST AND LONGEST-FIRST, and the span they cover is then closed to
// everything else. «burro di cacao» contains «burro»; «grano saraceno» contains
// «grano»; «noce di cocco» contains «noce». Without this the matcher declares milk
// in a dairy-free chocolate and wheat in a buckwheat pancake — which is the wrong
// KIND of wrong: a false positive teaches people to tap through, and then the real
// one goes through with them.
// ⚠️⚠️ A PHRASE MAY NOT BE BOTH «SAY NOTHING» AND «MEANS PEANUTS», and the first
// version of this file made exactly that mistake. `burro di arachidi` sat here to
// stop `burro` reading as milk — and because a negative claims its span before
// anything else runs, it silenced ITSELF: the pack said peanuts and the matcher
// said nothing. A phrase that overrides a stem AND names an allergen belongs in
// REMAPS below, which is checked after the traps and before the vocabulary. Found
// by a test, not by reading.
export const NEGATIVE_PHRASES = Object.freeze([
  // Italian — each one contains a word that would otherwise fire, and none of them
  // is an allergen.
  'grano saraceno', 'farina di grano saraceno',   // buckwheat contains « grano »
  'burro di cacao', 'burro di karite',            // cocoa and shea butter are not dairy
  'noce moscata', 'noce di cocco', 'pesca noce',  // nutmeg, coconut, nectarine
  'latte di cocco', 'latte di riso',
  'maltodestrine', 'maltodestrina', 'maltitolo',  // not malt
  // ⚠️ NO ENTRY FOR «solfato» / «sulphate», AND A MUTATION PROVED WHY. Removing
  // one left every test green: matching is whole-word, so «solfato» never touches
  // «solfito» and «sulphate» never touches «sulphite». The trap was doing nothing
  // — and a trap that does nothing is not free, because it silences a span that a
  // word added to the vocabulary tomorrow could find itself inside.
  // ⚠️ THE GLUTEN-FREE FLOURS NEED NO ENTRY HERE, AND ADDING THEM WAS A MISTAKE I
  // MADE TWICE IN ONE FILE. They were only ever in danger while «farina» alone
  // counted as wheat; with that gone, nothing matches inside «farina di riso». And
  // three of the ones I first listed — «farina di mandorle», «di soia», «di lupino»
  // — ARE allergens, so silencing them would have hidden almond, soya and lupin.
  // A trap that is not needed is not free: it silences a span, and the next word
  // added to the vocabulary can find itself inside one.
  'cream of tartar', 'cremor tartaro',            // «cream» is milk; this is not
  // ⚠️ FREE-FROM CLAIMS SILENCE THE CLAIM, NOT THE ALLERGEN. The span covered is the
  // claim itself, so a real «latte scremato» elsewhere in the same list still fires
  // — which is what stops «senza lattosio» from hiding the milk protein that
  // lactose-free milk still contains.
  'senza glutine', 'senza lattosio', 'senza latte', 'senza uova',
  // English
  'buckwheat', 'buckwheat flour',
  'cocoa butter', 'shea butter',
  'nutmeg', 'coconut', 'coconut milk', 'coconut oil', 'chestnut', 'water chestnut',
  'pine nut', 'pine nuts',
  'nutrition', 'nutritional',
  'maltodextrin', 'maltitol',
  'sulphate', 'sulfate', 'calcium sulphate',
  // ⚠️ NO HYPHENATED FORM. The normaliser turns every separator into a space, so
  // 'gluten-free' could never match anything — a phrase carrying a character the
  // normaliser strips is dead weight that reads like cover. A test bans the shape.
  'gluten free', 'dairy free', 'lactose free', 'nut free', 'egg free',
]);

// ── Phrases whose obvious stem names the WRONG allergen ──────────────────────
//
// ⚠️ THE MOST DANGEROUS ENTRY IN THIS FILE IS «noccioline». Left to the `nocciol`
// stem it reads as HAZELNUT — so it names an allergen the pack does not contain AND
// misses the one it does. Peanuts are a legume; somebody allergic to peanuts is not
// protected by a hazelnut warning.
export const REMAPS = Object.freeze([
  Object.freeze({ phrase: 'noccioline americane', code: 'peanuts' }),
  Object.freeze({ phrase: 'noccioline', code: 'peanuts' }),
  Object.freeze({ phrase: 'monkey nut', code: 'peanuts' }),
  // ⚠️ THESE FOUR ARE WHY REMAPS EXISTS SEPARATELY FROM THE TRAPS. Each contains a
  // word that names the WRONG allergen — «burro», «latte» — and each names a REAL
  // one of its own. As a trap it would silence the pack; as an ordinary term the
  // wrong stem could win. Claimed here, between the two.
  Object.freeze({ phrase: 'burro di arachidi', code: 'peanuts' }),
  Object.freeze({ phrase: 'peanut butter', code: 'peanuts' }),
  Object.freeze({ phrase: 'latte di mandorla', code: 'nuts-almond' }),
  Object.freeze({ phrase: 'almond milk', code: 'nuts-almond' }),
  Object.freeze({ phrase: 'latte di soia', code: 'soybeans' }),
  Object.freeze({ phrase: 'soya milk', code: 'soybeans' }),
  Object.freeze({ phrase: 'latte di avena', code: 'gluten-oats' }),
  Object.freeze({ phrase: 'oat milk', code: 'gluten-oats' }),
  // A knob of butter is still butter.
  Object.freeze({ phrase: 'noce di burro', code: 'milk' }),
]);

// ── Words that could be one of several, and must be ASKED rather than answered ──
//
// ⚠️ GUESSING HERE IS THE SAME DEFECT AS A PARTIAL LIST LOOKING COMPLETE. Italian
// packs very often print only «emulsionante: lecitine», which is soya, sunflower or
// egg and the pack does not say which. A matcher that picks the commonest is
// declaring something nobody told it.
// `kind` picks which question the screen asks:
//   'which'    — the pack named something that could be one of these codes
//   'vague'    — it could hide anything; only the supplier knows
//   'category' — the pack named a WHOLE FAMILY, and the law needs the member
export const AMBIGUOUS = Object.freeze([
  Object.freeze({ phrase: 'lecitina', kind: 'which', could: ['soybeans', 'eggs'] }),
  Object.freeze({ phrase: 'lecitine', kind: 'which', could: ['soybeans', 'eggs'] }),
  Object.freeze({ phrase: 'lecithin', kind: 'which', could: ['soybeans', 'eggs'] }),
  Object.freeze({ phrase: 'e322', kind: 'which', could: ['soybeans', 'eggs'] }),
  Object.freeze({ phrase: 'albumina', kind: 'which', could: ['milk', 'eggs'] }),
  Object.freeze({ phrase: 'albumin', kind: 'which', could: ['milk', 'eggs'] }),
  Object.freeze({ phrase: 'gelatina', kind: 'which', could: ['fish'] }),
  Object.freeze({ phrase: 'gelatine', kind: 'which', could: ['fish'] }),
  Object.freeze({ phrase: 'amido modificato', kind: 'which', could: ['gluten-wheat'] }),
  Object.freeze({ phrase: 'modified starch', kind: 'which', could: ['gluten-wheat'] }),
  Object.freeze({ phrase: 'aroma naturale', kind: 'vague', could: [] }),
  Object.freeze({ phrase: 'aromi naturali', kind: 'vague', could: [] }),
  Object.freeze({ phrase: 'natural flavouring', kind: 'vague', could: [] }),

  // ⚠️⚠️ THE CATEGORY WORDS, AND THIS GAP WAS FOUND BY DRIVING THE REAL FORM. A pack
  // reading «può contenere tracce di FRUTTA A GUSCIO» went through in silence: the
  // app models the SPECIFIC nut, as the law requires — «hazelnut», never «nuts» —
  // so there is no box for a family and nothing could be ticked. Silence there is
  // the worst of both worlds: the pack DID warn, and the screen said nothing.
  //
  // It cannot be resolved either — «nuts» is eight different allergies, and
  // somebody who can eat almonds but not hazelnuts is not served by a guess. So it
  // is raised, loudly, as the one question the supplier can answer.
  Object.freeze({ phrase: 'frutta a guscio', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'frutta secca a guscio', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'tree nuts', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'tree nut', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'nuts', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'nut', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'cereali contenenti glutine', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'cereals containing gluten', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'glutine', kind: 'category', could: [] }),
  Object.freeze({ phrase: 'gluten', kind: 'category', could: [] }),
]);

// ── Where a pack stops listing what is IN it and starts listing traces ───────
//
// ⚠️ `allergens[]` AND `mayContain[]` MAY NEVER BE MERGED — different statements,
// different consequences, and merging them makes everything near a nut declare nuts
// until the label stops being read. So the text is CUT here before anything is
// matched, and whatever follows can only ever reach the traces half.
export const TRACES_MARKERS = Object.freeze([
  'puo contenere tracce di', 'puo contenere tracce', 'puo contenere',
  'tracce di', 'prodotto in uno stabilimento che utilizza',
  'prodotto in uno stabilimento che lavora anche',
  'may contain traces of', 'may contain traces', 'may contain',
  'produced in a factory that also handles', 'made in a factory that also handles',
  'packed in a facility that also handles',
]);
