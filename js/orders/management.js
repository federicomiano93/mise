// management.js — the Orders SETTINGS panel (the gear in the bottom bar).
//
// How the order screen looks, when the working week starts, which roads an order
// may leave by, and the alerts. That is all it is now, and the word above the
// screen finally matches what is behind it.
//
// ⚠️ THE SUPPLIER AND INGREDIENT RECORDS LEFT THIS FILE. They were here — two lists
// of business data sitting under a gear, four levels down — and they are neither
// settings nor rare: the ingredient form is where the whole allergen job happens.
// They live on their own screen now (js/orders/registry.js, suppliers.html), one
// tap from the Home. The helpers both halves still share are in js/orders/mgmt-ui.js.
//
// ⚠️ THE PANEL IS OPEN TO EVERYBODY IN THE LOCATION, AND THAT IS THE DESIGN, not
// a leftover. isAdmin below is the old placeholder from before roles existed; it
// still reads `true` because the panel really is for everybody. What is gated is
// each individual control — two of the four sections are drawn only for whoever
// runs the place, and firestore.rules refuses the write regardless of what this
// page decides to show (P2).
//
// data: { ordersConfig(): {} } — a live getter from orders-main.
// actions: { onClose, saveOrdersConfig(patch) }

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { renderNotificationSettings } from './notifications.js';
import { alertDialog } from './confirm-dialog.js';
import { ROUTES, validateRoutes, toStored } from './send-routes.js';
import { WEEKDAYS as WEEK_START_DAYS, isValidWeekStart } from './work-week.js';
// ⚠️ THE SWITCH LIVES HERE, NOT IN notifications.js. That file is importable under
// Node and has its own test suite BECAUSE it touches no Firebase; importing push.js
// into it pulled the SDK in from an https: URL and broke the whole suite at load.
// A screen that already talks to Firestore is the right home for a control that does.
import { muteOrderRequests, orderRequestsMuted, rememberMute } from '../push.js';
import { BACK_ICON, reportFailure } from './mgmt-ui.js';

export const isAdmin = true; // the panel is for everybody; each control is gated on its own

export function buildManagement(data, actions) {
  const content = el('div', { class: 'mgmt-scroll' });

  // ⚠️ NO TAB BAR ANY MORE. It carried Suppliers / Ingredients / General, and with
  // the first two gone a bar of one tab is a control that appears to do nothing.
  const overlay = el('div', { class: 'mgmt-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', { type: 'button', class: 'orders-icon-btn', 'aria-label': 'Back', icon: BACK_ICON, onClick: () => actions.onClose() }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: t('ui.settings') })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    content,
  ]);

  // ⚠️ FOUR SECTIONS, EACH ANSWERING A DIFFERENT QUESTION (Federico, 14 Aug 2026:
  // «dividi in sezioni le impostazioni per renderle più chiare»). It was a flat list
  // with two headings, and the send routes had been dropped under «the order screen» —
  // where they do not belong: how an order LEAVES is not how the screen LOOKS.
  //
  // ⚠️ TWO OF THE FOUR ARE FOR WHOEVER RUNS THE PLACE, and the database says the same:
  // config/orders is write-gated on canManage(). Hiding them is COURTESY — an employee
  // who reached the screen anyway would simply have the write refused, which is the
  // shape every guard in this app has (v269: hiding is not the feature).
  function render() {
    content.textContent = '';
    const boss = canManageHere();

    section('orders.section.orderScreen', [buildStockToggle(), buildHistoryDaysField()]);
    if (boss) section('orders.weekStart.title', [buildWeekStart()]);
    if (boss) section('orders.section.howSent', [buildSendRoutes()]);

    const box = el('div', { class: 'mgmt-notif' });
    section('orders.section.alerts', [box, buildMuteOrderRequests()]);
    renderNotificationSettings(box);
  }

  // One heading and its fields, so a section cannot end up with a title and nothing
  // under it — or fields under somebody else's title.
  function section(titleKey, fields) {
    content.appendChild(el('h3', { class: 'mgmt-section-title', text: t(titleKey) }));
    fields.filter(Boolean).forEach(f => content.appendChild(f));
  }

  // Show or hide the Stock box on every order row, for EVERY phone (it is stored in
  // Firestore, not on this device). Applied on the tap, like the notification control
  // above it — there is nothing to lose by getting it wrong, and one more tap undoes it.
  function buildStockToggle() {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = data.ordersConfig().showStock;

    cb.addEventListener('change', async () => {
      const wanted = cb.checked;
      cb.disabled = true;
      try {
        await actions.saveOrdersConfig({ showStock: wanted });
      } catch (err) {
        cb.checked = !wanted;          // put the box back to what is actually stored
        await reportFailure('save', t('orders.showStock'), err);
      } finally {
        cb.disabled = false;
      }
    });

    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-toggle' }, [cb, el('span', { text: t('orders.showTheStockBox') })]),
      el('p', { class: 'notif-note', text:
        t('orders.turnThisOffIf') }),
    ]);
  }

  // "Do not buzz this phone about order lists."
  //
  // ⚠️ ONE SWITCH, for the one alert somebody asked to be able to turn off. Not a switch
  // per kind: five switches nobody asked for is five more things to get wrong.
  //
  // ⚠️ IT SILENCES THE BUZZ, NEVER THE WORK, and the note under it says so — somebody
  // who turns this off and later finds an app that looks empty has been misled by their
  // own setting. Same rule the holiday switch is built on.
  //
  // ⚠️ A PROPERTY OF THIS PHONE, not of the person: somebody may want the alert in their
  // pocket and not on the tablet in the kitchen.
  function buildMuteOrderRequests() {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = orderRequestsMuted();
    cb.addEventListener('change', async () => {
      const wanted = cb.checked;
      cb.disabled = true;
      try {
        await muteOrderRequests(wanted);
        rememberMute(wanted);
      } catch (err) {
        cb.checked = !wanted;      // back to what is actually stored
        await reportFailure('save', t('orders.mute.orderRequests'), err);
      } finally {
        cb.disabled = false;
      }
    });
    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-toggle' }, [cb, el('span', { text: t('orders.mute.orderRequests') })]),
      el('p', { class: 'notif-note', text: t('orders.mute.stillShown') }),
    ]);
  }

  // Which day the working week starts on.
  //
  // ⚠️ IT DECIDES WHAT «THIS WEEK» MEANS ON INCOMING, so it is a decision about how the
  // venue works, not a preference of one phone — which is why it lives in Firestore and
  // why the database gates the write on canManage(). Hiding the control is courtesy.
  //
  // ⚠️ A <select>, not a row of seven buttons: seven targets on a 320px phone is how a
  // bar wraps, and this project has already lost a release to exactly that.
  function buildWeekStart() {
    const current = data.ordersConfig().weekStartsOn;
    const sel = el('select', { class: 'mgmt-input' });
    // ⚠️ THE SHORT NAMES, which the dictionary already carries in both languages and
    // which Orders already uses for a supplier's delivery days. Inventing a long form
    // would mean 14 new entries saying what 7 existing ones already say, and two sets
    // of weekday words is how one of them ends up half-translated.
    WEEK_START_DAYS.forEach((day, i) => {
      const opt = el('option', { value: day, text: t(`day.weekdayShort.${i}`) });
      if (day === current) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', async () => {
      const wanted = sel.value;
      // ⚠️ Checked before the network, with the same list the model uses: a value the
      // app does not recognise would be silently read back as Sunday, so the screen
      // would show one thing and the list would do another.
      if (!isValidWeekStart(wanted)) { sel.value = current; return; }
      sel.disabled = true;
      try {
        await actions.saveOrdersConfig({ weekStartsOn: wanted });
      } catch (err) {
        sel.value = current;          // back to what is actually stored
        await reportFailure('save', t('orders.weekStart.title'), err);
      } finally {
        sel.disabled = false;
      }
    });

    // ⚠️ NO TITLE OF ITS OWN — the section above owns it. Two headings for one block is
    // how a "section" quietly becomes a flat list again.
    return el('div', { class: 'mgmt-field' }, [
      el('p', { class: 'send-setting-hint', text: t('orders.weekStart.hint') }),
      sel,
    ]);
  }

  // Which roads an employee may send an order by.
  //
  // ⚠️ THE SWITCHES SAY WHAT AN EMPLOYEE MAY USE. Whoever runs the place keeps all
  // four whatever they say - if they applied to everybody, closing WhatsApp to hold
  // an employee back would disarm the very person who then has to reach the
  // supplier, and the order could never leave the building. The hint under the
  // title says so, because a switch whose scope is invisible is a switch that gets
  // set wrongly.
  //
  // ⚠️ AND IT IS A SIGNPOST, NOT A LOCK. WhatsApp and email live outside this app,
  // so nothing here can stop a person opening WhatsApp themselves. What it does is
  // take the road out of the app, so nobody takes it by habit - and the message is
  // BUILT here, so going round it means retyping thirty ingredients.
  function buildSendRoutes() {
    const current = data.ordersConfig().sendSettings;
    const routes = { ...current.routes };
    let preferred = current.preferred;

    const box = el('div', { class: 'mgmt-field' }, [
      // ⚠️ .mgmt-section-title, NOT a new class. The first draft invented
      // .mgmt-subtitle, which is defined in NO stylesheet — the heading would
      // simply have had no styling, silently, which is the same family of defect
      // as the undefined custom properties that left three screens flush to the
      // edge of the phone. Checked before shipping, not after.
      el('p', { class: 'send-setting-hint', text: t('orders.send.settingsHint') }),
    ]);

    ROUTES.forEach(route => {
      const cb = el('input', { type: 'checkbox', class: 'mgmt-check' });
      cb.checked = routes[route] === true;
      cb.addEventListener('change', async () => {
        const wanted = { ...routes, [route]: cb.checked };
        const verdict = validateRoutes(wanted, preferred);
        // ⚠️ THE LAST ROAD CANNOT BE CLOSED, and the refusal is SAID. Left silent it
        // would read as a switch that mysteriously will not stay off.
        if (!verdict.ok) {
          cb.checked = true;
          await alertDialog(t('orders.send.mustKeepOne'));
          return;
        }
        cb.disabled = true;
        try {
          await actions.saveOrdersConfig(toStored(verdict.routes, verdict.preferred));
          Object.assign(routes, verdict.routes);
          preferred = verdict.preferred;
        } catch (err) {
          cb.checked = !cb.checked;      // back to what is actually stored
          await reportFailure('save', t('orders.send.settingsTitle'), err);
        } finally {
          cb.disabled = false;
        }
      });
      box.appendChild(el('label', { class: 'send-setting-row' }, [
        cb,
        el('span', { class: 'send-setting-name', text: t(`orders.send.route.${route}`) }),
      ]));
    });

    // ⚠️ SAID PLAINLY, because believing an email has gone when it is sitting in a
    // drafts folder is the worst outcome this road has.
    box.appendChild(el('p', { class: 'send-setting-hint', text: t('orders.send.emailOpensApp') }));
    return box;
  }

  // How far back the History tab reaches before asking. The app is mostly used by
  // kitchen staff, who need this week's orders rather than last month's — but this
  // HIDES and never deletes, which is why the note under it says so out loud.
  //
  // Saved on `change` (blur or Enter), not on every keystroke: typing "20" passes
  // through "2", and saving that would push a 2-day window onto every phone in the
  // bakery for as long as it takes to type the second digit.
  function buildHistoryDaysField() {
    const input = el('input', {
      type: 'number', min: '1', max: '365', inputmode: 'numeric',
      class: 'mgmt-input', id: 'history-days-input',
    });
    input.value = String(data.ordersConfig().historyDays);

    input.addEventListener('change', async () => {
      const stored = data.ordersConfig().historyDays;
      const wanted = Math.floor(Number(input.value));
      // Refuse rather than store: an empty box or a 0 would render an EMPTY History,
      // which reads as "the orders have been deleted" — the one impression this
      // feature must never give.
      if (!Number.isFinite(wanted) || wanted < 1 || wanted > 365) {
        input.value = String(stored);
        return;
      }
      if (wanted === stored) return;

      input.disabled = true;
      try {
        await actions.saveOrdersConfig({ historyDays: wanted });
      } catch (err) {
        input.value = String(stored);   // put the box back to what is actually stored
        await reportFailure('save', t('orders.daysOfHistory'), err);
      } finally {
        input.disabled = false;
      }
    });

    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-field-label', for: 'history-days-input',
        text: t('orders.daysOfPastOrders') }),
      el('div', { class: 'mgmt-days-row' }, [input, el('span', { text: t('orders.days') })]),
      el('p', { class: 'notif-note', text:
        t('orders.olderOrdersAreNever') }),
    ]);
  }

  render();

  // Redrawn when config/orders changes on another phone — the only live document
  // this panel now shows. ⚠️ The suppliers / ingredients / prices snapshots no
  // longer call it: nothing here comes from those collections any more.
  return { overlay, refresh: render };
}
