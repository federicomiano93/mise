const CACHE_NAME = 'theitalianclub-v239';
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
  './js/catalogue/firebase-catalogue.js',
  './js/catalogue/catalogue-store.js',
  './js/catalogue/catalogue-main.js',
  './js/catalogue/catalogue-list.js',
  './js/catalogue/catalogue-detail.js',
  './js/catalogue/catalogue-editor.js',
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
