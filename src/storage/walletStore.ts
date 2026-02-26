/**
 * Wallet persistence: encrypted key in localStorage, session state.
 * Keys never leave the client; only ciphertext is stored.
 */

import { encryptPrivateKey, decryptPrivateKey } from './encrypted';
import { accountIdToHex } from '../boing/types';
import { publicKeyFromPrivate, generateKeyPair, privateKeyFromHex, privateKeyToHex } from '../crypto/keys';

const STORAGE_KEY = 'boing_wallet_enc';

export interface StoredWallet {
  encrypted: string;
  addressHex: string; // so we can show "last used address" before unlock
}

export function hasStoredWallet(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    JSON.parse(raw) as StoredWallet;
    return true;
  } catch {
    return false;
  }
}

export function getStoredWallet(): StoredWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredWallet;
  } catch {
    return null;
  }
}

export function saveWallet(encrypted: string, addressHex: string): void {
  const w: StoredWallet = { encrypted, addressHex };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
}

export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Unlock: decrypt and return [publicKey 32b, privateKey 32b] or throw. */
export async function unlockWallet(password: string): Promise<[Uint8Array, Uint8Array]> {
  const w = getStoredWallet();
  if (!w) throw new Error('No wallet found');
  const privateKey = await decryptPrivateKey(w.encrypted, password);
  const publicKey = await publicKeyFromPrivate(privateKey);
  return [publicKey, privateKey];
}

/** Create new wallet: generate keypair, encrypt with password, save. Returns address and private key hex for backup. */
export async function createAndSaveWallet(password: string): Promise<{ addressHex: string; privateKeyHex: string }> {
  const [publicKey, privateKey] = await generateKeyPair();
  const encrypted = await encryptPrivateKey(privateKey, password);
  const addressHex = accountIdToHex(publicKey);
  const privateKeyHex = privateKeyToHex(privateKey);
  saveWallet(encrypted, addressHex);
  return { addressHex, privateKeyHex };
}

/** Import from hex private key (64 hex chars), encrypt and save. */
export async function importAndSaveWallet(password: string, privateKeyHex: string): Promise<string> {
  const privateKey = privateKeyFromHex(privateKeyHex);
  const publicKey = await publicKeyFromPrivate(privateKey);
  const addressHex = accountIdToHex(publicKey);
  const encrypted = await encryptPrivateKey(privateKey, password);
  saveWallet(encrypted, addressHex);
  return addressHex;
}
