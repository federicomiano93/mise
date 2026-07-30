// import-to-calculator.js — the ONE coupling between the catalogue and the
// Calculator. Copies a catalogue recipe into the Calculator's config/calculator
// recipes[] as an independent 'total' (pro-rata) recipe.
//
// This is the only file in js/catalogue/ that reaches into the Calculator, and it
// touches only the PURE shared data model (normalizeConfig) — never a feature UI.
// The write is a Firestore transaction (atomic read-modify-write) so overwriting
// the whole config document can't clobber a concurrent Calculator save; on a
// write conflict Firestore re-reads and retries.

import { normalizeConfig } from '../calculator-config.js';
import { toCalculatorRecipe, mergeImportedRecipe, findCalculatorImport } from './catalogue-model.js';
import { updateConfigInTransaction, getCalculatorConfig } from './firebase-catalogue.js';

// Import a catalogue recipe into the Calculator. Adds it, or updates the existing
// copy in place (matched by its 'cat-<id>' provenance id) so a re-import never
// duplicates. Returns { action: 'added' | 'updated' }.
export async function importRecipeIntoCalculator(catalogueRecipe) {
  const recipe = toCalculatorRecipe(catalogueRecipe);
  let action = 'added';
  await updateConfigInTransaction((rawConfig) => {
    const cfg = normalizeConfig(rawConfig);        // null → DEFAULT_CONFIG (stays valid)
    const merged = mergeImportedRecipe(cfg, recipe);
    action = merged.action;
    // Bump the optimistic-concurrency revision so a concurrent Calculator save
    // detects this write and preserves the imported recipe.
    const rev = (Number(rawConfig && rawConfig.configRev) || 0) + 1;
    // Re-normalize so the new recipe gets its keys/order/baseline tidied, then
    // stamp the revision. The location stamp the rules check is added by
    // updateConfigInTransaction — this function must not name a location, or it
    // goes stale the next time the data moves.
    return { ...normalizeConfig(merged.config), configRev: rev };
  });
  return { action };
}

// Is this catalogue recipe currently imported into the Calculator (as 'cat-<id>')?
// Reads the shared config once (read-only) and applies the pure findCalculatorImport
// check. Used to WARN before deleting a catalogue recipe: the Calculator copy is
// independent and stays. Returns false on any error/offline so a delete is never
// blocked by a failed check (the warning is a nicety, not a gate).
export async function isRecipeLinkedToCalculator(catalogueId) {
  try {
    const config = await getCalculatorConfig();
    return !!findCalculatorImport(config, catalogueId);
  } catch (err) {
    console.warn('Calculator link check failed:', err);
    return false;
  }
}
