// i18n.js — the INTERFACE language: what the staff read on screen. PURE (no DOM,
// no Firestore), so every rule below is asserted in a unit test rather than read
// back out of rendered markup (P15).
//
// ⚠️⚠️ THIS IS NOT THE LABEL LANGUAGE, AND KEEPING THE TWO APART IS WHY THIS FILE
// AND js/market.js ARE SEPARATE FILES RATHER THAN ONE.
//
//   this file        the INTERFACE language   what the staff READ    a preference
//   js/market.js     the OUTPUT language      what a LABEL says      the LAW
//
// Federico is Italian and his bakeries are in England: he wants the app in
// Italian, and his allergen labels must stay in English because that food is sold
// in the United Kingdom. So an interface set to Italian must not move a single
// word on a label. That is not a promise made in a comment — nothing in this file
// is reachable from the label code, and tests/i18n-label-separation.test.mjs
// fails if anybody imports one into the other.
//
// ⚠️ THE SIGN-IN SCREEN CANNOT USE THIS, and must not try. Nobody is signed in
// yet, so no venue is open, so there is no setting to read — the same reason that
// screen says «Mise» where every other screen says the venue's name. It stays in
// English until somebody is inside.

export const LANGUAGES = Object.freeze(['en', 'it']);

export const DEFAULT_LANGUAGE = 'en';

// ── The words that are DATA, and must never pass through here ────────────────
//
// ⚠️⚠️ TRANSLATING ANY OF THESE BREAKS THE APP, SILENTLY AND IN A WAY NO SCREEN
// EXPLAINS. They are English words, they look exactly like labels, and they are
// identifiers:
//
//   the weekday names ARE Firestore document ids — `pastries/Monday`. Translate
//   them and all seven proving lists become unreachable, with the app cheerfully
//   showing seven empty days;
//   the section keys decide which parts of the app a venue has bought;
//   the role values decide who may do what — and a membership value the code does
//   not recognise is not a demotion, it is a LOCKOUT (learnt three times);
//   the allergen codes are what an ingredient's declaration is stored under. A
//   translated code is a declaration that stops matching, on the one feature in
//   this app that can put somebody in hospital;
//   the unit and country codes are stored on documents and compared by the rules.
//
// This list exists so that translating one turns a test RED and NAMES it — the
// technique from v1.24.1, where a rule that mattered more than a behaviour was
// pinned by its own test rather than left in a comment. A rule that lives only in
// a comment is a rule that comes back.
export const DATA_WORDS = Object.freeze([
  // Firestore document ids for the seven proving lists
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  // which parts of the app a venue has
  'orders', 'calculator', 'catalogue', 'pastries', 'foodcost',
  // who may do what — the membership VALUE itself
  'owner', 'manager', 'staff', 'head-chef',
  // stored on ingredients and products, and compared by firestore.rules
  'kg', 'l', 'pcs',
  // the country, which decides the LABEL language (js/market.js)
  'GB', 'IT',
  // the interface languages themselves
  'en', 'it',
]);

// ── The dictionaries ─────────────────────────────────────────────────────────
//
// One flat map per language, keyed by a dotted name that says where the phrase
// lives: `orders.supplier.delete`, not `deleteBtn`. Flat and dotted so a phrase
// can be found by grepping for the key exactly as it appears at the call site.
//
// ⚠️ A PHRASE IS ONE ENTRY WITH A HOLE IN IT, NEVER TWO HALVES GLUED TOGETHER.
// `'Delete ' + name` cannot be translated: Italian puts the words in a different
// order, and a translator handed two fragments cannot see the sentence. Write
// `'Delete {name}?'` and pass `{ name }`.
//
// ⚠️ AND A COUNT IS NOT AN `if`. English and Italian agree that there are two
// forms here, but they do not agree on which number takes which — so counted
// phrases carry `.one` and `.other` and are picked by Intl.PluralRules, the
// platform's own answer (P19), never by `n === 1 ? … : …` at the call site.
const DICTIONARIES = Object.freeze({
  en: Object.freeze({
    // ── Who can get in ──────────────────────────────────────────────────────
    // ⚠️ THE WORD AND THE STORED VALUE ARE DIFFERENT THINGS, and this block is
    // where that is easiest to get wrong. `role.staff` shows «Employee»; the
    // value in users/{uid} stays 'staff' whatever any language calls it.
    'role.owner': 'Owner',
    'role.manager': 'Manager',
    'role.headChef': 'Head chef',
    'role.staff': 'Employee',

    // ⚠️ THE SAME WORD INSIDE A SENTENCE, ASKED FOR RATHER THAN COMPUTED. The
    // screen used to write `Make ${label.toLowerCase()}`, which is two mistakes
    // at once: it glues a sentence out of fragments, and it TRANSFORMS a
    // translated word. Case is a property of a language, not an operation you
    // may perform on somebody else's — so the form that goes inside a phrase is
    // its own entry, and the translator decides what it looks like.
    'people.make': 'Make {role}',
    'people.add': 'Add {role}',
    'role.owner.inSentence': 'owner',
    'role.manager.inSentence': 'manager',
    'role.headChef.inSentence': 'head chef',
    'role.staff.inSentence': 'employee',

    // ⚠️ THESE FOUR SENTENCES ARE THE ONLY PLACE ANYBODY IS EVER TOLD what a role
    // can do. Nothing else in the app explains it, so a translation that softens
    // one is a wrong decision about a real person's access, made confidently
    // because the screen said so. «Head chef» must keep saying out loud that it
    // is the manager level under another name, or four pills read as four levels.
    'role.means.owner': 'Everything, including adding people and setting their roles.',
    'role.means.manager': 'Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.headChef': 'The same as Manager — it is only the job title that differs. Runs this location: can delete suppliers, ingredients, recipes and products. Cannot add people.',
    'role.means.staff': 'Does the daily work — quantities, doughs, orders. Cannot delete things or add people.',

    'people.confirm.owner': 'Make {name} an owner?',
    'people.confirm.manager': 'Make {name} a manager?',
    'people.confirm.headChef': 'Make {name} the head chef?',
    'people.confirm.staff': 'Make {name} an employee?',

    // ⚠️ The quoted button name has to match what auth-gate.js actually shows.
    // It is repeated here rather than composed because that screen's words are
    // not extracted yet; when they are, this becomes a hole. Until then, changing
    // one means changing the other — the drift is real, and small.
    'people.joinsAs': 'Joins as {role} · {expires} · they open the app, tap “I have a code”, create their account and type it.',

    // ── Signing in ──────────────────────────────────────────────────────────
    // ⚠️ «Misé» IS NOT HERE. It is the product's name, not a phrase — the same
    // reason a venue's name never passes through a dictionary either.
    'auth.signIn.sub': 'Sign in to open your location.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signIn': 'Sign in',
    'auth.forgot': 'Forgot your password?',
    'auth.iHaveACode': 'I have a join code',
    'auth.installGuide': 'How to install the app',
    'auth.enterEmail': 'Enter your email.',
    'auth.enterPassword': 'Enter your password.',
    'auth.signingIn': 'Signing in…',
    'auth.typeEmailFirst': 'Type your email above first, then tap this.',
    // Deliberately does not reveal whether the address has an account.
    'auth.resetSent': 'If {address} has an account, a reset link is on its way.',
    'auth.back': 'Back',
    'auth.tryAgain': 'Try again',
    'auth.otherAccount': 'Sign in with a different account',
    'auth.logOut': 'Log out',
    'auth.logOut.title': 'Log out?',
    'auth.logOut.message': 'You will need your email and password to get back in.',

    // ⚠️ FOUR FIREBASE CODES SHARE ONE SENTENCE ON PURPOSE. Saying which half was
    // wrong tells somebody guessing at the door that an email exists. Keeping one
    // key for the four is what keeps that true through a translation as well.
    'auth.err.badPair': 'That email and password do not match an account.',
    'auth.err.badEmail': 'That does not look like an email address.',
    'auth.err.disabled': 'This account has been turned off. Ask the owner to re-enable it.',
    'auth.err.tooMany': 'Too many attempts. Wait a minute and try again.',
    'auth.err.offline': 'No connection. The first sign-in on a device needs internet.',
    'auth.err.emailTaken': 'That email already has an account. Sign in with it instead.',
    'auth.err.weakPassword': 'Pick a longer password — at least 6 characters.',
    'auth.err.generic': 'Could not sign in. Please try again.',

    // ── Joining with a code ─────────────────────────────────────────────────
    // ⚠️ FOUR SITUATIONS, FOUR SENTENCES, NOT ONE HEDGED ONE. «Type the code you
    // were given» is a LIE to somebody who arrived by link — their code is
    // already in the box — and a sentence that is wrong about what is on screen
    // teaches people to stop reading the next one.
    'join.title.invited': 'You have been invited',
    'join.title.new': 'Join with a code',
    'join.title.have': 'Enter your code',
    'join.sub.prefillNew': 'Your code is already filled in. Add your name and choose a password.',
    'join.sub.prefill': 'Your code is already filled in. Add your name to finish.',
    'join.sub.new': 'Create your account, then type the code you were given.',
    'join.sub.have': 'Type the code you were given.',
    'join.firstName': 'Your first name',
    'join.lastName': 'Your surname',
    'join.email': 'Your email',
    'join.choosePassword': 'Choose a password (at least {n} characters)',
    'join.code': 'Code',
    'join.join': 'Join',
    'join.signInInstead': 'Sign in with that email',
    'join.signInAndAdd': 'Sign in, and we will add the business to your account.',
    'join.creating': 'Creating your account…',
    'join.checking': 'Checking…',
    'join.checkingCode': 'Checking your code…',
    'join.badCode': 'That code does not work. Ask for a new one.',
    'join.shapeHint': 'Enter your six-digit code, or open the link you were sent.',

    // ── Above every venue ───────────────────────────────────────────────────
    'hub.where': 'Where would you like to go?',
    'hub.mine': 'My businesses',
    // ⚠️ A COUNT, NOT A TERNARY. It read `count === 1 ? … : …`, which is English's
    // rule written into the code — a language whose plural works differently
    // cannot be fixed by translating either half.
    'hub.mine.sub': { one: 'The place you run', other: 'The places you run' },
    'hub.customers': 'Customer businesses',
    'hub.customers.sub': 'The businesses using Misé',
    'hub.back': 'Back to Misé',

    'picker.title': 'Choose location',
    'picker.sub': 'You have access to more than one.',
    'noAccess.title': 'No location yet',
    'noAccess.body': 'This account is not linked to a location. If you were given a code, type it here.',

    'invite.title': 'You opened an invitation',
    'invite.message': 'Add this business to {who}?',
    'invite.ok': 'Add it',
    'invite.cancel': 'Not now',

    // ── Who can get in ──────────────────────────────────────────────────────
    'people.title': 'Who can get in',
    'people.rename': 'Rename',
    'people.remove': 'Remove',
    'people.cancel': 'Cancel',
    'people.done': 'Done',
    'people.empty': 'Nobody else yet.',
    'people.firstName': 'First name',
    'people.surname': 'Surname',
    'people.noEmail': 'no email',
    'people.readOut': 'Read this out to them:',
    'people.invite.intro': 'Add someone who works here. They install the app, create their own account with their name, and type the code you give them.',
    'people.remove.title': 'Remove this person?',
    'people.remove.message': '{name} ({email}) will lose access to this location immediately. Everything they have entered stays.',
    'people.err.read': 'Could not read who works here. Check your connection.',
    'people.err.name': 'Could not save that name. Check your connection.',
    'people.err.change': 'Could not change that. Check your connection and try again.',
    'people.err.remove': 'Could not remove them. Check your connection and try again.',
    'people.err.code': 'Could not make a code. Check your connection and try again.',

    // ── The venue's Home strip ──────────────────────────────────────────────
    'home.switch': 'Switch location',
    'home.switch.title': 'Switch location?',
    'home.switch.ok': 'Switch',
    'home.switch.cleared': 'Anything typed but not saved on this device is cleared.',
    'home.switch.toOne': 'Open {other} instead of {here}?',
    'home.switch.toMany': 'Choose a different location?',

    // ── The sections a venue has ────────────────────────────────────────────
    // ⚠️ THE WORD ONLY. `calculator`, `orders`, `catalogue`, `pastries` and
    // `foodcost` are stored on the venue document and decide what somebody
    // bought; they are in DATA_WORDS and can never be a key here.
    'section.calculator': 'Calculator',
    'section.orders': 'Orders',
    'section.catalogue': 'Recipe catalogue',
    'section.pastries': 'Pastries',
    'section.foodcost': 'Food cost',
    'section.calculator.sub': 'Dough scaling for the day’s orders',
    'section.orders.sub': 'Suppliers, ingredients and the WhatsApp order',
    'section.catalogue.sub': 'Recipes, scaling and guided mixing',
    'section.pastries.sub': 'The seven weekday proving lists',
    'section.foodcost.sub': 'Prices, margins and labels',

    // ── The app's own customers ─────────────────────────────────────────────
    'bz.title': 'Customer businesses',
    'bz.new': 'New business',
    'bz.hint': 'Your own venues are not here — they are behind “My businesses”.',
    'bz.empty': 'No businesses yet. “New business” above creates one.',
    'bz.noSections': 'No sections',
    'bz.status.open': 'Somebody has opened this',
    'bz.status.stranded': 'Nobody has opened this yet',
    'bz.created': 'Created {day} {month} {year}',
    'bz.createdRecently': 'Created recently',
    // ⚠️ THE IN-SENTENCE FORMS ARE THEIR OWN ENTRIES, not a lower-cased copy. The
    // screen used to write .replace(/^Created/, 'created'), which is English
    // grammar in the code: it does nothing in a language whose word starts
    // differently, and leaves Italian capitalised mid-line.
    'bz.created.inSentence': 'created {day} {month} {year}',
    'bz.createdRecently.inSentence': 'created recently',
    'bz.rowState': '{status} · {created}',
    'bz.newLink': 'Make a new link',
    'bz.newLink.title': 'Make a new link?',
    'bz.newLink.message': 'A new link for {name}. Any link sent before stops working, so whoever holds one cannot use it.',
    'bz.making': 'Making…',
    'bz.delete': 'Delete',
    'bz.delete.title': 'Delete this business?',
    'bz.delete.message': '{name} will be removed, along with the link that opens it. Nobody has opened it, so nothing else is lost — but this cannot be undone.',
    'bz.link.copied': 'The new link for {name} is copied. Paste it into a message to them.',
    'bz.link.once': 'It works once and has {expires}.',
    'bz.link.manual': 'Copy this link and send it to {name}:',
    'bz.err.newLink': 'Could not make a new link. Try again.',
    'bz.err.delete': 'Could not delete this business. Try again.',
    'bz.err.load': 'Could not load the businesses. Check your connection.',

    // ── Creating a business ─────────────────────────────────────────────────
    'nc.title.self': 'Add a business',
    'nc.title.customer': 'New customer',
    'nc.nameLabel': 'The business name',
    'nc.namePlaceholder': 'Panificio Rossi',
    'nc.create': 'Create',
    'nc.country': 'Which country does it sell in?',
    'nc.sections.self': 'Which sections it uses',
    'nc.sections.customer': 'What they are buying',
    'nc.explain.self': 'Creates the business in YOUR account, as owner. It opens straight away — no link, nothing to send.',
    'nc.explain.customer': 'Creates the business and a link that makes whoever opens it its owner. They choose their own email and password. You do not go in.',
    'nc.leave.title': 'Leave without sending the link?',
    'nc.leave.message': '{name} has been created, but their link is shown only here and cannot be shown again. Without it nobody can open their app.',
    'nc.leave.ok': 'Leave anyway',
    'nc.leave.stay': 'Stay',
    'nc.err.noName': 'Give the business a name.',
    'nc.err.longName': 'That name is longer than {n} characters.',
    'nc.err.noCountry': 'Choose the country this business sells in — it decides the language of its labels.',
    'nc.err.noSection': 'Choose at least one section — otherwise their app opens empty.',

    'common.loading': 'Loading…',
  }),
  it: Object.freeze({
    'role.owner': 'Titolare',
    'role.manager': 'Responsabile',
    'role.headChef': 'Chef di cucina',
    'role.staff': 'Dipendente',

    // 📌 Italian puts the word where Italian puts it, which is the entire reason
    // a phrase is one entry with a hole and not two halves joined at the call
    // site. «Rendi responsabile», not «Fai responsabile».
    'people.make': 'Rendi {role}',
    'people.add': 'Aggiungi {role}',
    'role.owner.inSentence': 'titolare',
    'role.manager.inSentence': 'responsabile',
    'role.headChef.inSentence': 'chef di cucina',
    'role.staff.inSentence': 'dipendente',

    'role.means.owner': 'Tutto, compreso aggiungere persone e decidere che ruolo hanno.',
    'role.means.manager': 'Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.headChef': 'Identico a Responsabile — cambia solo il nome del ruolo. Gestisce questo locale: può cancellare fornitori, ingredienti, ricette e prodotti. Non può aggiungere persone.',
    'role.means.staff': 'Fa il lavoro di ogni giorno — quantità, impasti, ordini. Non può cancellare niente né aggiungere persone.',

    // 📌 Italian takes no article here, which is exactly why these are four whole
    // sentences and not one template with a hole for «an» / «a» / «the».
    'people.confirm.owner': 'Rendere {name} titolare?',
    'people.confirm.manager': 'Rendere {name} responsabile?',
    'people.confirm.headChef': 'Rendere {name} chef di cucina?',
    'people.confirm.staff': 'Rendere {name} dipendente?',

    'people.joinsAs': 'Entra come {role} · {expires} · apre l’app, tocca “I have a code”, crea il suo account e digita il codice.',

    'auth.signIn.sub': 'Accedi per aprire il tuo locale.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signIn': 'Accedi',
    'auth.forgot': 'Password dimenticata?',
    'auth.iHaveACode': 'Ho un codice di accesso',
    'auth.installGuide': 'Come installare l’app',
    'auth.enterEmail': 'Inserisci la tua email.',
    'auth.enterPassword': 'Inserisci la tua password.',
    'auth.signingIn': 'Accesso in corso…',
    'auth.typeEmailFirst': 'Scrivi prima la tua email qui sopra, poi tocca qui.',
    'auth.resetSent': 'Se {address} ha un account, il link per reimpostare la password sta arrivando.',
    'auth.back': 'Indietro',
    'auth.tryAgain': 'Riprova',
    'auth.otherAccount': 'Accedi con un altro account',
    'auth.logOut': 'Esci',
    'auth.logOut.title': 'Vuoi uscire?',
    'auth.logOut.message': 'Per rientrare ti serviranno email e password.',

    // 📌 Come in inglese, una sola frase per quattro casi: dire quale metà è
    // sbagliata rivelerebbe a chi tenta la porta che quell’email esiste.
    'auth.err.badPair': 'Email e password non corrispondono a nessun account.',
    'auth.err.badEmail': 'Questo non sembra un indirizzo email.',
    'auth.err.disabled': 'Questo account è stato disattivato. Chiedi al titolare di riattivarlo.',
    'auth.err.tooMany': 'Troppi tentativi. Aspetta un minuto e riprova.',
    'auth.err.offline': 'Nessuna connessione. Il primo accesso su un dispositivo richiede internet.',
    'auth.err.emailTaken': 'Questa email ha già un account. Accedi con quella.',
    'auth.err.weakPassword': 'Scegli una password più lunga — almeno 6 caratteri.',
    'auth.err.generic': 'Accesso non riuscito. Riprova.',

    'join.title.invited': 'Sei stato invitato',
    'join.title.new': 'Entra con un codice',
    'join.title.have': 'Inserisci il codice',
    'join.sub.prefillNew': 'Il codice è già inserito. Aggiungi il tuo nome e scegli una password.',
    'join.sub.prefill': 'Il codice è già inserito. Aggiungi il tuo nome per finire.',
    'join.sub.new': 'Crea il tuo account, poi digita il codice che ti hanno dato.',
    'join.sub.have': 'Digita il codice che ti hanno dato.',
    'join.firstName': 'Il tuo nome',
    'join.lastName': 'Il tuo cognome',
    'join.email': 'La tua email',
    'join.choosePassword': 'Scegli una password (almeno {n} caratteri)',
    'join.code': 'Codice',
    'join.join': 'Entra',
    'join.signInInstead': 'Accedi con quella email',
    'join.signInAndAdd': 'Accedi, e aggiungiamo l’attività al tuo account.',
    'join.creating': 'Creazione dell’account…',
    'join.checking': 'Controllo…',
    'join.checkingCode': 'Controllo del codice…',
    'join.badCode': 'Questo codice non funziona. Chiedine uno nuovo.',
    'join.shapeHint': 'Inserisci il codice di sei cifre, oppure apri il link che ti hanno mandato.',

    'hub.where': 'Dove vuoi andare?',
    'hub.mine': 'Le mie attività',
    'hub.mine.sub': { one: 'Il locale che gestisci', other: 'I locali che gestisci' },
    'hub.customers': 'Attività dei clienti',
    'hub.customers.sub': 'Le attività che usano Misé',
    'hub.back': 'Torna a Misé',

    'picker.title': 'Scegli il locale',
    'picker.sub': 'Hai accesso a più di uno.',
    'noAccess.title': 'Nessun locale',
    'noAccess.body': 'Questo account non è collegato a nessun locale. Se ti hanno dato un codice, digitalo qui.',

    'invite.title': 'Hai aperto un invito',
    'invite.message': 'Vuoi aggiungere questa attività a {who}?',
    'invite.ok': 'Aggiungila',
    'invite.cancel': 'Non ora',

    'people.title': 'Chi può entrare',
    'people.rename': 'Rinomina',
    'people.remove': 'Rimuovi',
    'people.cancel': 'Annulla',
    'people.done': 'Fatto',
    'people.empty': 'Ancora nessun altro.',
    'people.firstName': 'Nome',
    'people.surname': 'Cognome',
    'people.noEmail': 'nessuna email',
    'people.readOut': 'Leggilo a voce a loro:',
    'people.invite.intro': 'Aggiungi qualcuno che lavora qui. Installano l’app, creano il loro account con il loro nome, e digitano il codice che gli dai.',
    'people.remove.title': 'Vuoi rimuovere questa persona?',
    'people.remove.message': '{name} ({email}) perderà subito l’accesso a questo locale. Tutto quello che ha inserito resta.',
    'people.err.read': 'Non è stato possibile leggere chi lavora qui. Controlla la connessione.',
    'people.err.name': 'Non è stato possibile salvare quel nome. Controlla la connessione.',
    'people.err.change': 'Non è stato possibile cambiarlo. Controlla la connessione e riprova.',
    'people.err.remove': 'Non è stato possibile rimuoverli. Controlla la connessione e riprova.',
    'people.err.code': 'Non è stato possibile creare un codice. Controlla la connessione e riprova.',

    'home.switch': 'Cambia locale',
    'home.switch.title': 'Vuoi cambiare locale?',
    'home.switch.ok': 'Cambia',
    'home.switch.cleared': 'Tutto quello che è stato digitato e non salvato su questo dispositivo viene cancellato.',
    'home.switch.toOne': 'Vuoi aprire {other} invece di {here}?',
    'home.switch.toMany': 'Vuoi scegliere un altro locale?',

    'section.calculator': 'Calcolatore',
    'section.orders': 'Ordini',
    'section.catalogue': 'Ricettario',
    'section.pastries': 'Paste',
    'section.foodcost': 'Food cost',
    'section.calculator.sub': 'Calcolo degli impasti per gli ordini del giorno',
    'section.orders.sub': 'Fornitori, ingredienti e l’ordine su WhatsApp',
    'section.catalogue.sub': 'Ricette, scalatura e impasto guidato',
    'section.pastries.sub': 'Le sette liste di lievitazione della settimana',
    'section.foodcost.sub': 'Prezzi, margini ed etichette',

    'bz.title': 'Attività dei clienti',
    'bz.new': 'Nuova attività',
    'bz.hint': 'I tuoi locali non sono qui — stanno dietro a “Le mie attività”.',
    'bz.empty': 'Ancora nessuna attività. “Nuova attività” qui sopra ne crea una.',
    'bz.noSections': 'Nessuna sezione',
    'bz.status.open': 'Qualcuno l’ha aperta',
    'bz.status.stranded': 'Nessuno l’ha ancora aperta',
    'bz.created': 'Creata il {day} {month} {year}',
    'bz.createdRecently': 'Creata da poco',
    'bz.created.inSentence': 'creata il {day} {month} {year}',
    'bz.createdRecently.inSentence': 'creata da poco',
    'bz.rowState': '{status} · {created}',
    'bz.newLink': 'Crea un nuovo link',
    'bz.newLink.title': 'Vuoi creare un nuovo link?',
    'bz.newLink.message': 'Un nuovo link per {name}. Ogni link mandato prima smette di funzionare, quindi chi ne ha uno non potrà usarlo.',
    'bz.making': 'Creazione…',
    'bz.delete': 'Elimina',
    'bz.delete.title': 'Vuoi eliminare questa attività?',
    'bz.delete.message': '{name} verrà rimossa, insieme al link che la apre. Nessuno l’ha aperta, quindi non si perde altro — ma questa cosa non si può annullare.',
    'bz.link.copied': 'Il nuovo link per {name} è stato copiato. Incollalo in un messaggio per loro.',
    'bz.link.once': 'Funziona una volta sola e {expires}.',
    'bz.link.manual': 'Copia questo link e mandalo a {name}:',
    'bz.err.newLink': 'Non è stato possibile creare un nuovo link. Riprova.',
    'bz.err.delete': 'Non è stato possibile eliminare questa attività. Riprova.',
    'bz.err.load': 'Non è stato possibile caricare le attività. Controlla la connessione.',

    'nc.title.self': 'Aggiungi un’attività',
    'nc.title.customer': 'Nuovo cliente',
    'nc.nameLabel': 'Il nome dell’attività',
    'nc.namePlaceholder': 'Panificio Rossi',
    'nc.create': 'Crea',
    'nc.country': 'In quale paese vende?',
    'nc.sections.self': 'Quali sezioni usa',
    'nc.sections.customer': 'Che cosa stanno comprando',
    'nc.explain.self': 'Crea l’attività NEL TUO account, come titolare. Si apre subito — nessun link, niente da mandare.',
    'nc.explain.customer': 'Crea l’attività e un link che rende titolare chi lo apre. Scelgono da soli email e password. Tu non entri.',
    'nc.leave.title': 'Vuoi uscire senza mandare il link?',
    'nc.leave.message': '{name} è stata creata, ma il suo link si vede solo qui e non può essere mostrato di nuovo. Senza, nessuno può aprire la loro app.',
    'nc.leave.ok': 'Esci comunque',
    'nc.leave.stay': 'Resta',
    'nc.err.noName': 'Dai un nome all’attività.',
    'nc.err.longName': 'Quel nome supera i {n} caratteri.',
    'nc.err.noCountry': 'Scegli il paese in cui vende questa attività — decide la lingua delle sue etichette.',
    'nc.err.noSection': 'Scegli almeno una sezione — altrimenti la loro app si apre vuota.',

    'common.loading': 'Caricamento…',
  }),
});

// ── Which language is showing ────────────────────────────────────────────────

let current = DEFAULT_LANGUAGE;

// ⚠️ AN UNKNOWN LANGUAGE FALLS BACK TO ENGLISH RATHER THAN THROWING, and that is
// the opposite direction from countryOf() in js/market.js — deliberately. There,
// a wrong answer prints a non-compliant label; here, a wrong answer shows the
// wrong words to somebody who can see they are the wrong words. An app that
// refuses to open because a stored setting is odd is worse than an app in the
// wrong language.
export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  return current;
}

export function currentLanguage() {
  return current;
}

// The language a venue's staff read, from the venue document. Separate from
// outputLanguage(location) in js/market.js, which reads `country` — the two
// fields are independent on purpose, because Federico's venues need them to
// disagree.
export function interfaceLanguage(location) {
  const value = location && location.language;
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

// ⚠️ THE SCREENS ABOVE EVERY VENUE HAVE NO SETTING TO READ, and this is what they
// use instead. Sign-in, "I have a join code" and the Misé home all happen before a
// location is open — the same reason the sign-in screen says «Mise» where every
// other screen says the venue's name. There is genuinely nothing to look up.
//
// The device's own language is the best signal available, and for the case this
// exists for it is a good one: an Italian buyer opening the app for the first time
// on an Italian phone should not be met in English.
//
// ⚠️ IT IS A GUESS, AND ONLY EVER APPLIES BEFORE SOMEBODY IS INSIDE. The venue's
// setting wins the moment a location opens, even when the two disagree — a venue
// whose staff read English stays English on an Italian phone. And neither of them
// ever reaches a label: that follows the country (js/market.js).
//
// ⚠️ IT TAKES THE TAG RATHER THAN READING `navigator`, so this file stays free of
// the DOM and every rule in it can be asserted under Node (P15). The caller passes
// navigator.language.
export function languageFromTag(tag) {
  const base = String(tag || '').toLowerCase().split('-')[0];
  return LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE;
}

// The tag to hand Intl for dates and numbers.
//
// ⚠️ IT FOLLOWS THE INTERFACE, AND SO DID THE HARDCODED 'en-GB' IT REPLACES —
// nobody chose that, it was simply the only language there was. A date is read by
// the same person reading the screen around it, so it belongs to the interface.
// 14 March and 14 marzo are the same day; nothing is decided by which is shown.
//
// ⚠️ A DATE ON A LABEL WOULD NOT COME THROUGH HERE, and there is none today. If
// one is ever added it follows the country, like every other word on a label.
export function localeTag(lang = current) {
  return lang === 'it' ? 'it-IT' : 'en-GB';
}

// ── Looking a phrase up ──────────────────────────────────────────────────────

function fill(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

function plural(entry, n, lang) {
  // Intl decides the category, so a language whose rules differ from English's
  // gets them right without anything here knowing about it.
  const rules = new Intl.PluralRules(lang === 'it' ? 'it-IT' : 'en-GB');
  const category = rules.select(n);
  return entry[category] !== undefined ? entry[category] : entry.other;
}

// ⚠️ TWO DIFFERENT FAILURES, ANSWERED TWO DIFFERENT WAYS, and telling them apart
// is what keeps a half-translated app usable AND keeps a typo findable:
//
//   the key is missing from THIS language but present in English
//     → the English phrase. A translation that has not been written yet must not
//       leave a blank on a working screen.
//
//   the key is missing from EVERY language
//     → the key itself, on screen. That is a programming mistake, not a
//       translation gap, and it must be LOUD. A silent empty string is a button
//       with no words on it that nobody notices until a customer does.
//
// ⚠️ THE LOOKUP TAKES ITS DICTIONARIES AS AN ARGUMENT, so it can be exercised
// against made-up phrases without the real ones being made writable. They are
// frozen on purpose — a screen that could edit the dictionary would be a screen
// that can change another screen's words — and loosening that to suit a test
// would be the test damaging the thing it is checking.
export function translate(dicts, lang, key, vars) {
  const entry = dicts[lang] && dicts[lang][key];
  const fallback = dicts[DEFAULT_LANGUAGE] && dicts[DEFAULT_LANGUAGE][key];
  const found = entry !== undefined ? entry : fallback;
  if (found === undefined) return key;

  const from = entry !== undefined ? lang : DEFAULT_LANGUAGE;
  const text = (typeof found === 'object' && found !== null)
    ? plural(found, vars && Number(vars.n), from)
    : found;
  return fill(text, vars);
}

export function t(key, vars) {
  return translate(DICTIONARIES, current, key, vars);
}

// Everything the dictionaries hold, for the tests that check the two languages
// carry the same keys and that no data word was translated. Not for the app.
export function _dictionaries() {
  return DICTIONARIES;
}
