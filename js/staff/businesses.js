// businesses.js — "Businesses": the customers of this app.
//
// ⚠️ WHY IT EXISTS, and it is not tidiness. locations/{lid} is readable only by a
// MEMBER, and whoever creates a customer is deliberately not one — so until this
// screen a business created here was invisible from the moment it was made, and
// its link (stored only as a sha256) was unrecoverable if it never arrived. The
// Firebase console was the only way back.
//
// ⚠️ AND WHY IT IS SEPARATE FROM THE HOME. The Home belongs to a VENUE — its
// header says the venue's name. "New customer" sat in the strip at its foot
// between "Who can get in" (about this venue) and "Log out" (about your account):
// three different scopes in one list. Federico spotted it on his own phone.
//
// An OVERLAY, like people.js, not a page: a page would want a name in
// js/sections.js, and a section missing from a location document counts as ON —
// so adding one switches it on for every venue that already exists and needs
// `sections.<name>: false` typed into each of them in the console first.

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { listWorkspaces, reissueOwnerLink, callFailureText } from './firebase-staff.js';
import { joinLinkFor } from '../join-link.js';
import { expiresInWords } from '../join-code.js';
import { isStranded, statusWords, sectionSummary, createdWords } from '../workspace-row.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ⚠️ Raced against a clock, like every clipboard write in this app. writeText()
// can sit there and never settle — the page losing focus is enough — and here it
// would stand between re-issuing a link and being shown it (v1.29.1).
const CLIPBOARD_WAIT_MS = 2000;

async function copyToClipboard(text) {
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS)),
    ]);
  } catch {
    return false;
  }
}

// Whatever happens, the link ends up on screen: copied if the clipboard took it,
// spelled out if it did not.
async function handOver(name, link, expiresAt) {
  const copied = await copyToClipboard(link);
  await alertDialog(copied
    ? `The new link for ${name} is copied. Paste it into a message to them.\n\n`
      + `It works once and has ${expiresInWords({ expiresAt })}.`
    : `Copy this link and send it to ${name}:\n\n${link}`);
}

export function openBusinesses() {
  let rows = [];

  const list = el('div', { class: 'people-list' });
  const top = el('div', { class: 'people-code' });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: () => overlay.remove(),
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'Businesses' })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [top, list]),
  ]);

  // ── The top of the screen ──────────────────────────────────────────────────

  const add = el('button', { type: 'button', class: 'btn-primary people-save', text: 'New business' });
  add.addEventListener('click', async () => {
    const { openNewCustomer } = await import('./new-customer.js');
    // ⚠️ The list is reloaded when that screen closes, not when it opens: a
    // business created and then walked away from must still appear here, which
    // is the whole reason this screen exists.
    openNewCustomer({ onClose: load });
  });

  top.append(
    el('p', { class: 'people-hint', text:
      'The businesses using this app. Your own venues are not here — you switch to '
      + 'those from the Home.' }),
    add,
  );

  // ── One business ───────────────────────────────────────────────────────────

  function rowFor(row) {
    const stranded = isStranded(row);

    const parts = [
      el('span', { class: 'people-name', text: row.name }),
      el('span', { class: 'people-email', text: sectionSummary(row.sections) }),
      el('span', {
        // ⚠️ The state carries a colour as well as words. "Nobody has opened this"
        // is the line somebody has to ACT on, and a list where every line reads
        // the same weight is a list nobody reads twice.
        class: `bz-state${stranded ? ' bz-state--stranded' : ''}`,
        text: `${statusWords(row)} · ${createdWords(row.createdAt).toLowerCase()}`,
      }),
    ];

    const card = el('div', { class: `people-row${stranded ? ' bz-row--stranded' : ''}` }, [
      el('div', { class: 'people-row-main' }, parts),
    ]);

    // ⚠️ ONLY WHILE NOBODY HAS OPENED IT. The server refuses otherwise, and this
    // draws nothing rather than a button that exists to be refused — the same
    // reason "Make a label" only appears on a fully declared recipe.
    if (stranded) {
      const again = el('button', {
        type: 'button', class: 'mgmt-link', text: 'Make a new link',
        onClick: () => reissue(row, again),
      });
      card.appendChild(el('div', { class: 'people-row-actions' }, [again]));
    }

    return card;
  }

  async function reissue(row, button) {
    const ok = await confirmDialog({
      title: 'Make a new link?',
      message: `A new link for ${row.name}. `
        + 'Any link sent before stops working, so whoever holds one cannot use it.',
      okLabel: 'Make a new link',
    });
    if (!ok) return;

    button.disabled = true;
    const was = button.textContent;
    button.textContent = 'Making…';
    try {
      const res = await reissueOwnerLink(row.id);
      await handOver(row.name, joinLinkFor(res.token), res.expiresAt);
      await load();
    } catch (err) {
      await alertDialog(callFailureText(err, 'Could not make a new link. Try again.'));
      button.disabled = false;
      button.textContent = was;
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  function paint() {
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('p', { class: 'people-empty', text:
        'No businesses yet. “New business” above creates one.' }));
      return;
    }
    // Stranded first: they are the ones with something to do about them.
    const order = [...rows].sort((a, b) => Number(isStranded(b)) - Number(isStranded(a)));
    order.forEach(row => list.appendChild(rowFor(row)));
  }

  async function load() {
    list.textContent = '';
    list.appendChild(el('p', { class: 'people-empty', text: 'Loading…' }));
    try {
      rows = await listWorkspaces();
      paint();
    } catch (err) {
      // ⚠️ Says what went wrong rather than showing an empty list. An empty list
      // and a failed read look identical, and one of them means "you have no
      // customers" while the other means "ask again in a minute".
      list.textContent = '';
      list.appendChild(el('p', { class: 'people-empty', text:
        callFailureText(err, 'Could not load the businesses. Check your connection.') }));
    }
  }

  document.body.appendChild(overlay);
  load();
  return overlay;
}
