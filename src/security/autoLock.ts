/** Extension auto-lock policy (the web app has its own in `src/storage/lockSettings.ts`). */

export const AUTO_LOCK_OPTIONS = [0, 5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const STORAGE_KEY_AUTO_LOCK_MINUTES = 'boing_auto_lock_minutes';

export function normalizeAutoLockMinutes(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && (AUTO_LOCK_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_AUTO_LOCK_MINUTES;
}

/** 0 minutes means "never auto-lock". */
export function isSessionExpired(lastActivityAt: number, now: number, minutes: number): boolean {
  if (minutes <= 0) return false;
  if (!Number.isFinite(lastActivityAt)) return true;
  return now - lastActivityAt >= minutes * 60_000;
}

export function autoLockLabel(minutes: number): string {
  if (minutes <= 0) return 'Never';
  if (minutes === 60) return '1 hour';
  return `${minutes} minutes`;
}