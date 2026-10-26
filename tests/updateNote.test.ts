import { describe, expect, it } from 'vitest';
import { evaluateNodeHealth, type NodeCompatIssue, type NodeCompatStatus } from '../src/boing/nodeCompat';
import {
  UPDATE_NOTE_DISMISSED_KEY,
  dismissUpdateNote,
  isUpdateNoteDismissed,
  renderCompatBanner,
  visibleCompatIssues,
  visibleUpdateNote,
  type KeyValueStore,
} from '../src/boing/updateNote';
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

const note = (version = '0.2.0'): NodeCompatIssue => ({
  code: 'wallet_update_available',
  level: 'info',
  message: `Boing Express ${version} is available (you have 0.1.22).`,
  version,
});
const tooOld: NodeCompatIssue = { code: 'wallet_too_old', level: 'warn', message: 'This network asks for Boing Express 0.3.0 or newer.' };
const unreachable: NodeCompatIssue = { code: 'unreachable', level: 'warn', message: 'Could not reach the node.' };
const status = (issues: NodeCompatIssue[], level: NodeCompatStatus['level'] = 'ok') => ({ level, issues });

describe('update note dismissal (per recommended version)', () => {
  it('is not dismissed by default or when storage is unavailable', () => {
    expect(isUpdateNoteDismissed(memStore(), '0.2.0')).toBe(false);
    expect(isUpdateNoteDismissed(null, '0.2.0')).toBe(false);
    expect(isUpdateNoteDismissed(brokenStore, '0.2.0')).toBe(false);
  });

  it('dismissing hides the same version, and any older recommendation', () => {
    const s = memStore();
    dismissUpdateNote(s, '0.2.0');
    expect(s.data[UPDATE_NOTE_DISMISSED_KEY]).toBe('0.2.0');
    expect(isUpdateNoteDismissed(s, '0.2.0')).toBe(true);
    expect(isUpdateNoteDismissed(s, 'v0.2.0')).toBe(true);
    expect(isUpdateNoteDismissed(s, '0.1.30')).toBe(true);
  });

  it('a newer recommendation shows the note again', () => {
    const s = memStore();
    dismissUpdateNote(s, '0.2.0');
    expect(isUpdateNoteDismissed(s, '0.2.1')).toBe(false);
    expect(isUpdateNoteDismissed(s, '1.0.0')).toBe(false);
  });

  it('never lowers a stored newer version, and ignores a corrupt stored value', () => {
    const s = memStore();
    dismissUpdateNote(s, '0.3.0');
    dismissUpdateNote(s, '0.2.0');
    expect(s.data[UPDATE_NOTE_DISMISSED_KEY]).toBe('0.3.0');
    const corrupt = memStore({ [UPDATE_NOTE_DISMISSED_KEY]: 'soon' });
    expect(isUpdateNoteDismissed(corrupt, '0.2.0')).toBe(false);
    dismissUpdateNote(corrupt, '0.2.0');
    expect(corrupt.data[UPDATE_NOTE_DISMISSED_KEY]).toBe('0.2.0');
  });

  it('dismissing with a broken store does not throw', () => {
    expect(() => dismissUpdateNote(brokenStore, '0.2.0')).not.toThrow();
  });
});

describe('visibleCompatIssues', () => {
  it('drops unreachable always, and the update note only once dismissed', () => {
    const s = memStore();
    expect(visibleCompatIssues([unreachable, note(), tooOld], s).map((i) => i.code)).toEqual(['wallet_update_available', 'wallet_too_old']);
    dismissUpdateNote(s, '0.2.0');
    expect(visibleCompatIssues([unreachable, note(), tooOld], s).map((i) => i.code)).toEqual(['wallet_too_old']);
  });

  it('a minimum-version warning can never be dismissed', () => {
    const s = memStore();
    dismissUpdateNote(s, '99.0.0');
    expect(visibleCompatIssues([tooOld], s)).toHaveLength(1);
  });

  it('an update note without a version cannot be dismissed (nothing to key it on)', () => {
    const s = memStore({ [UPDATE_NOTE_DISMISSED_KEY]: '99.0.0' });
    const bare = { ...note(), version: undefined };
    expect(visibleCompatIssues([bare], s)).toHaveLength(1);
    expect(visibleUpdateNote([bare])).toBeUndefined();
  });
});

describe('evaluateNodeHealth carries the dismissal key', () => {
  it('sets version on the update note to the recommended wallet version', () => {
    const health = {
      ok: true,
      chain_id: 6913,
      client_version: 'boing-node/0.1.0',
      tx_signing: { chain_id: 6913, v2_supported: true },
      client_hints: { min_wallet_version: '0.1.15', recommended_wallet_version: '0.2.0' },
    };
    const s = evaluateNodeHealth(health, { chainId: 6913 }, 1, { version: '0.1.22' });
    expect(s.level).toBe('ok');
    const n = s.issues.find((i) => i.code === 'wallet_update_available');
    expect(n?.version).toBe('0.2.0');
  });
});

const textOf = (n: FakeNode) => n.allText;
const findButton = (n: FakeNode): FakeNode | undefined =>
  n.tag === 'button' ? n : n.children.map(findButton).find(Boolean);

describe('renderCompatBanner (popup)', () => {
  it('shows the note with a labelled Dismiss button; clicking hides the banner and remembers it', () => {
    const banner = new FakeNode('p');
    banner.classes.add('hidden');
    const s = memStore();
    renderCompatBanner(banner as never, status([note()]), s, fakeDoc);
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(banner.classList.contains('hint')).toBe(true);
    expect(textOf(banner)).toContain('Boing Express 0.2.0 is available');
    const btn = findButton(banner)!;
    expect(btn.textContent).toBe('Dismiss');
    expect(btn.attrs.get('type')).toBe('button');
    expect(btn.attrs.get('data-testid')).toBe('compat-dismiss-update');
    expect(btn.attrs.get('aria-label')).toBe('Dismiss the update note for Boing Express 0.2.0');
    btn.fire('click');
    expect(banner.classList.contains('hidden')).toBe(true);
    expect(banner.children).toHaveLength(0);
    expect(s.data[UPDATE_NOTE_DISMISSED_KEY]).toBe('0.2.0');
    // A later render with the same recommendation stays hidden; a newer one comes back.
    renderCompatBanner(banner as never, status([note()]), s, fakeDoc);
    expect(banner.classList.contains('hidden')).toBe(true);
    renderCompatBanner(banner as never, status([note('0.2.1')]), s, fakeDoc);
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(textOf(banner)).toContain('0.2.1');
  });

  it('dismissing the note keeps a co-occurring warning visible (and its level)', () => {
    const banner = new FakeNode('p');
    const s = memStore();
    renderCompatBanner(banner as never, status([tooOld, note()], 'warn'), s, fakeDoc);
    findButton(banner)!.fire('click');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(textOf(banner)).toContain('asks for Boing Express 0.3.0');
    expect(textOf(banner)).not.toContain('is available');
    expect(findButton(banner)).toBeUndefined();
  });

  it('warnings and errors have no Dismiss button, and an error keeps its error class', () => {
    const banner = new FakeNode('p');
    renderCompatBanner(banner as never, status([tooOld], 'warn'), memStore(), fakeDoc);
    expect(findButton(banner)).toBeUndefined();
    const err: NodeCompatIssue = { code: 'chain_mismatch', level: 'error', message: 'Wrong network' };
    renderCompatBanner(banner as never, status([err], 'error'), memStore(), fakeDoc);
    expect(banner.classList.contains('error')).toBe(true);
    expect(banner.classList.contains('hint')).toBe(false);
    expect(findButton(banner)).toBeUndefined();
  });

  it('with blocked storage the note still shows and dismissing just hides it for this render', () => {
    const banner = new FakeNode('p');
    expect(() => renderCompatBanner(banner as never, status([note()]), brokenStore, fakeDoc)).not.toThrow();
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(() => findButton(banner)!.fire('click')).not.toThrow();
  });

  it('hides when there is nothing to show', () => {
    const banner = new FakeNode('p');
    renderCompatBanner(banner as never, status([unreachable], 'warn'), memStore(), fakeDoc);
    expect(banner.classList.contains('hidden')).toBe(true);
  });
});