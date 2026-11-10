import { describe, expect, it } from 'vitest';
import * as sdk from '@boing-network/boing-sdk';
import * as local from './referenceMultiToken';

const bare = (h: string) => h.replace(/^0x/i, '').toLowerCase();

/** The wallet keeps string-tolerant encoders/decoders; pin them to the published SDK so they cannot drift. */
describe('referenceMultiToken matches @boing-network/boing-sdk', () => {
  it('tags, topics and admin key', () => {
    for (const k of [
      'REF_MT_BALANCE_XOR_HEX',
      'REF_MT_SUPPLY_XOR_HEX',
      'REF_MT_METADATA_XOR_HEX',
      'REF_MT_TOPIC_TRANSFER_HEX',
      'REF_MT_TOPIC_METADATA_HEX',
      'REF_MT_TOPIC_ADMIN_HEX',
      'REF_MT_ADMIN_KEY_HEX',
    ] as const) {
      expect(bare(local[k]), k).toBe(bare(sdk[k]));
    }
  });

  it('bytecode and template identity', () => {
    expect(local.REFERENCE_MULTI_TOKEN_RUNTIME_HEX).toBe(bare(sdk.DEFAULT_REFERENCE_MULTI_TOKEN_RUNTIME_BYTECODE_HEX));
    expect(local.isReferenceMultiTokenBytecode(sdk.DEFAULT_REFERENCE_MULTI_TOKEN_RUNTIME_BYTECODE_HEX)).toBe(true);
    expect(sdk.isReferenceMultiTokenBytecode(local.REFERENCE_MULTI_TOKEN_RUNTIME_HEX)).toBe(true);
  });

  it('storage keys and calldata encoders', () => {
    const a = 'a1'.repeat(32);
    const b = 'b2'.repeat(32);
    expect(bare(local.multiTokenBalanceStorageKey(a, 7n))).toBe(bare(sdk.multiTokenBalanceStorageKey(a, 7n)));
    expect(bare(local.multiTokenSupplyStorageKey(7n))).toBe(bare(sdk.multiTokenSupplyStorageKey(7n)));
    expect(bare(local.multiTokenMetadataStorageKey(7n))).toBe(bare(sdk.multiTokenMetadataStorageKey(7n)));
    expect(local.encodeMultiTokenTransferCalldata(b, 7n, 3n)).toEqual(sdk.encodeMultiTokenTransferCalldata(b, 7n, 3n));
    const entries = [
      { itemId: 1n, amount: 2n },
      { itemId: 9n, amount: 5n },
    ];
    expect(local.encodeMultiTokenMintBatchCalldata(a, entries)).toEqual(sdk.encodeMultiTokenMintBatchCalldata(a, entries));
    expect(local.encodeMultiTokenTransferBatchCalldata(a, entries)).toEqual(
      sdk.encodeMultiTokenTransferBatchCalldata(a, entries)
    );
  });
});
