import { describe, expect, it } from 'vitest';
import { discoverMultiTokenItemsFromBlock, groupMultiTokenHoldings } from './multiTokenHoldings';
import {
  REF_MT_TOPIC_TRANSFER_HEX,
  encodeMultiTokenMintBatchCalldata,
  encodeMultiTokenTransferCalldata,
} from './referenceMultiToken';
import { describeCalldataIntent } from './calldataIntent';

const OWNER = 'a1'.repeat(32);
const OTHER = 'b2'.repeat(32);
const CONTRACT = 'c3'.repeat(32);
const hex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function callTx(sender: string, calldata: Uint8Array) {
  return { sender: '0x' + sender, payload: { ContractCall: { contract: '0x' + CONTRACT, calldata: hex(calldata) } } };
}

describe('multi-token discovery', () => {
  it('finds items minted or sent to the owner and items the owner sent', () => {
    const block = {
      transactions: [
        callTx(OTHER, encodeMultiTokenMintBatchCalldata(OWNER, [{ itemId: 1, amount: 5 }, { itemId: 2, amount: 1 }])),
        callTx(OWNER, encodeMultiTokenTransferCalldata(OTHER, 3, 2)),
        callTx(OTHER, encodeMultiTokenTransferCalldata(OTHER, 9, 2)),
      ],
      receipts: [{ success: true }, { success: true }, { success: true }],
    };
    const found = discoverMultiTokenItemsFromBlock(block, OWNER).map((f) => `${f.itemId}`);
    expect(found).toEqual(['1', '2', '3']);
  });

  it('skips failed txs and reads transfer logs', () => {
    const data = '0x' + '00'.repeat(31) + '07' + '00'.repeat(31) + '01';
    const block = {
      transactions: [callTx(OTHER, encodeMultiTokenTransferCalldata(OWNER, 4, 1)), { sender: '0x' + OTHER, payload: { ContractCall: { contract: '0x' + CONTRACT, calldata: '0x00' } } }],
      receipts: [
        { success: false },
        { success: true, logs: [{ topics: ['0x' + REF_MT_TOPIC_TRANSFER_HEX, '0x' + OTHER, '0x' + OWNER], data }] },
      ],
    };
    const found = discoverMultiTokenItemsFromBlock(block, OWNER);
    expect(found).toEqual([{ contractHex: CONTRACT, itemId: 7n, source: 'log' }]);
  });

  it('groups holdings by contract sorted by item id', () => {
    const g = groupMultiTokenHoldings([
      { contractHex: CONTRACT, itemId: 5n, balance: 1n, totalSupply: 1n, metadataHash: '' },
      { contractHex: CONTRACT, itemId: 2n, balance: 1n, totalSupply: 1n, metadataHash: '' },
    ]);
    expect(g[0]!.items.map((i) => i.itemId)).toEqual([2n, 5n]);
  });
});

describe('approval copy for multi-token calldata', () => {
  it('describes transfer, mint batch, and keeps wBOING unwrap', () => {
    expect(describeCalldataIntent(encodeMultiTokenTransferCalldata(OTHER, 3, 40))!.summary).toMatch(
      /^Send 40 × item #3 to /
    );
    const mb = describeCalldataIntent(encodeMultiTokenMintBatchCalldata(OWNER, [{ itemId: 1, amount: 2 }]))!;
    expect(mb.action).toBe('Mint items');
    const unwrap = new Uint8Array(64);
    unwrap[31] = 0x21;
    unwrap[63] = 5;
    expect(describeCalldataIntent(unwrap)!.action).toBe('Unwrap');
  });
});
