// pastries-main.js — entry point / orchestrator for the Pastries page.
// Owns the three views (day ↔ editor, day ↔ records), the header controls, the
// weekday strip, the shared confirm dialog and toast, and the live subscriptions.
// Feature-local
// only: it reaches js/firebase.js and js/location.js through its own data layer
// and never imports from js/orders/ or js/catalogue/.

import {
  initPastries, getDays, getItems, getNote, getCounts, saveDay, setItemQuantity,
  setSyncErrorHandler,
} from './pastries-store.js';
import { renderStrip } from './pastries-strip.js';
import { renderDay } from './pastries-day.js';
import { renderEditor } from './pastries-editor.js';
import { renderLogs } from './pastries-logs.js';
import {
  initPastryLogs, getVisibleLogs, confirmDay, removeLog, tonightsRecord,
  setLogsErrorHandler, isConfirmedTonight, watchConfirmations,
} from './pastries-logs-store.js';
import { provingDayFor } from './pastries-model.js';
import { LOG_VISIBLE_DAYS, workDate } from './pastries-log-model.js';
import { isDayLocked, grantKeyFor, grantAfter, msUntilWorkDayEnd } from './pastries-lock.js';
import { confirmDialog } from './confirm-dialog.js';

const screen = document.getElementById('pasScreen');
const stripHost = document.getElementById('pasStrip');
const titleEl = document.getElementById('pasTitle');
const subEl = document.getElementById('pasSub');
const homeBtn = document.getElementById('pasHome');
const backBtn = document.getElementById('pasBack');
const editBtn = document.getElementById('pasEdit');
const footer = document.getElementById('pasFooter');
const logsBtn = document.getElementById('pasLogs');

// The day the screen opened on: worked out ONCE, at boot. Recomputing it later
// would let the marked day jump under the person's finger at 4am — which is the
// one minute of the day they are most likely to be looking at it.
const openingDay = provingDayFor(Date.now());

let view = 'day';         // 'day' | 'editor' | 'logs'
let shownDay = openingDay;
let strip = null;
let dayView = null;       // { node, update } while the day view is on screen
let logsView = null;      // { node, update } while the records are on screen
let logsStarted = false;  // the records listener is attached on first use, not at boot
let leaveGuard = null;    // async () => boolean; blocks Back when there are unsaved edits

// ── Header + view helpers ────────────────────────────────────────────────────

function setHeader({ title, sub, back, edit }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  homeBtn.hidden = back;   // Home shows on the day view; Back replaces it in the editor
  backBtn.hidden = !back;
  editBtn.hidden = !edit;
}

// `focus` is false when the strip changed the day.
//
// ⚠️ In a tablist the focus belongs on the tab that was tapped. Pulling it into
// the panel on every day change fights the arrow keys — there would be nothing
// focused in the strip for the next press to move from — so the day view only
// takes focus when it is being ARRIVED at (boot, or Back out of the editor).
function swap(node, { focus = true } = {}) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  node.setAttribute('tabindex', '-1');
  if (!focus) return;
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

// ── The lock ─────────────────────────────────────────────────────────────────
//
// ⚠️ THE WORK DATE IS READ FROM THE CLOCK EVERY TIME, never frozen at boot the
// way openingDay is. That difference is deliberate and both directions matter:
// openingDay is frozen so the list under someone's finger cannot jump at 4am,
// while the lock MUST follow the clock, because releasing itself at 4am is the
// entire point of doing it this way.
function currentWorkDate() {
  return workDate(Date.now());
}

function grantFor(day) {
  const key = grantKeyFor(day);
  if (!key) return null;
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// Store or clear the permission. In private mode both throw, and the lock then
// behaves as if nothing was ever stored — annoying, never destructive.
function setGrant(day, value) {
  const key = grantKeyFor(day);
  if (!key) return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) { /* nothing stored, so the day simply stays locked */ }
}

function lockedFor(day) {
  return isDayLocked({
    confirmed: isConfirmedTonight(day),
    grant: grantFor(day),
    workDate: currentWorkDate(),
  });
}

// The ONE gate, whichever way a confirmed list is reached: a row, the Edit
// button, or the pencil in the header. Returns true when editing may go ahead.
//
// An unlocked day passes straight through without a question — the gate exists
// to catch a change to something already recorded, not to make every edit slower.
async function requestEdit(day) {
  if (!lockedFor(day)) return true;
  const ok = await confirmDialog({
    title: `Edit ${day}?`,
    message: `${day} is already recorded for tonight. Edit these quantities?`,
    okLabel: 'Edit',
  });
  if (!ok) return false;
  // The permission carries the work date, so it is spent when the date rolls at
  // 4am — and spent again by the next Confirm, see grantAfter().
  setGrant(day, grantAfter('edit', currentWorkDate()));
  repaint();
  return true;
}

// ── The 4am roll ─────────────────────────────────────────────────────────────
//
// A confirmed list unlocks when the work date moves on. Nothing about that is
// stored, so all that is needed is to ask the database about the NEW date.
let watchedDate = null;
let rollTimer = null;

function refreshConfirmations() {
  watchedDate = currentWorkDate();
  watchConfirmations(watchedDate, repaint);
}

function scheduleWorkDayRoll() {
  clearTimeout(rollTimer);
  const wait = msUntilWorkDayEnd(Date.now());
  if (wait === null) return;
  // A second past the boundary, so the clock has definitely crossed it by the
  // time the new work date is computed.
  rollTimer = setTimeout(() => { refreshConfirmations(); scheduleWorkDayRoll(); }, wait + 1000);
}

// ⚠️ THE TIMER ALONE IS NOT ENOUGH ON A PHONE. A backgrounded tab has its timers
// throttled or suspended entirely, so a phone left in a pocket across 4am would
// come back still showing last night as done. Checking on the way back in covers
// exactly that, and costs nothing when the date has not changed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (watchedDate === currentWorkDate()) return;
  refreshConfirmations();
  scheduleWorkDayRoll();
});

function showDay(day, opts = {}) {
  view = 'day';
  shownDay = day;
  leaveGuard = null;
  stripHost.hidden = false;
  footer.hidden = false;
  logsView = null;
  if (strip) strip.setActive(day);
  screen.setAttribute('aria-labelledby', `pas-tab-${day}`);
  setHeader({
    title: day,
    // Naming the day AND saying it is the one you came for, so a glance answers
    // both "which list is this?" and "is this today's job?".
    sub: day === openingDay ? 'Tomorrow · to prove' : 'To prove',
    back: false,
    edit: true,
  });
  // A NEW view, because the day itself changed. A snapshot for the day already
  // on screen goes through dayView.update() instead — see repaint().
  dayView = renderDay({
    day, items: getItems(day), note: getNote(day), locked: lockedFor(day), app,
  });
  swap(dayView.node, opts);
}

function openEditor(day) {
  view = 'editor';
  dayView = null;
  footer.hidden = true;
  // The strip is hidden rather than left live: changing day mid-edit would need
  // the unsaved-work question asked from a second place, and there is already a
  // Back that asks it.
  stripHost.hidden = true;
  setHeader({ title: `Edit ${day}`, sub: 'Pastries', back: true, edit: false });
  swap(renderEditor({
    day, items: getItems(day), note: getNote(day), allDays: getDays(), app,
  }));
}

function showLogs() {
  view = 'logs';
  dayView = null;
  leaveGuard = null;
  stripHost.hidden = true;
  footer.hidden = true;
  screen.removeAttribute('aria-labelledby');
  setHeader({
    title: 'Records',
    sub: `Last ${LOG_VISIBLE_DAYS} days`,
    back: true,
    edit: false,
  });
  logsView = renderLogs({ logs: getVisibleLogs(Date.now()), app });
  swap(logsView.node);

  // The listener is attached HERE, on first use — never at page boot, so the day
  // screen stays at seven reads per opening (P14).
  if (logsStarted) return;
  logsStarted = true;
  initPastryLogs(
    () => { if (view === 'logs' && logsView) logsView.update(getVisibleLogs(Date.now())); },
    () => toast('Live sync interrupted — these records may be out of date.'),
  );
}

async function handleBack() {
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
  }
  leaveGuard = null;
  showDay(shownDay);
}

function toast(msg) {
  const t = document.getElementById('pasToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// Repaint after the data changed underneath — a Firestore snapshot, or this
// device's own optimistic write. The editor is deliberately NOT repainted: it
// holds a working copy someone is typing into, and replacing it would delete
// what they are in the middle of writing.
//
// ⚠️ IT UPDATES THE VIEW IN PLACE rather than rebuilding it. Rebuilding ran
// swap(), which sets scrollTop = 0 — so every snapshot, several times a minute,
// threw away where the person had scrolled to.
function repaint() {
  if (strip) strip.setCounts(getCounts());
  if (view === 'day' && dayView) {
    dayView.update(getItems(shownDay), getNote(shownDay), lockedFor(shownDay));
  }
}

// Keep tonight's list as a record. It confirms first, because it writes
// something permanent — unlike the tick on a row, which changes a number that
// can be changed straight back.
async function confirmToday(day, items, note) {
  const list = items || [];
  // One read, and only here. The records listener is not running on the day
  // screen, so the in-memory list cannot answer this — and getting it wrong
  // would mean either a surprise replacement or a promise of one that is not
  // happening. When the read fails it returns null and nothing is promised.
  const existing = await tonightsRecord(day);

  const base = list.length
    ? `Keep this list as a record for ${day}?`
    : `${day} has nothing to prove. Record that?`;
  // Naming the replacement out loud, so a second Confirm is never a surprise —
  // and, for a first one, saying what confirming now DOES, since it ticks the
  // day off. Deliberately not "kept for 15 days" any more: records are kept for
  // good, and 15 days is only how far back this screen shows.
  const message = existing
    ? `${base}\n\nTonight's record for ${day} will be replaced.`
    : `${base}\n\n${day} will show as done. You can still change it — it will ask first.`;

  const ok = await confirmDialog({ title: `Confirm ${day}?`, message, okLabel: 'Confirm' });
  if (!ok) return;

  const saved = await confirmDay(day, list, note);
  if (!saved) return;
  // ⚠️ Confirming SPENDS any permission to edit. Without this the day stays
  // green after a Confirm → Edit → Confirm, because the permission still names
  // tonight — which is exactly what it should mean, right up until the list is
  // recorded again.
  setGrant(day, grantAfter('confirm'));
  toast(`${day} recorded.`);
  // A confirm on THIS phone must tick the day off straight away. The
  // confirmations listener will say the same thing a moment later, but waiting
  // for it would leave the green button sitting there after the job is done.
  repaint();
}

// The ONE thing the views receive. They never import the store or the header.
const app = {
  confirm: confirmDialog,
  toast,
  showDay,
  showLogs,
  saveDay,
  setItemQuantity,
  confirmDay: confirmToday,
  requestEdit,
  removeLog,
  setLeaveGuard: (fn) => { leaveGuard = fn; },
};

// ── Boot ─────────────────────────────────────────────────────────────────────

backBtn.addEventListener('click', handleBack);

// The pencil opens the full editor, which can rewrite the whole list — so it
// goes through the SAME gate as a row. Leaving it open would have made the lock
// cosmetic: the one screen that can change everything would have been the one
// screen that never asked.
editBtn.addEventListener('click', async () => {
  if (view !== 'day') return;
  if (!(await requestEdit(shownDay))) return;
  if (view !== 'day') return;   // the dialog takes time; the screen may have moved on
  openEditor(shownDay);
});

strip = renderStrip({
  host: stripHost,
  active: shownDay,
  openingDay,
  counts: getCounts(),
  onPick: (day) => { if (view === 'day') showDay(day, { focus: false }); },
});

// A write that was rolled back has to say so: a row left on screen after a
// failed save looks like the work is recorded.
setSyncErrorHandler(toast);
setLogsErrorHandler(toast);

logsBtn.addEventListener('click', () => { if (view === 'day') showLogs(); });

initPastries(
  () => repaint(),
  () => toast('Live sync interrupted — this list may be out of date.'),
);

// Which lists are already done tonight. One query, at most seven documents, and
// it is what ticks a day off and locks it. A failure leaves nothing locked,
// which is how the screen behaved before this existed.
refreshConfirmations();
scheduleWorkDayRoll();

showDay(shownDay);
