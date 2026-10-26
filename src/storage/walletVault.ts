/**
 * Multi-account vault JSON in localStorage / chrome.storage.local.
 * v1 legacy: { encrypted, addressHex }
 * v2: { version: 2, activeIndex, accounts: [{ encrypted, addressHex, label?, recovery? }] }
 *
 * `recovery` is optional and only present on accounts created from (or restored with) a recovery phrase. It holds
 * the BIP-39 entropy encrypted with the same wallet password, so the phrase can be shown again after the user
 * re-enters the password. Accounts without it (every account created before recovery phrases, and any imported
 * private key) behave exactly as before. See docs/RECOVERY_PHRASE_DESIGN.md.
 */

export type RecoveryMeta = {
  v: 1;
  /** 12 or 24 words. */
  words: 12 | 24;
  /** SLIP-0010 account index used in the derivation path (0 for every account the wallet creates today). */
  account: number;
  /** AES-GCM blob (same format as `encrypted`) holding the 16- or 32-byte BIP-39 entropy. */
  encrypted: string;
};

export type VaultAccountEntry = {
  encrypted: string;
  addressHex: string;
  label?: string;
  recovery?: RecoveryMeta;
};

export type WalletVaultV2 = {
  version: 2;
  activeIndex: number;
  accounts: VaultAccountEntry[];
};

export type ParsedWalletVault = WalletVaultV2;

const V2: 2 = 2;

function normalizeAddressHex(hex: string): string {
  return hex.replace(/^0x/i, '').toLowerCase();
}

/** Keep `recovery` only when it has the exact expected shape. */
function sanitizeRecovery(x: unknown): RecoveryMeta | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const r = x as Record<string, unknown>;
  if (r.v !== 1 || (r.words !== 12 && r.words !== 24) || typeof r.encrypted !== 'string') return undefined;
  const account = typeof r.account === 'number' && Number.isInteger(r.account) && r.account >= 0 ? r.account : 0;
  return { v: 1, words: r.words, account, encrypted: r.encrypted };
}

export function entryHasRecovery(entry: VaultAccountEntry | null | undefined): boolean {
  return !!entry && sanitizeRecovery(entry.recovery) !== undefined;
}

/** True if parsed object is legacy single-wallet shape. */
export function isLegacyVaultV1(o: unknown): o is { encrypted: string; addressHex: string } {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.encrypted === 'string' &&
    typeof r.addressHex === 'string' &&
    r.version === undefined
  );
}

export function migrateVaultToV2(parsed: unknown): WalletVaultV2 {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const r = parsed as Record<string, unknown>;
    if (r.version === 2 && Array.isArray(r.accounts)) {
      const accounts = (r.accounts as unknown[]).filter(
        (a): a is VaultAccountEntry =>
          !!a &&
          typeof a === 'object' &&
          typeof (a as VaultAccountEntry).encrypted === 'string' &&
          typeof (a as VaultAccountEntry).addressHex === 'string'
      );
      let activeIndex = typeof r.activeIndex === 'number' && Number.isFinite(r.activeIndex) ? Math.floor(r.activeIndex) : 0;
      if (accounts.length === 0) {
        return { version: V2, activeIndex: 0, accounts: [] };
      }
      if (activeIndex < 0 || activeIndex >= accounts.length) activeIndex = 0;
      return {
        version: V2,
        activeIndex,
        accounts: accounts.map((a) => {
          const { recovery: rawRecovery, ...rest } = a;
          const recovery = sanitizeRecovery(rawRecovery);
          return {
            ...rest,
            addressHex: normalizeAddressHex(a.addressHex),
            ...(recovery ? { recovery } : {}),
          };
        }),
      };
    }
  }
  if (isLegacyVaultV1(parsed)) {
    return {
      version: V2,
      activeIndex: 0,
      accounts: [
        {
          encrypted: parsed.encrypted,
          addressHex: normalizeAddressHex(parsed.addressHex),
        },
      ],
    };
  }
  throw new Error('Invalid wallet vault data');
}

export function vaultToStoredJson(vault: WalletVaultV2): string {
  return JSON.stringify(vault);
}

export function parseVaultFromStoredJson(raw: string): WalletVaultV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid wallet storage');
  }
  return migrateVaultToV2(parsed);
}

export function getActiveAccountEntry(vault: WalletVaultV2): VaultAccountEntry | null {
  if (vault.accounts.length === 0) return null;
  const i = vault.activeIndex >= 0 && vault.activeIndex < vault.accounts.length ? vault.activeIndex : 0;
  return vault.accounts[i] ?? null;
}

export function getActiveAddressHex(vault: WalletVaultV2): string | null {
  const a = getActiveAccountEntry(vault);
  return a ? a.addressHex : null;
}

/** Vault with `entry` as the only account (first wallet) or appended and made active (extra account). */
export function vaultWithEntry(
  vault: WalletVaultV2 | null,
  entry: VaultAccountEntry,
  mode: 'replace' | 'append'
): WalletVaultV2 {
  const e: VaultAccountEntry = { ...entry, addressHex: normalizeAddressHex(entry.addressHex) };
  if (mode === 'replace' || !vault || vault.accounts.length === 0) {
    return { version: V2, activeIndex: 0, accounts: [e] };
  }
  return { version: V2, activeIndex: vault.accounts.length, accounts: [...vault.accounts, e] };
}
