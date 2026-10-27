import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { BIP39_ENGLISH } from '../src/crypto/bip39Wordlist';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  normalizeMnemonic,
  validateMnemonic,
  generateMnemonic,
  MnemonicError,
} from '../src/crypto/bip39';
import { parseHardenedPath, slip10DeriveEd25519 } from '../src/crypto/slip10';
import {
  BOING_COIN_TYPE,
  boingDerivationPath,
  generateRecoveryPhrase,
  isPhraseConfirmed,
  keyPairFromRecoveryPhrase,
  parseRecoveryPhrase,
  pickConfirmationPositions,
  privateKeyFromRecoveryPhrase,
} from '../src/crypto/recoveryPhrase';
import { accountIdToHex } from '../src/boing/types';
import '../src/crypto/keys';
import bip39Vectors from './fixtures/bip39-vectors.json';
import slip10Vectors from './fixtures/slip10-ed25519-vectors.json';
import goldens from './fixtures/recovery-phrase-goldens.json';

const ABANDON12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('BIP-39 English wordlist', () => {
  it('has 2048 unique, sorted words and the official SHA-256', () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH).size).toBe(2048);
    expect([...BIP39_ENGLISH].sort()).toEqual([...BIP39_ENGLISH]);
    // SHA-256 of the official english.txt (newline-terminated words), from the bitcoin/bips repository.
    expect(bytesToHex(sha256(new TextEncoder().encode(BIP39_ENGLISH.join('\n') + '\n')))).toBe(
      '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda'
    );
  });
  it('has a unique 4-letter prefix per word (BIP-39 property)', () => {
    expect(new Set(BIP39_ENGLISH.map((w) => w.slice(0, 4))).size).toBe(2048);
  });
});

describe('BIP-39 official vectors (Trezor python-mnemonic, passphrase "TREZOR")', () => {
  it.each(bip39Vectors.vectors.map((v) => [v.mnemonic.split(' ').length, v] as const))(
    '%i words: entropy <-> mnemonic <-> seed',
    (_n, v) => {
      expect(entropyToMnemonic(hexToBytes(v.entropy))).toBe(v.mnemonic);
      expect(bytesToHex(mnemonicToEntropy(v.mnemonic))).toBe(v.entropy);
      expect(validateMnemonic(v.mnemonic)).toBe(true);
      expect(bytesToHex(mnemonicToSeed(v.mnemonic, bip39Vectors.passphrase))).toBe(v.seed);
    }
  );
  it('covers 12, 18 and 24 words; 15 and 21 round-trip too', () => {
    const sizes = new Set(bip39Vectors.vectors.map((v) => v.mnemonic.split(' ').length));
    expect([...sizes].sort((a, b) => a - b)).toEqual([12, 18, 24]);
    for (const bytes of [20, 28]) {
      const m = entropyToMnemonic(new Uint8Array(bytes).fill(0x5a));
      expect(m.split(' ')).toHaveLength((bytes * 8 + bytes * 8 / 32) / 11);
      expect(bytesToHex(mnemonicToEntropy(m))).toBe('5a'.repeat(bytes));
    }
  });
});

describe('BIP-39 input handling', () => {
  it('normalises case, spacing and line breaks', () => {
    const messy = `  ABANDON abandon\tabandon\nabandon abandon abandon abandon abandon abandon abandon abandon   About `;
    expect(normalizeMnemonic(messy)).toBe(ABANDON12);
    expect(parseRecoveryPhrase(messy)).toBe(ABANDON12);
  });
  it('rejects a bad checksum, unknown words and unsupported lengths with plain messages', () => {
    const badChecksum = ABANDON12.replace(/about$/, 'abandon');
    expect(validateMnemonic(badChecksum)).toBe(false);
    expect(() => parseRecoveryPhrase(badChecksum)).toThrow(MnemonicError);
    expect(() => parseRecoveryPhrase(ABANDON12.replace('about', 'aboot'))).toThrow(/words is not right/);
    // 15 words are valid BIP-39 but the wallet only offers/accepts 12 and 24.
    const fifteen = entropyToMnemonic(new Uint8Array(20).fill(0x5a));
    expect(validateMnemonic(fifteen)).toBe(true);
    expect(() => parseRecoveryPhrase(fifteen)).toThrow(/12 or 24 words/);
    expect(() => parseRecoveryPhrase(`${ABANDON12} about`)).toThrow(MnemonicError);
    expect(() => parseRecoveryPhrase('')).toThrow(MnemonicError);
  });
  it('does not leak which word is wrong', () => {
    try {
      parseRecoveryPhrase(ABANDON12.replace('about', 'zzzz'));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toMatch(/zzzz/);
    }
  });
  it('generates valid phrases of the requested size, different each time', () => {
    const a = generateMnemonic(24);
    const b = generateMnemonic(24);
    expect(a.split(' ')).toHaveLength(24);
    expect(a).not.toBe(b);
    expect(validateMnemonic(a)).toBe(true);
    expect(generateMnemonic(12).split(' ')).toHaveLength(12);
    expect(generateRecoveryPhrase().split(' ')).toHaveLength(24);
  });
});

describe('SLIP-0010 ed25519 official vectors', () => {
  // The SLIP-0010 spec publishes ed25519 vectors 1 and 2 only. Its other vectors are secp256k1/nist256p1/curve25519, and the
  // "retry" vectors are nist256p1-only (ed25519 never needs a retry). So there is no official ed25519 vector 3-5 to add.
  it('covers every official ed25519 vector in the spec (1 and 2)', () => {
    expect(Object.keys(slip10Vectors).sort()).toEqual(['v1', 'v2']);
  });
  for (const [name, v] of Object.entries(slip10Vectors)) {
    it(`test vector ${name}: every chain`, async () => {
      for (const [path, chainCode, priv, pub] of v.chains) {
        const node = slip10DeriveEd25519(hexToBytes(v.seed), path);
        expect(bytesToHex(node.key), `${path} private`).toBe(priv);
        expect(bytesToHex(node.chainCode), `${path} chain code`).toBe(chainCode);
        expect(bytesToHex(await ed.getPublicKeyAsync(node.key)), `${path} public`).toBe(pub);
      }
    });
  }
  it('rejects non-hardened or malformed paths (ed25519 supports hardened derivation only)', () => {
    expect(() => parseHardenedPath("m/44'/0/0'")).toThrow();
    expect(() => parseHardenedPath("44'/0'")).toThrow();
    expect(() => parseHardenedPath("m/44'/x'")).toThrow();
    expect(() => parseHardenedPath("m/2147483648'")).toThrow();
    expect(parseHardenedPath('m')).toEqual([]);
    expect(parseHardenedPath("m/44'/0h/1H")).toEqual([44, 0, 1]);
  });
});

describe('Boing derivation', () => {
  it('uses m/44\'/<BOIN>\'/<account>\'/0\'/0\' with a frozen coin type', () => {
    expect(BOING_COIN_TYPE).toBe(1112492366);
    expect(BOING_COIN_TYPE).toBe(0x424f494e);
    expect(boingDerivationPath()).toBe("m/44'/1112492366'/0'/0'/0'");
    expect(boingDerivationPath(7)).toBe("m/44'/1112492366'/7'/0'/0'");
    expect(() => boingDerivationPath(-1)).toThrow(RangeError);
    expect(() => boingDerivationPath(0x80000000)).toThrow(RangeError);
  });
  it('matches the independent Python reference for 12- and 24-word phrases and accounts 0/1', async () => {
    expect(goldens.vectors.length).toBeGreaterThanOrEqual(8);
    for (const g of goldens.vectors) {
      expect(g.path).toBe(boingDerivationPath(g.account));
      expect(entropyToMnemonic(hexToBytes(g.entropy))).toBe(g.phrase);
      expect(bytesToHex(mnemonicToSeed(g.phrase))).toBe(g.seed);
      expect(bytesToHex(privateKeyFromRecoveryPhrase(g.phrase, g.account))).toBe(g.privateKey);
      const [pub, priv] = await keyPairFromRecoveryPhrase(g.phrase, g.account);
      expect('0x' + accountIdToHex(pub).toLowerCase()).toBe(g.address);
      expect(bytesToHex(priv)).toBe(g.privateKey);
    }
  });
  it('gives the same account for 12/24-word phrases regardless of formatting, and different accounts per phrase', async () => {
    const [a] = await keyPairFromRecoveryPhrase(ABANDON12);
    const [b] = await keyPairFromRecoveryPhrase(`  ${ABANDON12.toUpperCase()}\n`);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    const [c] = await keyPairFromRecoveryPhrase(generateRecoveryPhrase());
    expect(bytesToHex(c)).not.toBe(bytesToHex(a));
  });
  it('derived keys sign and verify like any other wallet key', async () => {
    const [pub, priv] = await keyPairFromRecoveryPhrase(ABANDON12);
    const msg = new TextEncoder().encode('boing recovery phrase test');
    const sig = await ed.signAsync(msg, priv);
    expect(await ed.verifyAsync(sig, msg, pub)).toBe(true);
    expect(await ed.verifyAsync(sig, new TextEncoder().encode('other'), pub)).toBe(false);
  });
});

describe('backup confirmation', () => {
  const phrase = goldens.vectors.find((v) => v.name === 'seq24')!.phrase;
  const words = phrase.split(' ');
  it('picks 3 distinct sorted positions inside the phrase', () => {
    for (let i = 0; i < 50; i++) {
      const p = pickConfirmationPositions(24, 3);
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect([...p].sort((x, y) => x - y)).toEqual(p);
      expect(p.every((n) => n >= 0 && n < 24)).toBe(true);
    }
    expect(pickConfirmationPositions(2, 3)).toHaveLength(2);
  });
  it('accepts the right words (any case/spacing) and rejects wrong, missing or swapped ones', () => {
    const pos = [2, 9, 20];
    expect(isPhraseConfirmed(phrase, pos, pos.map((p) => words[p]!))).toBe(true);
    expect(isPhraseConfirmed(phrase, pos, pos.map((p) => ` ${words[p]!.toUpperCase()} `))).toBe(true);
    expect(isPhraseConfirmed(phrase, pos, [words[2]!, words[9]!, ''])).toBe(false);
    expect(isPhraseConfirmed(phrase, pos, [words[9]!, words[2]!, words[20]!])).toBe(false);
    expect(isPhraseConfirmed(phrase, [], [])).toBe(false);
    expect(isPhraseConfirmed(phrase, pos, [words[2]!])).toBe(false);
  });
});
