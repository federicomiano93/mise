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
import { listWorkspaces, reissueOwnerLink, deleteWorkspace, callFailureText } from './firebase-staff.js';
import { joinLinkFor } from '../join-link.js';
import { expiresInWords } from '../join-code.js';
import { isStranded, statusWords, sectionSummary, createdWords } from '../workspace-row.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// The app's one bin, drawn exactly as the Catalogue, Food Cost and the Calculator
// draw theirs — same path, same 2px stroke, same round caps. An icon, never an
// emoji: an emoji is a font, so it is a different picture on every phone and
// cannot take the colour of the thing it sits in.
const BIN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

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

// `host` is where the overlay is mounted, and it matters in exactly one case.
// Opened from the Misé home screen the sign-in cover is still up, and that cover
// marks every OTHER child of <body> `inert` — so a panel appended to the body
// there would be drawn and could not be touched. Mounted inside the cover it is
// part of the topmost layer instead. Everywhere else the body is right.
export function openBusinesses({ host } = {}) {
  let rows = [];

  const list = el('div', { class: 'people-list' });
  const top = el('div', { class: 'people-code' });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: () => overlay.remove(),
      }),
      // ⚠️ "Customer businesses". The bare word sat one letter away from "My
      // businesses" on the Misé home and left the whole distinction to a sub-line.
      // The FILE keeps its name on purpose: renaming it would add an entry to the
      // service worker's precache list, which is the one failure that does not
      // heal itself on the next load.
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'Customer businesses' })]),
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
    // ⚠️ 'customer', decided HERE and not by whoever taps. This is the app's
    // customer list, so a business added from it belongs to somebody else and
    // its creator stays out. A venue of your own is added from "Choose location".
    openNewCustomer({ onClose: load, ownerKind: 'customer' });
  });

  top.append(
    // ⚠️ THE TITLE NOW CARRIES HALF OF WHAT THIS USED TO SAY. It read "The
    // businesses using Misé. Your own venues are not here — …", and with the
    // screen called "Customer businesses" the first half repeats the heading. A
    // sentence whose opening says nothing new is a sentence people stop reading,
    // and the part that matters — where your own venues actually are — is at the
    // end of it. So only that part survives.
    el('p', { class: 'people-hint', text:
      'Your own venues are not here — they are behind “My businesses”.' }),
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
        // ⚠️ ONLY THE STATUS WORDS ARE LOWERCASED, NEVER THE DATE. This line read
        // "created 13 aug 2026" on Federico's phone: createdWords() returns
        // "Created 13 Aug 2026" and the .toLowerCase() here was applied to the
        // whole sentence, month included. Exactly the defect fixed in v180
        // ("typed sat 11 jul 2026") — the second time this project has lowercased
        // a string with a date inside it. Found by looking at a screenshot.
        text: `${statusWords(row)} · ${createdWords(row.createdAt).replace(/^Created/, 'created')}`,
      }),
    ];

    // `bz-row` scopes the layout rule that gives the two actions their own line —
    // see tokens.css. It is NOT the stranded marker, which is a separate class.
    const card = el('div', { class: `people-row bz-row${stranded ? ' bz-row--stranded' : ''}` }, [
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
      // ⚠️ AN ICON, KEPT QUIET, AND LAST. Deleting is the rarest thing done here
      // and the only one that cannot be undone, so it must never look like the
      // action the row is offering (P20). It is a sibling of the row, not nested
      // inside anything tappable — a button cannot live inside a button.
      const bin = el('button', {
        type: 'button', class: 'bz-del-icon', icon: BIN_ICON,
        'aria-label': `Delete ${row.name}`,
        onClick: () => remove(row, bin),
      });
      card.appendChild(el('div', { class: 'people-row-actions' }, [again, bin]));
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

  // ⚠️ THE ONE IRREVERSIBLE THING ON THIS SCREEN, so it says what goes and names
  // the business. `danger: true` colours it as the app colours every other delete,
  // and the confirmation is the app's own dialog — never the browser's grey box.
  //
  // ⚠️ It does NOT promise the business is empty. It is, by definition (nobody has
  // opened it), and saying "this will delete its data" would teach somebody to
  // expect that sentence on a screen where it could be false.
  async function remove(row, button) {
    const ok = await confirmDialog({
      title: 'Delete this business?',
      message: `${row.name} will be removed, along with the link that opens it. `
        + 'Nobody has opened it, so nothing else is lost — but this cannot be undone.',
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    button.disabled = true;
    try {
      await deleteWorkspace(row.id);
      await load();
    } catch (err) {
      // The server refuses if somebody opened it in the meantime, and that refusal
      // has to arrive as words rather than as a button that stopped working.
      await alertDialog(callFailureText(err, 'Could not delete this business. Try again.'));
      button.disabled = false;
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

  (host || document.body).appendChild(overlay);
  load();
  return overlay;
}
