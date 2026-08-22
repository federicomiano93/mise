// allergen-match.js — read a pack's own ingredient list and PROPOSE allergens.
//
// ⚠️⚠️ IT PROPOSES. IT NEVER DECLARES. Nothing here writes `allergensCheckedAt`,
// and that is not a convention — js/allergen-model.js:123 makes ticks without a
// stamp read 'unknown' whatever they say, so a proposal is inert by construction
// and still blocks every label. A wrong suggestion costs a correction; it cannot
// become a declaration without a person pressing the verification tick.
//
// ⚠️ AND IT SHOWS ITS WORKING. Every match carries the span of the pack text it
// came from, so the screen can mark what was recognised and leave the rest grey.
// That turns the unanswerable question — «did it find everything?» — into one a
// person can actually answer: «is there anything in the grey worth checking?». An
// extractor that cannot point at its evidence cannot be checked by the person who
// is legally responsible for the answer.
//
// ⚠️ WHICH WAY IT ERRS. A MISS is worse than a false positive, so a doubtful word
// is raised as a QUESTION rather than resolved — but only just: a matcher that
// cries wolf teaches people to tap through, and then the real one goes through
// with them. Hence NEGATIVE_PHRASES, which close the traps that would otherwise
// declare milk in a dairy-free chocolate.

import { TERMS, NEGATIVE_PHRASES, REMAPS, AMBIGUOUS, TRACES_MARKERS } from './allergen-terms.js';
import { normalizeAllergens } from './allergen-model.js';

// ── Normalising, WITHOUT losing where each character came from ───────────────
//
// The map is the whole point: a match found at normalised index n has to be
// reported as a span of the text the person actually typed, accents, capitals,
// punctuation and all.
export function normaliseWithMap(text) {
  const src = String(text == null ? '' : text);
  let norm = '';
  const map = [];
  let lastWasSpace = true;      // suppresses a leading space
  for (let i = 0; i < src.length; i += 1) {
    // ⚠️ WRITTEN AS ESCAPES, NOT AS LITERAL COMBINING MARKS. A literal U+0300–U+036F
    // range in the source is invisible in every diff and every review, and one
    // mangled byte silently stops accents being stripped — so «però» would no
    // longer match «pero» and nobody would ever see why.
    const folded = src[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const ch of folded) {
      if (ch >= 'a' && ch <= 'z') { norm += ch; map.push(i); lastWasSpace = false; }
      else if (ch >= '0' && ch <= '9') { norm += ch; map.push(i); lastWasSpace = false; }
      else if (!lastWasSpace) { norm += ' '; map.push(i); lastWasSpace = true; }
    }
  }
  return { norm, map, source: src };
}

// Every occurrence of `phrase` in `norm`, as whole words.
function findAll(norm, phrase) {
  const out = [];
  if (!phrase) return out;
  const padded = ` ${norm} `;
  const needle = ` ${phrase} `;
  let at = padded.indexOf(needle);
  while (at !== -1) {
    // -1 for the pad we added at the front; the phrase starts one char in.
    out.push({ start: at, end: at + phrase.length });
    at = padded.indexOf(needle, at + 1);
  }
  return out;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// ── The one pass ─────────────────────────────────────────────────────────────
//
// Longest phrase first, always. «burro di cacao» has to be able to consume
// «burro», and «noccioline americane» has to beat «noccioline» which itself has to
// beat the hazelnut stem.
function scan(norm, map) {
  const taken = [];      // spans already claimed, so nothing shorter can re-read them
  const hits = [];       // { code, phrase, start, end }
  const questions = [];  // { phrase, could, start, end }

  const claim = (span) => {
    if (taken.some(t => overlaps(t, span))) return false;
    taken.push(span);
    return true;
  };

  // 1. The traps, first and unconditionally. A negative phrase claims its span and
  //    says nothing, so whatever sits inside it can never be read again.
  for (const phrase of [...NEGATIVE_PHRASES].sort((a, b) => b.length - a.length)) {
    for (const span of findAll(norm, phrase)) claim(span);
  }

  // 2. Phrases whose obvious stem names the WRONG allergen.
  for (const remap of [...REMAPS].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const span of findAll(norm, remap.phrase)) {
      if (!claim(span)) continue;
      if (remap.code) hits.push({ code: remap.code, phrase: remap.phrase, ...span });
    }
  }

  // 3. The vocabulary proper, longest phrase first across every code at once —
  //    «latte di mandorla» must be settled before «latte».
  const all = [];
  for (const [code, langs] of Object.entries(TERMS)) {
    for (const lang of ['en', 'it']) {
      for (const phrase of langs[lang] || []) all.push({ code, phrase });
    }
  }
  all.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { code, phrase } of all) {
    for (const span of findAll(norm, phrase)) {
      if (!claim(span)) continue;
      hits.push({ code, phrase, ...span });
    }
  }

  // 4. What it cannot answer. Raised, never resolved.
  for (const item of [...AMBIGUOUS].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const span of findAll(norm, item.phrase)) {
      if (!claim(span)) continue;
      questions.push({
        phrase: item.phrase, kind: item.kind || 'vague', could: [...item.could], ...span,
      });
    }
  }

  // Spans reported in the ORIGINAL text's coordinates.
  const place = (h) => ({
    ...h,
    from: map.length ? map[h.start] : 0,
    to: map.length ? (map[Math.min(h.end, map.length) - 1] + 1) : 0,
  });
  return { hits: hits.map(place), questions: questions.map(place) };
}

// ── Cutting composition from traces ──────────────────────────────────────────
//
// ⚠️ BEFORE ANYTHING IS MATCHED, because the two lists mean different things and
// merging them is how "may contain nuts" turns into "contains nuts" on a label.
export function splitTraces(text) {
  const { norm, map, source } = normaliseWithMap(text);
  let cut = -1;
  for (const marker of TRACES_MARKERS) {
    for (const span of findAll(norm, marker)) {
      if (cut === -1 || span.start < cut) cut = span.start;
    }
  }
  if (cut === -1) return { composition: source, traces: '' };
  const at = map.length ? map[Math.min(cut, map.length - 1)] : source.length;
  return { composition: source.slice(0, at), traces: source.slice(at) };
}

/**
 * Read a pack's ingredient list.
 *
 * Returns the two lists a person then CONFIRMS, the questions it could not answer,
 * and every span it recognised so the screen can show its working.
 */
export function readPackIngredients(text) {
  const { composition, traces } = splitTraces(text);

  const compNorm = normaliseWithMap(composition);
  const comp = scan(compNorm.norm, compNorm.map);

  const traceNorm = normaliseWithMap(traces);
  const trace = scan(traceNorm.norm, traceNorm.map);
  const traceOffset = composition.length;

  const allergens = normalizeAllergens(comp.hits.map(h => h.code));
  // ⚠️ A CODE ALREADY IN `allergens` IS NOT ALSO A TRACE. buildAllergenFields strips
  // it anyway; doing it here keeps the two proposals consistent with what will be
  // saved, so the screen never ticks a box that the save then drops.
  const mayContain = normalizeAllergens(trace.hits.map(h => h.code))
    .filter(code => !allergens.includes(code));

  return {
    allergens,
    mayContain,
    questions: [
      ...comp.questions,
      ...trace.questions.map(q => ({ ...q, from: q.from + traceOffset, to: q.to + traceOffset })),
    ],
    matches: [
      ...comp.hits.map(h => ({ code: h.code, phrase: h.phrase, from: h.from, to: h.to, traces: false })),
      ...trace.hits.map(h => ({
        code: h.code, phrase: h.phrase,
        from: h.from + traceOffset, to: h.to + traceOffset, traces: true,
      })),
    ].sort((a, b) => a.from - b.from),
    // ⚠️ EMPTY IS AN HONEST ANSWER AND MUST LOOK LIKE ONE. A pack whose words this
    // file does not know produces no ticks, and the screen has to say "I recognised
    // nothing here" rather than leaving a person to read that as "contains nothing".
    recognisedAnything: comp.hits.length + trace.hits.length + comp.questions.length
      + trace.questions.length > 0,
    hasText: String(text == null ? '' : text).trim().length > 0,
  };
}
