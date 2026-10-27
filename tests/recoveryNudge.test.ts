import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_NUDGE_DISMISSED_KEY,
  RECOVERY_NUDGE_TEXT,
  dismissRecoveryNudge,
  isRecoveryNudgeDismissed,
  renderRecoveryNudge,
  shouldShowRecoveryNudge,
} from '../src/boing/recoveryNudge';
import { UPDATE_NOTE_DISMISSED_KEY, type KeyValueStore } from '../src/boing/updateNote';
import { RecoveryNudge } from '../src/components/RecoveryNudge';
import { fakeDoc, FakeNode } from './fakeDom';

function memStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}
const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error('storage blocked');
  },
  setItem: () => {
    throw new Error('storage blocked');
  },
};

describe('recovery phrase tip for private-key accounts', () => {
  it('shows by default for an account without a phrase, and never for a phrase account', () => {
    expect(shouldShowRecoveryNudge(false, memStore())).toBe(true);
    expect(shouldShowRecoveryNudge(false, null)).toBe(true);
    expect(shouldShowRecoveryNudge(true, memStore())).toBe(false);
  });
  it('stays hidden once dismissed, using its own key (separate from the update note)', () => {
    const s = memStore();
    expect(isRecoveryNudgeDismissed(s)).toBe(false);
    dismissRecoveryNudge(s);
    expect(s.data[RECOVERY_NUDGE_DISMISSED_KEY]).toBe('1');
    expect(isRecoveryNudgeDismissed(s)).toBe(true);
    expect(shouldShowRecoveryNudge(false, s)).toBe(false);
    expect(RECOVERY_NUDGE_DISMISSED_KEY).not.toBe(UPDATE_NOTE_DISMISSED_KEY);
    // Dismissing the update note does not dismiss the tip.
    expect(isRecoveryNudgeDismissed(memStore({ [UPDATE_NOTE_DISMISSED_KEY]: '9.9.9' }))).toBe(false);
  });
  it('never throws when storage is unavailable', () => {
    expect(isRecoveryNudgeDismissed(brokenStore)).toBe(false);
    expect(() => dismissRecoveryNudge(brokenStore)).not.toThrow();
    expect(() => dismissRecoveryNudge(null)).not.toThrow();
    expect(shouldShowRecoveryNudge(false, brokenStore)).toBe(true);
  });
  it('renders plain-language copy with a dismiss button that has an accessible name', () => {
    const html = renderToStaticMarkup(createElement(RecoveryNudge, { onShow: () => {}, onDismiss: () => {} }));
    expect(html).toContain('data-testid="recovery-nudge"');
    expect(html).toContain('role="note"');
    expect(html).toContain('data-testid="recovery-nudge-dismiss"');
    expect(html).toContain('aria-label="Dismiss the recovery phrase tip"');
    expect(html).toContain('stays exactly as it is');
    expect(RECOVERY_NUDGE_TEXT).not.toMatch(/mnemonic|BIP|SLIP|entropy/i);
  });
});

describe('recovery phrase tip in the extension popup (plain DOM)', () => {
  const find = (n: FakeNode, testId: string): FakeNode | undefined =>
    n.attrs.get('data-testid') === testId ? n : n.children.map((c) => find(c, testId)).find(Boolean);
  const render = (el: FakeNode, has: boolean, store: KeyValueStore | null, onShow = () => {}) =>
    renderRecoveryNudge(el as never, { hasRecoveryPhrase: has, store, onShow, doc: fakeDoc });

  it('is hidden for a phrase account and shown (with both buttons) for a private-key account', () => {
    const el = new FakeNode('p');
    el.classes.add('hidden');
    render(el, true, memStore());
    expect(el.classes.has('hidden')).toBe(true);
    expect(el.children).toHaveLength(0);
    render(el, false, memStore());
    expect(el.classes.has('hidden')).toBe(false);
    expect(el.allText).toContain('recovery phrase');
    expect(find(el, 'recovery-nudge-show')).toBeDefined();
    expect(find(el, 'recovery-nudge-dismiss')!.attrs.get('aria-label')).toBe('Dismiss the recovery phrase tip');
  });
  it('Show me how calls back; Dismiss hides it and remembers that', () => {
    const el = new FakeNode('p');
    const s = memStore();
    let shown = 0;
    render(el, false, s, () => void shown++);
    find(el, 'recovery-nudge-show')!.fire('click');
    expect(shown).toBe(1);
    find(el, 'recovery-nudge-dismiss')!.fire('click');
    expect(el.classes.has('hidden')).toBe(true);
    expect(s.data[RECOVERY_NUDGE_DISMISSED_KEY]).toBe('1');
    // A later render (e.g. after switching accounts) stays hidden.
    render(el, false, s);
    expect(el.classes.has('hidden')).toBe(true);
  });
});
