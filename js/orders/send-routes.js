// send-routes.js — the four ways an order can leave the app, which of them a
// person may use, and which one is offered first.
//
// PURE: no DOM, no Firestore, so every rule below is assertable in a test (P15).
//
// ⚠️⚠️ THIS IS A SIGNPOST, NOT A LOCK, AND SAYING SO IS PART OF THE FEATURE.
// WhatsApp and email live OUTSIDE this app: it opens a link, and there is no server
// call anybody could refuse. No setting here can stop a person opening WhatsApp on
// their own phone. What it genuinely does is remove the road from the app, so nobody
// takes it by habit or by accident and the normal way becomes "send it to the
// manager" — and the message itself is BUILT by the app, so going round it means
// retyping thirty ingredients by hand. It discourages; it does not forbid.
//
// ⚠️ THE DECISION, THOUGH, IS CLOSED PROPERLY: who may change these settings is
// enforced by the database rules, not by a hidden button. Hiding a control is
// courtesy, never security (v269).

export const ROUTES = Object.freeze(['manager', 'whatsapp', 'whatsappSupplier', 'email']);

// The two that address one supplier directly need a way to reach it.
const NEEDS = Object.freeze({ whatsappSupplier: 'phone', email: 'email' });

// What a venue starts with: the two roads that existed before this change.
//
// ⚠️ THE TWO NEW ONES DEFAULT TO OFF. A venue that has never been asked has not
// agreed to let anybody message its suppliers directly, and a default that turns on
// a way of contacting the outside world is a decision made by nobody.
export const DEFAULT_ROUTES = Object.freeze({
  manager: true, whatsapp: true, whatsappSupplier: false, email: false,
});

// Read a stored config into the settings the screens use.
//
// ⚠️ A CORRUPT OR HALF-WRITTEN DOCUMENT FALLS BACK TO THE DEFAULTS, never to
// "nothing allowed": an order that cannot leave the app at all is a worse failure
// than one that can leave by a road somebody meant to close.
export function normalizeSendRoutes(doc) {
  const stored = doc?.sendRoutes;
  const routes = {};
  ROUTES.forEach(r => {
    routes[r] = typeof stored?.[r] === 'boolean' ? stored[r] : DEFAULT_ROUTES[r];
  });
  // ⚠️ ALL FOUR OFF IS NOT A STATE THE APP MAY BE IN. The settings screen refuses
  // to save it, but a document written by hand, an older version or a partial merge
  // could still produce it — and the answer must be a working app, not a dead end.
  if (!ROUTES.some(r => routes[r])) routes.manager = true;

  const wanted = String(doc?.preferredRoute || '');
  const preferred = routes[wanted] ? wanted : ROUTES.find(r => routes[r]);
  return { routes, preferred };
}

// Which routes THIS person may use.
//
// ⚠️⚠️ A MANAGER OR OWNER ALWAYS KEEPS ALL FOUR, AND THE REASON IS STRUCTURAL. If
// the switches applied to everybody, turning WhatsApp off to hold an employee back
// would disarm the very person who then has to get the order to the supplier — the
// order could never leave the building. The switches say what an EMPLOYEE may use.
export function routesFor(settings, { canManage = false } = {}) {
  if (canManage) return [...ROUTES];
  const routes = settings?.routes || DEFAULT_ROUTES;
  return ROUTES.filter(r => routes[r] === true);
}

// Can this route actually be used for this supplier?
//
// ⚠️ A ROUTE WITH NOWHERE TO SEND IS OFFERED AS UNAVAILABLE, WITH THE REASON — never
// as a chat that opens blank or a mail addressed to nobody. Those look like the app
// failing; "no number saved for this supplier" looks like the thing it is, and names
// what to go and fix.
export function routeAvailableFor(route, supplier) {
  const need = NEEDS[route];
  if (!need) return true;
  return String(supplier?.[need] || '').trim() !== '';
}

// The suppliers a direct route cannot reach.
export function unreachable(route, suppliers) {
  if (!NEEDS[route]) return [];
  return (suppliers || []).filter(s => s && !routeAvailableFor(route, s));
}

// ── Saving the settings ──────────────────────────────────────────────────────

// What the settings screen is allowed to save, and why not.
//
//   -> { ok: true, routes, preferred } | { ok: false, reason }
//
// ⚠️ THE LAST ROAD CANNOT BE CLOSED. With every switch off an employee is left
// holding an order that can never leave the app, and the app would have taken away
// the only thing it was for. Refused out loud, so it is a message rather than a
// switch that mysteriously will not stay off.
export function validateRoutes(routes, preferred) {
  const on = ROUTES.filter(r => routes?.[r] === true);
  if (!on.length) return { ok: false, reason: 'none' };

  // ⚠️ A PREFERENCE POINTING AT A CLOSED ROAD IS MOVED, NOT KEPT. Left alone it
  // would silently mean "no preference" and the app would offer whatever came
  // first — a setting that stopped doing what it says without saying so.
  const chosen = routes[preferred] ? preferred : on[0];
  return { ok: true, routes: { ...routes }, preferred: chosen };
}

// Only the routes ever reach Firestore, never a derived list.
export function toStored(routes, preferred) {
  const out = {};
  ROUTES.forEach(r => { out[r] = routes?.[r] === true; });
  return { sendRoutes: out, preferredRoute: String(preferred || '') };
}
