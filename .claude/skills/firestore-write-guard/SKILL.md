---
name: firestore-write-guard
description: Guard Firestore writes during manual testing in The Italian Club. The SAFE path is the local Firebase emulator on localhost; warn forcefully whenever the emulator is NOT confirmed active or the page is served from a non-localhost hostname (live domain, LAN IP, tunnel), because those writes hit the real production database. Use whenever a task involves confirming a dough, saving Settings/config, adding or editing suppliers/ingredients, autosaving an Orders draft, or saving/deleting log entries. Raise this proactively, before starting, without being asked.
---

# Firestore write guard — The Italian Club

The Italian Club has ONE production Firestore (`bakery-app-ebf90`) under Anonymous
Auth, so a write against production changes the real data the live site shows, and
several collections deny deletes. A local Firebase **emulator** (live since v1.3.0)
is the safe place to write during testing. Which database a write hits depends on
the EMULATOR being up and the HOSTNAME — not on "I'm testing locally".

## How the switch works (js/firebase.js)
On a localhost hostname (`localhost`, `127.0.0.1`, `::1`) the app redirects the SDK
to the emulator (Auth 9099, Firestore 8080) UNCONDITIONALLY, by hostname alone — it
does NOT check whether the emulator is actually running, and there is NO production
fallback. On any other hostname it uses production.

## The three situations
1. **localhost WITH the emulator running → SAFE default. Write freely.**
   Confirm it: the console shows the green "LOCAL EMULATOR mode — production data is
   NOT touched" line and the emulator is up (UI at http://127.0.0.1:4000). This is
   the standard way to test writes — start it proactively (`npx serve` +
   `firebase emulators:start --only auth,firestore`).
2. **localhost WITHOUT the emulator running → writes FAIL; nothing is saved.**
   The SDK is hardwired to localhost:8080 with no production fallback, so the write
   cannot reach anything — it errors or stays pending. Production is NOT touched, but
   this is NOT a valid test: nothing is being saved. Start the emulator.
3. **Any non-localhost hostname → PRODUCTION. Warn forcefully.**
   The live github.io domain — but ALSO a LAN IP (e.g. 192.168.x.x to test from a
   phone) or a tunnel (ngrok): all make the switch choose production. This is the
   real danger; the warning below applies in full.

## When to warn (proactively, before starting)
Before any task that triggers a Firestore WRITE during manual/browser testing,
UNLESS situation 1 is confirmed (emulator up + "LOCAL EMULATOR mode" in console):
- Confirming a dough (writes the `logs` model)
- Saving Settings / config (`config/calculator`)
- Adding or editing a supplier or ingredient (`suppliers` / `ingredients`)
- Autosaving an Orders draft (`drafts/current`)
- Saving or deleting a log entry

Default to proposing the emulator FIRST, so the test is safe by construction.

## What to say (when the emulator is NOT confirmed active)
"Unless the local emulator is running, this could write to the PRODUCTION Firestore —
anything not served from a true localhost hostname (live site, a LAN IP to test on a
phone, a tunnel) hits real production data. A test supplier or ingredient can at least
be deleted from the app afterwards, but `drafts/current` and `config/*` have delete
denied — a bad write there can only be repaired by overwriting it by hand from the
Firebase Console. Let me start the emulator first (safe local database), or do you
want to proceed against production?"

## Exempt — no warning needed
- `npm test` (automated math/logic tests) — pure functions, never touch Firestore.
- Read-only / local-only checks: dough gram calculations (on-screen only), the
  Recipes overlay (saves to localStorage only), Copy/WhatsApp, viewing Orders.

## Never
- Never suggest weakening `firestore.rules` to delete test data — fixing test cleanup
  by lowering production security is worse than the problem.
- Never tell Federico writes are safe just because it's "localhost" — safety requires
  the emulator confirmed active AND a true localhost hostname.
- Never tell Federico writes are safe or reversible when they hit delete-denied
  collections in production.
