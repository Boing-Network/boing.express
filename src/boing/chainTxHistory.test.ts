import { describe, expect, it } from 'vitest';
import { chainRowToDisplay, mergeTxHistory, type ChainTxRow } from './chainTxHistory';
import type { TxHistoryEntry } from '../storage/txHistory';

const ME = '0x' + 'd6'.repeat(32);
const row = (o: Partial<ChainTxRow>): ChainTxRow => ({
  tx_id: '0x' + 'aa'.repeat(32), block_height: 10, tx_index: 0, timestamp: 1_700_000_000,
  sender: ME, nonce: 0, direction: 'out', payload: { kind: 'transfer', to: '0x' + '11'.repeat(32), amount: '5' },
  success: true, error: null, ...o,
});

describe('chainTxHistory', () => {
  it('maps faucet receipts, batches and failures', () => {
    const inc = chainRowToDisplay(row({ direction: 'in', sender: '0x' + 'fa'.repeat(32) }));
    expect(inc.label).toBe('Receive BOING');
    expect(inc.summary).toContain('from 0xfafa');
    expect(inc.timestamp).toBe(1_700_000_000_000);
    const b = chainRowToDisplay(row({ payload: { kind: 'batch', steps: [
      { kind: 'contract_call', contract: '0x' + 'eb'.repeat(32) }, { kind: 'transfer', to: '0x' + '22'.repeat(32), amount: '3' }] } }));
    expect(b.label).toBe('Batch');
    expect(b.steps).toHaveLength(2);
    const f = chainRowToDisplay(row({ success: false, error: 'boom' }));
    expect(f.status).toBe('failed');
    expect(f.summary).toMatch(/^Not transferred \(failed\): 5 BOING → /);
    expect(f.summary).toContain('only the fee was charged');
  });

  it('keeps the failed wording when a local optimistic summary exists', () => {
    const c = chainRowToDisplay(row({ success: false, payload: { kind: 'transfer', to: '0x' + '42'.repeat(32), amount: '1' + '0'.repeat(30) } }));
    const local: TxHistoryEntry[] = [
      { txHash: 'aa'.repeat(32), type: 'send', summary: 'Sent 1e30 BOING', networkId: 't', addressHint: 'x', timestamp: 1 },
    ];
    const [m] = mergeTxHistory(local, [c], { chainLoaded: true });
    expect(m.status).toBe('failed');
    expect(m.summary).toBe('Not transferred (failed): Sent 1e30 BOING. Reverted, only the fee was charged.');
  });

  it('merges local and chain entries, deduping and keeping pending first', () => {
    const now = 2_000_000_000_000;
    const chain = [chainRowToDisplay(row({})), chainRowToDisplay(row({ tx_id: '0x' + 'bb'.repeat(32), block_height: 12 }))];
    const local: TxHistoryEntry[] = [
      { txHash: 'AA'.repeat(32), type: 'send', summary: 'local summary', networkId: 't', addressHint: 'x', timestamp: now - 1e9 },
      { txHash: '0x' + 'cc'.repeat(32), type: 'batch', steps: ['1. a', '2. b'], networkId: 't', addressHint: 'x', timestamp: now - 1000 },
      { txHash: '0x' + 'dd'.repeat(32), type: 'bond', networkId: 't', addressHint: 'x', timestamp: now - 1e9 },
    ];
    const m = mergeTxHistory(local, chain, { now, chainLoaded: true });
    expect(m.map((e) => e.txHash.slice(2, 4))).toEqual(['cc', 'dd', 'bb', 'aa']);
    expect(m[0].status).toBe('pending');
    expect(m[3].summary).toBe('local summary');
    expect(m[3].source).toBe('both');
    expect(m[1].status).toBe('confirmed');
  });
});