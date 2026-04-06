/**
 * Wallet persistence for the browser extension: uses chrome.storage.local.
 * Keys never leave the client; only ciphertext is stored. Call initExtensionWalletStorage()
 * before any other wallet API when running in the extension context.
 */

import { encryptPrivateKey, decryptPrivateKey } from './encrypted';
import { accountIdToHex } from '../boing/types';
import { publicKeyFromPrivate, generateKeyPair, privateKeyFromHex, privateKeyToHex } from '../crypto/keys';
import {
  type WalletVaultV2,
  type VaultAccountEntry,
  vaultToStoredJson,
  parseVaultFromStoredJson,
  getActiveAccountEntry,
  isLegacyVaultV1,
} from './walletVault';

const STORAGE_KEY = 'boing_wallet_enc';

export interface StoredWallet {
  encrypted: string;
  addressHex: string;
}

let cacheVault: WalletVaultV2 | null = null;
let cacheLoaded = false;

type ChromeStorageLocal = {
  get: (keys: string[], cb: (r: Record<string, string | undefined>) => void) => void;
  set: (obj: Record<string, string>, cb?: () => void) => void;
  remove: (key: string) => void;
};

function getChromeStorage(): ChromeStorageLocal | undefined {
  const g =
    typeof globalThis !== 'undefined' ? (globalThis as unknown as { chrome?: { storage?: { local?: ChromeStorageLocal } } }) : null;
  return g?.chrome?.storage?.local;
}

async function persistVault(vault: WalletVaultV2): Promise<void> {
  cacheVault = vault;
  const storage = getChromeStorage();
  if (storage) {
    await new Promise<void>((resolve) => {
      storage.set({ [STORAGE_KEY]: vaultToStoredJson(vault) }, resolve);
    });
  }
}

/** Must be called once when the popup opens so getStoredWallet/hasStoredWallet work. */
export function initExtensionWalletStorage(): Promise<void> {
  const storage = getChromeStorage();
  if (!storage) {
    cacheLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    storage.get([STORAGE_KEY], (result: Record<string, string | undefined>) => {
      try {
        const raw = result[STORAGE_KEY];
        if (!raw) {
          cacheVault = null;
        } else {
          const parsed: unknown = JSON.parse(raw) as unknown;
          const needsPersistMigration = isLegacyVaultV1(parsed);
          const v = parseVaultFromStoredJson(raw);
          cacheVault = v.accounts.length > 0 ? v : null;
          if (needsPersistMigration && cacheVault) {
            storage.set({ [STORAGE_KEY]: vaultToStoredJson(cacheVault) }, () => undefined);
          }
        }
      } catch {
        cacheVault = null;
      }
      cacheLoaded = true;
      resolve();
    });
  });
}

export function hasStoredWallet(): boolean {
  if (!cacheLoaded) return false;
  return cacheVault !== null && cacheVault.accounts.length > 0;
}

/** Active account only (backward-compatible shape for unlock/decrypt). */
export function getStoredWallet(): StoredWallet | null {
  if (!cacheVault) return null;
  const a = getActiveAccountEntry(cacheVault);
  if (!a) return null;
  return { encrypted: a.encrypted, addressHex: a.addressHex };
}

export function listAccountSummaries(): { index: number; addressHex: string; label?: string }[] {
  if (!cacheVault) return [];
  return cacheVault.accounts.map((acc, index) => ({
    index,
    addressHex: acc.addressHex,
    label: acc.label,
  }));
}

export function getActiveAccountIndex(): number {
  if (!cacheVault || cacheVault.accounts.length === 0) return 0;
  const i = cacheVault.activeIndex;
  return i >= 0 && i < cacheVault.accounts.length ? i : 0;
}

export async function setActiveAccountIndex(index: number): Promise<void> {
  if (!cacheVault || cacheVault.accounts.length === 0) return;
  if (index < 0 || index >= cacheVault.accounts.length) return;
  const next: WalletVaultV2 = { ...cacheVault, activeIndex: index };
  await persistVault(next);
}

/** Replace the vault with a single account (initial create/import from the choose screen). */
export async function saveWallet(encrypted: string, addressHex: string): Promise<void> {
  const entry: VaultAccountEntry = { encrypted, addressHex: addressHex.replace(/^0x/i, '').toLowerCase() };
  await persistVault({ version: 2, activeIndex: 0, accounts: [entry] });
}

/** Replace entire vault (internal / tests). */
export async function saveVault(vault: WalletVaultV2): Promise<void> {
  await persistVault(vault.accounts.length > 0 ? vault : { version: 2, activeIndex: 0, accounts: [] });
}

export function clearWallet(): void {
  cacheVault = null;
  const storage = getChromeStorage();
  if (storage) storage.remove(STORAGE_KEY);
}

export async function unlockWallet(password: string): Promise<[Uint8Array, Uint8Array]> {
  const w = getStoredWallet();
  if (!w) throw new Error('No wallet found');
  const privateKey = await decryptPrivateKey(w.encrypted, password);
  const publicKey = await publicKeyFromPrivate(privateKey);
  return [publicKey, privateKey];
}

export async function createAndSaveWallet(password: string): Promise<{ addressHex: string; privateKeyHex: string }> {
  const [publicKey, privateKey] = await generateKeyPair();
  const encrypted = await encryptPrivateKey(privateKey, password);
  const addressHex = accountIdToHex(publicKey);
  const privateKeyHex = privateKeyToHex(privateKey);
  await persistVault({
    version: 2,
    activeIndex: 0,
    accounts: [{ encrypted, addressHex: addressHex.toLowerCase() }],
  });
  return { addressHex, privateKeyHex };
}

export async function importAndSaveWallet(password: string, privateKeyHex: string): Promise<string> {
  const privateKey = privateKeyFromHex(privateKeyHex);
  const publicKey = await publicKeyFromPrivate(privateKey);
  const addressHex = accountIdToHex(publicKey);
  const encrypted = await encryptPrivateKey(privateKey, password);
  await persistVault({
    version: 2,
    activeIndex: 0,
    accounts: [{ encrypted, addressHex: addressHex.toLowerCase() }],
  });
  return addressHex;
}

/** Append a new account from an existing encrypted wallet file flow — first wallet uses create/import as today. */
export async function importAdditionalAccount(password: string, privateKeyHex: string): Promise<string> {
  if (!cacheVault || cacheVault.accounts.length === 0) {
    return importAndSaveWallet(password, privateKeyHex);
  }
  const privateKey = privateKeyFromHex(privateKeyHex);
  const publicKey = await publicKeyFromPrivate(privateKey);
  const addressHex = accountIdToHex(publicKey);
  const encrypted = await encryptPrivateKey(privateKey, password);
  const newIndex = cacheVault.accounts.length;
  const next: WalletVaultV2 = {
    version: 2,
    activeIndex: newIndex,
    accounts: [...cacheVault.accounts, { encrypted, addressHex }],
  };
  await persistVault(next);
  return addressHex;
}

export async function createAdditionalAccount(password: string): Promise<{ addressHex: string; privateKeyHex: string }> {
  if (!cacheVault || cacheVault.accounts.length === 0) {
    return createAndSaveWallet(password);
  }
  const [publicKey, privateKey] = await generateKeyPair();
  const encrypted = await encryptPrivateKey(privateKey, password);
  const addressHex = accountIdToHex(publicKey);
  const privateKeyHex = privateKeyToHex(privateKey);
  const newIndex = cacheVault.accounts.length;
  const next: WalletVaultV2 = {
    version: 2,
    activeIndex: newIndex,
    accounts: [...cacheVault.accounts, { encrypted, addressHex }],
  };
  await persistVault(next);
  return { addressHex, privateKeyHex };
}

export async function removeAccountAtIndex(index: number): Promise<void> {
  if (!cacheVault || cacheVault.accounts.length <= 1) {
    clearWallet();
    return;
  }
  const accounts = cacheVault.accounts.filter((_, i) => i !== index);
  let activeIndex = cacheVault.activeIndex;
  if (index === activeIndex) {
    activeIndex = Math.min(index, accounts.length - 1);
  } else if (index < activeIndex) {
    activeIndex -= 1;
  }
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
  await persistVault({ version: 2, activeIndex, accounts });
}
