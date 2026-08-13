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
import { joinLinkFor, expiresInWords } from '../join-link.js';
import { copyToClipboard, sendOnWhatsApp } from './share.js';
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
  return full || t('people.noNameYet');
}

// ⚠️ IT TAKES THE WHOLE SESSION, not just a uid, and the reason is the WhatsApp
// message: an invitation that says only "open this link" is indistinguishable
// from every scam that has ever been sent over WhatsApp. It has to name the place
// the person is being let into, and `session.name` is where that name lives.
// openLanguage(session) next to it already had this shape.
export function openPeople(session) {
  const myUid = session && session.user && session.user.uid;
  const venueName = (session && session.name) || '';

  let members = [];
  let stop = null;
  let pending = null;      // the invitation being shown, if any
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
      el('div', { class: 'orders-header-title' }, [el('h1', { text: t('people.title') })]),
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
        t('people.err.read') }));
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
          el('span', { class: 'people-name', text: displayName(person) + (isMe ? t('people.you') : '') }),
          el('span', { class: 'people-email', text: person.email || t('people.noEmailParen') }),
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
          }, t('people.rename')),
          el('button', {
            type: 'button', class: 'mgmt-link danger', onClick: () => remove(person),
          }, t('people.remove')),
        ]));
      }

      list.appendChild(row);
    }

    if (!sorted.length) {
      list.appendChild(el('p', { class: 'people-empty', text: t('people.empty') }));
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
    first.placeholder = t('people.firstName');
    first.autocomplete = 'given-name';
    const last = el('input', { class: 'people-input', type: 'text', value: cleanName(person.lastName) });
    last.placeholder = t('people.surname');
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
        status.textContent = callFailureText(err, t('people.err.name'));
      }
    });

    const cancel = el('button', { type: 'button', class: 'btn-secondary people-save' }, t('people.cancel'));
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
      await alertDialog(callFailureText(err, t('people.err.change')));
    }
  }

  async function remove(person) {
    const ok = await confirmDialog({
      title: t('people.remove.title'),
      message: t('people.remove.message', {
        name: displayName(person), email: person.email || t('people.noEmail'),
      }),
      okLabel: t('people.remove'), danger: true,
    });
    if (!ok) return;
    try { await setMemberRole(person.uid, null); }
    catch (err) {
      await alertDialog(callFailureText(err, t('people.err.remove')));
    }
  }

  // ── Adding somebody ────────────────────────────────────────────────────────

  function paintCode() {
    codeBox.textContent = '';

    if (!pending) {
      codeBox.appendChild(el('p', { class: 'people-hint', text:
        t('people.invite.intro') }));
      // ⚠️ THE ROLE IS CHOSEN BEFORE THE INVITATION, not after they arrive. Going
      // back to change somebody's role afterwards is a second errand nobody
      // remembers. It starts at Employee — the least power — so a distracted tap
      // grants nothing.
      codeBox.appendChild(rolePills(newChoice.key, choice => { newChoice = choice; paintCode(); }));
      codeBox.appendChild(el('p', { class: 'people-note', text: t(ROLE_MEANS[newChoice.key]) }));

      // ⚠️⚠️ TWO WAYS TO HAND OVER THE SAME INVITATION, AND NEITHER REPLACES THE
      // OTHER. A link is right when the person is not in front of you, which for
      // somebody who starts on Monday is most of the time — and this is a kitchen,
      // so the channel is WhatsApp, not email (js/join-code.js says in as many
      // words that staff often have no email they read on a phone). Six digits
      // stay right when they ARE in front of you: they need no phone number, no
      // chat, and they leave nothing behind in one.
      //
      // ⚠️ THE ROLE IS DELIBERATELY NOT ON EITHER BUTTON. English needs an article
      // where Italian takes none ("an employee" / «dipendente»), so a role dropped
      // into a button label is a hole no translator can fill well. It is stated
      // twice instead, in whole sentences: by the note directly above, and by the
      // result screen the owner reads before sending anything.
      codeBox.appendChild(el('p', { class: 'people-label', text: t('people.sendHow') }));

      const byLink = el('button', { type: 'button', class: 'btn-primary people-add' },
        t('people.add.link'));
      byLink.addEventListener('click', () => mint('link'));
      codeBox.appendChild(byLink);

      const byDigits = el('button', { type: 'button', class: 'btn-secondary people-add' },
        t('people.add.digits'));
      byDigits.addEventListener('click', () => mint('digits'));
      codeBox.appendChild(byDigits);
      return;
    }

    if (pending.kind === 'link') paintLink();
    else paintDigits();

    // ⚠️ NO WARNING ON THE WAY OUT, and that is a decision rather than an
    // omission. "New customer" does warn, because only a sha256 of that link is
    // stored and walking away strands a whole business nobody can enter. Here,
    // losing an invitation costs two taps to mint another — so a warning would
    // never mean anything, and a warning that never means anything teaches people
    // to tap through the one that does (the v275 lesson).
  }

  // ── Six digits, read out ───────────────────────────────────────────────────
  //
  // ⚠️ SHOWN ONCE AND NEVER STORED. The server keeps only a hash, so this screen
  // is the only place the code exists in readable form — which is why it is large,
  // and why the sentence under it says what happens next rather than leaving
  // somebody holding six digits and no instructions.
  function paintDigits() {
    codeBox.appendChild(el('p', { class: 'people-hint', text: t('people.readOut') }));
    codeBox.appendChild(el('p', { class: 'people-digits', text: pending.code }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      t('people.joinsAs', {
        role: personLabelInSentence(pending.role, pending.title),
        expires: expiresInWords(pending),
        // ⚠️ THE BUTTON NAMES ITSELF RATHER THAN BEING QUOTED. This sentence used
        // to say: tap “I have a code”. The button has always said "I have a JOIN
        // code", so the instruction was wrong in English — and in Italian it
        // quoted the English words at somebody whose screen says «Ho un codice di
        // accesso». Interpolated, it cannot drift again in either language.
        button: t('auth.iHaveACode'),
      }) }));
    codeBox.appendChild(doneButton());
  }

  // ── A link, sent over WhatsApp ─────────────────────────────────────────────

  function paintLink() {
    const link = joinLinkFor(pending.code);

    codeBox.appendChild(el('p', { class: 'people-hint', text: t('people.link.intro') }));
    // ⚠️ THE LINK IS ON SCREEN AS TEXT WHATEVER THE CLIPBOARD DID. A screen that
    // only said "Copied!" would leave nothing at all behind on the phones where
    // the clipboard silently refuses — and this one cannot be shown again.
    codeBox.appendChild(el('p', { class: 'nc-link', text: link }));
    codeBox.appendChild(el('p', { class: 'people-note', text:
      t('people.link.joinsAs', {
        role: personLabelInSentence(pending.role, pending.title),
        expires: expiresInWords(pending),
      }) }));

    // WhatsApp first, because it is the errand: this exists so an owner can add
    // somebody without them being in the room.
    const wa = el('button', { type: 'button', class: 'btn-primary people-add' },
      t('help.sendOnWhatsapp'));
    wa.addEventListener('click', () => {
      // ⚠️ THE MESSAGE NAMES THE VENUE. "Open this link" and nothing else is what
      // every scam sent over WhatsApp looks like; the person has to be able to
      // tell, before tapping, that this is the place they work.
      sendOnWhatsApp(t('people.link.message', { venue: venueName, link }));
    });
    codeBox.appendChild(wa);

    const copy = el('button', { type: 'button', class: 'btn-secondary people-add' },
      t('help.copyTheLink'));
    copy.addEventListener('click', async () => {
      const copied = await copyToClipboard(link);
      await alertDialog(copied ? t('people.link.copied') : t('people.link.manual', { link }));
    });
    codeBox.appendChild(copy);

    codeBox.appendChild(doneButton());
  }

  function doneButton() {
    const done = el('button', { type: 'button', class: 'btn-secondary people-add' }, t('people.done'));
    done.addEventListener('click', () => { pending = null; paintCode(); });
    return done;
  }

  async function mint(kind) {
    try {
      // ⚠️ THE ROLE AND THE SHAPE BOTH COME BACK FROM THE SERVER, AND THAT IS
      // WHAT IS SHOWN. The function reduces a role it does not recognise to an
      // employee and anything that is not the word 'link' to digits — so echoing
      // what was ASKED for could promise a manager where an employee was made, or
      // draw a link screen for six digits. Ask, then show the answer.
      pending = await createJoinCode(newChoice.role, newChoice.title, kind);
      paintCode();
    } catch (err) {
      await alertDialog(callFailureText(err, t('people.err.code')));
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
