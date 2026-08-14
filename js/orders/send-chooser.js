// send-chooser.js — "how should this order go?", once there is more than one answer.
//
// The deciding is in the pure js/orders/send-routes.js; this is the screen and the
// four links it opens.
//
// ⚠️ WITH ONE ROAD OPEN IT ASKS NOTHING. A question with a single answer is a tap
// wasted on every order, every day, for no information.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { alertDialog } from './confirm-dialog.js';
import { buildOrderMessage, whatsappUrl } from './order-text.js';
import { routesFor, routeAvailableFor, unreachable } from './send-routes.js';

const ICONS = {
  manager: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4"/></svg>',
  whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
  whatsappSupplier: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/><path d="M12 8v5M9.5 10.5L12 8l2.5 2.5"/></svg>',
  email: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
};

// The two that address one supplier each.
const PER_SUPPLIER = new Set(['whatsappSupplier', 'email']);

// Which roads this person could take with these suppliers, each with the sentence
// the screen shows under it.
export function offerFor({ settings, canManage, suppliers }) {
  return routesFor(settings, { canManage }).map(route => {
    const perSupplier = PER_SUPPLIER.has(route);
    const cannot = unreachable(route, suppliers);
    const reachable = suppliers.filter(s => routeAvailableFor(route, s));

    let note = '';
    // ⚠️ THE COST OF A DIRECT ROAD IS SAID BEFORE IT IS TAKEN. One message per
    // supplier means one chat at a time: with three suppliers that is three trips
    // out of the app and back. Discovering that halfway through is how somebody
    // sends the first and forgets the other two.
    if (perSupplier && reachable.length > 1) {
      note = t('orders.send.onePerSupplier', { n: reachable.length });
    }
    // ⚠️ AND WHO CANNOT BE REACHED IS NAMED, never silently dropped. A supplier
    // missing from a send nobody mentioned is an order that simply never happened.
    if (cannot.length) {
      const missing = t('orders.send.noContact', { n: cannot.length,
        names: cannot.map(s => s.name).join(', ') });
      note = note ? `${note} · ${missing}` : missing;
    }
    return { route, perSupplier, reachable, cannot, note, usable: reachable.length > 0 };
  });
}

// Ask, then act. `rows` are the picked suppliers ({ id, name, items }).
export function chooseAndSend({ rows, settings, canManage, suppliers, locationName, grouped,
                               onSendToManager, onSent }) {
  const offers = offerFor({ settings, canManage, suppliers }).filter(o => o.usable);

  if (!offers.length) {
    // Cannot happen through the settings screen, which refuses to close the last
    // road — but a hand-written document could, and the app must say so rather
    // than do nothing when the button is pressed.
    return alertDialog(t('orders.send.noRouteAvailable'));
  }
  if (offers.length === 1) return take(offers[0]);

  return new Promise(resolve => {
    const overlay = el('div', { class: 'app-dialog-backdrop send-chooser' }, [
      el('div', { class: 'app-dialog' }, [
        el('h2', { class: 'app-dialog-title', text: t('orders.send.howTitle') }),
        el('div', { class: 'send-routes' }, offers.map(o => el('button', {
          class: 'send-route', type: 'button',
          onclick: () => { overlay.remove(); resolve(take(o)); },
        }, [
          el('span', { class: 'send-route-icon', icon: ICONS[o.route] }),
          el('span', { class: 'send-route-text' }, [
            el('span', { class: 'send-route-name', text: t(`orders.send.route.${o.route}`) }),
            o.note ? el('span', { class: 'send-route-note', text: o.note }) : null,
          ]),
        ]))),
        el('div', { class: 'app-dialog-actions' }, [
          el('button', {
            class: 'app-dialog-btn app-dialog-btn-ghost', type: 'button',
            text: t('ui.cancel'), onclick: () => { overlay.remove(); resolve(false); },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
    overlay.querySelector('.send-route')?.focus();
  });

  function take(offer) {
    if (offer.route === 'manager') { onSendToManager?.(rows.map(r => r.id)); return true; }

    const message = supplierName => buildOrderMessage(
      rows.filter(r => !supplierName || r.name === supplierName)
        .map(r => ({ supplierName: r.name, items: r.items })),
      { grouped, locationName });

    if (offer.route === 'whatsapp') {
      const text = message(null);
      if (!text) return false;               // never open an empty chat
      window.open(whatsappUrl(text), '_blank');
      onSent?.(rows.map(r => r.id));
      return true;
    }

    // ⚠️ ONE MESSAGE PER SUPPLIER, AND ONLY TO THE ONES IT CAN REACH. The rows are
    // matched to their supplier by ID rather than by name: two suppliers can share
    // a name, and the wrong order going to the wrong supplier is the one mistake
    // this feature must not be able to make.
    const sent = [];
    offer.reachable.forEach(supplier => {
      const row = rows.find(r => r.id === supplier.id);
      if (!row) return;
      const text = buildOrderMessage([{ supplierName: row.name, items: row.items }],
        { grouped: true, locationName });
      if (!text) return;
      const url = offer.route === 'email'
        ? mailto(supplier.email, t('orders.send.emailSubject', { name: locationName || '' }), text)
        : `https://wa.me/${digitsOf(supplier.phone)}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
      sent.push(supplier.id);
    });
    if (sent.length) onSent?.(sent);
    return sent.length > 0;
  }
}

// ⚠️ DIGITS ONLY. wa.me refuses a number carrying spaces, brackets or a leading
// "+", and refuses it by opening a page that says the number is invalid — which
// reads as the app being broken rather than the number needing tidying.
export function digitsOf(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ⚠️ mailto OPENS THE MAIL APP; IT DOES NOT SEND. That is the honest limit of doing
// this without a server, and the screen says so rather than letting somebody believe
// an order has gone.
export function mailto(address, subject, body) {
  return `mailto:${encodeURIComponent(String(address || '').trim())}`
    + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
