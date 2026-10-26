/**
 * Recovery-phrase accounts: build a vault entry from a phrase, and read the phrase back after a password check.
 * Storage-agnostic (web localStorage and extension chrome.storage both call these).
 */
import { accountIdToHex } from '../boing/types';
import { decryptBytes, encryptBytes, encryptPrivateKey } from './encrypted';
import {
  entropyToMnemonic,
  keyPairFromRecoveryPhrase,
  mnemonicToEntropy,
  parseRecoveryPhrase,
} from '../crypto/recoveryPhrase';
import type { RecoveryMeta, VaultAccountEntry, WalletVaultV2 } from './walletVault';

export class PhraseAccountError extends Error {}

/** Vault entry (private key + encrypted entropy) for a phrase at SLIP-0010 account index 0. */
export async function buildPhraseEntry(
  phrase: string,
  password: string,
  vault: WalletVaultV2 | null
): Promise<{ entry: VaultAccountEntry; addressHex: string }> {
  const canonical = parseRecoveryPhrase(phrase);
  const account = 0;
  const [publicKey, privateKey] = await keyPairFromRecoveryPhrase(canonical, account);
  const entropy = mnemonicToEntropy(canonical);
  try {
    const addressHex = accountIdToHex(publicKey).toLowerCase();
    const bare = addressHex.replace(/^0x/, '');
    if (vault?.accounts.some((a) => a.addressHex.replace(/^0x/i, '').toLowerCase() === bare)) {
      throw new PhraseAccountError('This account is already in your wallet.');
    }
    const encrypted = await encryptPrivateKey(privateKey, password);
    const recovery: RecoveryMeta = {
      v: 1,
      words: entropy.length === 16 ? 12 : 24,
      account,
      encrypted: await encryptBytes(entropy, password),
    };
    return { entry: { encrypted, addressHex: bare, recovery }, addressHex };
  } finally {
    privateKey.fill(0);
    entropy.fill(0);
  }
}

/**
 * Decrypt the phrase of `entry` with the wallet password. Throws PhraseAccountError with a plain message when
 * the account has no phrase, the password is wrong, or the stored data does not match the account address.
 */
export async function readEntryPhrase(entry: VaultAccountEntry | null, password: string): Promise<string> {
  if (!entry?.recovery) throw new PhraseAccountError('This account has no recovery phrase.');
  let entropy: Uint8Array;
  try {
    entropy = await decryptBytes(entry.recovery.encrypted, password);
  } catch {
    throw new PhraseAccountError('Incorrect password.');
  }
  try {
    if (entropy.length !== 16 && entropy.length !== 32) {
      throw new PhraseAccountError('The saved recovery phrase could not be read.');
    }
    const phrase = entropyToMnemonic(entropy);
    const [publicKey, privateKey] = await keyPairFromRecoveryPhrase(phrase, entry.recovery.account);
    privateKey.fill(0);
    const addr = accountIdToHex(publicKey).replace(/^0x/i, '').toLowerCase();
    if (addr !== entry.addressHex.replace(/^0x/i, '').toLowerCase()) {
      throw new PhraseAccountError('The saved recovery phrase does not match this account.');
    }
    return phrase;
  } finally {
    entropy.fill(0);
  }
}
