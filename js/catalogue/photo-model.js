// photo-model.js — the pure half of "read a recipe from a photograph": how big a
// photo may be, and what to say when it does not work. No DOM, no Firebase.
//
// The rest of the feature is js/catalogue/photo-capture.js (the screen and the
// canvas), js/catalogue/firebase-photo.js (the one call) and, on the server,
// functions/recipe-photo-model.js (every judgement about what the photo said).

// ⚠️ 1568px IS NOT A ROUND NUMBER PICKED FOR TIDINESS. The reader downsamples
// anything larger than this before looking at it, so a bigger photo costs upload
// time and payload budget and is read no better. Below it, handwriting starts to
// go. It is the one size that is both cheapest and clearest.
export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.82;
// A second, lower pass for a photo that is still too heavy. ⚠️ Quality drops
// before SIZE does: a smaller picture of handwriting is unreadable, a slightly
// softer one is not.
export const FALLBACK_QUALITY = 0.7;

export const MAX_PHOTOS = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

// The dimensions to draw at: never larger than maxEdge, never UPSCALED, always
// whole pixels, aspect ratio kept.
export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// The payload half of a `data:image/jpeg;base64,…` URL. Returns '' for anything
// that is not one, so a caller cannot accidentally send a whole data URL as if it
// were base64 — the server would reject it and nobody would know why.
export function base64Of(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const at = dataUrl.indexOf(';base64,');
  if (at < 0 || !dataUrl.startsWith('data:image/')) return '';
  return dataUrl.slice(at + ';base64,'.length);
}

export function mediaTypeOf(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return '';
  const at = dataUrl.indexOf(';');
  return at < 0 ? '' : dataUrl.slice('data:'.length, at);
}

export function approxBytes(base64) {
  return typeof base64 === 'string' ? Math.floor(base64.length * 3 / 4) : 0;
}

// ⚠️ THE SAME GUARD THE SERVER RUNS, ON PURPOSE. The server's copy is the one that
// is enforced; this one exists so somebody on a slow connection is told in an
// instant instead of after a two-megabyte upload. Returns a CODE, never a
// sentence — the phrase is chosen by the screen, in the reader's own language.
export function payloadProblem(images) {
  if (!Array.isArray(images) || images.length === 0) return 'no-images';
  if (images.length > MAX_PHOTOS) return 'too-many-images';
  let total = 0;
  for (const image of images) {
    const bytes = approxBytes(image && image.data);
    if (!bytes) return 'bad-image';
    if (bytes > MAX_IMAGE_BYTES) return 'image-too-large';
    total += bytes;
  }
  return total > MAX_TOTAL_BYTES ? 'images-too-large' : null;
}

// ── What went wrong, as an i18n KEY ──────────────────────────────────────────
//
// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL. A t() resolved here would run at
// module load — before a venue is open, so before the interface language is even
// known — and freeze in whatever language the app started in. Fourteen constants
// in this app did exactly that and rendered English for weeks with every
// translation correctly in place (tests/frozen-phrases.test.mjs).
const BY_KEY = {
  'signed-out': 'cat.photo.err.signedOut',
  'no-location': 'cat.photo.err.failed',
  'no-images': 'cat.photo.err.noImages',
  'too-many-images': 'cat.photo.err.tooMany',
  'image-too-large': 'cat.photo.err.tooLarge',
  'images-too-large': 'cat.photo.err.tooLarge',
  'bad-image': 'cat.photo.err.badImage',
  'not-allowed': 'cat.photo.err.notAllowed',
  'person-limit': 'cat.photo.err.personLimit',
  'venue-limit': 'cat.photo.err.venueLimit',
  'photo-off': 'cat.photo.err.photoOff',
  'read-failed': 'cat.photo.err.failed',
  // Not errors at all — the call worked and the answer was "nothing I can use".
  // They are here so one lookup covers both, and the screen treats them alike.
  'nothing-readable': 'cat.photo.err.nothingFound',
  refused: 'cat.photo.err.refused',
  truncated: 'cat.photo.err.tooLong',
  'no-tool': 'cat.photo.err.nothingFound',
  // Raised on the phone, before anything is sent.
  undecodable: 'cat.photo.err.badFormat',
  offline: 'cat.photo.err.offline',
};

// ⚠️ ONLY ONE ANSWER MAY MENTION THE CONNECTION, and it is the one where there
// genuinely is not one. This project has already learnt that the hard way: telling
// somebody with full signal to check their connection sends them to fix the one
// thing that is working (js/client-orders/order-main.js). A refusal, a daily limit
// and an unreadable photograph are all decisions, and each says so.
export function photoErrorKey(err) {
  const key = err && err.details && typeof err.details.key === 'string' ? err.details.key : '';
  if (BY_KEY[key]) return BY_KEY[key];

  const code = err && typeof err.code === 'string' ? err.code : '';
  // Firebase prefixes a callable's code with 'functions/'.
  const bare = code.replace(/^functions\//, '');
  if (bare === 'unauthenticated') return BY_KEY['signed-out'];
  if (bare === 'permission-denied') return BY_KEY['not-allowed'];
  if (bare === 'resource-exhausted') return BY_KEY['person-limit'];
  // 'unavailable' is what a callable reports when it could not be reached at all,
  // and 'deadline-exceeded' when the phone gave up waiting.
  if (bare === 'unavailable') return BY_KEY.offline;
  if (bare === 'deadline-exceeded') return 'cat.photo.err.tooSlow';
  return BY_KEY['read-failed'];
}

// The key for an answer that arrived and carried no recipe.
export function noRecipeKey(reason) {
  return BY_KEY[reason] || BY_KEY['nothing-readable'];
}
