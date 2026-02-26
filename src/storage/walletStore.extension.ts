/**
 * Wallet persistence for the browser extension: uses chrome.storage.local.
 * Keys never leave the client; only ciphertext is stored. Call initExtensionWalletStorage()
 * before any other wallet API when running in the extension context.
 */

import { encryptPrivateKey, decryptPrivateKey } from './encrypted';
import { accountIdToHex } from '../boing/types';
import { publicKeyFromPrivate, generateKeyPair, privateKeyFromHex, privateKeyToHex } from '../crypto/keys';

const STORAGE_KEY = 'boing_wallet_enc';

export interface StoredWallet {
  encrypted: string;
  addressHex: string;
}

let cache: StoredWallet | null = null;
let cacheLoaded = false;

type ChromeStorageLocal = {
  get: (keys: string[], cb: (r: Record<string, string | undefined>) => void) => void;
  set: (obj: Record<string, string>, cb?: () => void) => void;
  remove: (key: string) => void;
};

/** Access chrome.storage.local in extension context; undefined in web. */
function getChromeStorage(): ChromeStorageLocal | undefined {
  const g = typeof globalThis !== 'undefined' ? (globalThis as unknown as { chrome?: { storage?: { local?: ChromeStorageLocal } } }) : null;
  return g?.chrome?.storage?.local;
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
        cache = raw ? (JSON.parse(raw) as StoredWallet) : null;
      } catch {
        cache = null;
      }
      cacheLoaded = true;
      resolve();
    });
  });
}

export function hasStoredWallet(): boolean {
  if (!cacheLoaded) return false;
  return cache !== null;
}

export function getStoredWallet(): StoredWallet | null {
  return cache;
}

export async function saveWallet(encrypted: string, addressHex: string): Promise<void> {
  const w: StoredWallet = { encrypted, addressHex };
  cache = w;
  const storage = getChromeStorage();
  if (storage) {
    return new Promise((resolve) => {
      storage.set({ [STORAGE_KEY]: JSON.stringify(w) }, resolve);
    });
  }
}

export function clearWallet(): void {
  cache = null;
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
  await saveWallet(encrypted, addressHex);
  return { addressHex, privateKeyHex };
}

export async function importAndSaveWallet(password: string, privateKeyHex: string): Promise<string> {
  const privateKey = privateKeyFromHex(privateKeyHex);
  const publicKey = await publicKeyFromPrivate(privateKey);
  const addressHex = accountIdToHex(publicKey);
  const encrypted = await encryptPrivateKey(privateKey, password);
  await saveWallet(encrypted, addressHex);
  return addressHex;
}
