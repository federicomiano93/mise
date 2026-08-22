// catalogue-settings.js — what the Recipe catalogue lets an owner change.
//
// One switch today: whether this venue may read a recipe from a photograph. It used to
// sit on the recipe list, and Federico's note on 23 Aug 2026 is the reason it does not
// any more — a switch nobody expects on a screen of recipes is worse than a screen with
// one row on it. The comment it replaces said *"one row does not justify building
// one"*; using the screen proved otherwise.
//
// ⚠️ REACHED ONLY BY AN OWNER OR A MANAGER, and the button that leads here is hidden
// from everybody else — the switch is the only thing on the screen, and an empty
// Settings screen is worse than no button. Hiding is courtesy either way: the server
// refuses the change itself (functions/onboarding.js setRecipePhoto).

import { t, onLanguageChange } from '../i18n.js';
import { el } from './dom.js';

export function renderSettings({ photoOn, onTogglePhoto }) {
  const root = el('div', { class: 'cat-view' });

  // ⚠️ EVERY PHRASE IS SET IN paint(), NEVER ONCE AT BUILD TIME. The interface
  // language comes from the VENUE and arrives a moment after the page has drawn
  // itself, so a string written once here is frozen in whatever language the app
  // started in. Same reason, same shape, as photo-capture.js.
  const label = el('span', { class: 'cat-photo-setting-label' });
  const state = el('span', { class: 'cat-photo-setting-state' });
  const row = el('button', {
    class: 'cat-alg-sheet-btn cat-photo-setting', type: 'button',
    onclick: () => onTogglePhoto(),
  }, [label, state]);

  const note = el('p', { class: 'cat-settings-note' });

  function paint(on = photoOn) {
    label.textContent = t('cat.photo.setting');
    state.textContent = on ? t('cat.photo.on') : t('cat.photo.off');
    row.classList.toggle('cat-photo-setting--on', !!on);
    note.textContent = t('cat.photo.settingNote');
  }
  paint();

  // A language arriving while this screen is open. `root.isConnected` guards it:
  // swap() replaces the screen's children with no teardown hook, so the listener
  // outlives the view.
  onLanguageChange(() => { if (root.isConnected) paint(); });

  root.append(row, note);
  return { root, refresh: paint };
}
