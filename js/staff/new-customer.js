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

import { t } from '../i18n.js';
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
  // ⚠️ THE FIRST COLUMN IS THE SECTION ID AND IS NEVER TRANSLATED — it is what
  // the venue document stores. The other two are keys, looked up when drawn.
  ['calculator', 'section.calculator', 'section.calculator.sub'],
  ['orders', 'section.orders', 'section.orders.sub'],
  ['catalogue', 'section.catalogue', 'section.catalogue.sub'],
  ['pastries', 'section.pastries', 'section.pastries.sub'],
  ['foodcost', 'section.foodcost', 'section.foodcost.sub'],
];

const MAX_NAME = 80;   // the server refuses longer, so refuse it here first

// ⚠️ WHO THE BUSINESS IS FOR IS DECIDED BY THE DOOR, NOT BY A QUESTION.
//
// It WAS a question — two radio rows, "For a customer" / "One of mine" — for a few
// hours on 13 Aug 2026, and Federico hit the defect it causes within minutes of
// opening the app: the screen defaults to "for a customer", so his own bakery was
// created as a customer's and he could not get into it. The two entry points
// already say which is meant, and a screen that asks anyway is a screen that can
// be answered wrongly:
//
//   Choose location  → the list of HIS venues        → 'self'
//   Customer businesses → the app's customer list    → 'customer'
//
// ⚠️ AND THE TWO OUTCOMES ARE GENUINELY DIFFERENT, not a wording choice. For a
// customer the caller does NOT become a member — their data, their staff, their
// prices, and whoever sells the app has no business holding those keys. For one
// of his own there is nobody to invite, so he is made owner on the spot. That is
// exactly why the answer must not be one tap away from the wrong one.
const OWNER_KINDS = ['self', 'customer'];

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
// `ownerKind` is REQUIRED — see OWNER_KINDS above.
export function openNewCustomer({ onClose, host, ownerKind } = {}) {
  // ⚠️ THROWS RATHER THAN GUESSING, the same choice js/location.js makes for a
  // missing location and for the same reason: a stray call must fail loudly.
  // Neither default is safe here — 'customer' silently strands a business its
  // creator cannot enter (the defect this whole change exists to remove), and
  // 'self' silently puts somebody else's business into this account. A screen
  // that does not open gets fixed; a screen that quietly does the wrong thing is
  // what cost Federico an afternoon.
  if (!OWNER_KINDS.includes(ownerKind)) {
    throw new Error(`openNewCustomer needs ownerKind (${OWNER_KINDS.join(' | ')})`);
  }
  const forSelf = ownerKind === 'self';

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
      // ⚠️ The title follows the door. It said "New customer" whatever it was
      // about, so a venue of your own was created under a heading calling it
      // somebody else's — the same mistake as the screen itself, in one word.
      el('div', { class: 'orders-header-title' }, [
        el('h1', { text: t(forSelf ? 'nc.title.self' : 'nc.title.customer') }),
      ]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [form, result]),
  ]);

  // ⚠️ THE LINK IS SHOWN ONCE AND CANNOT BE SHOWN AGAIN. Only a sha256 of it is
  // stored, on purpose — so walking away without copying it leaves a customer's
  // location that nobody can enter, recoverable only from the Firebase console.
  // Hence a question on the way out, and only while there is something to lose.
  // ⚠️ `made.mine` IS PART OF THE CONDITION, AND IT WAS MISSING. showMine() says in
  // as many words that a business of your own has "no secret here to leave behind"
  // and must NOT warn on the way out — but the guard below only asked whether
  // something had been created, so tapping the header Back after creating one of
  // your own raised "Leave without sending the link?" about a link that does not
  // exist. A warning that never means anything teaches people to tap through the
  // one that does (the v275 lesson), which is the very thing showMine avoids.
  async function leave() {
    if (made && !made.mine && !handedOver) {
      const ok = await confirmDialog({
        title: t('nc.leave.title'),
        message: t('nc.leave.message', { name: made.name }),
        okLabel: t('nc.leave.ok'),
        cancelLabel: t('nc.leave.stay'),
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
    placeholder: t('nc.namePlaceholder'), autocapitalize: 'words',
  });
  const nameLabel = el('label', { class: 'people-label', text: t('nc.nameLabel') });
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

  // ── Which country it sells in ──────────────────────────────────────────────
  //
  // ⚠️⚠️ THIS IS A LEGAL QUESTION WEARING THE CLOTHES OF A SETTING, and it is
  // asked at creation because it can never be worked out afterwards. It decides
  // what language this venue's allergen labels are printed in: retained Reg. (EU)
  // 1169/2011 Art. 15 asks for food information in a language easily understood
  // where the food is marketed.
  //
  // ⚠️ NOTHING IS PRE-SELECTED, exactly like the sections below and for a sharper
  // version of the same reason. Pre-ticking a section sells part of the app by
  // accident; pre-selecting "United Kingdom" would make every business created in
  // a hurry print ENGLISH allergen labels — right for every venue that exists
  // today, and silently non-compliant for the first Italian customer.
  let country = '';
  const countryList = el('div', { class: 'nc-sections' },
    [['GB', 'United Kingdom', 'Labels are printed in English.'],
      ['IT', 'Italia', 'Le etichette sono prodotte in italiano.']]
      .map(([key, label, what]) => {
        const radio = el('input', { type: 'radio', class: 'nc-check', name: 'nc-country' });
        radio.addEventListener('change', () => { if (radio.checked) country = key; });
        return el('label', { class: 'nc-section' }, [
          radio,
          el('span', { class: 'nc-section-text' }, [
            el('span', { class: 'nc-section-name', text: label }),
            el('span', { class: 'nc-section-what', text: what }),
          ]),
        ]);
      }));

  const status = el('p', { class: 'people-note', role: 'alert' });
  const create = el('button', { type: 'button', class: 'btn-primary people-save', text: t('nc.create') });

  // ⚠️ THE SENTENCE STILL HAS TO BE THERE, even with nothing to choose. It is what
  // makes the outcome predictable BEFORE the Create button — that this one opens
  // straight away, or that this one produces a link somebody else opens. Removing
  // the question is not a reason to remove the explanation: it is a reason for the
  // explanation to be certain instead of conditional.
  const hint = el('p', { class: 'people-hint',
    text: t(forSelf ? 'nc.explain.self' : 'nc.explain.customer') });

  const sectionsLabel = el('p', { class: 'people-label', text: forSelf
    ? t('nc.sections.self')
    : t('nc.sections.customer') });

  form.append(
    hint,
    nameLabel,
    // Before the sections on purpose: it is a fact about the business, where the
    // sections are a fact about the sale.
    el('p', { class: 'people-label', text: t('nc.country') }),
    el('p', { class: 'people-note', text:
      'This decides the language its allergen labels are printed in, and it cannot '
      + 'be worked out later. The law asks for a label in the language of the country '
      + 'where the food is sold.' }),
    countryList,
    sectionsLabel,
    sectionList,
    create,
    status,
  );

  // ⚠️ EVERY CHECK RUNS BEFORE THE NETWORK, and a location with no sections is a
  // real refusal, not pedantry: it opens to an empty Home and there is no screen
  // anywhere that can switch one back on — that needs the Firebase console.
  function problem() {
    const typed = name.value.trim();
    if (!typed) return [t('nc.err.noName'), name];
    if (typed.length > MAX_NAME) return [t('nc.err.longName', { n: MAX_NAME }), name];
    // ⚠️ REFUSED, NOT DEFAULTED. The server refuses it too; this one only exists
    // so the refusal arrives before the network and says something useful.
    if (!country) return [t('nc.err.noCountry'), null];
    const any = [...boxes.values()].some(box => box.checked);
    if (!any) return [t('nc.err.noSection'), null];
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

    const bought = SECTIONS.filter(([key]) => sections[key]).map(([, label]) => label);
    // ⚠️ THE COUNTRY IS IN THE CONFIRMATION, because it is the one answer here
    // that cannot be corrected from any screen afterwards.
    const where = country === 'IT' ? 'Italy — labels in Italian' : 'the United Kingdom — labels in English';
    const ok = await confirmDialog({
      title: forSelf ? 'Create this business?' : 'Create this customer?',
      message: `${typed}\n\nSells in: ${where}.\nSections: ${bought.join(', ')}.\n\n`
        + (forSelf
          ? 'It will be created in YOUR account, as owner.'
          : 'Whoever opens the link becomes its owner.'),
      okLabel: 'Create',
    });
    if (!ok) return;

    create.disabled = true;
    status.textContent = 'Creating…';
    try {
      const res = await createWorkspace(typed, sections, { forSelf, country });
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
