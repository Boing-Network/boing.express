import { describe, expect, it, vi } from 'vitest';
import {
  buildReferenceFungibleTransfer,
  decodeReferenceFungibleBalanceWord,
  encodeReferenceFungibleTransferCalldata,
  referenceFungibleBalanceStorageKey,
} from '../src/boing/referenceFungible';
import { isReferenceSelfTransferCalldata, SELF_TRANSFER_REFUSED } from '../src/boing/dappTxRequest';
import { accountIdFromHex } from '../src/boing/types';
import type { NetworkAdapter } from '../src/networks/types';

const ME = 'aa'.repeat(32);
const TO = '11'.repeat(32);
const TOKEN = '22'.repeat(32);

describe('reference fungible', () => {
  it('encodes transfer(to, amount) like boing-sdk', () => {
    const cd = encodeReferenceFungibleTransferCalldata(TO, 258n);
    expect(cd.length).toBe(96);
    expect(cd[31]).toBe(1);
    expect(Array.from(cd.subarray(32, 64))).toEqual(Array(32).fill(0x11));
    expect(cd[94]).toBe(1);
    expect(cd[95]).toBe(2);
    expect(Array.from(cd.subarray(64, 80)).every((b) => b === 0)).toBe(true);
    expect(() => encodeReferenceFungibleTransferCalldata(TO, 0n)).toThrow();
  });
  it('balance key = holder XOR "BOING_REFFUNGIBLE_BAL1"', () => {
    const k = referenceFungibleBalanceStorageKey('00'.repeat(32));
    expect(k.slice(0, 44)).toBe(Buffer.from('BOING_REFFUNGIBLE_BAL1').toString('hex'));
    expect(k.slice(44)).toBe('0'.repeat(20));
  });
  it('decodes storage words', () => {
    expect(decodeReferenceFungibleBalanceWord(null)).toBe(0n);
    expect(decodeReferenceFungibleBalanceWord(`0x${'0'.repeat(62)}ff`)).toBe(255n);
    expect(decodeReferenceFungibleBalanceWord({ value: '0x10' })).toBe(16n);
    expect(() => decodeReferenceFungibleBalanceWord(`0x01${'0'.repeat(62)}`)).toThrow(/u128/);
  });
  it('refuses self-transfer before signing (v1 guard), signs otherwise', async () => {
    const buildContractCall = vi.fn(async () => 'signed');
    const network = { buildContractCall } as unknown as NetworkAdapter;
    const sender = accountIdFromHex(ME);
    await expect(
      buildReferenceFungibleTransfer({ network, sender, tokenHex: TOKEN, toHex: ME, amount: 1n, nonce: 0n, privateKey: new Uint8Array(32) })
    ).rejects.toThrow(SELF_TRANSFER_REFUSED);
    expect(buildContractCall).not.toHaveBeenCalled();
    await expect(
      buildReferenceFungibleTransfer({ network, sender, tokenHex: TOKEN, toHex: TO, amount: 5n, nonce: 3n, privateKey: new Uint8Array(32) })
    ).resolves.toBe('signed');
    const cd = (buildContractCall.mock.calls[0] as unknown[])[2] as Uint8Array;
    expect(isReferenceSelfTransferCalldata(sender, cd)).toBe(false);
    expect((buildContractCall.mock.calls[0] as unknown[])[3]).toBe(3n);
  });
});
