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
  it('18 decimals: batch fee is gas x 10^12 base units', () => {
    expect(estimateBatchFee(1, 0n, 18)).toEqual({ gas: 28_000n, fee: 28_000_000_000_000_000n });
    expect(feeFromGas(133_000n, 18)).toBe(133_000_000_000_000_000n);
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

import { nftAssetKey, nftTokenIdLabel, parseBulkCsv, resolveCsvAsset } from '../src/boing/bulkTransfer';

const COLL = 'cd'.repeat(32);
const id7 = (7).toString(16).padStart(64, '0');

describe('NFT rows', () => {
  const assets = { boing: { symbol: 'BOING', decimals: 0, balance: 100n } };
  const nfts = [
    { collectionHex: COLL, tokenIdHex: id7 },
    { collectionHex: COLL, tokenIdHex: (8).toString(16).padStart(64, '0') },
  ];
  const k7 = nftAssetKey(COLL, id7);

  it('valid NFT rows have amount 1 and carry collection + token id', () => {
    const v = validateMixedBulkRows(
      [
        { to: A, amount: '', assetKey: k7 },
        { to: A, amount: '3', assetKey: 'boing' },
      ],
      { senderHex: ME, assets, nfts }
    );
    expect(v.ok).toBe(true);
    expect(v.rows[0]).toMatchObject({ row: 0, amount: 1n, nft: { collectionHex: COLL, tokenIdHex: id7 } });
    expect(v.totals).toEqual({ boing: 3n });
  });

  it('guards: duplicate NFT, self-send, not held, stray amount', () => {
    const v = validateMixedBulkRows(
      [
        { to: A, amount: '', assetKey: k7, source: 'Row 1' },
        { to: B, amount: '', assetKey: k7, source: 'Row 2' },
        { to: ME, amount: '', assetKey: nftAssetKey(COLL, (8).toString(16).padStart(64, '0')), source: 'Row 3' },
        { to: B, amount: '', assetKey: nftAssetKey(COLL, (9).toString(16).padStart(64, '0')), source: 'Row 4' },
        { to: B, amount: '2', assetKey: nftAssetKey(COLL, (8).toString(16).padStart(64, '0')), source: 'Row 5' },
      ],
      { senderHex: ME, assets, nfts }
    );
    const m = v.issues.map((i) => i.message).join('\n');
    expect(v.ok).toBe(false);
    expect(m).toMatch(/Row 2: same NFT as Row 1/);
    expect(m).toMatch(/Row 3: cannot send to your own address/);
    expect(m).toMatch(/Row 4: you do not hold this NFT \(#9\)/);
    expect(m).toMatch(/Row 5: NFT rows have no amount/);
  });

  it('token id labels', () => {
    expect(nftTokenIdLabel(id7)).toBe('#7');
    expect(nftTokenIdLabel('ab'.repeat(32))).toBe('#abab…abab');
  });

  it('batch history summary counts NFTs', () => {
    const rows = [
      { row: 0, toHex: A, amount: 1n, amountInput: '1', assetKey: k7, nft: { collectionHex: COLL, tokenIdHex: id7 } },
      { row: 1, toHex: B, amount: 2n, amountInput: '2', assetKey: 'boing' },
    ];
    const s = batchHistorySummary(rows, (k, v) => (k.startsWith('nft:') ? 'NFT #7' : `${v} BOING`), (h) => h.slice(0, 4));
    expect(s.summary).toBe('Batch of 2 (atomic), 2 asset types, 1 NFT');
    expect(s.steps[0]).toBe('1. NFT #7 → 2222');
  });
});

describe('CSV asset column', () => {
  it('parses address,amount / address,amount,asset / NFT forms', () => {
    const { rows, issues } = parseBulkCsv(
      ['address,amount,asset', `0x${A},5`, `${A},2.5,TKN`, `${B},nft:${COLL}:7`, `${B},,nft:${COLL}:8`, `${B},1,nft:${COLL}:9`, 'x,y,z,w'].join('\n')
    );
    expect(rows.slice(0, 5).map((r) => [r.amount, r.asset])).toEqual([
      ['5', undefined],
      ['2.5', 'TKN'],
      ['', `nft:${COLL}:7`],
      ['', `nft:${COLL}:8`],
      ['', `nft:${COLL}:9`],
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/expected "address,amount\[,asset\]"/);
  });

  it('resolves assets', () => {
    const tokens = [{ tokenHex: '0x' + 'ab'.repeat(32), symbol: 'TKN' }];
    expect(resolveCsvAsset(undefined, { defaultKey: 'boing', tokens })).toEqual({ key: 'boing' });
    expect(resolveCsvAsset('boing', { defaultKey: 'x', tokens })).toEqual({ key: 'boing' });
    expect(resolveCsvAsset('tkn', { defaultKey: 'boing', tokens })).toEqual({ key: tokens[0]!.tokenHex });
    expect(resolveCsvAsset('ab'.repeat(32), { defaultKey: 'boing', tokens })).toEqual({ key: tokens[0]!.tokenHex });
    expect(resolveCsvAsset(`nft:0x${COLL}:7`, { defaultKey: 'boing', tokens })).toEqual({ key: nftAssetKey(COLL, id7) });
    expect(resolveCsvAsset('XYZ', { defaultKey: 'boing', tokens })).toHaveProperty('error');
    expect(resolveCsvAsset(`nft:${COLL}:0`, { defaultKey: 'boing', tokens })).toHaveProperty('error');
  });
});
