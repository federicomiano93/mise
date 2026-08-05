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
  initPastryLogs, getVisibleLogs, acceptDay, removeLog, tonightsRecord,
  setLogsErrorHandler,
} from './pastries-logs-store.js';
import { provingDayFor } from './pastries-model.js';
import { LOG_VISIBLE_DAYS } from './pastries-log-model.js';
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
  dayView = renderDay({ day, items: getItems(day), note: getNote(day), app });
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
  if (view === 'day' && dayView) dayView.update(getItems(shownDay), getNote(shownDay));
}

// Keep tonight's list as a record. It confirms first, because it writes
// something permanent — unlike the tick on a row, which changes a number that
// can be changed straight back.
async function acceptToday(day, items, note) {
  const list = items || [];
  // One read, and only here. The records listener is not running on the day
  // screen, so the in-memory list cannot answer this — and getting it wrong
  // would mean either a surprise replacement or a promise of one that is not
  // happening. When the read fails it returns null and nothing is promised.
  const existing = await tonightsRecord(day);

  const base = list.length
    ? `Keep this list as a record for ${day}?`
    : `${day} has nothing to prove. Record that?`;
  // Naming the replacement out loud, so a second Accept is never a surprise.
  const message = existing
    ? `${base}\n\nTonight's record for ${day} will be replaced.`
    : `${base}\n\nRecords are kept for ${LOG_VISIBLE_DAYS} days.`;

  const ok = await confirmDialog({ title: `Accept ${day}?`, message, okLabel: 'Accept' });
  if (!ok) return;

  const saved = await acceptDay(day, list, note);
  if (saved) toast(`${day} recorded.`);
}

// The ONE thing the views receive. They never import the store or the header.
const app = {
  confirm: confirmDialog,
  toast,
  showDay,
  showLogs,
  saveDay,
  setItemQuantity,
  acceptDay: acceptToday,
  removeLog,
  setLeaveGuard: (fn) => { leaveGuard = fn; },
};

// ── Boot ─────────────────────────────────────────────────────────────────────

backBtn.addEventListener('click', handleBack);
editBtn.addEventListener('click', () => { if (view === 'day') openEditor(shownDay); });

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

showDay(shownDay);
