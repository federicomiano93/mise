// guided-editor.js — writing a recipe's mixing procedure.
//
// Follows the app's editing pattern exactly (P20): a working COPY, an explicit
// confirm-gated Save, a guard against leaving with unsaved edits. Nothing here
// touches the stored recipe until Save is tapped.
//
// ⚠️ IT SAVES THE INGREDIENTS TOO, and that is not scope creep. A step points at
// a row by its `rid`, and a recipe written before this feature existed has rows
// with no id at all — so the ids have to be minted and STORED alongside the steps
// that reference them. Saving the steps without them would store a procedure
// pointing at nothing. The labels, amounts and units are copied through untouched;
// only the ids are added.

import { el } from './dom.js';
import { unitOf } from './catalogue-model.js';
import {
  withRowIds, ridOf, normalizeSteps, normalizeSeconds, unassignedRows,
  MAX_STEPS, MAX_STEP_TEXT, MAX_SPEED_TEXT, formatDuration,
} from './guided-model.js';

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
const UP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const DOWN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

const clampInt = (value, max) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

export function renderGuidedEditor({ recipe, app }) {
  // The working copy. Row ids are minted HERE, into the copy, so every checkbox
  // below has something stable to name — and they only ever reach the database if
  // Save is tapped.
  const ingredients = withRowIds(recipe.ingredients).map(i => ({ ...i, unit: unitOf(i) }));
  const steps = normalizeSteps(recipe.steps).map(s => ({ ...s, rows: s.rows.slice() }));

  let dirty = false;
  let busy = false;
  const markDirty = () => { dirty = true; };

  const list = el('div', { class: 'guided-edit-list' });
  const missedBox = el('div', { class: 'guided-edit-missed' });

  // ── The warning that makes the whole feature safe to trust ──────────────────
  //
  // ⚠️ SHOWN WHILE WRITING, not only when running. Somebody following a procedure
  // trusts it completely, so an ingredient that appears in no step is one that
  // never goes in the bowl. It is a WARNING and not a block on purpose: a recipe
  // can legitimately hold a row the mixing does not use — flour for dusting, a
  // glaze — and refusing to save would teach people to work around it.
  function paintMissed() {
    const missed = unassignedRows({ ingredients, steps });
    missedBox.replaceChildren();
    if (!steps.length) {
      missedBox.appendChild(el('p', { class: 'guided-edit-hint', text:
        'Add the first step. Each one can carry ingredients, a timer, and a mixer speed.' }));
      return;
    }
    if (!missed.length) {
      missedBox.appendChild(el('p', { class: 'guided-edit-ok', text: 'Every ingredient is in a step.' }));
      return;
    }
    missedBox.appendChild(el('p', { class: 'guided-edit-warn', text:
      `Not in any step yet: ${missed.map(r => r.label).join(', ')}` }));
    missedBox.appendChild(el('p', { class: 'guided-edit-hint', text:
      'Whoever follows this will not be told to add them. It is fine if that is on purpose.' }));
  }

  // ── One step ────────────────────────────────────────────────────────────────

  function stepCard(step, i) {
    const textInput = el('input', {
      class: 'guided-edit-text', type: 'text', maxlength: String(MAX_STEP_TEXT),
      value: step.text, placeholder: 'What to do — e.g. Add the flour and the water',
      'aria-label': `Step ${i + 1} instruction`,
      oninput: (e) => { step.text = e.target.value; markDirty(); },
    });

    // The ingredients of this step, as tick boxes over the recipe's own rows.
    // Ticking rather than typing is the point: a name typed here would be a COPY
    // of the recipe, free to drift from it and to carry its own typo.
    const picks = el('div', { class: 'guided-edit-picks' });
    for (const row of ingredients) {
      const rid = ridOf(row);
      const label = String(row.label || '').trim();
      if (!rid || !label) continue;
      const box = el('input', {
        type: 'checkbox', class: 'guided-edit-check',
        onchange: (e) => {
          if (e.target.checked) { if (!step.rows.includes(rid)) step.rows.push(rid); }
          else step.rows = step.rows.filter(x => x !== rid);
          markDirty();
          paintMissed();
        },
      });
      if (step.rows.includes(rid)) box.checked = true;
      picks.appendChild(el('label', { class: 'guided-edit-pick' }, [
        box,
        el('span', { class: 'guided-edit-pick-name', text: label }),
        el('span', { class: 'guided-edit-pick-amt', text: `${nf.format(Number(row.grams) || 0)} ${unitOf(row)}` }),
      ]));
    }

    // Minutes and seconds as two boxes rather than one "how long" field: 4:30 is
    // how a mixing time is said, and a single box invites 4.5 — which is four and
    // a half of something nobody has named.
    const mins = el('input', {
      class: 'guided-edit-num', type: 'number', min: '0', max: '720', step: '1', inputmode: 'numeric',
      value: step.seconds ? String(Math.floor(step.seconds / 60)) : '', placeholder: '0',
      'aria-label': `Step ${i + 1} minutes`,
      oninput: (e) => { setTime(step, e.target.value, secs.value); markDirty(); },
    });
    const secs = el('input', {
      class: 'guided-edit-num', type: 'number', min: '0', max: '59', step: '1', inputmode: 'numeric',
      value: step.seconds % 60 ? String(step.seconds % 60) : '', placeholder: '0',
      'aria-label': `Step ${i + 1} seconds`,
      oninput: (e) => { setTime(step, mins.value, e.target.value); markDirty(); },
    });

    const speed = el('input', {
      class: 'guided-edit-speed', type: 'text', maxlength: String(MAX_SPEED_TEXT),
      value: step.speed, placeholder: 'e.g. 1',
      'aria-label': `Step ${i + 1} speed`,
      oninput: (e) => { step.speed = e.target.value; markDirty(); },
    });

    return el('div', { class: 'guided-edit-card' }, [
      el('div', { class: 'guided-edit-head' }, [
        el('span', { class: 'guided-edit-n', text: `Step ${i + 1}` }),
        el('button', {
          class: 'cat-del-icon', type: 'button', icon: UP_SVG,
          'aria-label': `Move step ${i + 1} up`, disabled: i === 0 ? 'disabled' : null,
          onclick: () => move(i, -1),
        }),
        el('button', {
          class: 'cat-del-icon', type: 'button', icon: DOWN_SVG,
          'aria-label': `Move step ${i + 1} down`, disabled: i === steps.length - 1 ? 'disabled' : null,
          onclick: () => move(i, 1),
        }),
        el('button', {
          class: 'cat-del-icon', type: 'button', icon: TRASH_SVG,
          'aria-label': `Remove step ${i + 1}`, onclick: () => remove(i),
        }),
      ]),
      textInput,
      picks.childNodes.length ? el('div', { class: 'guided-edit-field' }, [
        el('span', { class: 'guided-edit-lbl', text: 'Ingredients to add' }), picks,
      ]) : null,
      el('div', { class: 'guided-edit-field' }, [
        el('span', { class: 'guided-edit-lbl', text: 'Timer' }),
        el('div', { class: 'guided-edit-time' }, [
          mins, el('span', { class: 'guided-edit-unit', text: 'min' }),
          secs, el('span', { class: 'guided-edit-unit', text: 'sec' }),
        ]),
      ]),
      el('div', { class: 'guided-edit-field' }, [
        el('span', { class: 'guided-edit-lbl', text: 'Mixer speed' }), speed,
      ]),
    ]);
  }

  function setTime(step, minutes, seconds) {
    step.seconds = normalizeSeconds(clampInt(minutes, 720) * 60 + clampInt(seconds, 59));
  }

  function move(i, by) {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    markDirty();
    paint();
  }

  async function remove(i) {
    if (busy) return;
    busy = true;
    const ok = await app.confirm({
      title: 'Remove this step?', message: `Step ${i + 1} will be removed from the procedure.`,
      okLabel: 'Remove', danger: true,
    });
    busy = false;
    if (!ok) return;
    steps.splice(i, 1);
    markDirty();
    paint();
  }

  function add() {
    if (steps.length >= MAX_STEPS) {
      app.toast(`A procedure can hold ${MAX_STEPS} steps.`);
      return;
    }
    steps.push({ text: '', rows: [], seconds: 0, speed: '' });
    markDirty();
    paint();
    // Put the cursor in the step just added, so adding several in a row is typing
    // rather than typing-then-hunting.
    const inputs = list.querySelectorAll('.guided-edit-text');
    const last = inputs[inputs.length - 1];
    if (last) try { last.focus(); } catch (e) {}
  }

  function paint() {
    list.replaceChildren(...steps.map(stepCard));
    paintMissed();
    summary.textContent = steps.length
      ? `${steps.length} step${steps.length === 1 ? '' : 's'} · ${formatDuration(steps.reduce((s, x) => s + x.seconds, 0))} of timers`
      : 'No steps yet';
  }

  const summary = el('p', { class: 'guided-edit-summary' });

  async function onSave() {
    if (busy) return;
    busy = true;
    const clean = normalizeSteps(steps);
    const ok = await app.confirm({
      title: 'Save the procedure?',
      message: clean.length
        ? `Save ${clean.length} step${clean.length === 1 ? '' : 's'} for "${recipe.name}"?`
        : `"${recipe.name}" will have no guided procedure.`,
      okLabel: 'Save',
    });
    if (!ok) { busy = false; return; }
    dirty = false;
    // Ingredients go with it — see the note at the top of the file. Everything the
    // recipe carries is spread through, so nothing this editor does not know about
    // is dropped.
    app.saveRecipe({ ...recipe, ingredients, steps: clean });
    app.toast('Procedure saved.');
    app.openDetail({ ...recipe, ingredients, steps: clean });
    busy = false;
  }

  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({
      title: 'Discard changes?',
      message: 'The steps you have written have not been saved.',
      okLabel: 'Discard', danger: true,
    });
  });

  paint();

  return el('div', { class: 'cat-view guided-edit' }, [
    el('div', { class: 'guided-edit-top' }, [summary, missedBox]),
    list,
    el('button', { class: 'cat-add-row', type: 'button', text: '+ Add step', onclick: add }),
    el('div', { class: 'cat-editor-actions' }, [
      el('button', { class: 'cat-save-btn', type: 'button', text: 'Save', onclick: onSave }),
    ]),
  ]);
}
