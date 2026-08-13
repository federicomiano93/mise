// people.js — "Who can get in": the owner's list of everybody in this location,
// what each of them may do, and the six-digit code that adds one more.
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
  watchMembers, createJoinCode, setMemberRole, setMemberName, callFailureText,
} from './firebase-staff.js';
import { expiresInWords } from '../join-code.js';
import {
  ROLE_CHOICES, personLabel, personLabelInSentence, choiceKey,
  choiceLabel, choiceLabelInSentence,
} from '../roles.js';
import { t } from '../i18n.js';
import { nameProblem, cleanName } from '../credentials.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// What each role means, in the words the person reading this screen would use.
//
// ⚠️ THESE SENTENCES ARE THE ONLY PLACE ANYBODY IS EVER TOLD what a role does.
// Nothing else in the app explains it, so a wrong one here is a wrong decision
// about a real person's access — made confidently, because the screen said so.
// ⚠️ KEYED BY THE PILL, NOT BY THE ROLE, because two pills share one role.
// "Head chef" has to state plainly that it is the manager level under another
// name — four pills with four different-sounding sentences would read as four
// levels of power, and somebody would pick between them believing it mattered.
// ⚠️ KEYS, NOT WORDS, AND LOOKED UP AT DRAW TIME. These are module-level tables:
// a translated sentence written here would be fixed at import — the language the
// app happened to start in, never changing again however often somebody switched
// the setting. Same reason ROLE_CHOICES carries a labelKey (js/roles.js).
const ROLE_MEANS = {
  owner: 'role.means.owner',
  manager: 'role.means.manager',
  'head-chef': 'role.means.headChef',
  staff: 'role.means.staff',
};

// ⚠️ THE WHOLE SENTENCE PER ROLE, NOT A TEMPLATE WITH AN ARTICLE IN IT. English
// needs «an owner», «a manager», «the head chef»; Italian needs no article at all
// («Rendere Marco titolare?»). A hole for the article would be a hole no Italian
// translator can fill, and it would force one to exist. Where two languages
// differ in STRUCTURE and not merely in words, each case gets its own sentence.
const CONFIRM_TITLE = {
  owner: 'people.confirm.owner',
  manager: 'people.confirm.manager',
  'head-chef': 'people.confirm.headChef',
  staff: 'people.confirm.staff',
};

// A person's name, falling back honestly rather than inventing one. The four
// accounts made by hand in the Firebase console have no name at all, and saying
// so is what tells the owner there is something to fix.
function displayName(person) {
  const full = [cleanName(person.firstName), cleanName(person.lastName)]
    .filter(Boolean).join(' ');
  return full || '(no name yet)';
}

export function openPeople(myUid) {
  let members = [];
  let stop = null;
  let pending = null;      // the code being shown, if any
  // Which pill the next code will invite as. It starts at Employee — the least
  // power — so a distracted tap grants nothing.
  let newChoice = ROLE_CHOICES.find(c => c.key === 'staff');
  let renaming = null;     // the uid whose row is currently two input boxes

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

  // ── Choosing a role ────────────────────────────────────────────────────────
  //
  // ⚠️ THREE PILLS, NOT A TWO-WAY TOGGLE. With three roles a single button saying
  // "Make owner" cannot express where somebody is going, and a toggle that cycles
  // is worse: it puts a real person's access one mis-tap away from a role nobody
  // chose. Every pill states its destination, and the current one is disabled —
  // so the only taps that reach the server are real changes.
  // ⚠️ FOUR WORDS, THREE LEVELS OF POWER. "Manager" and "Head chef" are the same
  // level under two names — Federico's own words for it since 11 Aug, and the
  // reason it is a title rather than a fourth role is in js/roles.js. The
  // confirmation below has to say so out loud, or four pills read as four levels.
  function rolePills(current, onPick) {
    const wrap = el('div', { class: 'people-pills', role: 'group', 'aria-label': 'Role' });
    for (const choice of ROLE_CHOICES) {
      const chosen = choice.key === current;
      const pill = el('button', {
        type: 'button',
        class: `people-pill${chosen ? ' people-pill--on' : ''}`,
        'aria-pressed': chosen ? 'true' : 'false',
      }, choiceLabel(choice));
      if (chosen) pill.disabled = true;
      else pill.addEventListener('click', () => onPick(choice));
      wrap.appendChild(pill);
    }
    return wrap;
  }

  // ── The list ───────────────────────────────────────────────────────────────

  function paint() {
    list.textContent = '';

    if (members === null) {
      list.appendChild(el('p', { class: 'people-empty', text:
        'Could not read who works here. Check your connection.' }));
      return;
    }

    // Most power first, then alphabetically by name: the question this screen is
    // usually opened to answer is "who can delete things", and that should not
    // need scrolling for.
    const rank = r => (r === 'owner' ? 0 : r === 'manager' ? 1 : 2);
    const sorted = [...members].sort((a, b) =>
      rank(a.role) - rank(b.role) || displayName(a).localeCompare(displayName(b)));

    for (const person of sorted) {
      const isMe = person.uid === myUid;

      if (renaming === person.uid) {
        list.appendChild(renameRow(person));
        continue;
      }

      const row = el('div', { class: 'people-row' }, [
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-name', text: displayName(person) + (isMe ? ' · you' : '') }),
          el('span', { class: 'people-email', text: person.email || '(no email)' }),
        ]),
      ]);

      // ⚠️ NO CONTROLS ON YOUR OWN ROW. Demoting yourself is the one action here
      // that cannot be undone by the person who took it — you would need somebody
      // else to put you back — so the buttons simply are not there. The server
      // refuses the last owner as well, but a screen that offers a tap and then
      // explains why not is a worse screen than one that does not offer it.
      if (isMe) {
        row.appendChild(el('span', { class: 'people-role', text: personLabel(person.role, person.title) }));
      } else {
        row.appendChild(rolePills(choiceKey(person.role, person.title), next => change(person, next)));
        row.appendChild(el('div', { class: 'people-row-actions' }, [
          el('button', {
            type: 'button', class: 'mgmt-link',
            onClick: () => { renaming = person.uid; paint(); },
          }, 'Rename'),
          el('button', {
            type: 'button', class: 'mgmt-link danger', onClick: () => remove(person),
          }, 'Remove'),
        ]));
      }

      list.appendChild(row);
    }

    if (!sorted.length) {
      list.appendChild(el('p', { class: 'people-empty', text: 'Nobody else yet.' }));
    }
  }

  // ── Giving somebody a name ─────────────────────────────────────────────────
  //
  // ⚠️ EDITED IN THE ROW, NOT IN A POP-UP. The browser's own prompt() is the grey
  // system box this app removed everywhere in PR #28, and confirm-dialog.js only
  // asks yes-or-no — it is byte-identical across six copies and must not grow a
  // text field for one screen. Two inputs in the row need neither.
  //
  // ⚠️ AND IT IS WHAT THE ACCOUNTS MADE IN THE FIREBASE CONSOLE NEED. They never
  // passed through the join screen, so they carry no name at all; without this
  // the roster is a list of email addresses and no way to tell whose phone is
  // whose.
  function renameRow(person) {
    const first = el('input', { class: 'people-input', type: 'text', value: cleanName(person.firstName) });
    first.placeholder = 'First name';
    first.autocomplete = 'given-name';
    const last = el('input', { class: 'people-input', type: 'text', value: cleanName(person.lastName) });
    last.placeholder = 'Surname';
    last.autocomplete = 'family-name';

    const status = el('p', { class: 'people-note' });
    status.setAttribute('role', 'alert');

    const save = el('button', { type: 'button', class: 'btn-primary people-save' }, 'Save');
    save.addEventListener('click', async () => {
      const problem = nameProblem(first.value, 'first') || nameProblem(last.value, 'last');
      if (problem) {
        status.textContent = problem;
        (nameProblem(first.value, 'first') ? first : last).focus();
        return;
      }
      save.disabled = true;
      try {
        await setMemberName(person.uid, first.value, last.value);
        renaming = null;
        paint();
      } catch (err) {
        save.disabled = false;
        status.textContent = callFailureText(err, 'Could not save that name. Check your connection.');
      }
    });

    const cancel = el('button', { type: 'button', class: 'btn-secondary people-save' }, 'Cancel');
    cancel.addEventListener('click', () => { renaming = null; paint(); });

    const row = el('div', { class: 'people-row people-row--editing' }, [
      el('span', { class: 'people-email', text: person.email || '(no email)' }),
      first, last, status,
      el('div', { class: 'people-row-actions' }, [save, cancel]),
    ]);
    setTimeout(() => first.focus(), 0);
    return row;
  }

  async function change(person, choice) {
    // ⚠️ THE CONFIRMATION SAYS WHAT THE ROLE DOES, not just its name. "Make this
    // person a manager?" means nothing to somebody deciding whether their baker
    // should be one; the sentence about deleting is the whole decision.
    const ok = await confirmDialog({
      title: t(CONFIRM_TITLE[choice.key], { name: displayName(person) }),
      message: t(ROLE_MEANS[choice.key]),
      okLabel: t('people.make', { role: choiceLabelInSentence(choice) }),
      // Taking power away is the direction that surprises somebody mid-shift.
      danger: choice.role === 'staff',
    });
    if (!ok) return;
    try { await setMemberRole(person.uid, choice.role, choice.title); }
    catch (err) {
      await alertDialog(callFailureText(err, 'Could not change that. Check your connection and try again.'));
    }
  }

  async function remove(person) {
    const ok = await confirmDialog({
      title: 'Remove this person?',
      message: `${displayName(person)} (${person.email || 'no email'}) will lose access to this location immediately. Everything they have entered stays.`,
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
        'Add someone who works here. They install the app, create their own account with their name, and type the code you give them.' }));
      // ⚠️ THE ROLE IS CHOSEN BEFORE THE CODE, not after they arrive. A code is
      // read out to somebody standing there, and going back to change their role
      // afterwards is a second errand nobody remembers. It starts at Employee —
      // the least power — so a distracted tap grants nothing.
      codeBox.appendChild(rolePills(newChoice.key, choice => { newChoice = choice; paintCode(); }));
      codeBox.appendChild(el('p', { class: 'people-note', text: t(ROLE_MEANS[newChoice.key]) }));
      const add = el('button', { type: 'button', class: 'btn-primary people-add' },
        t('people.add', { role: choiceLabelInSentence(newChoice) }));
      add.addEventListener('click', mint);
      codeBox.appendChild(add);
      return;
    }

    // ⚠️ SHOWN ONCE AND NEVER STORED. The server keeps only a hash of it, so this
    // screen is the only place the code exists in readable form — which is why it
    // is large, and why the sentence under it says what happens next rather than
    // leaving somebody holding six digits and no instructions.
    codeBox.appendChild(el('p', { class: 'people-hint', text: 'Read this out to them:' }));
    codeBox.appendChild(el('p', { class: 'people-digits', text: pending.code }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      t('people.joinsAs', {
        role: personLabelInSentence(pending.role, pending.title),
        expires: expiresInWords(pending),
      }) }));

    const again = el('button', { type: 'button', class: 'btn-secondary people-add' }, 'Done');
    again.addEventListener('click', () => { pending = null; paintCode(); });
    codeBox.appendChild(again);
  }

  async function mint() {
    try {
      // ⚠️ THE ROLE COMES BACK FROM THE SERVER AND THAT IS WHAT IS SHOWN. The
      // function reduces a role it does not recognise to an employee, so echoing
      // what was ASKED for could promise a manager where a code for an employee
      // was actually made.
      pending = await createJoinCode(newChoice.role, newChoice.title);
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
