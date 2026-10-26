/**
 * "Update available" advisory: dismiss for this version.
 *
 * The note (`wallet_update_available`, info level) is advisory only. The user can dismiss it; the dismissal is
 * remembered per **recommended version**: it stays hidden until the network recommends a newer wallet than the one
 * dismissed, then it shows again. It never affects `min_wallet_version` warnings (`wallet_too_old`) or errors, which
 * cannot be dismissed. Storage is localStorage (popup and web app); a failing store just means "not dismissed".
 */
import { compareSemver, type NodeCompatIssue, type NodeCompatStatus } from './nodeCompat';

export const UPDATE_NOTE_DISMISSED_KEY = 'boing_update_note_dismissed_version';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True when the note for `recommended` was dismissed, i.e. the stored version is the same or newer. */
export function isUpdateNoteDismissed(store: Pick<KeyValueStore, 'getItem'> | null | undefined, recommended: string): boolean {
  try {
    const stored = store?.getItem(UPDATE_NOTE_DISMISSED_KEY);
    if (!stored) return false;
    const c = compareSemver(stored, recommended);
    return c === 0 || c === 1;
  } catch {
    return false;
  }
}

/** Remember the dismissal. Never lowers an already stored (newer) version. */
export function dismissUpdateNote(store: KeyValueStore | null | undefined, recommended: string): void {
  try {
    const stored = store?.getItem(UPDATE_NOTE_DISMISSED_KEY);
    if (stored && compareSemver(stored, recommended) === 1) return;
    store?.setItem(UPDATE_NOTE_DISMISSED_KEY, recommended);
  } catch {
    /* storage unavailable: the note simply shows again next time */
  }
}

/** Issues to show in the banner: drops `unreachable` (already reported by the balance error) and a dismissed update note. */
export function visibleCompatIssues(
  issues: readonly NodeCompatIssue[],
  store: Pick<KeyValueStore, 'getItem'> | null | undefined
): NodeCompatIssue[] {
  return issues.filter((i) => {
    if (i.code === 'unreachable') return false;
    if (i.code === 'wallet_update_available' && i.version && isUpdateNoteDismissed(store, i.version)) return false;
    return true;
  });
}

/** The visible update note, when there is one (the banner then offers a Dismiss button). */
export function visibleUpdateNote(issues: readonly NodeCompatIssue[]): NodeCompatIssue | undefined {
  return issues.find((i) => i.code === 'wallet_update_available' && !!i.version);
}

export function updateNoteDismissLabel(version: string): string {
  return `Dismiss the update note for Boing Express ${version}`;
}

type El = Pick<HTMLElement, 'textContent' | 'classList' | 'replaceChildren' | 'append' | 'setAttribute' | 'addEventListener'>;

/**
 * Render the node-compat banner (popup). Hidden when nothing is left to show. The Dismiss button only appears while the
 * update note is visible and hides just that note: other issues in the same banner stay.
 */
export function renderCompatBanner(
  banner: El,
  status: Pick<NodeCompatStatus, 'level' | 'issues'>,
  store: KeyValueStore | null | undefined,
  doc: Pick<Document, 'createElement'>
): void {
  const issues = visibleCompatIssues(status.issues, store);
  banner.replaceChildren();
  if (issues.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  const text = doc.createElement('span');
  text.textContent = issues.map((i) => i.message).join(' ');
  banner.append(text);
  const note = visibleUpdateNote(issues);
  if (note?.version) {
    const version = note.version;
    const btn = doc.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('class', 'compat-dismiss');
    btn.setAttribute('data-testid', 'compat-dismiss-update');
    btn.setAttribute('aria-label', updateNoteDismissLabel(version));
    btn.textContent = 'Dismiss';
    btn.addEventListener('click', () => {
      dismissUpdateNote(store, version);
      renderCompatBanner(banner, status, store, doc);
    });
    banner.append(' ', btn);
  }
  banner.classList.toggle('error', status.level === 'error');
  banner.classList.toggle('hint', status.level !== 'error');
  banner.classList.remove('hidden');
}