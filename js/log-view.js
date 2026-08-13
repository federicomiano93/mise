// log-view.js — read-only rendering of a saved log version. Reused by the log list
// preview, the tap-to-open read-only screen (D) and the version-history viewer (C),
// so the calculator sheet is shown read-only WITHOUT duplicating the live one: the
// same CSS classes/markup are rebuilt from the stored sheet snapshot.
//
// CSP-safe: built with the el() DOM helper (no innerHTML, no inline styles).

import { t } from './i18n.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { dayLabel } from './log-model.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Legacy (migrated) logs kept only the grouped text; render it as customer/item rows.
function renderLegacyText(text) {
  const wrap = el('div', { class: 'logview-order' });
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line) && line.endsWith(':')) wrap.appendChild(el('div', { class: 'log-customer' }, line.slice(0, -1)));
    else wrap.appendChild(el('div', { class: 'log-item' }, line.trim()));
  }
  if (!wrap.childNodes.length) wrap.appendChild(el('div', { class: 'log-item' }, t('calc.empty')));
  return wrap;
}

// The order content (grouped by client, plus occasional clients) from a version's
// items. Zero-quantity lines are omitted, like the saved text.
function renderItems(version) {
  const wrap = el('div', { class: 'logview-order' });
  const groups = new Map();
  const order = [];
  for (const it of (version.items || [])) {
    if (num(it.qty) <= 0) continue;
    const key = it.clientName || 'Client';
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(it);
  }
  for (const key of order) {
    wrap.appendChild(el('div', { class: 'log-customer' }, key));
    for (const it of groups.get(key)) {
      wrap.appendChild(el('div', { class: 'log-item' }, [it.name + ': ', el('strong', {}, num(it.qty) + (it.kind === 'kg' ? ' kg' : ' pz'))]));
    }
  }
  for (const occ of (version.occasional || [])) {
    const prods = (occ.products || []).filter(p => num(p.qty) > 0);
    if (!prods.length) continue;
    wrap.appendChild(el('div', { class: 'log-customer' }, (occ.name || t('calc.occasionalClient')) + t('calc.occasional')));
    for (const p of prods) {
      wrap.appendChild(el('div', { class: 'log-item' }, [p.name + ': ', el('strong', {}, num(p.qty) + (p.unit === 'kg' ? ' kg' : ' pz'))]));
    }
  }
  if (version.sheet && num(version.sheet.extra_g) > 0) {
    wrap.appendChild(el('div', { class: 'log-item' }, t('calc.extraDough') + num(version.sheet.extra_g) + ' g'));
  }
  if (!wrap.childNodes.length) wrap.appendChild(el('div', { class: 'log-item' }, t('calc.noProductsEntered')));
  return wrap;
}

// The order block for any version (structured or legacy). Used for the list preview
// and as the top of the read-only screen.
export function renderOrder(version) {
  if (!version) return el('div', {});
  if (version.legacy || !version.sheet) return renderLegacyText(version.text);
  return renderItems(version);
}

// The read-only calculator result sheet, rebuilt from a stored sheet snapshot using
// the SAME classes as the live result card (so it looks identical, never editable).
export function renderSheetCard(sheet) {
  if (!sheet) return el('div', {});
  const rows = (sheet.ingredients || []).map(r =>
    el('div', { class: 'ing-row' }, [
      el('span', { class: 'ing-name' }, r.name),
      el('span', { class: 'ing-val' }, Math.round(num(r.grams)) + ' g'),
    ]));

  const children = [
    el('div', { class: 'result-header' }, [
      el('h3', {}, sheet.dough + ' dough'),
      el('span', { class: 'result-badge' }, num(sheet.total_g) + ' g raw'),
    ]),
    el('div', {}, rows),
    el('div', { class: 'ing-separator' }),
    el('div', { class: 'total-dough-row' }, [
      el('span', { class: 'total-dough-label' }, t('calc.totalDough')),
      el('span', {}, [el('span', { class: 'total-dough-val' }, String(num(sheet.total_g))), ' ', el('span', { class: 'total-dough-unit' }, 'g')]),
    ]),
  ];

  if (sheet.divisor) {
    children.push(el('div', { class: 'divisor-box' }, [
      el('div', { class: 'divisor-names' }, (sheet.divisor.names || []).join(', ')),
      el('div', { class: 'divisor-row' }, [
        el('span', { class: 'divisor-total' }, String(num(sheet.divisor.total))),
        el('span', { class: 'divisor-unit' }, 'g'),
        el('span', { class: 'divisor-sym' }, '÷'),
        el('span', { class: 'divisor-static' }, String(num(sheet.divisor.n))),
        el('span', { class: 'divisor-eq' }, '='),
        el('span', { class: 'divisor-result' }, String(num(sheet.divisor.result))),
        el('span', { class: 'divisor-unit' }, 'g'),
      ]),
    ]));
  }

  for (const c of (sheet.crates || [])) {
    children.push(el('div', { class: 'crate-box' }, [
      el('div', { class: 'crate-box-title' }, c.name),
      el('div', { class: 'crate-count' }, [
        el('span', { class: 'crate-count-val' }, String(num(c.count))),
        el('span', { class: 'crate-count-unit' }, ' box'),
      ]),
      el('div', { class: 'crate-sub' }, num(c.eachBoxG) + 'g each box'),
    ]));
  }

  return el('div', { class: 'result-card logview-sheet' }, children);
}

// The full read-only view of one version: a header (dough + day + author + time),
// the order content, then the calculator sheet (or just the text for legacy logs).
export function renderVersion(version, log) {
  const frag = document.createDocumentFragment();
  const v = version || {};
  const day = dayLabel(log, Date.now());

  frag.appendChild(el('div', { class: 'logview-head' }, [
    el('span', { class: 'logview-dough' }, log ? log.dough : (v.sheet ? v.sheet.dough : 'Log')),
    el('span', { class: 'logday-badge ' + day.tone }, day.text),
  ]));
  const at = v.at || {};
  frag.appendChild(el('div', { class: 'log-timestamp' }, [icon('calendar', 14), ' ' + (at.date || '') + ' — ' + (at.time || '')]));
  if (v.calculatedBy) frag.appendChild(el('div', { class: 'logview-by' }, t('calc.calculatedBy') + v.calculatedBy));

  frag.appendChild(renderOrder(v));
  if (!v.legacy && v.sheet) frag.appendChild(renderSheetCard(v.sheet));
  return frag;
}
