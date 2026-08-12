// workspace-row.js — PURE: what one line of the Businesses list says.
//
// ⚠️ IT LIVES IN js/ ROOT, NOT js/staff/, for the reason js/price-model.js does:
// nothing here touches Firestore or the DOM, and a pure decision that two screens
// might one day ask is not a feature's private business. Everything with a
// document or an element in it stays in js/staff/businesses.js.
//
// ⚠️ THE ONE DISTINCTION THAT MATTERS is between a business somebody has opened
// and one nobody has. They look identical on a list — a name and a date — and
// they are opposite situations: the second one is stranded, and its link is the
// only way in and cannot be shown again.

// ⚠️ THE DEFAULT IS "STRANDED", NOT "FINE". A row whose `claimed` did not arrive —
// a truncated response, an older server, a field renamed — must not read as a
// running business, because that is the answer that hides the problem and removes
// the button that fixes it. Being told to re-send a link that was already used
// costs a message; being told nothing costs the customer.
export function statusOf(row) {
  if (!row || typeof row !== 'object') return 'stranded';
  return row.claimed === true ? 'open' : 'stranded';
}

// A business nobody has opened yet, whose link may therefore be re-issued.
//
// ⚠️ IT ASKS statusOf() RATHER THAN DECIDING AGAIN, and that is not tidiness — the
// first version of this file decided separately and the two DISAGREED about a
// missing row: statusOf(null) said "stranded" while isStranded(null) said false,
// i.e. "this one is fine". Caught by a test, and it is the exact shape of the
// membership-value defect that ran through three files in this project: one fact,
// answered in two places, with the copies drifting towards the unsafe answer.
export function isStranded(row) {
  return statusOf(row) === 'stranded';
}

export const STATUS_WORDS = Object.freeze({
  open: 'Somebody has opened this',
  stranded: 'Nobody has opened this yet',
});

export function statusWords(row) {
  return STATUS_WORDS[statusOf(row)];
}

// The sections a customer bought, in the words the Home uses, so the list and the
// creation screen cannot disagree about what a customer has.
const SECTION_WORDS = Object.freeze({
  calculator: 'Calculator',
  orders: 'Orders',
  catalogue: 'Recipe catalogue',
  pastries: 'Pastries',
  foodcost: 'Food cost',
});

// ⚠️ ONLY `=== true` COUNTS. createWorkspace writes every section explicitly, but
// a document written before that, or by hand, can carry a missing key — and
// everywhere else in this app a missing section means ON. Here that default would
// be a lie about what somebody bought, so this asks for the word itself.
export function sectionNames(sections) {
  if (!sections || typeof sections !== 'object') return [];
  return Object.keys(SECTION_WORDS).filter(key => sections[key] === true)
    .map(key => SECTION_WORDS[key]);
}

export function sectionSummary(sections) {
  const names = sectionNames(sections);
  return names.length ? names.join(' · ') : 'No sections';
}

// "12 Aug 2026" — short, unambiguous, and never a bare number that a reader has
// to work out is a month or a day.
export function createdWords(createdAt, now = Date.now()) {
  const ms = Number(createdAt);
  if (!Number.isFinite(ms) || ms <= 0) return 'Created recently';
  const then = new Date(ms);
  if (Number.isNaN(then.getTime())) return 'Created recently';
  // A business created in the future is a clock problem, not a fact to report.
  const stamp = ms > now ? new Date(now) : then;
  return `Created ${stamp.getDate()} ${stamp.toLocaleString('en-GB', { month: 'short' })} ${stamp.getFullYear()}`;
}
