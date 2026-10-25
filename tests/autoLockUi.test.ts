import { describe, expect, it } from 'vitest';
import { AUTO_LOCK_OPTIONS, DEFAULT_AUTO_LOCK_MINUTES, isSessionExpired } from '../src/security/autoLock';
import { bindAutoLockSelect } from '../src/security/autoLockUi';
import { fakeDoc, FakeNode } from './fakeDom';

describe('popup auto-lock UI', () => {
  it('lists every policy option with a readable label and selects the stored value', () => {
    const sel = new FakeNode('select');
    bindAutoLockSelect(fakeDoc, sel as never, 30, () => {});
    expect(sel.children.map((o) => o.value)).toEqual(AUTO_LOCK_OPTIONS.map(String));
    expect(sel.children.map((o) => o.textContent)).toEqual(['Never', '5 minutes', '15 minutes', '30 minutes', '1 hour']);
    expect(sel.value).toBe('30');
  });

  it('reports the chosen value on change (to be persisted by the popup)', () => {
    const sel = new FakeNode('select');
    const seen: number[] = [];
    bindAutoLockSelect(fakeDoc, sel as never, 15, (m) => seen.push(m));
    sel.value = '5';
    sel.fire('change');
    sel.value = '0';
    sel.fire('change');
    expect(seen).toEqual([5, 0]);
  });

  it('falls back to the default for a tampered value', () => {
    const sel = new FakeNode('select');
    const seen: number[] = [];
    bindAutoLockSelect(fakeDoc, sel as never, 15, (m) => seen.push(m));
    sel.value = '999999';
    sel.fire('change');
    expect(seen).toEqual([DEFAULT_AUTO_LOCK_MINUTES]);
  });

  it('idle lock rule used by the popup timer: locks at the limit, never when set to Never', () => {
    const t0 = 1_000_000;
    expect(isSessionExpired(t0, t0 + 5 * 60_000 - 1, 5)).toBe(false);
    expect(isSessionExpired(t0, t0 + 5 * 60_000, 5)).toBe(true);
    expect(isSessionExpired(t0, t0 + 24 * 3_600_000, 0)).toBe(false);
  });
});