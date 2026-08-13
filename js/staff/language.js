// "App language" — the one screen where somebody chooses what the staff read.
//
// ⚠️⚠️ IT SAYS, EVERY TIME, THAT IT DOES NOT MOVE THE LABELS. That sentence is
// not decoration and it is not an apology: an allergen label must be in the
// language of the country the food is SOLD in (retained Reg. 1169/2011), so the
// label follows `country` and nothing else. Somebody who set the app to Italian
// and assumed their English labels had followed would be wrong in the one place
// this app can hurt a person. The screen states it in the same breath as the
// choice, not in a footnote at the end of a scroll.
//
// ⚠️ OWNER AND MANAGER ONLY, which includes a head chef (they hold 'manager').
// Federico's rule: everybody else uses the app's language and cannot change it.
// The card simply is not drawn for an employee — and the server refuses them as
// well, because hiding a control is courtesy, never security (P2).
//
// ⚠️ AND IT RELOADS. Every screen in this app reads its words at draw time, but
// dozens of them are already drawn when this returns — the venue's Home, the
// strip behind it, whatever was open before. Repainting all of them from here is
// a promise nobody could keep; a reload is honest and takes a moment. Same
// reasoning as switchLocation().

import { el } from './dom.js';
import { alertDialog } from './confirm-dialog.js';
import { setLocationLanguage } from './firebase-staff.js';
import { t, LANGUAGES, currentLanguage } from '../i18n.js';
// ⚠️ FACTS ABOUT THE LABEL, NEVER ITS WORDS. This screen has to say which
// language the labels are in; it must never be able to build one. Importing
// labelWord here turns tests/i18n-label-separation.test.mjs red by name —
// checked, not assumed.
import { countryOf, canPrintLabel, outputLanguage } from '../market.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ⚠️ EACH LANGUAGE NAMES ITSELF, IN ITSELF. «Italiano», not «Italian» — somebody
// looking for their own language is looking for the word they would use for it,
// and that is the one word on this screen that must not be translated.
const NAMES = Object.freeze({ en: 'English', it: 'Italiano' });

export function openLanguage(session) {
  const list = el('div', { class: 'people-list' });
  const status = el('p', { class: 'people-note' });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': t('auth.back'),
        icon: BACK_ICON, onClick: close,
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: t('lang.title') })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-hint', text: t('lang.intro') }),
      ]),
      list,
      // ⚠️ THE LABEL SENTENCE, ALWAYS, AND IT NAMES THE COUNTRY. A generic "labels
      // are not affected" is a rule; "your labels are printed in English because
      // this business sells in the United Kingdom" is the fact somebody can check.
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: labelSentence(session.location) }),
      ]),
      status,
    ]),
  ]);

  function close() { overlay.remove(); }

  function paint() {
    list.textContent = '';
    for (const lang of LANGUAGES) {
      const chosen = lang === currentLanguage();
      const row = el('div', { class: 'people-row' }, [
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-name', text: NAMES[lang] }),
        ]),
        el('div', { class: 'people-row-actions' }, [
          el('button', {
            type: 'button',
            class: `people-pill${chosen ? ' people-pill--on' : ''}`,
            'aria-pressed': chosen ? 'true' : 'false',
            onClick: () => choose(lang),
          }, chosen ? t('lang.inUse') : t('lang.use')),
        ]),
      ]);
      if (chosen) row.querySelector('button').disabled = true;
      list.appendChild(row);
    }
  }

  async function choose(lang) {
    status.textContent = t('lang.saving');
    for (const b of list.querySelectorAll('button')) b.disabled = true;
    try {
      await setLocationLanguage(session.locationId, lang);
      // ⚠️ A RELOAD, not a repaint — see the header. It also makes the change
      // arrive the same way it would on any other phone: read once, at open.
      location.reload();
    } catch (err) {
      status.textContent = '';
      await alertDialog(t('lang.err.save'));
      paint();
    }
  }

  paint();
  document.body.appendChild(overlay);
  return { close };
}

// What this venue's labels are printed in, and why. ⚠️ A venue with no country
// prints no label at all (js/market.js) — saying so here is more use than
// silence, because it is the one thing that stops a label existing.
function labelSentence(location) {
  if (!canPrintLabel(location)) return t('lang.labels.noCountry');
  // ⚠️ THE NAMES COME FROM THE INTERFACE, NOT FROM js/market.js. This sentence is
  // read by whoever is looking at the screen, so «inglese» and «Regno Unito» —
  // the first version said «sono prodotte in English … vende in the United
  // Kingdom», which is an Italian sentence with English words dropped into it.
  // Found by reading the Italian screen, not by any measurement.
  return t('lang.labels', {
    country: t(`country.${countryOf(location)}.in`),
    language: t(`language.${outputLanguage(location)}.inSentence`),
  });
}
