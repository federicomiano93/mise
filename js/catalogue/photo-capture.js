// photo-capture.js — photograph a recipe, and have it typed in for you.
//
// Federico, 22 Aug 2026. Loading a recipe means typing every line by hand, and a
// recipe book has hundreds. So: take the photographs, the reader turns them into a
// draft, and the ORDINARY recipe editor opens with the draft in it.
//
// ⚠️⚠️ NOTHING HERE EVER SAVES ANYTHING. A machine reading handwriting is sometimes
// confidently wrong, and 100 g read as 1000 g looks exactly like a number somebody
// typed. Every value goes to the editor as a working copy and waits for the same
// Save, and the same "Save these changes?", as a recipe typed by hand.
//
// ⚠️ IT IS THE ONLY SCREEN IN THIS APP THAT CANNOT WORK OFFLINE. Everything else is
// local-first; this one needs a reader that lives somewhere else. So it says so
// plainly, and it never blames the connection for anything but a missing one.

import { t, onLanguageChange } from '../i18n.js';
import { el } from './dom.js';
import {
  MAX_EDGE, JPEG_QUALITY, FALLBACK_QUALITY, MAX_PHOTOS, MAX_IMAGE_BYTES,
  fitWithin, base64Of, mediaTypeOf, approxBytes, payloadProblem,
  photoErrorKey, noRecipeKey,
} from './photo-model.js';
import { readRecipePhotos } from './firebase-photo.js';

const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const BIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

// Turn one chosen file into the one string that is BOTH the thumbnail and the
// payload.
//
// ⚠️ createImageBitmap, NOT FileReader, AND `imageOrientation` IS THE LINE THAT
// MUST NOT BE LOST. A phone held upright writes an EXIF rotation flag into the
// file instead of rotating the pixels; the historical default here is to ignore
// it. Ignored, the reader is handed a photograph lying on its side and answers
// with confident nonsense — and NOTHING reports an error, because nothing has
// gone wrong as far as any code can tell.
//
// It also takes the File directly, so no blob: URL is ever made — which matters,
// because the app's Content-Security-Policy allows `img-src 'self' data:` and
// nothing else — and it holds one downscaled copy rather than the original as
// well.
async function shrink(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // ⚠️ ALMOST ALWAYS HEIC, off an iPhone, picked from the library rather than
    // taken with the camera. Android cannot decode it at all. There is no fallback
    // path on purpose: a second decoder that works on one platform is a defect
    // that exists only on the other.
    throw new Error('undecodable');
  }
  const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  if (!w || !h) { bitmap.close(); throw new Error('undecodable'); }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  // ⚠️ Quality drops before SIZE does. A softer photograph of handwriting is still
  // readable; a smaller one is not.
  if (approxBytes(base64Of(dataUrl)) > MAX_IMAGE_BYTES) {
    dataUrl = canvas.toDataURL('image/jpeg', FALLBACK_QUALITY);
  }
  return dataUrl;
}

export function renderPhotoCapture({ app, locationId, onDraft }) {
  // The working set. Each entry is { dataUrl } — one string, used twice.
  const photos = [];
  let busy = false;

  const root = el('div', { class: 'cat-view cat-photo' });

  // ⚠️ EVERY PHRASE IS SET IN paint(), NEVER ONCE AT BUILD TIME, and that is not
  // tidiness. The interface language comes from the VENUE and arrives a moment AFTER
  // the page has drawn itself — so a string written once, here, is frozen in
  // whatever language the app started in. catalogue-main.js redraws on a language
  // change only from its LIST view, deliberately (redrawing over an open editor
  // would throw away what somebody typed), so this screen answers for itself. It
  // can: paint() rebuilds from `photos`, so nothing is lost.
  const lead = el('p', { class: 'cat-photo-lead' });
  const note = el('p', { class: 'cat-photo-note' });

  const strip = el('div', { class: 'cat-photo-strip' });
  const status = el('p', { class: 'cat-photo-status', role: 'status' });

  const input = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    capture: 'environment',
    multiple: 'multiple',
    class: 'cat-photo-input',
    'aria-hidden': 'true',
    tabindex: '-1',
  });

  const addBtn = el('button', {
    class: 'cat-import-btn cat-photo-add', type: 'button',
    icon: CAMERA_ICON,
    onclick: () => { if (!busy) input.click(); },
  }, [el('span', { class: 'cat-photo-add-label' })]);

  const readBtn = el('button', {
    class: 'cat-save-btn cat-photo-read', type: 'button',
    onclick: () => read(),
  });

  function setStatus(key, kind = 'info') {
    status.textContent = key ? t(key) : '';
    status.className = `cat-photo-status cat-photo-status--${kind}`;
  }

  function paint() {
    lead.textContent = t('cat.photo.lead');
    note.textContent = t('cat.photo.note');
    strip.replaceChildren();
    photos.forEach((photo, index) => {
      strip.appendChild(el('div', { class: 'cat-photo-thumb' }, [
        el('img', { src: photo.dataUrl, alt: t('cat.photo.thumbAlt') }),
        el('button', {
          class: 'cat-photo-remove', type: 'button',
          'aria-label': t('cat.photo.remove'),
          icon: BIN_ICON,
          onclick: () => { if (!busy) { photos.splice(index, 1); paint(); } },
        }),
      ]));
    });
    strip.hidden = photos.length === 0;

    addBtn.querySelector('.cat-photo-add-label').textContent =
      photos.length ? t('cat.photo.addAnother') : t('cat.photo.take');
    addBtn.disabled = busy || photos.length >= MAX_PHOTOS;

    readBtn.textContent = busy ? t('cat.photo.reading') : t('cat.photo.read');
    readBtn.disabled = busy || photos.length === 0;
    readBtn.hidden = photos.length === 0;
  }

  input.addEventListener('change', async () => {
    const chosen = Array.from(input.files || []);
    // The picker is reset immediately so choosing the SAME file twice still fires.
    input.value = '';
    if (!chosen.length) return;

    const room = MAX_PHOTOS - photos.length;
    if (chosen.length > room) setStatus('cat.photo.err.tooMany', 'bad');
    else setStatus('');

    for (const file of chosen.slice(0, room)) {
      try {
        photos.push({ dataUrl: await shrink(file) });
      } catch (err) {
        setStatus(photoErrorKey(err.message === 'undecodable'
          ? { details: { key: 'undecodable' } } : err), 'bad');
      }
    }
    paint();
  });

  async function read() {
    if (busy || !photos.length) return;

    const images = photos.map(p => ({ mediaType: mediaTypeOf(p.dataUrl), data: base64Of(p.dataUrl) }));
    // Checked here as well as on the server, so somebody on a slow connection is
    // told in an instant rather than after a two-megabyte upload.
    const local = payloadProblem(images);
    if (local) { setStatus(photoErrorKey({ details: { key: local } }), 'bad'); return; }

    // ⚠️ Asked BEFORE the call, because `unavailable` from a callable is also what
    // a broken function looks like — and this is the one case where "check your
    // connection" is the truth rather than a wrong guess.
    if (navigator.onLine === false) {
      setStatus('cat.photo.err.offline', 'bad');
      return;
    }

    busy = true;
    // ⚠️ THE MARKER THE UPDATE GATE WATCHES. A compulsory update reloading the page
    // now would throw away a read that has already been paid for. It goes on only
    // while the call is in flight, which is the rule js/update-gate.js states.
    root.classList.add('cat-photo-busy');
    setStatus('cat.photo.working', 'busy');
    paint();

    try {
      const answer = await readRecipePhotos(locationId, images);
      if (!answer || !answer.ok) {
        // ⚠️ NOT A FAILURE. The call worked; there was no recipe to find. Saying
        // "something went wrong" here is what teaches somebody to stop believing
        // the app when it does work.
        setStatus(noRecipeKey(answer && answer.reason), 'bad');
        return;
      }
      onDraft(answer.recipe, answer.notes);
    } catch (err) {
      setStatus(photoErrorKey(err), 'bad');
    } finally {
      busy = false;
      root.classList.remove('cat-photo-busy');
      paint();
    }
  }

  // ⚠️ AND THE SAME FOR A LANGUAGE THAT ARRIVES WHILE THIS SCREEN IS OPEN.
  // `root.isConnected` is the guard: swap() in catalogue-main.js replaces the
  // screen's children with no teardown hook, so a listener registered here outlives
  // the view. Repainting a detached node is harmless but pointless.
  onLanguageChange(() => { if (root.isConnected) paint(); });

  paint();
  root.append(lead, strip, status, addBtn, readBtn, input, note);
  return { root };
}
