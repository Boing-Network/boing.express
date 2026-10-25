import { describe, expect, it } from 'vitest';
import { autoLockLabel, DEFAULT_AUTO_LOCK_MINUTES, isSessionExpired, normalizeAutoLockMinutes } from './autoLock';

describe('autoLock', () => {
  it('normalizes unknown values to the default', () => {
    expect(normalizeAutoLockMinutes(undefined)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(normalizeAutoLockMinutes('7')).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(normalizeAutoLockMinutes('30')).toBe(30);
    expect(normalizeAutoLockMinutes(0)).toBe(0);
  });
  it('expires after the idle window; 0 never expires', () => {
    expect(isSessionExpired(0, 14 * 60_000, 15)).toBe(false);
    expect(isSessionExpired(0, 15 * 60_000, 15)).toBe(true);
    expect(isSessionExpired(0, 10 ** 12, 0)).toBe(false);
    expect(isSessionExpired(NaN, 1, 15)).toBe(true);
  });
  it('labels options', () => {
    expect(autoLockLabel(0)).toBe('Never');
    expect(autoLockLabel(60)).toBe('1 hour');
    expect(autoLockLabel(5)).toBe('5 minutes');
  });
});