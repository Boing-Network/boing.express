import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, privateKeyToHex } from '../crypto/keys';
import { accountIdToHex } from '../boing/types';
import { createRevealSession, revealActivePrivateKeyHex, RevealError } from './revealPrivateKey';

describe('revealActivePrivateKeyHex', () => {
  it('returns the key hex for the correct password and active account, then zeroes the buffer', async () => {
    const [pub, priv] = await generateKeyPair();
    const expected = privateKeyToHex(priv);
    const copy = new Uint8Array(priv);
    const unlock = vi.fn(async (pw: string) => {
      if (pw !== 'pw') throw new Error('bad');
      return [pub, copy] as [Uint8Array, Uint8Array];
    });
    const hex = await revealActivePrivateKeyHex('pw', { unlock, expectedAddressHex: accountIdToHex(pub) });
    expect(hex).toBe(expected);
    expect(unlock).toHaveBeenCalledWith('pw');
    expect(copy.every((b) => b === 0)).toBe(true);
  });

  it('rejects a wrong or empty password', async () => {
    const unlock = vi.fn(async () => {
      throw new Error('decrypt failed');
    });
    await expect(revealActivePrivateKeyHex('nope', { unlock, expectedAddressHex: 'aa' })).rejects.toBeInstanceOf(RevealError);
    await expect(revealActivePrivateKeyHex('', { unlock, expectedAddressHex: 'aa' })).rejects.toThrow(/password/i);
  });

  it('rejects when the decrypted key is not the active account', async () => {
    const [pub, priv] = await generateKeyPair();
    const unlock = async () => [pub, priv] as [Uint8Array, Uint8Array];
    await expect(revealActivePrivateKeyHex('pw', { unlock, expectedAddressHex: '00'.repeat(32) })).rejects.toThrow(/does not match/);
  });

  it('never logs the key', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const [pub, priv] = await generateKeyPair();
    await revealActivePrivateKeyHex('pw', { unlock: async () => [pub, priv], expectedAddressHex: accountIdToHex(pub) });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('createRevealSession', () => {
  afterEach(() => vi.useRealTimers());

  it('is hidden by default, toggles visibility, and auto-clears after the timeout', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const s = createRevealSession(onChange, 1000);
    s.set('ab'.repeat(32));
    expect(s.getState()).toEqual({ keyHex: 'ab'.repeat(32), visible: false });
    s.toggleVisible();
    expect(s.getState().visible).toBe(true);
    vi.advanceTimersByTime(999);
    expect(s.getState().keyHex).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(s.getState()).toEqual({ keyHex: null, visible: false });
  });

  it('clear() wipes immediately', () => {
    const s = createRevealSession(() => {}, 1000);
    s.set('cd'.repeat(32));
    s.clear();
    expect(s.getState().keyHex).toBeNull();
    s.toggleVisible();
    expect(s.getState().visible).toBe(false);
  });
});