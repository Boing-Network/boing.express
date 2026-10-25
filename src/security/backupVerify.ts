/** Backup check: the user re-types the last characters of their key to prove they actually saved it. */

export const BACKUP_CONFIRM_LENGTH = 6;

export function backupConfirmSuffix(keyHex: string): string {
  return keyHex.trim().replace(/^0x/i, '').slice(-BACKUP_CONFIRM_LENGTH).toLowerCase();
}

export function isBackupConfirmed(keyHex: string, typed: string): boolean {
  if (!keyHex) return false;
  const want = backupConfirmSuffix(keyHex);
  const got = typed.trim().toLowerCase().replace(/\s+/g, '');
  return want.length === BACKUP_CONFIRM_LENGTH && got === want;
}