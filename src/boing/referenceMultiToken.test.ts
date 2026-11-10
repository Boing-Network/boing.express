import { describe, expect, it } from 'vitest';
import {
  REF_MT_TOPIC_TRANSFER_HEX,
  REFERENCE_MULTI_TOKEN_RUNTIME_HEX,
  decodeMultiTokenCalldata,
  decodeMultiTokenTransferLog,
  describeMultiTokenCall,
  encodeMultiTokenMintBatchCalldata,
  encodeMultiTokenTransferCalldata,
  isReferenceMultiTokenBytecode,
  multiTokenAmountFromStorageWord,
  multiTokenBalanceStorageKey,
  multiTokenMetadataStorageKey,
  multiTokenSupplyStorageKey,
  parseMultiTokenAmount,
  parseMultiTokenItemId,
} from './referenceMultiToken';

const ALICE = 'a1'.repeat(32);
const BOB = 'b2'.repeat(32);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('reference multi-token (mirror of boing-sdk 0.5.41)', () => {
  it('matches the Rust golden storage keys', () => {
    expect(multiTokenBalanceStorageKey(ALICE, 7)).toBe(
      'e3eee8efe6fef3e4e7ecf5fee3e0edfef790a1a1a1a1a1a10000000000000007'
    );
    expect(multiTokenSupplyStorageKey(7)).toBe('424f494e475f5245464d545f535550504c595f56310000000000000000000007');
    expect(multiTokenMetadataStorageKey(7)).toBe('424f494e475f5245464d545f4d4554415f563100000000000000000000000007');
    expect(REF_MT_TOPIC_TRANSFER_HEX).toBe('424f494e475f5245464d545f5452414e534645525f5631000000000000000000');
  });

  it('round-trips transfer and batch calldata', () => {
    const t = encodeMultiTokenTransferCalldata(BOB, 3, 40n);
    expect(t.length).toBe(128);
    expect(decodeMultiTokenCalldata(t)).toEqual({ kind: 'transfer', to: BOB, itemId: 3n, amount: 40n });
    const m = encodeMultiTokenMintBatchCalldata(ALICE, [
      { itemId: 1, amount: 25 },
      { itemId: 2, amount: 3 },
    ]);
    expect(m.length).toBe(96 + 64 * 2);
    const d = decodeMultiTokenCalldata('0x' + hex(m));
    expect(d).toEqual({
      kind: 'mint_batch',
      to: ALICE,
      entries: [
        { itemId: 1n, amount: 25n },
        { itemId: 2n, amount: 3n },
      ],
    });
    expect(describeMultiTokenCall(d!, { itemLabel: (id) => (id === 1n ? 'Iron' : undefined) }).summary).toBe(
      'Mint 25 × Iron (item #1), 3 × item #2 to 0xa1a1a1…a1a1'
    );
  });

  it('rejects wBOING-shaped calldata and malformed batches', () => {
    const wrap = new Uint8Array(32);
    wrap[31] = 0x20;
    expect(decodeMultiTokenCalldata(wrap)).toBeNull();
    const unwrap = new Uint8Array(64);
    unwrap[31] = 0x21;
    unwrap[63] = 5;
    expect(decodeMultiTokenCalldata(unwrap)).toBeNull();
    const m = encodeMultiTokenMintBatchCalldata(ALICE, [{ itemId: 1, amount: 1 }]);
    const extra = new Uint8Array(m.length + 32);
    extra.set(m);
    expect(decodeMultiTokenCalldata(extra)).toBeNull();
    expect(() => encodeMultiTokenTransferCalldata(BOB, 1, 0)).toThrow();
  });

  it('decodes transfer logs and storage words', () => {
    const data = '00'.repeat(31) + '01' + '00'.repeat(31) + '28';
    const log = decodeMultiTokenTransferLog({
      topics: ['0x' + REF_MT_TOPIC_TRANSFER_HEX, '0x' + '00'.repeat(32), '0x' + BOB],
      data: '0x' + data,
    });
    expect(log).toEqual({ from: '00'.repeat(32), to: BOB, itemId: 1n, amount: 40n, isMint: true });
    expect(decodeMultiTokenTransferLog({ topics: ['0x' + '11'.repeat(32), '0x' + ALICE, '0x' + BOB], data })).toBeNull();
    expect(multiTokenAmountFromStorageWord({ value: '0x' + '00'.repeat(31) + '3c' })).toBe(60n);
    expect(multiTokenAmountFromStorageWord(null)).toBe(0n);
  });

  it('identifies the pinned runtime and parses inputs', () => {
    expect(REFERENCE_MULTI_TOKEN_RUNTIME_HEX.length).toBe(2065 * 2);
    expect(isReferenceMultiTokenBytecode('0x' + REFERENCE_MULTI_TOKEN_RUNTIME_HEX)).toBe(true);
    expect(isReferenceMultiTokenBytecode('0x6000')).toBe(false);
    expect(parseMultiTokenItemId('42')).toBe(42n);
    expect(() => parseMultiTokenItemId('-1')).toThrow();
    expect(parseMultiTokenAmount('1,000')).toBe(1000n);
    expect(() => parseMultiTokenAmount('0')).toThrow();
  });
});
