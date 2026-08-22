// pastries-logs.js — what was actually put to prove, night by night.
//
// Read-only apart from the bin. The line under the list says out loud that the
// fifteen days are a WINDOW and not a lifespan: this screen used to delete a
// record once it was old enough, and the sentence there said so. It does not any
// more, so the sentence had to change with it — a screen that still promised a
// deletion nobody performs would be worse than one that never mentioned it.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { LOG_VISIBLE_DAYS } from './pastries-log-model.js';

const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 'Wed 5 Aug'. Formatted by hand rather than with toLocaleDateString, so it
// reads the same on every device and can be asserted — the same choice the
// Orders day helpers made.
function spellDate(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

export function renderLogs({ logs, app }) {
  const list = el('div', { class: 'pas-logs' });

  function card(log) {
    const rows = log.items.map(item => el('div', { class: 'pas-log-row' }, [
      el('span', { class: 'pas-log-name', text: item.name }),
      el('span', { class: 'pas-log-qty', text: String(item.qty) }),
    ]));

    const parts = [
      el('div', { class: 'pas-log-head' }, [
        // The DATE it was proved on, and WHICH list it was. They are different
        // things: a Wednesday list is accepted on Tuesday night.
        el('span', { class: 'pas-log-date', text: spellDate(log.date) }),
        el('span', { class: 'pas-log-badge', text: log.day }),
      ]),
    ];

    if (rows.length) parts.push(...rows);
    else parts.push(el('div', { class: 'pas-log-empty', text: t('past.nothingWasProved') }));

    if (log.note) parts.push(el('div', { class: 'pas-log-note', text: log.note }));

    parts.push(el('div', { class: 'pas-log-foot' }, [
      el('button', {
        class: 'pas-del-icon',
        type: 'button',
        icon: TRASH_SVG,
        'aria-label': `Remove the record for ${log.day}, ${spellDate(log.date)}`,
        onclick: async () => {
          const ok = await app.confirm({
            title: t('past.removeThisRecord'),
            message: `Remove the record for ${log.day}, ${spellDate(log.date)}? This cannot be undone.`,
            okLabel: t('ui.remove'),
            cancelLabel: t('ui.cancel'),
            danger: true,
          });
          if (!ok) return;
          const done = await app.removeLog(log.id);
          if (done) app.toast(t('past.recordRemoved'));
        },
      }),
    ]));

    return el('div', { class: 'pas-log' }, parts);
  }

  function paint(nextLogs) {
    const items = nextLogs || [];
    if (!items.length) {
      list.replaceChildren(el('p', { class: 'pas-empty' }, [
        t('past.noRecordsYet'),
        el('span', {
          class: 'pas-empty-hint',
          text: t('past.tapConfirmAtThe'),
        }),
      ]));
      return;
    }
    list.replaceChildren(
      ...items.map(card),
      el('p', {
        class: 'pas-retention',
        text: t('past.olderRecordsKept', { n: LOG_VISIBLE_DAYS }),
      }),
    );
  }

  paint(logs);

  return {
    node: el('div', { class: 'pas-view' }, [list]),
    update(nextLogs) { paint(nextLogs); },
  };
}
