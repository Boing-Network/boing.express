import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX_STEPS,
  batchHistorySummary,
  estimateBatchFee,
  feeFromGas,
  isBatchUnsupportedError,
  planBulkMode,
  validateMixedBulkRows,
} from '../src/boing/bulkTransfer';

const ME = '11'.repeat(32);
const A = '22'.repeat(32);
const B = '33'.repeat(32);
const TOK = '0x' + 'ab'.repeat(32);

describe('native batch helpers', () => {
  it('plans batch only when supported and within the step cap', () => {
    expect(planBulkMode(3, true)).toBe('batch');
    expect(planBulkMode(BATCH_MAX_STEPS, true)).toBe('batch');
    expect(planBulkMode(BATCH_MAX_STEPS + 1, true)).toBe('sequential');
    expect(planBulkMode(3, false)).toBe('sequential');
    expect(planBulkMode(9, true, 8)).toBe('sequential');
    expect(planBulkMode(0, true)).toBe('sequential');
  });

  it('fee schedule matches the node (21k base + 7k/step, 21k gas = 1 BOING, rounded up)', () => {
    expect(estimateBatchFee(16)).toEqual({ gas: 133_000n, fee: 7n });
    expect(estimateBatchFee(1)).toEqual({ gas: 28_000n, fee: 2n });
    expect(feeFromGas(21_000n)).toBe(1n);
    expect(feeFromGas(21_001n)).toBe(2n);
    expect(feeFromGas(0n)).toBe(0n);
  });

  it('recognises a pre-batch node decode error', () => {
    expect(isBatchUnsupportedError('Invalid transaction: invalid value: integer `9`, expected variant index 0 <= i < 9')).toBe(true);
    expect(isBatchUnsupportedError('insufficient balance for fee')).toBe(false);
    expect(isBatchUnsupportedError(undefined)).toBe(false);
  });
});

describe('validateMixedBulkRows', () => {
  const assets = {
    boing: { symbol: 'BOING', decimals: 0, balance: 100n },
    [TOK]: { symbol: 'TKN', decimals: 2, balance: 1_000n },
  };

  it('validates each asset with its own decimals and balance; same recipient across assets is fine', () => {
    const v = validateMixedBulkRows(
      [
        { to: A, amount: '10', assetKey: 'boing' },
        { to: A, amount: '2.5', assetKey: TOK },
        { to: B, amount: '5', assetKey: 'boing' },
      ],
      { senderHex: ME, assets }
    );
    expect(v.ok).toBe(true);
    expect(v.rows.map((r) => [r.row, r.assetKey, r.amount])).toEqual([
      [0, 'boing', 10n],
      [1, TOK, 250n],
      [2, 'boing', 5n],
    ]);
    expect(v.totals).toEqual({ boing: 15n, [TOK]: 250n });
  });

  it('reports per-asset problems with original row numbers', () => {
    const v = validateMixedBulkRows(
      [
        { to: A, amount: '1', assetKey: 'boing', source: 'Row 1' },
        { to: A, amount: '1.234', assetKey: TOK, source: 'Row 2' },
        { to: A, amount: '1', assetKey: 'boing', source: 'Row 3' },
        { to: B, amount: '20', assetKey: TOK, source: 'Row 4' },
      ],
      { senderHex: ME, assets }
    );
    expect(v.ok).toBe(false);
    const msgs = v.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Row 2: amount must be a positive number with at most 2 decimals/);
    expect(msgs).toMatch(/Row 3: duplicate recipient \(same as Row 1\)/);
    expect(v.issues.find((i) => i.message.includes('Row 3'))!.row).toBe(2);
    expect(
      validateMixedBulkRows([{ to: B, amount: '20', assetKey: TOK }], { senderHex: ME, assets }).issues[0]!.message
    ).toMatch(/^TKN: Total 2000 exceeds balance 1000/);
  });

  it('rejects unknown assets', () => {
    const v = validateMixedBulkRows([{ to: A, amount: '1', assetKey: '0x' + 'cd'.repeat(32) }], { senderHex: ME, assets });
    expect(v.ok).toBe(false);
    expect(v.issues[0]!.message).toMatch(/asset not available/);
  });
});

describe('batchHistorySummary', () => {
  it('one entry with one line per step', () => {
    const rows = [
      { row: 0, toHex: A, amount: 1n, amountInput: '1', assetKey: 'boing' },
      { row: 1, toHex: B, amount: 2n, amountInput: '2', assetKey: 'boing' },
    ];
    const s = batchHistorySummary(rows, (_k, v) => `${v} BOING`, (h) => h.slice(0, 4));
    expect(s.summary).toBe('Batch of 2 (atomic): 3 BOING total');
    expect(s.steps).toEqual(['1. 1 BOING → 2222', '2. 2 BOING → 3333']);
    const mixed = batchHistorySummary([rows[0]!, { ...rows[1]!, assetKey: TOK }], (_k, v) => `${v}`, (h) => h);
    expect(mixed.summary).toBe('Batch of 2 (atomic), 2 assets');
  });
});
