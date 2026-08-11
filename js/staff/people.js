// people.js — "Who can get in": the owner's list of everybody in this location,
// and the six-digit code that adds one more.
//
// ⚠️ IT IS AN OVERLAY ON THE HOME, NOT A PAGE OF ITS OWN, and that is a decision
// worth keeping. A new page would need a name in js/sections.js — and a section
// missing from a location document defaults to ON, so adding one turns it on for
// every venue that already exists and needs `sections.<name>: false` typed into
// each of them in the console before the release lands. This screen needs none
// of that: it is reached from the Home, it is drawn only for an owner, and the
// functions behind it refuse anybody else regardless of what is on screen.
//
// Follows the app's header spec: Back on the LEFT, title CENTRED, nothing on the
// right — there is no save here, every action applies as it is confirmed.

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import {
  watchMembers, createJoinCode, setMemberRole, callFailureText,
} from './firebase-staff.js';
import { expiresInWords } from '../join-code.js';
import { roleLabel } from '../roles.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

export function openPeople(myUid) {
  let members = [];
  let stop = null;
  let pending = null; // the code being shown, if any

  const list = el('div', { class: 'people-list' });
  const codeBox = el('div', { class: 'people-code' });

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back',
        icon: BACK_ICON, onClick: close,
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: 'Who can get in' })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [codeBox, list]),
  ]);

  function close() {
    if (stop) stop();
    overlay.remove();
  }

  // ── The list ───────────────────────────────────────────────────────────────

  function paint() {
    list.textContent = '';

    if (members === null) {
      list.appendChild(el('p', { class: 'people-empty', text:
        'Could not read who works here. Check your connection.' }));
      return;
    }

    // The owners first, then everybody else, each half alphabetical: the
    // question this screen is usually opened to answer is "who can delete
    // things", and that should not need scrolling for.
    const sorted = [...members].sort((a, b) =>
      (b.role === 'owner') - (a.role === 'owner') ||
      String(a.email || '').localeCompare(String(b.email || '')));

    for (const person of sorted) {
      const isMe = person.uid === myUid;
      const owner = person.role === 'owner';

      const row = el('div', { class: 'people-row' }, [
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-email', text: person.email || '(no email)' }),
          el('span', { class: 'people-role', text: roleLabel(person.role) + (isMe ? ' · you' : '') }),
        ]),
      ]);

      // ⚠️ NO CONTROLS ON YOUR OWN ROW. Demoting yourself is the one action on
      // this screen that cannot be undone by the person who took it — you would
      // need somebody else to put you back — so the button simply is not there.
      // The server refuses the last owner as well, but a screen that offers a
      // tap and then explains why not is a worse screen than one that does not
      // offer it.
      if (!isMe) {
        const actions = el('div', { class: 'people-row-actions' });
        actions.appendChild(el('button', {
          type: 'button', class: 'mgmt-link',
          onClick: () => change(person, owner ? 'staff' : 'owner'),
        }, owner ? 'Make staff' : 'Make owner'));
        actions.appendChild(el('button', {
          type: 'button', class: 'mgmt-link danger',
          onClick: () => remove(person),
        }, 'Remove'));
        row.appendChild(actions);
      }

      list.appendChild(row);
    }

    if (!sorted.length) {
      list.appendChild(el('p', { class: 'people-empty', text: 'Nobody else yet.' }));
    }
  }

  async function change(person, role) {
    const ok = await confirmDialog({
      title: role === 'owner' ? 'Make this person an owner?' : 'Make this person staff?',
      message: role === 'owner'
        ? `${person.email} will be able to delete suppliers, ingredients, recipes and products, and to invite other people.`
        : `${person.email} will keep working as normal but will no longer be able to delete things or invite people.`,
      okLabel: role === 'owner' ? 'Make owner' : 'Make staff',
      danger: role !== 'owner',
    });
    if (!ok) return;
    try { await setMemberRole(person.uid, role); }
    catch (err) {
      await alertDialog(callFailureText(err, 'Could not change that. Check your connection and try again.'));
    }
  }

  async function remove(person) {
    const ok = await confirmDialog({
      title: 'Remove this person?',
      message: `${person.email} will lose access to this location immediately. Everything they have entered stays.`,
      okLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    try { await setMemberRole(person.uid, null); }
    catch (err) {
      await alertDialog(callFailureText(err, 'Could not remove them. Check your connection and try again.'));
    }
  }

  // ── Adding somebody ────────────────────────────────────────────────────────

  function paintCode() {
    codeBox.textContent = '';

    if (!pending) {
      codeBox.appendChild(el('p', { class: 'people-hint', text:
        'Add someone who works here. They install the app, create their own account, and type the code you give them.' }));
      const add = el('button', { type: 'button', class: 'btn-primary people-add' }, 'Add a person');
      add.addEventListener('click', mint);
      codeBox.appendChild(add);
      return;
    }

    // ⚠️ SHOWN ONCE AND NEVER STORED. The server keeps only a hash of it, so
    // this screen is the only place the code exists in readable form — which is
    // why it is large, and why the sentence under it says what happens next
    // rather than leaving somebody holding six digits and no instructions.
    codeBox.appendChild(el('p', { class: 'people-hint', text: 'Read this out to them:' }));
    codeBox.appendChild(el('p', { class: 'people-digits', text: pending.code }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      `${expiresInWords(pending)} · they open the app, tap “I have a code”, create their account and type it.` }));

    const again = el('button', { type: 'button', class: 'btn-secondary people-add' }, 'Done');
    again.addEventListener('click', () => { pending = null; paintCode(); });
    codeBox.appendChild(again);
  }

  async function mint() {
    try {
      const made = await createJoinCode('staff');
      pending = made;
      paintCode();
    } catch (err) {
      await alertDialog(callFailureText(err, 'Could not make a code. Check your connection and try again.'));
    }
  }

  paintCode();
  paint();
  document.body.appendChild(overlay);

  watchMembers(next => { members = next; paint(); })
    .then(unsub => { stop = unsub; })
    .catch(err => {
      console.error('Could not watch the roster:', err);
      members = null;
      paint();
    });

  return { close };
}
