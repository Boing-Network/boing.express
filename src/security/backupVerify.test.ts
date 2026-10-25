import { describe, expect, it } from 'vitest';
import { backupConfirmSuffix, isBackupConfirmed } from './backupVerify';

const KEY = 'ab'.repeat(31) + '12cd3F';

describe('backupVerify', () => {
  it('uses the last 6 hex characters, lower-cased', () => {
    expect(backupConfirmSuffix(KEY)).toBe('12cd3f');
    expect(backupConfirmSuffix('0x' + KEY)).toBe('12cd3f');
  });
  it('accepts the suffix regardless of case or spacing, and rejects anything else', () => {
    expect(isBackupConfirmed(KEY, '12CD3F')).toBe(true);
    expect(isBackupConfirmed(KEY, ' 12cd 3f ')).toBe(true);
    expect(isBackupConfirmed(KEY, '12cd3e')).toBe(false);
    expect(isBackupConfirmed(KEY, '')).toBe(false);
    expect(isBackupConfirmed('', '')).toBe(false);
  });
});