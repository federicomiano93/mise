// new-customer.js — "New customer": the first step of every sale.
//
// ⚠️ THIS SCREEN IS THE REASON THIS FILE EXISTS AT ALL. createWorkspace has been
// deployed and correct since 11 Aug 2026 and NOTHING CALLED IT — found on 12 Aug
// by walking a fake sale end to end on the emulator. The server half and the app
// half were each correct on their own, so every test stayed green while the app
// had no way to sell itself. That is what this closes.
//
// Like people.js this is an OVERLAY ON THE HOME, not a page: a page would need a
// name in js/sections.js, and a section missing from a location document defaults
// to ON — so adding one would switch it on for every venue that already exists.
//
// ⚠️ AND IT IS FOR THE APP'S OWNER, NOT A CUSTOMER'S. `session.isAppAdmin` is a
// different question from `session.isOwner`: one creates businesses, the other
// hires into one. The function checks admins/{uid} itself and refuses anybody
// else, so what is drawn here is courtesy, never the protection (P2).

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { createWorkspace, callFailureText } from './firebase-staff.js';
import { joinLinkFor } from '../join-link.js';
import { expiresInWords } from '../join-code.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// The sections a customer can buy, in the order they appear on the Home, with the
// words a person buying them would use — not the database keys.
//
// ⚠️ NOTHING IS TICKED TO BEGIN WITH, and that is deliberate (P20: a new thing
// starts empty). Pre-ticking everything sells the whole app by default and the
// mistake is invisible — an unbought section looks exactly like a bought one once
// the customer is inside it.
const SECTIONS = [
  ['calculator', 'Calculator', 'Dough scaling for the day’s orders'],
  ['orders', 'Orders', 'Suppliers, ingredients and the WhatsApp order'],
  ['catalogue', 'Recipe catalogue', 'Recipes, scaling and guided mixing'],
  ['pastries', 'Pastries', 'The seven weekday proving lists'],
  ['foodcost', 'Food cost', 'Prices, margins and labels'],
];

const MAX_NAME = 80;   // the server refuses longer, so refuse it here first

// ⚠️ WHO THE BUSINESS IS FOR, asked FIRST because it changes everything after it.
//
// Added 13 Aug 2026, after Federico created a second business for himself and
// could not get into it. The only route was to mint a link meant for a stranger
// and redeem it on his own account — which Firebase refuses, because that email
// already exists. The link is not a missing feature for this case: it is a step
// that should never have been in the way.
//
// ⚠️ AND THE TWO OUTCOMES ARE GENUINELY DIFFERENT, not a wording choice. For a
// customer the caller does NOT become a member — their data, their staff, their
// prices, and whoever sells the app has no business holding those keys. For one
// of his own there is nobody to invite, so he is made owner on the spot.
//
// Drawn as two rows with the reason underneath, the pattern this app already uses
// for the sections below and for the Misé home — never a dropdown, whose options
// can only be read one at a time, after choosing.
const OWNERS = [
  ['customer', 'For a customer', 'They get a link and become the owner. You do not go in.'],
  ['self', 'One of mine', 'Created and opened straight away, in your account. No link.'],
];

// ⚠️ THE CLIPBOARD IS RACED AGAINST A CLOCK. navigator.clipboard.writeText() can
// sit there and never settle — the page losing focus is enough — and here it
// would be the only thing between creating a customer and being shown their link.
// The same defect was observed for real on the client ordering link (v1.29.1).
const CLIPBOARD_WAIT_MS = 2000;

async function copyToClipboard(text) {
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), CLIPBOARD_WAIT_MS)),
    ]);
  } catch {
    return false;   // an old browser, a denied permission, an insecure origin
  }
}

// `onClose` lets the list behind this screen reload when it goes away — whether
// a business was created or not. ⚠️ It fires on CLOSE and not on success, because
// a business created and then walked away from is exactly the one the list has to
// show: it is stranded, and its link cannot be shown again.
// `host` is where the overlay is mounted, and it matters in exactly one case —
// the same one openBusinesses documents. Opened from the Businesses screen it
// belongs on the body; opened from a screen drawn INSIDE the auth cover (the
// "Choose location" list, added 13 Aug 2026) it must be mounted in the cover,
// because the cover marks every other child of <body> `inert` and a panel out
// there would be visible and untappable.
export function openNewCustomer({ onClose, host } = {}) {
  // The link, once it exists. Kept here because it decides whether leaving the
  // screen is safe — see the Back handler.
  let made = null;
  let handedOver = false;

  const form = el('div', { class: 'people-code' });
  const result = el('div', { class: 'people-list' });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: leave,
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'New customer' })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [form, result]),
  ]);

  // ⚠️ THE LINK IS SHOWN ONCE AND CANNOT BE SHOWN AGAIN. Only a sha256 of it is
  // stored, on purpose — so walking away without copying it leaves a customer's
  // location that nobody can enter, recoverable only from the Firebase console.
  // Hence a question on the way out, and only while there is something to lose.
  async function leave() {
    if (made && !handedOver) {
      const ok = await confirmDialog({
        title: 'Leave without sending the link?',
        message: `${made.name} has been created, but their link is shown only here `
          + 'and cannot be shown again. Without it nobody can open their app.',
        okLabel: 'Leave anyway',
        cancelLabel: 'Stay',
        danger: true,
      });
      if (!ok) return;
    }
    overlay.remove();
    if (typeof onClose === 'function') onClose();
  }

  // ── The form ───────────────────────────────────────────────────────────────

  const name = el('input', {
    class: 'people-input', type: 'text', maxLength: String(MAX_NAME),
    placeholder: 'Panificio Rossi', autocapitalize: 'words',
  });
  const nameLabel = el('label', { class: 'people-label', text: 'The business name' });
  nameLabel.appendChild(name);

  const boxes = new Map();
  const sectionList = el('div', { class: 'nc-sections' },
    SECTIONS.map(([key, label, what]) => {
      // ⚠️ NOT orders.css's .day-check: that is the WRAPPER class, and it gives a
      // 31px target. A mis-tap here sells the wrong section, and switching one
      // back on afterwards needs the Firebase console — so these are 44px (P18,
      // and the allergen form's lesson in v1.36.0).
      const box = el('input', { type: 'checkbox', class: 'nc-check' });
      boxes.set(key, box);
      const row = el('label', { class: 'nc-section' }, [
        box,
        el('span', { class: 'nc-section-text' }, [
          el('span', { class: 'nc-section-name', text: label }),
          el('span', { class: 'nc-section-what', text: what }),
        ]),
      ]);
      return row;
    }));

  const status = el('p', { class: 'people-note', role: 'alert' });
  const create = el('button', { type: 'button', class: 'btn-primary people-save', text: 'Create' });

  // Who it is for. Radios, not tick boxes: it is one answer, and the browser's own
  // grouping gives arrow-key navigation and the right screen-reader announcement.
  let ownerKind = 'customer';
  const hint = el('p', { class: 'people-hint' });
  const ownerList = el('div', { class: 'nc-sections' },
    OWNERS.map(([key, label, what]) => {
      const radio = el('input', { type: 'radio', class: 'nc-check', name: 'nc-owner' });
      radio.checked = key === 'customer';
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        ownerKind = key;
        paintHint();
      });
      return el('label', { class: 'nc-section' }, [
        radio,
        el('span', { class: 'nc-section-text' }, [
          el('span', { class: 'nc-section-name', text: label }),
          el('span', { class: 'nc-section-what', text: what }),
        ]),
      ]);
    }));

  // ⚠️ DECLARED BEFORE THE FUNCTION THAT USES IT. This project lost an afternoon to
  // a Catalogue that rendered completely blank with NO console error, because a
  // helper was reached before its own declaration (v1.27.0). It would be safe here
  // by call order alone — that is exactly the kind of "safe for now" that stops
  // being true when somebody moves a line.
  const sectionsLabel = el('p', { class: 'people-label' });

  // ⚠️ THE HINT FOLLOWS THE CHOICE. A fixed sentence describing the link becomes a
  // lie the moment "one of mine" is picked, and a wrong explanation is worse than
  // none because the next one is believed too (the v250 lesson, same shape).
  function paintHint() {
    hint.textContent = ownerKind === 'self'
      ? 'Creates the business in YOUR account, as owner. It opens straight away — '
        + 'no link, nothing to send.'
      : 'Creates the business and a link that makes whoever opens it its owner. '
        + 'They choose their own email and password. You do not go in.';
    sectionsLabel.textContent = ownerKind === 'self'
      ? 'Which sections it uses'
      : 'What they are buying';
  }

  form.append(
    el('p', { class: 'people-label', text: 'Who is this business for?' }),
    ownerList,
    hint,
    nameLabel,
    sectionsLabel,
    sectionList,
    create,
    status,
  );
  paintHint();

  // ⚠️ EVERY CHECK RUNS BEFORE THE NETWORK, and a location with no sections is a
  // real refusal, not pedantry: it opens to an empty Home and there is no screen
  // anywhere that can switch one back on — that needs the Firebase console.
  function problem() {
    const typed = name.value.trim();
    if (!typed) return ['Give the business a name.', name];
    if (typed.length > MAX_NAME) return [`That name is longer than ${MAX_NAME} characters.`, name];
    const any = [...boxes.values()].some(box => box.checked);
    if (!any) return ['Choose at least one section — otherwise their app opens empty.', null];
    return null;
  }

  create.addEventListener('click', async () => {
    const wrong = problem();
    if (wrong) {
      status.textContent = wrong[0];
      if (wrong[1]) wrong[1].focus();
      return;
    }

    const typed = name.value.trim();
    const sections = {};
    boxes.forEach((box, key) => { sections[key] = box.checked; });

    const forSelf = ownerKind === 'self';
    const bought = SECTIONS.filter(([key]) => sections[key]).map(([, label]) => label);
    const ok = await confirmDialog({
      title: forSelf ? 'Create this business?' : 'Create this customer?',
      message: `${typed}\n\nSections: ${bought.join(', ')}.\n\n`
        + (forSelf
          ? 'It will be created in YOUR account, as owner.'
          : 'Whoever opens the link becomes its owner.'),
      okLabel: 'Create',
    });
    if (!ok) return;

    create.disabled = true;
    status.textContent = 'Creating…';
    try {
      const res = await createWorkspace(typed, sections, { forSelf });
      if (forSelf) {
        made = { name: typed, locationId: res.locationId, mine: true };
        showMine();
        return;
      }
      made = { name: typed, link: joinLinkFor(res.token), expiresAt: res.expiresAt,
               locationId: res.locationId };
      showLink();
    } catch (err) {
      status.textContent = callFailureText(err);
      create.disabled = false;
    }
  });

  // ── One of mine: nothing to copy, nothing to lose ──────────────────────────
  //
  // ⚠️ NO "COPY THE LINK" AND NO WARNING ON THE WAY OUT, because there is no
  // secret here to leave behind. The customer screen has both for a real reason —
  // only a hash of that link is stored, so closing without copying strands a
  // business nobody can enter. Reusing the same screen would attach a warning to
  // a situation that cannot go wrong, and a warning that never means anything
  // teaches people to tap through the one that does (the v275 lesson).
  function showMine() {
    form.textContent = '';
    result.textContent = '';
    result.append(
      el('p', { class: 'people-hint', text: `${made.name} is ready, and it is yours.` }),
      el('p', { class: 'people-note', text:
        'You are its owner. It will be in your list of businesses.' }),
      el('button', {
        class: 'btn-primary people-save', type: 'button', text: 'Open my businesses',
        // ⚠️ A RELOAD, not a redraw. Membership is read ONCE, when the session
        // starts, so a brand-new location is invisible to a page that is already
        // running — the same reason redeeming a code reloads (js/auth-gate.js).
        onclick: () => window.location.reload(),
      }),
    );
  }

  // ── What they get ──────────────────────────────────────────────────────────

  function showLink() {
    form.textContent = '';
    result.textContent = '';

    result.append(
      el('p', { class: 'people-hint', text: `${made.name} is ready.` }),
      // ⚠️ THE LINK IS ALWAYS ON SCREEN AS TEXT, whatever the clipboard did. A
      // screen that only offered "Copied!" would leave nothing at all behind on
      // the phones where the clipboard silently refuses.
      el('p', { class: 'nc-link', text: made.link }),
      // expiresInWords returns "7 days left", so it is phrased as a thing the
      // link HAS, not a thing it does — "expires 7 days left" is not English.
      el('p', { class: 'people-note', text:
        `The link works once and has ${expiresInWords({ expiresAt: made.expiresAt })}.`
        + ' It is not stored anywhere and cannot be shown again.' }),
    );

    const copy = el('button', { type: 'button', class: 'btn-primary people-save', text: 'Copy the link' });
    copy.addEventListener('click', async () => {
      const copied = await copyToClipboard(made.link);
      handedOver = true;
      await alertDialog(copied
        ? `The link for ${made.name} is copied. Paste it into a message to them.`
        : `Copy this link and send it to ${made.name}:\n\n${made.link}`);
    });

    const share = el('button', { type: 'button', class: 'btn-secondary people-save', text: 'Send on WhatsApp' });
    share.addEventListener('click', () => {
      handedOver = true;
      const text = `Here is your link to set up ${made.name}: ${made.link}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    });

    const done = el('button', { type: 'button', class: 'btn-secondary people-save', text: 'Done' });
    done.addEventListener('click', leave);

    result.append(copy, share, done);
  }

  (host || document.body).appendChild(overlay);
  setTimeout(() => name.focus(), 0);
  return overlay;
}
