import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptBytes, decryptPrivateKey, encryptBytes, encryptPrivateKey } from '../src/storage/encrypted';
import {
  entryHasRecovery,
  migrateVaultToV2,
  vaultWithEntry,
  type WalletVaultV2,
} from '../src/storage/walletVault';
import { PhraseAccountError, buildPhraseEntry, readEntryPhrase } from '../src/storage/recoveryVault';
import { revealActiveRecoveryPhrase } from '../src/security/revealRecoveryPhrase';
import { RevealError } from '../src/security/revealPrivateKey';
import { generateRecoveryPhrase, keyPairFromRecoveryPhrase } from '../src/crypto/recoveryPhrase';
import { accountIdToHex } from '../src/boing/types';
import { bytesToHex } from '@noble/hashes/utils.js';
import goldens from './fixtures/recovery-phrase-goldens.json';

const PW = 'correct horse battery';
const bare = (s: string) => s.toLowerCase().replace(/^0x/, '');
const g24 = goldens.vectors.find((v) => v.name === 'seq24' && v.account === 0)!;
const g12 = goldens.vectors.find((v) => v.name === 'seq12' && v.account === 0)!;

describe('encryptBytes / decryptBytes', () => {
  it('round-trips and rejects a wrong password', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const blob = await encryptBytes(data, PW);
    expect(Array.from(await decryptBytes(blob, PW))).toEqual(Array.from(data));
    await expect(decryptBytes(blob, 'nope nope nope')).rejects.toBeDefined();
    await expect(decryptBytes('abcd', PW)).rejects.toThrow('Invalid encrypted blob');
  });
  it('keeps the 32-byte rule for private keys', async () => {
    const blob = await encryptBytes(new Uint8Array(16), PW);
    await expect(decryptPrivateKey(blob, PW)).rejects.toThrow('Decrypted key must be 32 bytes');
    const key = new Uint8Array(32).fill(7);
    expect(Array.from(await decryptPrivateKey(await encryptPrivateKey(key, PW), PW))).toEqual(Array.from(key));
  });
});

describe('vault format', () => {
  it('keeps old accounts exactly as they were (no recovery field)', () => {
    const v = migrateVaultToV2({ version: 2, activeIndex: 0, accounts: [{ encrypted: 'aa', addressHex: '0xAB' }] });
    expect(v.accounts[0]).toEqual({ encrypted: 'aa', addressHex: 'ab' });
    expect('recovery' in v.accounts[0]!).toBe(false);
    const legacy = migrateVaultToV2({ encrypted: 'aa', addressHex: 'ab' });
    expect(entryHasRecovery(legacy.accounts[0])).toBe(false);
  });
  it('preserves a valid recovery block and drops malformed ones', () => {
    const good = { v: 1, words: 24, account: 0, encrypted: 'ff' };
    const v = migrateVaultToV2({
      version: 2,
      activeIndex: 0,
      accounts: [
        { encrypted: 'aa', addressHex: 'ab', recovery: good },
        { encrypted: 'bb', addressHex: 'cd', recovery: { v: 2, words: 24, account: 0, encrypted: 'ff' } },
        { encrypted: 'cc', addressHex: 'ef', recovery: { v: 1, words: 13, account: 0, encrypted: 'ff' } },
        { encrypted: 'dd', addressHex: '01', recovery: 'oops' },
      ],
    });
    expect(v.accounts[0]!.recovery).toEqual(good);
    expect(v.accounts.slice(1).every((a) => !('recovery' in a))).toBe(true);
  });
  it('vaultWithEntry replaces or appends and activates the new account', () => {
    const base: WalletVaultV2 = {
      version: 2,
      activeIndex: 0,
      accounts: [{ encrypted: 'aa', addressHex: 'ab' }],
    };
    const e = { encrypted: 'bb', addressHex: '0xCD' };
    expect(vaultWithEntry(base, e, 'replace').accounts).toEqual([{ encrypted: 'bb', addressHex: 'cd' }]);
    const appended = vaultWithEntry(base, e, 'append');
    expect(appended.accounts).toHaveLength(2);
    expect(appended.activeIndex).toBe(1);
    expect(vaultWithEntry(null, e, 'append').accounts).toHaveLength(1);
  });
});

describe('phrase accounts', () => {
  it('builds the golden account for a 24-word phrase and reads the phrase back', async () => {
    const { entry, addressHex } = await buildPhraseEntry(g24.phrase, PW, null);
    expect(bare(addressHex)).toBe(bare(g24.address));
    expect(entry.addressHex).toBe(g24.address.slice(2));
    expect(entry.recovery).toMatchObject({ v: 1, words: 24, account: 0 });
    expect(entryHasRecovery(entry)).toBe(true);
    // The stored private key is the derived key; the phrase is not stored in the clear anywhere.
    expect(bytesToHex(await decryptPrivateKey(entry.encrypted, PW))).toBe(g24.privateKey);
    expect(JSON.stringify(entry)).not.toContain(g24.phrase.split(' ')[1]!);
    expect(await readEntryPhrase(entry, PW)).toBe(g24.phrase);
  });
  it('accepts a 12-word phrase (import) and reports 12 words', async () => {
    const { entry } = await buildPhraseEntry(g12.phrase.toUpperCase(), PW, null);
    expect(entry.recovery!.words).toBe(12);
    expect(await readEntryPhrase(entry, PW)).toBe(g12.phrase);
  });
  it('refuses a wrong password, a missing phrase and a mismatching account with plain messages', async () => {
    const { entry } = await buildPhraseEntry(generateRecoveryPhrase(), PW, null);
    await expect(readEntryPhrase(entry, 'wrong password')).rejects.toThrow('Incorrect password.');
    await expect(readEntryPhrase({ encrypted: 'aa', addressHex: 'ab' }, PW)).rejects.toThrow('no recovery phrase');
    await expect(readEntryPhrase(null, PW)).rejects.toBeInstanceOf(PhraseAccountError);
    const other = await buildPhraseEntry(generateRecoveryPhrase(), PW, null);
    const swapped = { ...entry, addressHex: other.entry.addressHex };
    await expect(readEntryPhrase(swapped, PW)).rejects.toThrow('does not match');
  });
  it('rejects adding the same phrase twice to one vault', async () => {
    const first = await buildPhraseEntry(g12.phrase, PW, null);
    const vault = vaultWithEntry(null, first.entry, 'replace');
    await expect(buildPhraseEntry(g12.phrase, PW, vault)).rejects.toThrow('already in your wallet');
    const [pub] = await keyPairFromRecoveryPhrase(g12.phrase);
    expect(bare(first.addressHex)).toBe(bare(accountIdToHex(pub)));
  });
  it('rejects invalid phrases before touching storage', async () => {
    await expect(buildPhraseEntry('abandon abandon abandon', PW, null)).rejects.toThrow(/12 or 24 words/);
  });
});

describe('revealActiveRecoveryPhrase', () => {
  it('requires a password and maps errors to RevealError', async () => {
    await expect(revealActiveRecoveryPhrase('', { readPhrase: async () => 'x' })).rejects.toBeInstanceOf(RevealError);
    await expect(
      revealActiveRecoveryPhrase('pw', {
        readPhrase: async () => {
          throw new PhraseAccountError('Incorrect password.');
        },
      })
    ).rejects.toThrow('Incorrect password.');
    await expect(
      revealActiveRecoveryPhrase('pw', {
        readPhrase: async () => {
          throw new Error('internal detail');
        },
      })
    ).rejects.toThrow('Incorrect password.');
    expect(await revealActiveRecoveryPhrase('pw', { readPhrase: async () => 'a b c' })).toBe('a b c');
  });
});

describe('walletStore (web localStorage) with phrases', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    vi.resetModules();
  });

  it('create, unlock, view phrase, add a second phrase account and a key account, keep each account separate', async () => {
    const store = await import('../src/storage/walletStore');
    expect(store.getActiveRecoveryInfo()).toBeNull();
    const { phrase, addressHex } = await store.createWalletWithPhrase(PW);
    expect(phrase.split(' ')).toHaveLength(24);
    expect(store.getActiveRecoveryInfo()).toEqual({ words: 24 });
    const [pub, priv] = await store.unlockWallet(PW);
    expect(bare(accountIdToHex(pub))).toBe(bare(addressHex));
    priv.fill(0);
    expect(await store.unlockActiveRecoveryPhrase(PW)).toBe(phrase);
    await expect(store.unlockActiveRecoveryPhrase('wrong password')).rejects.toThrow('Incorrect password.');

    // Additional account created with a private key has no phrase.
    await store.createAdditionalAccount(PW);
    expect(store.getActiveRecoveryInfo()).toBeNull();
    await expect(store.unlockActiveRecoveryPhrase(PW)).rejects.toThrow('no recovery phrase');
    // Switching back shows the first account's phrase again.
    store.setActiveAccountIndex(0);
    expect(await store.unlockActiveRecoveryPhrase(PW)).toBe(phrase);

    // Import an extra phrase account (12 words).
    const imported = await store.importWalletFromPhrase(PW, g12.phrase, true);
    expect(bare(imported)).toBe(bare(g12.address));
    expect(store.listAccountSummaries()).toHaveLength(3);
    expect(store.getActiveRecoveryInfo()).toEqual({ words: 12 });
    expect(await store.unlockActiveRecoveryPhrase(PW)).toBe(g12.phrase);
    await expect(store.importWalletFromPhrase(PW, g12.phrase, true)).rejects.toThrow('already in your wallet');
    expect(store.listAccountSummaries()).toHaveLength(3);
  });

  it('restores a wallet from a phrase on a fresh device with the same address', async () => {
    const store = await import('../src/storage/walletStore');
    const addr = await store.importWalletFromPhrase(PW, g24.phrase);
    expect(bare(addr)).toBe(bare(g24.address));
    expect(store.listAccountSummaries()).toHaveLength(1);
  });
});
