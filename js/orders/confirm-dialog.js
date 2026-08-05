// confirm-dialog.js — the ONE styled replacement for the browser's native
// confirm() and alert() dialogs, so every confirmation in the app looks like
// the app instead of the grey system box.
//
// Copied per feature, like dom.js (js/confirm-dialog.js, js/orders/confirm-dialog.js,
// js/catalogue/confirm-dialog.js, js/pastries/confirm-dialog.js) — features must
// not import across folders, so KEEP THE FOUR COPIES IDENTICAL. Styles live in
// tokens.css (.app-dialog-*), the
// one stylesheet every page loads, because the dialog is created from JS and the
// CSP (style-src 'self') forbids injected styles — same precedent as #sw-update-banner.
//
// CSP-safe and Calculator-convention-safe: DOM API + textContent only (no innerHTML).
// Multi-line messages work: .app-dialog-msg uses white-space: pre-line.

let isOpen = false; // one dialog at a time; a re-entrant open resolves false
let seq = 0;        // unique ids, so a dialog can name itself to a screen reader

// confirmDialog({ title?, message, okLabel='OK', cancelLabel='Cancel', danger=false })
//   -> Promise<boolean>   true = confirmed; Cancel / Escape / backdrop tap = false
export function confirmDialog(opts) {
  return open({ ...opts, alertOnly: false });
}

// alertDialog(message, { title?, okLabel='OK' }?) -> Promise<void>
// One-button acknowledgement (replaces native alert()).
export function alertDialog(message, opts = {}) {
  return open({ message, ...opts, alertOnly: true }).then(() => undefined);
}

function open({ title = '', message = '', okLabel = 'OK', cancelLabel = 'Cancel',
                danger = false, alertOnly = false }) {
  if (isOpen) return Promise.resolve(false);
  isOpen = true;
  const prevFocus = document.activeElement;

  const n = ++seq;
  const backdrop = make('div', 'app-dialog-backdrop');
  const box = make('div', 'app-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  // Name and describe the dialog for a screen reader — without these it is
  // announced as an unnamed dialog and the message is never read out.
  const msg = make('p', 'app-dialog-msg', message);
  msg.id = 'app-dialog-msg-' + n;
  box.setAttribute('aria-describedby', msg.id);
  if (title) {
    const h = make('h3', 'app-dialog-title', title);
    h.id = 'app-dialog-title-' + n;
    box.setAttribute('aria-labelledby', h.id);
    box.appendChild(h);
  } else {
    box.setAttribute('aria-labelledby', msg.id); // no title → the message names it
  }
  const actions = make('div', 'app-dialog-actions');
  const ok = btn(danger ? 'app-dialog-btn-danger' : 'app-dialog-btn-solid', okLabel);
  const cancel = alertOnly ? null : btn('app-dialog-btn-ghost', cancelLabel);
  if (cancel) actions.appendChild(cancel);
  actions.appendChild(ok);
  box.appendChild(msg);
  box.appendChild(actions);
  backdrop.appendChild(box);

  return new Promise((resolve) => {
    const done = (v) => {
      isOpen = false;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* focus restore is best-effort */ }
      }
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Tab') {
        // Trap focus inside the dialog: Tab just bounces between the two buttons.
        e.preventDefault();
        (cancel && document.activeElement === ok ? cancel : ok).focus();
      }
    };
    ok.addEventListener('click', () => done(true));
    if (cancel) cancel.addEventListener('click', () => done(false));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    ok.focus();
  });
}

function make(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function btn(variant, label) {
  const b = make('button', 'app-dialog-btn ' + variant, label);
  b.type = 'button';
  return b;
}
