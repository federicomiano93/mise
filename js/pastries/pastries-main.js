// pastries-main.js — entry point / orchestrator for the Pastries page.
// Owns the two views (day ↔ editor), the header controls, the weekday strip,
// the shared confirm dialog and toast, and the live subscription. Feature-local
// only: it reaches js/firebase.js and js/location.js through its own data layer
// and never imports from js/orders/ or js/catalogue/.

import {
  initPastries, getDays, getItems, getCounts, saveDay, setSyncErrorHandler,
} from './pastries-store.js';
import { renderStrip } from './pastries-strip.js';
import { renderDay } from './pastries-day.js';
import { renderEditor } from './pastries-editor.js';
import { provingDayFor } from './pastries-model.js';
import { confirmDialog } from './confirm-dialog.js';

const screen = document.getElementById('pasScreen');
const stripHost = document.getElementById('pasStrip');
const titleEl = document.getElementById('pasTitle');
const subEl = document.getElementById('pasSub');
const homeBtn = document.getElementById('pasHome');
const backBtn = document.getElementById('pasBack');
const editBtn = document.getElementById('pasEdit');

// The day the screen opened on: worked out ONCE, at boot. Recomputing it later
// would let the marked day jump under the person's finger at 4am — which is the
// one minute of the day they are most likely to be looking at it.
const openingDay = provingDayFor(Date.now());

let view = 'day';         // 'day' | 'editor'
let shownDay = openingDay;
let strip = null;
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
  swap(renderDay({ day, items: getItems(day) }), opts);
}

function openEditor(day) {
  view = 'editor';
  // The strip is hidden rather than left live: changing day mid-edit would need
  // the unsaved-work question asked from a second place, and there is already a
  // Back that asks it.
  stripHost.hidden = true;
  setHeader({ title: `Edit ${day}`, sub: 'Pastries', back: true, edit: false });
  swap(renderEditor({ day, items: getItems(day), allDays: getDays(), app }));
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
function repaint() {
  if (strip) strip.setCounts(getCounts());
  if (view === 'day') showDay(shownDay, { focus: false });
}

// The ONE thing the views receive. They never import the store or the header.
const app = {
  confirm: confirmDialog,
  toast,
  showDay,
  saveDay,
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

initPastries(
  () => repaint(),
  () => toast('Live sync interrupted — this list may be out of date.'),
);

showDay(shownDay);
