/**
 * Gentle, dismissible nudge for accounts that were set up with a raw private key (no recovery phrase).
 *
 * Stored like the update note: one localStorage flag (popup and web app); a failing or missing store just
 * means "not dismissed". Dismissing hides it for good. It never blocks anything and never touches the vault.
 */
import type { KeyValueStore } from './updateNote';

export const RECOVERY_NUDGE_DISMISSED_KEY = 'boing_recovery_nudge_dismissed';

export const RECOVERY_NUDGE_TITLE = 'Want an easier backup?';
export const RECOVERY_NUDGE_TEXT =
  'This account is backed up with a private key. You can also add a new account that uses a 12 or 24 word recovery phrase, which is easier to write down and restore. Your current account stays exactly as it is.';
export const RECOVERY_NUDGE_ACTION_LABEL = 'Show me how';
export const RECOVERY_NUDGE_DISMISS_LABEL = 'Dismiss the recovery phrase tip';

export function isRecoveryNudgeDismissed(store: Pick<KeyValueStore, 'getItem'> | null | undefined): boolean {
  try {
    return store?.getItem(RECOVERY_NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissRecoveryNudge(store: KeyValueStore | null | undefined): void {
  try {
    store?.setItem(RECOVERY_NUDGE_DISMISSED_KEY, '1');
  } catch {
    /* storage blocked: the tip may show again next time, which is harmless */
  }
}

/** Show only for an unlocked account that has no recovery phrase and whose tip was not dismissed. */
export function shouldShowRecoveryNudge(
  hasRecoveryPhrase: boolean,
  store: Pick<KeyValueStore, 'getItem'> | null | undefined
): boolean {
  return !hasRecoveryPhrase && !isRecoveryNudgeDismissed(store);
}

type NudgeEl = Pick<HTMLElement, 'classList' | 'replaceChildren' | 'append' | 'setAttribute'>;

/** Plain-DOM version of the tip for the extension popup (the web app uses the React RecoveryNudge component). */
export function renderRecoveryNudge(
  el: NudgeEl,
  opts: {
    hasRecoveryPhrase: boolean;
    store: KeyValueStore | null | undefined;
    onShow: () => void;
    doc: Pick<Document, 'createElement'>;
  }
): void {
  const { hasRecoveryPhrase, store, onShow, doc } = opts;
  el.replaceChildren();
  if (!shouldShowRecoveryNudge(hasRecoveryPhrase, store)) {
    el.classList.add('hidden');
    return;
  }
  const text = doc.createElement('span');
  const title = doc.createElement('strong');
  title.textContent = RECOVERY_NUDGE_TITLE;
  text.append(title, ` ${RECOVERY_NUDGE_TEXT}`);
  const mk = (testId: string, label: string, aria?: string) => {
    const b = doc.createElement('button');
    b.setAttribute('type', 'button');
    b.setAttribute('class', 'compat-dismiss');
    b.setAttribute('data-testid', testId);
    if (aria) b.setAttribute('aria-label', aria);
    b.textContent = label;
    return b;
  };
  const show = mk('recovery-nudge-show', RECOVERY_NUDGE_ACTION_LABEL);
  show.addEventListener('click', onShow);
  const dismiss = mk('recovery-nudge-dismiss', 'Dismiss', RECOVERY_NUDGE_DISMISS_LABEL);
  dismiss.addEventListener('click', () => {
    dismissRecoveryNudge(store);
    renderRecoveryNudge(el, opts);
  });
  el.append(text, ' ', show, ' ', dismiss);
  el.classList.remove('hidden');
}
