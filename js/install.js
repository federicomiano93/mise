// install.js — make installing the PWA easier from the Home screen.
//
// Browsers do NOT allow a site to install itself silently — install always needs
// a user action. Best we can do:
//   - Chromium (Android/desktop): capture beforeinstallprompt and show a one-tap
//     "Install app" button that opens the native install prompt.
//   - iOS Safari: there is no install API at all, so show a short instruction.
// Hidden entirely when the app is already running as an installed PWA.

(function () {
  const host = document.getElementById('install-host');
  if (!host) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) return; // already installed — nothing to offer

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    host.textContent = '';
    const btn = document.createElement('button');
    btn.className = 'install-btn';
    btn.textContent = t('help.installApp');
    // ⚠️ AND AGAIN IF THE LANGUAGE ARRIVES AFTER THIS BUTTON DOES. The browser fires
    // beforeinstallprompt on its own schedule, which can be before the venue's session
    // opens — and this button is built once, so it kept the app's starting language.
    onLanguageChange(() => { btn.textContent = t('help.installApp'); });
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      host.textContent = '';
    });
    host.appendChild(btn);
  });

  // iOS Safari: no beforeinstallprompt — show the manual steps instead.
  const ua = window.navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (isIOS && isSafari) {
    const tip = document.createElement('p');
    tip.className = 'install-tip';
    tip.textContent = t('help.addToYourHome');
    host.appendChild(tip);
  }
})();
import { t, onLanguageChange } from './i18n.js';

