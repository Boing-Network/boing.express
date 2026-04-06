/**
 * Multi-account vault JSON in localStorage / chrome.storage.local.
 * v1 legacy: { encrypted, addressHex }
 * v2: { version: 2, activeIndex, accounts: [{ encrypted, addressHex, label? }] }
 */

export type VaultAccountEntry = {
  encrypted: string;
  addressHex: string;
  label?: string;
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
        accounts: accounts.map((a) => ({
          ...a,
          addressHex: normalizeAddressHex(a.addressHex),
        })),
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
