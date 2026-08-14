// away-screen.js — the "I am on holiday" control on the Home.
//
// It lives in the Home's quiet bottom strip, beside Log out, because it is a fact
// about the PERSON rather than about the venue — the same reason Log out is there
// and not in the header.
//
// ⚠️ THE DATE PICKER IS THE PLATFORM'S OWN (`<input type="date">`), on purpose
// (P19). A hand-rolled calendar is one of the things this project's rules name as
// notoriously fragile to build by hand, and the phone's own picker is the one
// every person already knows how to use — including its language and its idea of
// which day a week starts on.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';
import { currentSession } from './firebase.js';
import { buildAwayDoc, isAway, maxAwayDate, toISODate } from './away-model.js';
import { getAwayDaysOnce, saveAwayDay } from './orders/firebase-orders.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The dialog: one date, and a way back from it.
//
// ⚠️ IT SAYS WHAT BEING AWAY DOES AND WHAT IT DOES NOT. "Your phone stops
// ringing; the lists still arrive and are still waiting for you." Without that
// line somebody reasonably assumes the work is being handled by somebody else,
// which is the one belief this feature must never create.
async function askUntil(current) {
  const wrap = el('div', 'away-form');
  wrap.appendChild(el('p', 'away-what', t('away.whatItDoes')));

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'away-date';
  input.min = toISODate(Date.now());
  // ⚠️ The ceiling is a property of the CONTROL, not an error afterwards: a
  // picker that cannot reach 2028 is kinder than one that refuses it later.
  input.max = maxAwayDate(Date.now());
  if (current) input.value = current;
  input.setAttribute('aria-label', t('away.untilLabel'));
  wrap.appendChild(el('label', 'away-label', t('away.untilLabel')));
  wrap.appendChild(input);

  const ok = await confirmDialog({
    title: t('away.title'),
    node: wrap,
    message: '',
    okLabel: t('away.set'),
    cancelLabel: t('ui.cancel'),
  });
  return ok ? input.value : null;
}

// The strip entry. Returns the button, or null when there is nobody to be.
export async function buildAwayButton() {
  const { user } = currentSession();
  if (!user?.uid) return null;

  let mine = null;
  try {
    // ⚠️ READ ONCE, not a live listener: this screen is opened many times a day
    // on every phone and the answer changes about twice a year (P14).
    const all = await getAwayDaysOnce();
    mine = all.find(d => d.id === user.uid) || null;
  } catch (err) {
    // A venue that has never used this, or an offline phone. The button still
    // works — it simply starts from nothing.
    console.warn('Could not read your own holiday:', err);
  }

  const away = isAway(mine, Date.now());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'session-logout' + (away ? ' session-away' : '');
  btn.textContent = away ? t('away.onUntil', { day: mine.until }) : t('away.title');

  btn.addEventListener('click', async () => {
    if (away) {
      // ⚠️ COMING BACK IS ONE TAP AND IS NOT A DESTRUCTIVE ACT — no danger red,
      // no warning. The whole point is that it ends easily and by itself.
      const back = await confirmDialog({
        title: t('away.backTitle'),
        message: t('away.backMessage', { day: mine.until }),
        okLabel: t('away.back'),
        cancelLabel: t('ui.cancel'),
      });
      if (!back) return;
      await write(user.uid, '');
      return;
    }
    const until = await askUntil('');
    if (!until) return;
    await write(user.uid, until);
  });

  return btn;
}

async function write(uid, until) {
  const doc = buildAwayDoc({ uid, until, now: Date.now() });
  if (!doc) {
    await confirmDialog({
      title: t('away.title'), message: t('away.badDate'),
      okLabel: t('ui.cancel'), cancelLabel: null,
    });
    return;
  }
  try {
    await saveAwayDay(uid, doc);
    // Rebuilt rather than patched, so the button's words and the stored fact
    // cannot drift apart.
    window.dispatchEvent(new CustomEvent('away-changed'));
  } catch (err) {
    console.error('Saving the holiday failed:', err);
    await confirmDialog({
      title: t('away.title'), message: t('away.saveFailed'),
      okLabel: t('ui.cancel'), cancelLabel: null,
    });
  }
}
