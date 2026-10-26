/**
 * BIP-39 mnemonic codes (English). Native implementation on @noble/hashes only; no extra dependency.
 *
 * Spec: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
 *
 * Boing Express uses 24 words (256-bit entropy) for new wallets and accepts 12 or 24 words on import.
 * The optional BIP-39 passphrase ("25th word") is NOT used by the wallet UI (see docs/RECOVERY_PHRASE_DESIGN.md);
 * `mnemonicToSeed` still takes one so the official test vectors can be checked.
 */
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { BIP39_ENGLISH } from './bip39Wordlist';

export type MnemonicWordCount = 12 | 24;

/** Word counts accepted when restoring a phrase. */
export const IMPORT_WORD_COUNTS: readonly number[] = [12, 24];

const WORD_INDEX: ReadonlyMap<string, number> = new Map(BIP39_ENGLISH.map((w, i) => [w, i] as const));

export class MnemonicError extends Error {}

/** Entropy bytes for a word count: 12 -> 16, 24 -> 32 (also 15/18/21 per spec, but the wallet never offers them). */
function entropyBytesForWords(words: number): number {
  if (!Number.isInteger(words) || words < 12 || words > 24 || words % 3 !== 0) {
    throw new MnemonicError('Unsupported number of words.');
  }
  return (words * 11 * 32) / 33 / 8;
}

/** Trim, lowercase, collapse any whitespace to single spaces. Returns the word list. */
export function normalizeMnemonicWords(input: string): string[] {
  const s = input.normalize('NFKD').trim().toLowerCase();
  return s === '' ? [] : s.split(/\s+/);
}

/** Canonical single-space form of a phrase, or '' for blank input. */
export function normalizeMnemonic(input: string): string {
  return normalizeMnemonicWords(input).join(' ');
}

function checksumBits(entropy: Uint8Array): number {
  return entropy.length / 4; // ENT / 32
}

/** Entropy (16/20/24/28/32 bytes) -> mnemonic. */
export function entropyToMnemonic(entropy: Uint8Array): string {
  if (entropy.length < 16 || entropy.length > 32 || entropy.length % 4 !== 0) {
    throw new MnemonicError('Entropy must be 16 to 32 bytes in steps of 4.');
  }
  const cs = checksumBits(entropy);
  const hash = sha256(entropy);
  const total = entropy.length * 8 + cs;
  const words: string[] = [];
  for (let w = 0; w < total / 11; w++) {
    let idx = 0;
    for (let b = 0; b < 11; b++) {
      const bit = w * 11 + b;
      const byte = bit < entropy.length * 8 ? entropy[bit >> 3] : hash[(bit - entropy.length * 8) >> 3];
      // For checksum bits the position inside the hash byte is (bit - ENT) % 8; for entropy it is bit % 8.
      const pos = bit < entropy.length * 8 ? bit & 7 : (bit - entropy.length * 8) & 7;
      idx = (idx << 1) | ((byte >> (7 - pos)) & 1);
    }
    words.push(BIP39_ENGLISH[idx]);
  }
  return words.join(' ');
}

/**
 * Mnemonic -> entropy. Throws MnemonicError (generic message, never says which word) when a word is not in
 * the list, the word count is unsupported, or the checksum does not match.
 */
export function mnemonicToEntropy(mnemonic: string): Uint8Array {
  const words = normalizeMnemonicWords(mnemonic);
  let entBytes: number;
  try {
    entBytes = entropyBytesForWords(words.length);
  } catch {
    throw new MnemonicError('A recovery phrase has 12 or 24 words.');
  }
  const bits: number[] = [];
  for (const w of words) {
    const idx = WORD_INDEX.get(w);
    if (idx === undefined) throw new MnemonicError('One of the words is not right. Check the spelling and the order.');
    for (let b = 10; b >= 0; b--) bits.push((idx >> b) & 1);
  }
  const entBits = entBytes * 8;
  const entropy = new Uint8Array(entBytes);
  for (let i = 0; i < entBits; i++) entropy[i >> 3] |= bits[i] << (7 - (i & 7));
  const hash = sha256(entropy);
  const cs = checksumBits(entropy);
  for (let i = 0; i < cs; i++) {
    const want = (hash[i >> 3] >> (7 - (i & 7))) & 1;
    if (bits[entBits + i] !== want) {
      entropy.fill(0);
      throw new MnemonicError('One of the words is not right. Check the spelling and the order.');
    }
  }
  return entropy;
}

export function validateMnemonic(mnemonic: string): boolean {
  try {
    mnemonicToEntropy(mnemonic).fill(0);
    return true;
  } catch {
    return false;
  }
}

/** Fresh random mnemonic from crypto.getRandomValues (never Math.random). */
export function generateMnemonic(words: MnemonicWordCount = 24): string {
  const entropy = crypto.getRandomValues(new Uint8Array(entropyBytesForWords(words)));
  try {
    return entropyToMnemonic(entropy);
  } finally {
    entropy.fill(0);
  }
}

/** BIP-39 seed: PBKDF2-HMAC-SHA512, 2048 iterations, salt "mnemonic" + passphrase, 64 bytes. */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  const m = normalizeMnemonic(mnemonic);
  const salt = ('mnemonic' + passphrase).normalize('NFKD');
  return pbkdf2(sha512, new TextEncoder().encode(m), new TextEncoder().encode(salt), { c: 2048, dkLen: 64 });
}
