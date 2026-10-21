import { describe, expect, it } from 'vitest';
import { encodeSignedTransaction, transactionIdFromSignedTransactionHex } from './bincode';
import { transactionFromDappJson } from './dappTxRequest';
import { signableHashV2, signableHashWithTip } from './signing';
import { accountIdFromHex } from './types';

const SENDER = accountIdFromHex('11'.repeat(32));
const TO = '22'.repeat(32);

describe('dApp priority tip', () => {
  it('parses priority_tip and binds into tip domain when non-zero', () => {
    const tx = transactionFromDappJson(
      { type: 'transfer', to: TO, amount: '1', priority_tip: '210000000000000' },
      SENDER,
      0n
    );
    expect(tx.priorityTip).toBe(210000000000000n);
    const chainId = 6913n;
    expect(signableHashWithTip(tx, chainId)).not.toEqual(signableHashV2(tx, chainId));
  });

  it('omits tip from wire when zero / absent', () => {
    const tx = transactionFromDappJson({ type: 'transfer', to: TO, amount: '1' }, SENDER, 0n);
    expect(tx.priorityTip).toBeUndefined();
    const signed = encodeSignedTransaction({ tx, signature: new Uint8Array(64) });
    // tx body + sig length + 64 bytes; no tip trailer
    expect(signed.length).toBeGreaterThan(72);
    const id = transactionIdFromSignedTransactionHex(
      Array.from(signed)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
    expect(id.startsWith('0x')).toBe(true);
  });
});
