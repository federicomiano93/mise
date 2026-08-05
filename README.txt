# The Italian Club — PWA

A mobile-first Progressive Web App for hospitality venues, with three sections:

- **Calculator** — dough scaling from production orders (Focaccia, Brioche, Sourdough).
- **Recipe catalogue** — a searchable recipe library, scalable to a total weight.
- **Orders** — supplier-order workflow: suppliers & ingredients, stock-based
  order suggestions learned from history, autosaving real-time draft, preview and
  WhatsApp send, order history, and a management panel.

It serves **several venues from one deployment**. Each signs in with its own account
and sees only its own data, and each is set up with only the sections it uses.

Live: https://federicomiano93.github.io/the_italian_club_app/

## Files
The main ones — each feature folder holds more.
```
├── index.html              ← Home (PWA start_url): one card per section the venue uses
├── home.html               ← redirect stub -> index.html (for older installs)
├── calculator.html         ← Calculator (dough scaling)
├── catalogue.html          ← Recipe catalogue
├── orders.html             ← Orders feature page
├── install-guide.html      ← shareable, device-first install guide (uses qr.png)
├── tokens.css              ← THE shared design system (colour, type, spacing, dialogs)
├── style.css               ← Calculator styles      ├── auth.css   ← sign-in screen
├── orders.css · catalogue.css
├── fonts/                  ← self-hosted woff2 (no runtime font CDN)
├── manifest.json           ← PWA config (start_url, name, icons)
├── sw.js                   ← service worker (offline cache + auto-update)
├── firestore.rules         ← Firestore security rules
├── firebase.json           ← Firebase CLI config
├── qr.png                  ← QR code to the app (for the install guide)
├── js/
│   ├── firebase.js         ← Firebase init + THE SESSION + Calculator helpers — COMMITTED (public config)
│   ├── firebase.example.js ← reference template (placeholders), kept in sync
│   ├── location.js         ← the ONE place that turns a collection name into a path
│   ├── sections.js         ← PURE: which venue this session opens, and which sections it uses
│   ├── auth-gate.js        ← the door: sign-in, venue picker, per-section guard
│   ├── home-session.js     ← Home: filters the cards, Switch location / Log out
│   ├── location-title.js   ← puts the venue's name in the green header
│   ├── local-data.js       ← PURE: wipes this device's cached data on log out / switch
│   ├── app.js              ← Calculator entry point: dynamic tabs, listeners, localStorage
│   ├── calc.js             ← generic recipe-driven calc(recipeId) — recipes come from config
│   ├── log*.js             ← production log (model / store / view / edit / add …)
│   ├── recipes.js          ← recipe editor · whatsapp.js ← order text + send
│   ├── calculator-config.js        ← clients/products/recipes data model (pure, tested)
│   ├── calculator-config-store.js  ← config load/save: Firestore + localStorage cache (offline)
│   ├── calculator-render.js        ← builds the input cards from config
│   ├── calculator-settings.js      ← Settings panel
│   ├── confirm-dialog.js   ← THE styled confirm/alert dialog (never the browser's)
│   ├── whats-new.js        ← PURE release notes + who is shown them
│   ├── install.js · install-guide.js · sw-update.js · idle-reset.js
│   ├── catalogue/          ← Recipe catalogue feature (own dom.js + dialog copies)
│   └── orders/             ← Orders feature (vanilla ESM modules)
│       ├── boot.js         ← service worker registration for Home/Orders pages
│       ├── firebase-orders.js ← Firestore data layer (paths via location.js)
│       ├── orders-main.js  ← Orders entry point / orchestrator
│       ├── dom.js          ← CSP-safe DOM helpers
│       ├── day.js          ← local-day helpers (BST-safe)
│       ├── suppliers.js · supplier-detail.js  ← the supplier list, and one supplier's screen
│       ├── ingredients.js · ingredient-list.js · ingredient-search.js
│       ├── no-supplier.js  ← PURE: where an ingredient belongs (the ONE lens)
│       ├── draft.js        ← autosave/restore/real-time draft
│       ├── archive.js · history.js · history-edit.js  ← recorded orders
│       ├── order-text.js   ← PURE: the WhatsApp message (signed with the venue's name)
│       ├── preview.js · supplier-picker.js  ← preview and send
│       ├── management.js   ← management panel (add/edit/delete)
│       ├── suggestions.js  ← par-level order suggestion engine
│       ├── bank-holidays.js ← gov.uk UK bank-holiday calendar (cached)
│       └── notifications.js ← client-side alerts + browser notifications
├── scripts/                ← one-off maintenance (the move to per-venue folders)
├── tests/                  ← node --test suites + the Firestore rules checks
└── icons/
    ├── icon.svg            ← editable vector source for the app icon
    ├── icon-192.png
    └── icon-512.png
```

## Firebase config
`js/firebase.js` is **committed to Git**: Firebase web API keys are public config
(sent to every visitor's browser), not secrets. Security comes from Firestore
Security Rules + API key restrictions, never from hiding the file.
`js/firebase.example.js` is the matching template (placeholder values + docs for
the Orders collections and the future FCM setup). Keep it in sync with firebase.js.

Real secrets (service-account JSON, `.env`) are never committed.

## Local testing
Service workers and Firebase need a server (not file://):
```
npx http-server . -p 8765
```
then open http://localhost:8765/

## Deploy
Hosted on GitHub Pages — every push to `main` goes live automatically.
After editing any cached file, bump `CACHE_NAME = 'theitalianclub-vNN'` in sw.js
so users receive the update. Deploy Firestore rules separately when they change:
```
firebase deploy --only firestore:rules
```

## Versioning
Releases are tracked with git tags (semver `vMAJOR.MINOR.PATCH`), never by renaming
the repo. First release: v1.0.0.

## Install on a device
Open the install guide and follow the steps for your device:
https://federicomiano93.github.io/the_italian_club_app/install-guide.html
- iPhone/iPad: Safari → Share → "Add to Home Screen".
- Android: Chrome → "Install app" / menu → "Add to Home screen".
- Computer: Chrome/Edge → install icon in the address bar.
(Installs once per device; after that it opens like any app. Browsers do not allow
automatic install — a one-time user action is always required.)

## Works offline
The service worker precaches the app and serves a cached copy instantly, updating
in the background. Fonts are self-hosted. The Firebase SDK modules are kept in a
SEPARATE persistent cache so they survive the per-deploy cache bump and the app can
boot offline; the live Firestore/Auth API and gov.uk are never cached.

## Data model (Firestore)
Every document a venue owns lives under its own folder, so one venue's data cannot
be reached from another's path at all. `js/location.js` is the only file that turns
a collection name into a path.

`locations/{id}` — the venue itself: its display name and which sections it uses.
Written only from the Firebase console.

`locations/{id}/…`
- `suppliers/{id}` — name, category, deliveryDays, orderDays, phone, email, active.
- `ingredients/{id}` — name, supplierId, brand, weight, category, unit, active.
- `drafts/current` — the order in progress (autosaved, real-time), plus the day each
  supplier's rows were typed on.
- `orders-history/{YYYY-MM-DD}_{supplierId}` — one record per DAY per SUPPLIER
  (ordered quantities + stock on hand). Records from the earlier weekly model
  (`orders-history/{weekId}`) are still read; nothing was migrated.
- `recipes/{id}` — the recipe catalogue, one document per recipe.
- `logs/{id}`, `log/{dough}` — production logs. (`daily-logs/{YYYY-MM-DD}` still holds
  the documents written before Aug 2026; nothing writes or reads it any more.)
- `config/calculator`, `config/orders` — settings, mirrored to localStorage.

Every document also carries its venue id in a `bakery` field, which the rules require
to match the folder it sits in — the field and the path can never disagree. (The
field name is historical.)

`users/{uid}` — which venues an account may open: `{ locations: { <id>: true } }`.
Readable only by that account and writable by **no client**: the Firebase console is
the only way in, so nobody can grant themselves access.

## Security
- **Firestore rules** (firestore.rules) enforced server-side: membership required per
  venue, payloads validated, deletes restricted, default-deny for unmatched
  collections.
- **Email/password sign-in.** Accounts are created by the owner in the Firebase
  console; there is no self-registration, and anonymous access is switched off.
  An account with no `users/{uid}` document sees nothing at all.
- **Content Security Policy** on every page restricts what the browser may load
  (scripts/connections/styles/fonts allow-listed).
- **XSS-safe rendering** — Firestore data is rendered via textContent/createElement,
  never innerHTML.

## Notifications
Order alerts (order due, bank holiday next week, delivery-day conflict) are
client-side: in-app banners + browser notifications while the app is open. Push to
staff with the app closed needs a server step (Firebase Cloud Functions) — deferred;
see the FCM notes in js/firebase.example.js.
