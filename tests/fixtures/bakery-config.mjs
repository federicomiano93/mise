// The Italian Club Bakery's own address book and recipes — the shape DEFAULT_CONFIG
// held until 13 Aug 2026, kept HERE because it is a TEST FIXTURE and nothing else.
//
// ⚠️ WHY IT LEFT THE APP. The app now has customers, and this is one bakery's data:
// four clients, ten products with their weights, and three recipes with their real
// gram-by-gram formulas. Federico, 13 Aug 2026: «quelle ricette sono solo di The
// Italian Club Bakery». Shipping it as the default meant every customer who bought
// the Calculator opened it holding somebody else's recipes.
//
// ⚠️ WHY IT IS KEPT AT ALL, and this is the load-bearing half: these numbers are
// the PROOF OF THE DOUGH MATHS. Fifty-one assertions run through them, including
// the ones that show the config-driven scaler is byte-identical to the three
// hand-written scalers it replaced (tests/dynamic-recipes.test.mjs). Deleting them
// would delete that proof; moving them here keeps every assertion and removes a
// dependency that should never have existed — a test standing on production data.
//
// ⚠️ NOTHING IN js/ MAY IMPORT THIS. It is not shipped, it is not in sw.js ASSETS,
// and a runtime import would put one customer's recipes back on every phone.

export const BAKERY_CONFIG = {
  clients: [
    { id: 'c-bakery', name: 'Bakery', products: [
      { id: 'f-pizze',   name: 'Pizzas',    recipeId: 'focaccia', weight: 201, kind: 'number' },
      { id: 'f-focacce', name: 'Focaccias', recipeId: 'focaccia', weight: 181, kind: 'number' },
    ] },
    { id: 'c-client-1', name: 'Client 1', products: [
      { id: 'f-ciabatta',   name: 'Ciabatta',    recipeId: 'focaccia', weight: 151, kind: 'dropdown', crate: { show: true, perBox: 20 } },
      { id: 'b-burgerbuns', name: 'Burger buns', recipeId: 'brioche',  weight: 81,  kind: 'number' },
      { id: 'b-subrolls',   name: 'Sub rolls',   recipeId: 'brioche',  weight: 121, kind: 'number' },
    ] },
    { id: 'c-client-2', name: 'Client 2', products: [
      { id: 'f-trayfocaccia', name: 'Tray focaccia', recipeId: 'focaccia',  weight: 1800, kind: 'number' },
      { id: 'b-bun',          name: 'Buns',          recipeId: 'brioche',   weight: 71,   kind: 'number' },
      { id: 'b-rolls',        name: 'Rolls',         recipeId: 'brioche',   weight: 71,   kind: 'number' },
      { id: 's-loaf',         name: 'Loaf',          recipeId: 'sourdough', weight: 905,  kind: 'number' },
    ] },
    { id: 'c-client-3', name: 'Client 3', products: [
      { id: 'f-panini', name: 'Panini', recipeId: 'focaccia', weight: 131, kind: 'number' },
    ] },
  ],
  // The recipes — the base everything else hangs off. Each has a calc logic, an
  // ordered ingredient list, an optional designated leavening (yeast/starter) with a
  // default % and a "show the knob" flag, a stored baseline % (the leavening's share
  // at rest — see scaleRecipe), and its calculator-tab order + visibility. The three
  // shipped recipes reproduce today's exact amounts, names, order and leavening, so
  // the dough math is byte-identical (proven in tests/unified-scaler + dynamic-recipes).
  recipes: [
    { id: 'focaccia', name: 'Focaccia', logic: 'orders',
      ingredients: [
        { key: 'flourBlu', label: 'Flour uniqua blue', grams: 278 },
        { key: 'flourT65', label: 'Flour T65', grams: 278 },
        { key: 'malt', label: 'Malt', grams: 3 },
        { key: 'sugar', label: 'Sugar', grams: 8 },
        { key: 'salt', label: 'Salt', grams: 11 },
        { key: 'yeast', label: 'Yeast', grams: 3.6 },
        { key: 'oil', label: 'Oil', grams: 56 },
        { key: 'water1', label: '1° Water', grams: 334 },
        { key: 'water2', label: '2° Water', grams: 24 },
      ],
      leaveningKey: 'yeast', leaveningDefaultPct: 0.65, showLeavening: true,
      baselinePct: 0.6474820143884892, order: 0, visible: true },
    { id: 'brioche', name: 'Brioche', logic: 'orders',
      ingredients: [
        { key: 'flour', label: 'Mella brioche pof', grams: 3185 },
        { key: 'yeast', label: 'Yeast', grams: 127.4 },
        { key: 'water', label: 'Water', grams: 1575 },
      ],
      leaveningKey: 'yeast', leaveningDefaultPct: 4, showLeavening: true,
      baselinePct: 4, order: 1, visible: true },
    { id: 'sourdough', name: 'Sourdough', logic: 'orders',
      ingredients: [
        { key: 'flourBlu', label: 'Flour uniqua blue', grams: 2560 },
        { key: 'flourT65', label: 'Flour T65', grams: 2560 },
        { key: 'flourWhole', label: 'Flour wholemeal', grams: 570 },
        { key: 'water1', label: '1° Water', grams: 3800 },
        { key: 'starter', label: 'Starter', grams: 1024 },
        { key: 'malt', label: 'Malt', grams: 30 },
        { key: 'salt', label: 'Salt', grams: 124 },
        { key: 'water2', label: '2° Water', grams: 300 },
      ],
      leaveningKey: 'starter', leaveningDefaultPct: 18, showLeavening: true,
      baselinePct: 18, order: 2, visible: true },
  ],
  // The ingredient registry — a master list of names for autocomplete when composing
  // a recipe. Independent of the recipes (a name can exist here without being used).
  // Seeded with the distinct ingredient names of the three recipes.
  ingredients: [
    { id: 'ing-flourblue', name: 'Flour uniqua blue' },
    { id: 'ing-flourt65', name: 'Flour T65' },
    { id: 'ing-flourwhole', name: 'Flour wholemeal' },
    { id: 'ing-malt', name: 'Malt' },
    { id: 'ing-sugar', name: 'Sugar' },
    { id: 'ing-salt', name: 'Salt' },
    { id: 'ing-yeast', name: 'Yeast' },
    { id: 'ing-starter', name: 'Starter' },
    { id: 'ing-oil', name: 'Oil' },
    { id: 'ing-water1', name: '1° Water' },
    { id: 'ing-water2', name: '2° Water' },
    { id: 'ing-water', name: 'Water' },
    { id: 'ing-mella', name: 'Mella brioche pof' },
  ],
  // Independent WhatsApp order lists (decoupled from the recipe tabs): a title plus
  // client entries, each naming an address-book client and the catalogue product ids
  // it should show. References are resolved live; deleted clients/products are pruned.
  whatsappLists: [
    { id: 'wl-market', title: 'Market order', clients: [
      { clientId: 'c-client-1', products: ['f-ciabatta', 'b-burgerbuns', 'b-subrolls'] },
      { clientId: 'c-client-2', products: ['f-trayfocaccia', 'b-bun', 'b-rolls', 's-loaf'] },
      { clientId: 'c-client-3', products: ['f-panini'] },
    ] },
  ],
  // Direct WhatsApp clients: a standalone recipient with a TYPED name and catalogue
  // product ids. Empty by default. Product ids are resolved live; deleted ids pruned.
  whatsappClients: [],
  // Whether the per-tab "Extra dough" box is shown in each recipe tab. Default: shown.
  extraDough: { focaccia: true, brioche: true, sourdough: true },
  // Catalogue product ids INCLUDED in each tab's divisor box. Opt-in: an empty list
  // means NO product is split until the user ticks it in Settings.
  divisorIncluded: { focaccia: [], brioche: [], sourdough: [] },
  // Which recipes' logs are SHOWN in the app's Log list (display-only filter).
  logVisibility: { focaccia: true, brioche: true, sourdough: true },
  // How long (in hours) a log stays in the app's Log list. 24 or 48.
  logRetentionHours: 24,
  logRetentionByDough: { focaccia: 24, brioche: 24, sourdough: 24 },
  // Which days the WhatsApp order form fills itself from. Default: both, because a
  // day's order is normally assembled from two days' work.
  orderPrefillWindow: 'both',
};
