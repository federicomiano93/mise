// calculator-config-store.js — single source of truth for the live calculator
// configuration, bridging Firestore and the UI.
//
// Resilience (P17): the UI must paint instantly and work offline, so the current
// config is held in memory and mirrored to localStorage. On startup we return
// the cached config (or the default) synchronously; Firestore then streams in
// and, when it has data, updates the cache and notifies the app to re-render.

import { DEFAULT_CONFIG, cloneConfig, normalizeConfig, getClients } from './calculator-config.js';
import { watchCalculatorConfig, saveCalculatorConfig } from './firebase.js';
import { alertDialog } from './confirm-dialog.js';
import { publishMenus } from './client-orders-data.js';
import { menuFor, menuChanged } from './client-order-model.js';

const CACHE_KEY = 'calculator-config';

let current = readCache();
let notify = null; // called with the new config whenever it changes (set by initConfig)

// Has Firestore ANSWERED yet — including answering "there is no document"?
//
// ⚠️ THIS IS A GUARD AGAINST DESTROYING THE ADDRESS BOOK, not bookkeeping.
// With no cached copy (a new phone, or any phone that just entered a location —
// clearLocalData() wipes the cache on the way in) `current` starts as
// DEFAULT_CONFIG: the sample clients. If the config stream then FAILS — refused,
// offline, a session that expired mid-load — that sample data is what sits on
// screen, indistinguishable from real data, and the first Save would write it
// over the location's real clients, products and recipes.
//
// So a save is only allowed to leave the device once the server has told us what
// it holds. "No document yet" is a real answer (a brand-new location must be
// able to save); never having heard back is not.
let serverAnswered = false;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
  } catch (e) {
    // Corrupt/unavailable cache — fall back to defaults.
  }
  return cloneConfig(DEFAULT_CONFIG);
}

function writeCache(config) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch (e) {
    // Storage full/unavailable — the in-memory copy still works for this session.
  }
}

// The config currently in effect (cache/default until Firestore streams in).
export function getConfig() {
  return current;
}

// Start syncing with Firestore. onUpdate(config) fires whenever the remote
// config changes so the app can re-render. Returns the synchronous initial
// config so the first paint never waits on the network.
export function initConfig(onUpdate) {
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  watchCalculatorConfig(remote => {
    const firstAnswer = !serverAnswered;
    // Set BEFORE the early return: "there is no document" is an answer, and a
    // brand-new location has to be able to save its first client.
    serverAnswered = true;
    if (!remote) {
      // ⚠️ THE SCREEN HAS TO HEAR "THERE IS NO DOCUMENT" TOO. The empty Calculator
      // waits on this answer to tell "you have no recipes yet" from "the server has
      // not spoken yet" (calculatorEmptyReason), and this is the ONE branch where the
      // answer arrives without the config changing — so without a notify here the
      // very customer the empty state was written for would sit on "Loading…" for
      // ever. Only on the FIRST answer: a later null means the document was deleted,
      // and re-rendering then is the caller's business, not a fresh arrival.
      if (firstAnswer && notify) notify(current);
      return; // no document yet — keep cache/default
    }
    current = normalizeConfig(remote);
    writeCache(current);
    if (notify) notify(current);
  });
  return current;
}

// Whether a save can safely reach Firestore. Exported so a screen can explain
// itself rather than leaving the operator to wonder why nothing synced.
export function canSyncConfig() {
  return serverAnswered;
}

// Persist a new config. Local-first (P17): update memory + cache and re-render
// immediately so the change is instant and works offline; the Firestore write is
// best-effort and its failure (e.g. offline, rules not yet deployed) is logged
// but does not lose the local change or block the UI.
// Whether any client's PUBLISHED product list would read differently after this save.
// Everything else in the config — recipes, WhatsApp lists, log settings — is invisible
// to a client, so a save that touches only those must not cost a read of every menu.
function menusWouldChange(before, after) {
  const was = new Map(getClients(before).map(c => [c.id, menuFor(c)]));
  const now = getClients(after);
  if (was.size !== now.length) return true;
  return now.some(client => menuChanged(was.get(client.id), menuFor(client)));
}

export function saveConfig(config) {
  const previous = current;
  current = normalizeConfig(config);
  writeCache(current);
  if (notify) notify(current);

  // Local-first still applies above: the change is in memory and in the cache
  // before anything is sent. But it must NOT be sent while we are working from
  // DEFAULT_CONFIG for want of an answer — see serverAnswered. Refusing to sync
  // costs one unsynced edit; syncing here costs the location's whole address book.
  if (!serverAnswered) {
    console.warn('Calculator config kept local only: the server has not answered yet.');
    // Told plainly, because the alternative is someone believing a change is
    // shared with the other phones when it is only on this one.
    alertDialog(
      'Saved on this phone only. The app could not reach the settings stored '
      + 'online, so it has not sent the change — this protects the clients and '
      + 'recipes already saved there. Check your connection and reload the page.'
    );
    return Promise.resolve({ synced: false, reason: 'no-server-answer' });
  }

  const willRepublish = menusWouldChange(previous, current);

  return saveCalculatorConfig(current)
    .then(async () => {
      // ── Keep every client's ordering page in step with the address book ──
      //
      // ⚠️ IT HAS TO HAPPEN HERE, on the save, or it does not happen at all. A client
      // cannot order a product whose published list never learnt about it, and that
      // failure is invisible from this side: the owner adds a product, the client's
      // page simply does not show it, and nobody finds out until somebody telephones.
      //
      // ⚠️ BEST-EFFORT, AND IT NEVER FAILS THE SAVE. The address book is the thing
      // that matters and it is already stored; a menu that did not republish is a
      // nuisance corrected by the next save, while a save reported as failed because
      // of it would send the owner looking for a problem that is not there.
      if (willRepublish) {
        try {
          await publishMenus(current);
        } catch (err) {
          console.warn('Client ordering menus not republished:', err);
        }
      }
      return { synced: true };
    })
    .catch(err => {
      console.warn('Calculator config saved locally but not synced to Firestore:', err);
      return { synced: false, reason: 'write-failed', error: err };
    });
}
