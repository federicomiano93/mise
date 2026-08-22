// calculator-confirm.js — one shared "unsaved changes" guard.
//
// Every editor (clients & products, recipes, market) asks the EXACT same
// question when the user tries to leave mid-edit, so the experience is
// consistent. The dialog offers Discard / Cancel:
//   Discard → leave and lose the changes
//   Cancel  → keep editing
//
// ASYNC: callers must `await confirmDiscard(...)`. An un-awaited call would
// treat the pending Promise as truthy and silently skip the guard.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';

export const UNSAVED_MESSAGE =
  t('calc.youHaveUnsavedChanges');

// Resolves true when it is safe to leave the editor now: either nothing was
// changed, or the user confirmed they want to discard their edits.
export async function confirmDiscard(dirty) {
  return !dirty || confirmDialog({ message: UNSAVED_MESSAGE, okLabel: t('ui.discard'), danger: true, cancelLabel: t('ui.cancel') });
}
