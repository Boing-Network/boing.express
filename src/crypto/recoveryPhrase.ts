/**
 * Boing Express recovery phrase: BIP-39 (English) + SLIP-0010 ed25519.
 *
 *   phrase --PBKDF2-HMAC-SHA512 (BIP-39, empty passphrase)--> 64-byte seed
 *          --SLIP-0010 ed25519 at BOING_PATH--> 32-byte Ed25519 private seed --> Boing account
 *
 * Boing accounts are plain Ed25519 keys (the 32-byte public key is the address), so a derived private seed
 * works exactly like an imported private key. The derivation path is deliberately independent of the chain id,
 * so testnet (6913) and mainnet (6914) restore the same account from the same phrase.
 *
 * See docs/RECOVERY_PHRASE_DESIGN.md for the decision record.
 */
import { publicKeyFromPrivate } from './keys';
import {
  type MnemonicWordCount,
  IMPORT_WORD_COUNTS,
  MnemonicError,
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  normalizeMnemonic,
  normalizeMnemonicWords,
} from './bip39';
import { slip10DeriveEd25519 } from './slip10';

export { MnemonicError, generateMnemonic, normalizeMnemonic, normalizeMnemonicWords, entropyToMnemonic, mnemonicToEntropy };
export type { MnemonicWordCount };

/**
 * SLIP-0044 has no registered coin type for Boing. 0x424F494E is ASCII "BOIN" (1112492366, below 2^31) and is
 * not in the SLIP-0044 registry. It is a wallet-defined constant, NOT a chain id and NOT a registered coin type.
 * Changing it would change every derived account, so treat it as frozen.
 */
export const BOING_COIN_TYPE = 0x424f494e;

/** m/44'/1112492366'/<account>'/0'/0' (hardened throughout, as SLIP-0010 requires for ed25519). */
export function boingDerivationPath(account = 0): string {
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) {
    throw new RangeError('Account index out of range');
  }
  return `m/44'/${BOING_COIN_TYPE}'/${account}'/0'/0'`;
}

export const NEW_PHRASE_WORDS: MnemonicWordCount = 24;

/** A new 24-word phrase from crypto.getRandomValues. */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(NEW_PHRASE_WORDS);
}

/**
 * Check a typed phrase for import. Returns the canonical (single-space, lowercase) phrase, or throws a
 * MnemonicError with a plain-language message that never names a specific word.
 */
export function parseRecoveryPhrase(input: string): string {
  const words = normalizeMnemonicWords(input);
  if (!IMPORT_WORD_COUNTS.includes(words.length)) {
    throw new MnemonicError('A recovery phrase has 12 or 24 words.');
  }
  const entropy = mnemonicToEntropy(words.join(' ')); // throws MnemonicError on bad word / checksum
  entropy.fill(0);
  return words.join(' ');
}

/** Derive the 32-byte Ed25519 private seed for `account` (caller must zero it after use). */
export function privateKeyFromRecoveryPhrase(phrase: string, account = 0): Uint8Array {
  const canonical = parseRecoveryPhrase(phrase);
  const seed = mnemonicToSeed(canonical, '');
  try {
    return slip10DeriveEd25519(seed, boingDerivationPath(account)).key;
  } finally {
    seed.fill(0);
  }
}

/** [publicKey, privateKey] for the phrase at `account`. */
export async function keyPairFromRecoveryPhrase(phrase: string, account = 0): Promise<[Uint8Array, Uint8Array]> {
  const privateKey = privateKeyFromRecoveryPhrase(phrase, account);
  const publicKey = await publicKeyFromPrivate(privateKey);
  return [publicKey, privateKey];
}

/** Pick `count` distinct random word positions (0-based, ascending) for the "retype these words" check. */
export function pickConfirmationPositions(wordCount: number, count = 3): number[] {
  const set = new Set<number>();
  const buf = new Uint32Array(1);
  while (set.size < Math.min(count, wordCount)) {
    crypto.getRandomValues(buf);
    set.add(buf[0] % wordCount);
  }
  return [...set].sort((a, b) => a - b);
}

/** True when `typed[i]` matches the word at `positions[i]` of the phrase (normalised comparison). */
export function isPhraseConfirmed(phrase: string, positions: readonly number[], typed: readonly string[]): boolean {
  const words = normalizeMnemonicWords(phrase);
  if (positions.length === 0 || positions.length !== typed.length) return false;
  return positions.every((p, i) => {
    const w = words[p];
    return w !== undefined && (typed[i] ?? '').normalize('NFKD').trim().toLowerCase() === w;
  });
}
