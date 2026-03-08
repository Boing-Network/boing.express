/**
 * Lock-after-inactivity setting. Stored in localStorage.
 * 0 = never auto-lock; otherwise minutes of inactivity before locking.
 */

const STORAGE_KEY = 'boing_lock_after_minutes';

export type LockAfterMinutes = 0 | 5 | 15 | 30;

const VALID_VALUES: LockAfterMinutes[] = [0, 5, 15, 30];

export function getLockAfterMinutes(): LockAfterMinutes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 15;
    const n = parseInt(raw, 10);
    return VALID_VALUES.includes(n as LockAfterMinutes) ? (n as LockAfterMinutes) : 15;
  } catch {
    return 15;
  }
}

export function setLockAfterMinutes(value: LockAfterMinutes): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore
  }
}

export function getLockAfterLabel(value: LockAfterMinutes): string {
  if (value === 0) return 'Never';
  return `${value} min`;
}
