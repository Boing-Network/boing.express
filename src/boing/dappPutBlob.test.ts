import { describe, expect, it } from 'vitest';
import { encodePayload } from './bincode';
import { transactionFromDappJson, transactionSummary } from './dappTxRequest';
import { accountIdFromHex } from './types';

const sender = accountIdFromHex(`0x${'11'.repeat(32)}`);

describe('put_blob dapp tx', () => {
  it('parses forever PutBlob and encodes variant 21', () => {
    const tx = transactionFromDappJson(
      {
        type: 'put_blob',
        retention: { kind: 'forever' },
        content_type: 'image/png',
        data: '0xaabbcc',
      },
      sender,
      3n,
    );
    expect(tx.payload.kind).toBe('put_blob');
    if (tx.payload.kind !== 'put_blob') throw new Error('expected put_blob');
    expect(tx.payload.data).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    expect(tx.payload.contentType).toBe('image/png');
    expect(tx.payload.retention.kind).toBe('forever');
    const hex = Array.from(encodePayload(tx.payload))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex.startsWith('15000000')).toBe(true);
    expect(transactionSummary(tx)).toMatch(/PutBlob 3 bytes/);
  });

  it('parses prunable retention', () => {
    const tx = transactionFromDappJson(
      {
        type: 'putBlob',
        retention: { kind: 'prunable', ttl_blocks: '1000' },
        data: 'deadbeef',
      },
      sender,
      0n,
    );
    expect(tx.payload.kind).toBe('put_blob');
    if (tx.payload.kind !== 'put_blob') throw new Error('expected put_blob');
    expect(tx.payload.retention).toEqual({ kind: 'prunable', ttlBlocks: 1000n });
  });
});
