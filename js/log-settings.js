// log-settings.js — the "Log" Settings screen: ONE card per recipe, each choosing
// whether that recipe's logs appear in the Log list and for how long (24/48h, per
// recipe). DISPLAY-only filters in the shared config — logs are always written to and
// kept in Firestore; these only decide what the on-screen list shows.
//
// Edits are made on a WORKING COPY and applied only on Save (with a confirm). Leaving
// with unsaved changes asks to discard (P20). local-first via saveConfig, which
// re-renders and best-effort syncs to Firestore.

import { t } from './i18n.js';
import { getConfig, saveConfig } from './calculator-config-store.js';
import {
  cloneConfig, getRecipes, isLogVisible, getLogRetentionForDough,
  LOG_RETENTION_OPTIONS, getTabProducts,
} from './calculator-config.js';
import { el } from './calculator-render.js';
import { confirmDiscard } from './calculator-confirm.js';
import { confirmDialog } from './confirm-dialog.js';

let working = null; // { visibility: {recipeId:bool}, retention: {recipeId:hours} } or null
let dirty = false;

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

export function openLogSettings() {
  const cfg = getConfig();
  working = { visibility: {}, retention: {} };
  getRecipes(cfg).forEach(r => {
    working.visibility[r.id] = isLogVisible(cfg, r.id);
    working.retention[r.id] = getLogRetentionForDough(cfg, r.id);
  });
  dirty = false;
  render();
  show('logsettings-overlay');
}

function render() {
  const c = document.getElementById('logsettings-content');
  c.textContent = '';
  c.appendChild(el('p', { class: 'extra-help' },
    t('calc.forEachRecipeChoose') +
    t('calc.logsAreAlwaysKept')));
  getRecipes(getConfig()).forEach(r => c.appendChild(recipeCard(r)));
  const save = el('button', { class: 'cp-save-bottom', type: 'button' }, t('calc.saveChanges'));
  save.addEventListener('click', saveAll);
  c.appendChild(save);
}

// One card per recipe: its products (for context) + the two editable settings.
function recipeCard(recipe) {
  const card = el('div', { class: 'card logset-card' });
  card.appendChild(el('div', { class: 'card-title' }, recipe.name));

  const names = getTabProducts(getConfig(), recipe.id).map(p => p.name);
  card.appendChild(el('div', { class: 'logset-products' }, names.length ? names.join(', ') : t('calc.noProducts')));

  const visRow = el('label', { class: 'extra-toggle-row' }, [el('span', {}, t('calc.keepLogsVisible'))]);
  const cb = el('input', { type: 'checkbox' });
  cb.checked = working.visibility[recipe.id];
  cb.addEventListener('change', () => { working.visibility[recipe.id] = cb.checked; dirty = true; });
  visRow.appendChild(cb);
  card.appendChild(visRow);

  const durRow = el('label', { class: 'extra-toggle-row' }, [el('span', {}, t('calc.keepVisibleFor'))]);
  const sel = el('select', { class: 'extra-unit-select', 'aria-label': t('calc.logDurationFor') + recipe.name });
  LOG_RETENTION_OPTIONS.forEach(h => sel.appendChild(el('option', { value: String(h) }, h + ' hours')));
  sel.value = String(working.retention[recipe.id]);
  sel.addEventListener('change', () => { working.retention[recipe.id] = Number(sel.value); dirty = true; });
  durRow.appendChild(sel);
  card.appendChild(durRow);

  return card;
}

async function saveAll() {
  if (!(await confirmDialog({ message: t('calc.saveTheseLogSettings'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  const cfg = cloneConfig(getConfig());
  cfg.logVisibility = { ...working.visibility };
  cfg.logRetentionByDough = { ...working.retention };
  saveConfig(cfg);
  dirty = false;
  hide('logsettings-overlay');
}

async function closeLogSettings() {
  if (!(await confirmDiscard(dirty))) return;
  dirty = false;
  hide('logsettings-overlay');
}

document.getElementById('open-logsettings-btn').addEventListener('click', openLogSettings);
document.querySelector('.logsettings-back-btn').addEventListener('click', closeLogSettings);
document.getElementById('logsettings-home-btn').addEventListener('click', async () => {
  if (!(await confirmDiscard(dirty))) return;
  window.location.href = 'index.html';
});
