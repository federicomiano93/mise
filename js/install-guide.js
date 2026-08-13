// install-guide.js — drives the device-first install guide (install-guide.html).
// Detects the device and shows only the matching install steps. On Chromium
// (Android / desktop Chrome / Edge) it also offers a real one-tap "Install app"
// button via the native install prompt. On iOS Safari there is no install API,
// so the written steps are the only path. CSP-safe: external script, no inline.

(function () {
  const select = document.getElementById('screen-select');
  const steps = document.getElementById('screen-steps');
  if (!select || !steps) return;

  const blocks = steps.querySelectorAll('.steps');

  function showSteps(os) {
    blocks.forEach(b => { b.hidden = b.dataset.os !== os; });
    select.hidden = true;
    steps.hidden = false;
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('[data-os-btn]').forEach(btn => {
    btn.addEventListener('click', () => showSteps(btn.dataset.osBtn));
  });

  const change = document.getElementById('change-device');
  if (change) {
    change.addEventListener('click', () => {
      steps.hidden = true;
      select.hidden = false;
      window.scrollTo(0, 0);
    });
  }

  // Detect the most likely device from the user agent.
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  let detected = 'desktop';
  if (isIOS) detected = 'ios';
  else if (/Android/.test(ua)) detected = 'android';

  // On iOS only Safari can install a PWA. If the visitor opened the link in
  // Chrome / Firefox / Edge or an in-app browser (no "Safari" token), show a
  // clear notice telling them to switch to Safari, with a copy-link helper.
  const isOtherIOSBrowser = isIOS
    && (/CriOS|FxiOS|EdgiOS|GSA/.test(ua) || !/Safari/.test(ua));
  if (isOtherIOSBrowser) {
    const notice = document.getElementById('ios-safari-notice');
    if (notice) notice.hidden = false;
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          copyBtn.textContent = t('help.linkCopiedNowPaste');
        } catch (e) {
          copyBtn.textContent = t('help.copyFailedLongPress');
        }
      });
    }
  }

  // One-tap install (Chromium only). The browser fires beforeinstallprompt when
  // it considers the app installable; we capture it and show a button at the top
  // of the Android/desktop steps. When it never fires (iOS Safari, already
  // installed, non-Chromium), the written steps remain the fallback.
  let deferredPrompt = null;

  function addInstallButton() {
    if (!deferredPrompt) return;
    blocks.forEach(b => {
      if (b.dataset.os !== 'android' && b.dataset.os !== 'desktop') return;
      if (b.querySelector('.install-now-btn')) return; // already added
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'install-now-btn';
      btn.textContent = t('help.installApp');
      btn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        btn.remove();
      });
      b.insertBefore(btn, b.firstChild);
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    addInstallButton();
  });

  // Skip the "which device?" question: go straight to the detected device's
  // steps. "Change device" still lets the user switch if the guess is wrong.
  const suggestedBtn = document.querySelector(`[data-os-btn="${detected}"]`);
  if (suggestedBtn) {
    const tag = document.createElement('span');
    tag.className = 'suggested';
    tag.textContent = 'your device';
    suggestedBtn.appendChild(tag);
  }
  showSteps(detected);
})();
import { t } from './i18n.js';

