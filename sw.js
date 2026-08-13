const CACHE_NAME = 'theitalianclub-v291';
// Firebase SDK modules (loaded from gstatic) are cached SEPARATELY from CACHE_NAME
// so they survive the cache-version bump that happens on every deploy — otherwise
// the offline SDK would be wiped each release until the next online load. The name
// carries the pinned SDK version; bumping the SDK orphans the old cache for cleanup.
const SDK_CACHE = 'firebase-sdk-10-12-0';
const ASSETS = [
  './',
  './index.html',
  './home.html',
  './calculator.html',
  './orders.html',
  './install-guide.html',
  './qr.png',
  './js/install-guide.js',
  './tokens.css',
  './auth.css',
  './style.css',
  './orders.css',
  // The guided-mixing alarm. ⚠️ It has to be HERE, not merely on the server: the
  // one moment it is needed is a phone on a bench in a bakery, and a kitchen is
  // exactly where the signal is worst. A sound that only rings online is a sound
  // that fails on the days it matters.
  './sounds/alarm.wav',
  './fonts/manrope-latin.woff2',
  './fonts/manrope-latin-ext.woff2',
  './fonts/dm-mono-400-latin.woff2',
  './fonts/dm-mono-400-latin-ext.woff2',
  './fonts/dm-mono-500-latin.woff2',
  './fonts/dm-mono-500-latin-ext.woff2',
  './fonts/instrument-serif-latin.woff2',
  './fonts/instrument-serif-latin-ext.woff2',
  './js/app.js',
  './js/confirm-dialog.js',
  './js/calculator-icons.js',
  './js/hold-to-zoom.js',
  './js/price-model.js',
  './js/allergen-model.js',
  // ⚠️ A NEW FILE, AND THE ONE FAILURE THAT DOES NOT HEAL ITSELF. An installed
  // phone that goes offline after a deploy finds a file the new HTML asks for and
  // its cache never received. It is also the file that decides whether a label may
  // be printed at all, so its absence would look like the app refusing every label.
  './js/market.js',
  './js/push-model.js',
  './js/push.js',
  './js/client-order-model.js',
  './js/client-order-history.js',
  './js/client-orders-data.js',
  './js/calculator-client-orders.js',
  './js/home-client-orders-badge.js',
  './js/help-content.js',
  './js/help-button.js',
  // ⚠️ order.html AND js/client-orders/* ARE DELIBERATELY ABSENT FROM THIS LIST.
  // They are the page a wholesale CLIENT opens from their own link — not part of the
  // installed app, and no staff phone ever navigates to them. Precaching them would
  // put a copy of the client page on every phone in the bakery for nothing, and the
  // one failure this list exists to prevent (an installed user going offline and
  // finding a newly added file missing) cannot happen to a page installed users never
  // open. The two files above ARE listed: they are the Calculator's own half.
  './js/sw-update.js',
  './js/update-gate.js',
  './js/idle-reset.js',
  './js/install.js',
  './js/home-orders-badge.js',
  './js/splash-init.js',
  './js/whats-new.js',
  './js/whats-new-boot.js',
  './js/firebase.js',
  './js/location.js',
  './js/sections.js',
  './js/roles.js',
  './js/i18n.js',
  './js/i18n-dom.js',
  './js/join-code.js',
  './js/join-link.js',
  './js/credentials.js',
  './js/staff/dom.js',
  './js/staff/confirm-dialog.js',
  './js/staff/firebase-staff.js',
  // people.js IS listed: "Who can get in" belongs to the OWNER OF EVERY CUSTOMER'S
  // venue, not to whoever runs this app. The three files above are its dependencies.
  './js/staff/people.js',
  './js/staff/language.js',
  // ⚠️ js/staff/businesses.js, js/staff/new-customer.js AND js/workspace-row.js ARE
  // DELIBERATELY ABSENT FROM THIS LIST. They are the app owner's own back office —
  // one person, on one phone — and the server refuses them to everybody else, so
  // precaching them puts code on every customer's device that none of those devices
  // can ever use. All three are reached through a dynamic import(), and the fetch
  // handler below caches whatever it fetches, so the first open still works offline
  // afterwards; only the very first open after a deploy needs the network, and
  // creating a business needs it anyway. The failure this list exists to prevent —
  // an installed user going offline and finding a newly added file missing — cannot
  // happen to screens no installed user can open.
  './js/local-data.js',
  './js/auth-gate.js',
  './js/home-session.js',
  './js/location-title.js',
  './js/recipes.js',
  './js/calc.js',
  './js/calculator-recipe-text.js',
  './js/calculator-dough-math.js',
  './js/log.js',
  './js/log-time.js',
  './js/log-model.js',
  './js/log-store.js',
  './js/log-view.js',
  './js/log-edit.js',
  './js/log-qty.js',
  './js/log-add.js',
  './js/log-settings.js',
  './js/whatsapp.js',
  './js/calculator-confirm.js',
  './js/calculator-config.js',
  './js/calculator-config-store.js',
  './js/calculator-order-prefill.js',
  './js/calculator-order-text.js',
  './js/calculator-render.js',
  './js/calculator-settings.js',
  './js/calculator-whatsapp-settings.js',
  './js/vendor/sortable.esm.js',
  './js/orders/boot.js',
  './js/orders/confirm-dialog.js',
  './js/orders/firebase-orders.js',
  './js/orders/orders-main.js',
  './js/orders/dom.js',
  './js/orders/day.js',
  './js/orders/archive.js',
  './js/orders/reminders.js',
  './js/orders/reminder-view.js',
  './js/orders/suppliers.js',
  './js/orders/ingredients.js',
  './js/orders/no-supplier.js',
  './js/orders/ingredient-search.js',
  './js/orders/ingredient-list.js',
  './js/orders/search-box.js',
  './js/orders/supplier-detail.js',
  './js/orders/supplier-items.js',
  './js/orders/orders-config.js',
  './js/orders/draft.js',
  './js/orders/preview.js',
  './js/orders/order-text.js',
  './js/orders/supplier-picker.js',
  './js/orders/history.js',
  './js/orders/history-edit.js',
  './js/orders/management.js',
  './js/orders/bank-holidays.js',
  './js/orders/suggestions.js',
  './js/orders/notifications.js',
  './catalogue.html',
  './catalogue.css',
  './js/catalogue/confirm-dialog.js',
  './js/catalogue/dom.js',
  './js/catalogue/catalogue-model.js',
  './js/catalogue/recipe-cost-model.js',
  './js/catalogue/recipe-allergen-model.js',
  './js/catalogue/allergen-sheet.js',
  './js/catalogue/recipe-label-model.js',
  './js/catalogue/label-view.js',
  './js/catalogue/ingredient-picker.js',
  './js/catalogue/firebase-catalogue.js',
  './js/catalogue/catalogue-store.js',
  './js/catalogue/catalogue-main.js',
  './js/catalogue/catalogue-list.js',
  './js/catalogue/catalogue-detail.js',
  './js/catalogue/catalogue-editor.js',
  './js/catalogue/guided-model.js',
  './js/catalogue/guided-alarm.js',
  './js/catalogue/guided-run.js',
  './js/catalogue/guided-editor.js',
  './js/catalogue/import-to-calculator.js',
  './pastries.html',
  './pastries.css',
  './js/pastries/confirm-dialog.js',
  './js/pastries/dom.js',
  './js/pastries/pastries-model.js',
  './js/pastries/firebase-pastries.js',
  './js/pastries/pastries-store.js',
  './js/pastries/pastries-main.js',
  './js/pastries/pastries-strip.js',
  './js/pastries/pastries-day.js',
  './js/pastries/pastries-editor.js',
  './js/pastries/pastries-log-model.js',
  './js/pastries/pastries-lock.js',
  './js/pastries/pastries-logs-store.js',
  './js/pastries/pastries-logs.js',
  './foodcost.html',
  './foodcost.css',
  './js/foodcost/confirm-dialog.js',
  './js/foodcost/dom.js',
  './js/foodcost/foodcost-model.js',
  './js/foodcost/firebase-foodcost.js',
  './js/foodcost/foodcost-store.js',
  './js/foodcost/foodcost-main.js',
  './js/foodcost/foodcost-list.js',
  './js/foodcost/foodcost-editor.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  // Cache assets one-by-one — if one fails, installation still succeeds.
  // cache: 'reload' bypasses the browser's HTTP cache (GitHub Pages serves
  // ~10-minute max-age), so a brand-new worker can never precache stale copies.
  // NO skipWaiting() here: the new worker must WAIT so js/sw-update.js can show
  // the update banner; it activates when the user taps it (skipWaiting message
  // below) or when the app is next opened with no pages left from the old one.
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
      ))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SDK_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Cross-origin requests are bypassed (the browser performs them directly) with
  // ONE exception: the Firebase SDK modules on www.gstatic.com/firebasejs/*. Those
  // are static, CORS-clean, immutable files — caching them in a SEPARATE, persistent
  // cache (SDK_CACHE, untouched by the per-deploy CACHE_NAME bump) lets the app boot
  // offline and start instantly on a slow network, with no SDK vendoring and no
  // import rewriting; a version bump auto-refreshes it on the next online load.
  // Everything else cross-origin — the live Firestore/Auth API, reCAPTCHA (also on
  // gstatic, hence the /firebasejs/ path guard), the localhost emulator — is left
  // untouched: re-issuing those through the SW could cause a transient
  // auth/network-request-failed on the first anonymous sign-in.
  if (url.origin !== self.location.origin) {
    if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
      e.respondWith(
        caches.open(SDK_CACHE).then(cache =>
          cache.match(e.request).then(cached => {
            const networkFetch = fetch(e.request).then(res => {
              // Store only executable, CORS-clean module responses (not opaque/redirected).
              if (res && res.status === 200 && !res.redirected &&
                  (res.type === 'cors' || res.type === 'basic')) {
                cache.put(e.request, res.clone()).catch(() => {});
              }
              return res;
            }).catch(() => cached);
            return cached || networkFetch;
          })
        )
      );
    }
    return;
  }

  // Install guide assets: always network-first (fresh from server), falling back
  // to cache only when offline. Avoids serving a stale guide after an update.
  const p = url.pathname;
  if (p.endsWith('/install-guide.html') || p.endsWith('/qr.png') || p.endsWith('/js/install-guide.js')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          // Caching is best-effort: a full quota must not become an unhandled
          // rejection, and the response has already been handed to the page.
          caches.open(CACHE_NAME)
            .then(cache => cache.put(e.request, clone))
            .catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first with background update: serve cached version immediately,
  // fetch from network in background to keep cache fresh.
  // This prevents white screens on poor connections.
  // cache: 'no-cache' forces the background fetch to revalidate with the server
  // (a cheap 304 when unchanged) instead of trusting the browser's HTTP cache,
  // which could hand back the same stale copy we are trying to refresh.
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Deliberately fetch(e.request.url) and NOT fetch(e.request): passing a
      // Request together with a non-empty init re-creates it, and the spec then
      // downgrades a navigation's mode from 'navigate' to 'same-origin'. Every
      // page load goes through here, so that is not a change worth making for a
      // revalidation of same-origin static assets, which need no request context.
      const networkFetch = fetch(e.request.url, { cache: 'no-cache' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          // Best-effort, like above: a failed put must not surface as an
          // unhandled rejection when the page already has its response.
          caches.open(CACHE_NAME)
            .then(cache => cache.put(e.request, clone))
            .catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', e => {
  if (!e.source) return;
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── Notifications that arrive with the app closed ────────────────────────────
//
// ⚠️ THIS IS HERE, IN THE APP'S OWN SERVICE WORKER, ON PURPOSE. Firebase's usual
// setup registers a SECOND worker (firebase-messaging-sw.js) at the site ROOT —
// and this app is not at the root, it lives under /the_italian_club_app/. Two
// workers fighting over one scope is a whole class of bug that simply cannot
// happen if there is only ever one. getToken() is handed THIS registration
// instead (js/push.js).
//
// The server sends DATA-ONLY messages, so nothing is displayed until the code
// below decides to display it. A message carrying a `notification` block would be
// shown by the browser automatically, and the app would lose the two decisions it
// actually needs: whether to show it at all, and what it should say.

// Every push must result in something visible — a browser is entitled to revoke
// permission from a site that pushes silently — so this always shows SOMETHING,
// even when the payload is unreadable.
function pushPayload(event) {
  try {
    const raw = event.data ? event.data.json() : null;
    // FCM delivers the fields under `data` for a data-only message.
    return (raw && (raw.data || raw)) || {};
  } catch (err) {
    return {};
  }
}

self.addEventListener('push', event => {
  const data = pushPayload(event);
  const title = data.title || 'Misé';
  const body = data.body || 'Open the app to see what changed.';
  // One notification per thing: a re-delivery REPLACES rather than stacking three
  // copies of the same alarm on a lock screen.
  const tag = data.tag || 'italianclub';

  event.waitUntil((async () => {
    // ⚠️ SILENT WHEN THE APP IS ALREADY IN FRONT OF YOU. The alarm the page itself
    // sounds is better (it repeats, and the screen is showing the countdown), so a
    // notification on top of it is the same thing twice. `visibilityState` is the
    // test and not merely "a window exists": a page left open behind a locked
    // screen is not somebody looking at it.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = open.some(c => c.visibilityState === 'visible');
    if (watching) {
      // Still tell the page, so it can react without a second alarm going off.
      open.forEach(c => { try { c.postMessage({ type: 'push', data }); } catch (err) {} });
      return;
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || './index.html' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    // Reuse a window that is already open rather than piling up copies of the app.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.href).href;
    const existing = open.find(c => c.url === target) || open[0];
    if (existing) {
      try { await existing.focus(); } catch (err) {}
      if (existing.url !== target && 'navigate' in existing) {
        try { await existing.navigate(target); } catch (err) {}
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});
