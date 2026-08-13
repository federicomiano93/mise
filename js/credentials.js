// credentials.js — what somebody types on the way in: their name, and a password.
//
// PURE, so the awkward cases can be tested without a browser: a name that is all
// spaces, a surname pasted with a newline in it, a password that is the person's
// own email address. Every check here runs BEFORE the network, which matters for
// a reason that is not politeness — see the note on the join screen: a malformed
// attempt still spends one of the account's five join attempts an hour.
//
// ⚠️ THE PASSWORD RULE IS A GUARD IN THE APP, NOT A RULE OF THE SERVER, AND THAT
// HAS TO BE SAID PLAINLY. Firebase's own floor is SIX characters and cannot be
// raised without Identity Platform, which is a paid tier. So a determined person
// can still make a six-character password by talking to Firebase directly. What
// this stops is the ordinary case — somebody choosing `123456` on the one screen
// where a password is ever chosen — and that is most of the value, but it is not
// enforcement and must not be described as if it were.

// ⚠️ TEN, NOT EIGHT. Length is the only property that reliably costs an attacker
// anything; the usual "a capital and a number" rules mostly produce Password1
// and teach people to write passwords down. One number to explain, one to change.
import { t } from './i18n.js';

export const MIN_PASSWORD_LENGTH = 10;

// A name is a label on a roster, not an identity. Two people may share one, and
// nothing anywhere decides permissions from it (js/roles.js does that, from the
// membership value). So this cap is about what fits on a phone screen, not about
// safety.
export const MAX_NAME_LENGTH = 60;

// ⚠️ NOT A DICTIONARY, AND DELIBERATELY SHORT. A long list shipped to every phone
// buys almost nothing over the length rule and grows stale; these are the handful
// that show up in every breach report, plus the ones this app invites by name.
// ⚠️ `!` IS DELIBERATELY NOT MAPPED TO `i`. It is decoration far more often than
// a substitution, and mapping it turns `letmein!!!!` into `letmeiniiii`, which
// matches nothing — the stripping path catches that one already.
const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '3': 'e', '5': 's', '$': 's', '7': 't' };

const OBVIOUS = [
  'password', 'password1', 'passw0rd', 'letmein', 'welcome', 'qwerty',
  'iloveyou', 'admin', 'abc123', 'football', 'monkey', 'dragon',
  'bakery', 'italianclub', 'theitalianclub',
];

// Collapse the whitespace somebody's phone put in, and trim. A pasted name can
// arrive with a newline or a non-breaking space in it, and a roster row that
// wraps for no visible reason looks like a broken screen.
export function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

// What is wrong with this name, in words the person can act on — or null.
//
// ⚠️ IT ANSWERS ABOUT ONE FIELD AT A TIME so the screen can put the cursor in the
// field that is wrong. A single "check your details" tells somebody nothing when
// two boxes are on screen.
export function nameProblem(value, which) {
  const cleaned = cleanName(value);
  if (!cleaned) return which === 'last' ? t('help.enterYourSurname') : t('help.enterYourFirstName');
  // One letter is a legitimate name in plenty of places, so length is not
  // checked downwards. What is refused is a "name" made only of punctuation,
  // which is what an empty form filled in with a dash looks like.
  if (!/\p{Letter}/u.test(cleaned)) {
    return which === 'last' ? t('help.thatSurnameNeedsLetters')
                            : t('help.thatFirstNameNeeds');
  }
  return null;
}

// What is wrong with this password — or null.
//
// `email` is passed so the commonest bad choice of all can be refused: the
// address they typed two boxes up. It is optional, and its absence weakens the
// check rather than breaking it.
export function passwordProblem(value, email) {
  if (typeof value !== 'string' || !value) return t('help.chooseAPassword');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Make it at least ${MIN_PASSWORD_LENGTH} characters — length is what keeps it safe.`;
  }

  const lower = value.toLowerCase();
  // ⚠️ TWO NORMALISATIONS, AND BOTH ARE NEEDED — checked, not assumed. Stripping
  // non-letters catches `password12` and `letmein!!!!`. It does NOT catch
  // `P@ssw0rd!!`, which strips to `psswrd`: the @ and the 0 ARE the letters. So
  // the substitutions are undone first, and then the stripping runs again.
  // Without both, a list of obvious passwords is decoration.
  const stripped = lower.replace(/[^a-z]/g, '');
  const unleet = lower.replace(/[@40135$7]/g, ch => LEET[ch]).replace(/[^a-z]/g, '');
  if ([lower, stripped, unleet].some(form => form && OBVIOUS.includes(form))) {
    return t('help.thatOneIsGuessed');
  }

  // Repetition passes a length rule and nothing else: 'aaaaaaaaaa' is ten
  // characters and one guess.
  if (/^(.)\1+$/.test(value)) {
    return t('help.thatIsOneCharacter');
  }

  const local = typeof email === 'string' ? email.split('@')[0].trim().toLowerCase() : '';
  if (local && local.length >= 4 && lower.includes(local)) {
    return t('help.doNotUseYour');
  }

  return null;
}
