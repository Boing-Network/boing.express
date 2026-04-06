/**
 * Wallet persistence: encrypted keys in localStorage, session state.
 * Keys never leave the client; only ciphertext is stored.
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

function readVault(): WalletVaultV2 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw) as unknown;
    const needsMigration = isLegacyVaultV1(parsed);
    const v = parseVaultFromStoredJson(raw);
    if (v.accounts.length === 0) return null;
    if (needsMigration) {
      localStorage.setItem(STORAGE_KEY, vaultToStoredJson(v));
    }
    return v;
  } catch {
    return null;
  }
}

function writeVault(vault: WalletVaultV2): void {
  if (vault.accounts.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, vaultToStoredJson(vault));
}

export function hasStoredWallet(): boolean {
  const v = readVault();
  return v !== null && v.accounts.length > 0;
}

export function getStoredWallet(): StoredWallet | null {
  const v = readVault();
  if (!v) return null;
  const a = getActiveAccountEntry(v);
  if (!a) return null;
  return { encrypted: a.encrypted, addressHex: a.addressHex };
}

export function listAccountSummaries(): { index: number; addressHex: string; label?: string }[] {
  const v = readVault();
  if (!v) return [];
  return v.accounts.map((acc, index) => ({
    index,
    addressHex: acc.addressHex,
    label: acc.label,
  }));
}

export function getActiveAccountIndex(): number {
  const v = readVault();
  if (!v || v.accounts.length === 0) return 0;
  const i = v.activeIndex;
  return i >= 0 && i < v.accounts.length ? i : 0;
}

export function setActiveAccountIndex(index: number): void {
  const v = readVault();
  if (!v || v.accounts.length === 0) return;
  if (index < 0 || index >= v.accounts.length) return;
  writeVault({ ...v, activeIndex: index });
}

export function saveWallet(encrypted: string, addressHex: string): void {
  const entry: VaultAccountEntry = { encrypted, addressHex: addressHex.replace(/^0x/i, '').toLowerCase() };
  writeVault({ version: 2, activeIndex: 0, accounts: [entry] });
}

export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
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
  writeVault({
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
  writeVault({
    version: 2,
    activeIndex: 0,
    accounts: [{ encrypted, addressHex: addressHex.toLowerCase() }],
  });
  return addressHex;
}

export async function importAdditionalAccount(password: string, privateKeyHex: string): Promise<string> {
  const v = readVault();
  if (!v || v.accounts.length === 0) {
    return importAndSaveWallet(password, privateKeyHex);
  }
  const privateKey = privateKeyFromHex(privateKeyHex);
  const publicKey = await publicKeyFromPrivate(privateKey);
  const addressHex = accountIdToHex(publicKey);
  const encrypted = await encryptPrivateKey(privateKey, password);
  const newIndex = v.accounts.length;
  writeVault({
    version: 2,
    activeIndex: newIndex,
    accounts: [...v.accounts, { encrypted, addressHex: addressHex.toLowerCase() }],
  });
  return addressHex;
}

export async function createAdditionalAccount(password: string): Promise<{ addressHex: string; privateKeyHex: string }> {
  const v = readVault();
  if (!v || v.accounts.length === 0) {
    return createAndSaveWallet(password);
  }
  const [publicKey, privateKey] = await generateKeyPair();
  const encrypted = await encryptPrivateKey(privateKey, password);
  const addressHex = accountIdToHex(publicKey);
  const privateKeyHex = privateKeyToHex(privateKey);
  const newIndex = v.accounts.length;
  writeVault({
    version: 2,
    activeIndex: newIndex,
    accounts: [...v.accounts, { encrypted, addressHex: addressHex.toLowerCase() }],
  });
  return { addressHex, privateKeyHex };
}

export function removeAccountAtIndex(index: number): void {
  const v = readVault();
  if (!v || v.accounts.length <= 1) {
    clearWallet();
    return;
  }
  const accounts = v.accounts.filter((_, i) => i !== index);
  let activeIndex = v.activeIndex;
  if (index === activeIndex) {
    activeIndex = Math.min(index, accounts.length - 1);
  } else if (index < activeIndex) {
    activeIndex -= 1;
  }
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
  writeVault({ version: 2, activeIndex, accounts });
}
