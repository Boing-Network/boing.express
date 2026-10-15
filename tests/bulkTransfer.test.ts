import { describe, expect, it, vi } from 'vitest';
import {
  formatBulkReport,
  parseBulkAmount,
  parseBulkCsv,
  runSequentialBulkTransfer,
  validateBulkRows,
} from '../src/boing/bulkTransfer';

const ME = 'aa'.repeat(32);
const A = '11'.repeat(32);
const B = '22'.repeat(32);
const C = '33'.repeat(32);

describe('parseBulkCsv', () => {
  it('parses comma/semicolon/tab/space rows, skips header, blanks and comments', () => {
    const { rows, issues } = parseBulkCsv(`address,amount\n0x${A},10\n\n# note\n${B}; 5\n${C}\t7\n${A.slice(0, 64)} 1`);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.to.replace(/^0x/, ''), r.amount])).toEqual([
      [A, '10'],
      [B, '5'],
      [C, '7'],
      [A, '1'],
    ]);
    expect(rows[0]!.source).toBe('CSV line 2');
  });
  it('flags rows with the wrong number of fields', () => {
    const { rows, issues } = parseBulkCsv(`${A},1,2\n${B}`);
    expect(rows).toHaveLength(2);
    expect(issues.map((i) => i.row)).toEqual([0, 1]);
  });
});

describe('parseBulkAmount', () => {
  it('is strict about decimals', () => {
    expect(parseBulkAmount('10', 0)).toBe(10n);
    expect(parseBulkAmount('1.5', 0)).toBeNull();
    expect(parseBulkAmount('1.5', 2)).toBe(150n);
    expect(parseBulkAmount('1.505', 2)).toBeNull();
    expect(parseBulkAmount('-1', 0)).toBeNull();
    expect(parseBulkAmount('1e3', 0)).toBeNull();
  });
});

describe('validateBulkRows', () => {
  const base = { senderHex: ME, decimals: 0, balance: 100n };
  it('accepts a clean batch and sums the total', () => {
    const v = validateBulkRows([{ to: A, amount: '10' }, { to: `0x${B}`, amount: '20' }], base);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(30n);
    expect(v.rows.map((r) => r.toHex)).toEqual([A, B]);
  });
  it('rejects bad address, self-transfer, duplicate recipient and bad amount', () => {
    const v = validateBulkRows(
      [
        { to: 'xyz', amount: '1' },
        { to: ME, amount: '1' },
        { to: A, amount: '1' },
        { to: A.toUpperCase(), amount: '2' },
        { to: B, amount: '0' },
      ],
      base
    );
    expect(v.ok).toBe(false);
    const byRow = (r: number) => v.issues.filter((i) => i.row === r).map((i) => i.message).join(' ');
    expect(byRow(0)).toMatch(/64 hex/);
    expect(byRow(1)).toMatch(/own address/);
    expect(byRow(2)).toBe('');
    expect(byRow(3)).toMatch(/duplicate recipient.*Row 3/);
    expect(byRow(4)).toMatch(/positive/);
  });
  it('rejects a total above the balance and unknown balance', () => {
    expect(validateBulkRows([{ to: A, amount: '60' }, { to: B, amount: '50' }], base).issues.some((i) => i.field === 'total')).toBe(true);
    expect(validateBulkRows([{ to: A, amount: '1' }], { ...base, balance: null }).ok).toBe(false);
  });
  it('rejects empty and oversized batches', () => {
    expect(validateBulkRows([], base).ok).toBe(false);
    const many = Array.from({ length: 3 }, (_, i) => ({ to: String(i + 1).padStart(64, '0'), amount: '1' }));
    expect(validateBulkRows(many, { ...base, maxRows: 2 }).ok).toBe(false);
  });
});

describe('runSequentialBulkTransfer', () => {
  const rows = validateBulkRows([{ to: A, amount: '1' }, { to: B, amount: '2' }, { to: C, amount: '3' }], {
    senderHex: ME,
    decimals: 0,
    balance: 10n,
  }).rows;

  it('signs with consecutive nonces and submits every row in order', async () => {
    const sign = vi.fn(async (r: { toHex: string }, n: bigint) => `${r.toHex}:${n}`);
    const submit = vi.fn(async (hex: string) => ({ success: true, txHash: `h-${hex.split(':')[1]}` }));
    const progress: string[][] = [];
    const rep = await runSequentialBulkTransfer({ rows, startNonce: 7n, sign, submit, onProgress: (r) => progress.push(r.map((x) => x.status)) });
    expect(sign.mock.calls.map((c) => c[1])).toEqual([7n, 8n, 9n]);
    expect(submit.mock.calls.map((c) => c[0])).toEqual([`${A}:7`, `${B}:8`, `${C}:9`]);
    expect(rep.submitted).toBe(3);
    expect(rep.failedRow).toBeNull();
    expect(rep.results.map((r) => r.txHash)).toEqual(['h-7', 'h-8', 'h-9']);
    expect(progress[0]).toEqual(['pending', 'pending', 'pending']);
    expect(progress.at(-1)).toEqual(['submitted', 'submitted', 'submitted']);
  });

  it('stops at the first failure, never retries, and reports which rows succeeded', async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ success: true, txHash: 'h1' })
      .mockResolvedValueOnce({ success: false, error: 'insufficient balance' });
    const sign = vi.fn(async () => 'hex');
    const rep = await runSequentialBulkTransfer({ rows, startNonce: 0n, sign, submit });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(rep.results.map((r) => r.status)).toEqual(['submitted', 'failed', 'not_sent']);
    expect(rep.failedRow).toBe(1);
    expect(rep.results[1]!.error).toBe('insufficient balance');
    const text = formatBulkReport(rep, (v) => `${v} BOING`);
    expect(text).toMatch(/Stopped at row 2: 1 of 3 submitted/);
    expect(text).toMatch(/#1 .*submitted \(h1\)/);
    expect(text).toMatch(/#3 .*not sent/);
  });

  it('treats a signing throw as a failure', async () => {
    const rep = await runSequentialBulkTransfer({
      rows,
      startNonce: 0n,
      sign: async () => {
        throw new Error('locked');
      },
      submit: vi.fn(),
    });
    expect(rep.failedRow).toBe(0);
    expect(rep.submitted).toBe(0);
  });

  it('honours cancellation between rows', async () => {
    let n = 0;
    const rep = await runSequentialBulkTransfer({
      rows,
      startNonce: 0n,
      sign: async () => 'x',
      submit: async () => ({ success: true }),
      shouldCancel: () => n++ >= 1,
    });
    expect(rep.cancelled).toBe(true);
    expect(rep.results.map((r) => r.status)).toEqual(['submitted', 'not_sent', 'not_sent']);
  });
});
