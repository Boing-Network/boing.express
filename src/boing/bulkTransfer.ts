/**
 * Bulk transfers (many recipients; BOING and tokens can be mixed).
 * - Batch path: nodes that advertise `tx_payload_batch` accept ONE signed tx with up to 16 steps,
 *   applied all-or-nothing (see helpers at the bottom of this file).
 * - Sequential fallback (older nodes, or more than 16 rows): N independent signed transactions with
 *   consecutive nonces. NOT atomic: rows before a failure stay sent. Stops at the first failure and never
 *   retries. See docs/BULK-TRANSFER.md.
 */

export const BULK_MAX_ROWS = 100;

import { normalizeHex64, parseTokenIdInput } from './referenceNft';

export interface BulkRowInput {
  to: string;
  amount: string;
  /** Optional third CSV column (asset): `BOING`, token symbol / hex, or `nft:<collection>:<tokenId>`. */
  asset?: string;
  /** Where the row came from, for error messages (e.g. "CSV line 3"). */
  source?: string;
}

export interface BulkIssue {
  /** 0-based row index, or -1 for whole-batch issues (total, row count). */
  row: number;
  field: 'to' | 'amount' | 'row' | 'total';
  message: string;
}

export interface BulkRowValid {
  row: number;
  toHex: string;
  amount: bigint;
  amountInput: string;
}

export interface BulkValidation {
  ok: boolean;
  rows: BulkRowValid[];
  issues: BulkIssue[];
  total: bigint;
}

/**
 * Parse pasted CSV. One row per line; separators: comma, semicolon, tab or spaces.
 * - `address,amount` — uses the panel's default asset
 * - `address,amount,asset` — asset = `BOING`, a token symbol or token contract hex
 * - `address,nft:<collectionHex>:<tokenId>` (or `address,,nft:…` / `address,1,nft:…`) — one NFT, no amount
 * Blank lines and `#` comments are skipped; a first line without a hex address (e.g. `address,amount`) is a header.
 */
export function parseBulkCsv(text: string): { rows: BulkRowInput[]; issues: BulkIssue[] } {
  const rows: BulkRowInput[] = [];
  const issues: BulkIssue[] = [];
  const lines = text.split(/\r?\n/);
  let firstContent = true;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const parts = t.split(/\s*[,;\t]\s*|\s+/).filter((p) => p !== '');
    if (firstContent) {
      firstContent = false;
      if (parts.length >= 1 && !/^(0x)?[0-9a-f]{8,}$/i.test(parts[0]!) && /addr|to|recipient/i.test(parts[0]!)) return;
    }
    const source = `CSV line ${i + 1}`;
    if (parts.length === 2 && /^nft:/i.test(parts[1]!)) {
      rows.push({ to: parts[0]!, amount: '', asset: parts[1]!, source });
      return;
    }
    if (parts.length === 3) {
      const nft = /^nft:/i.test(parts[2]!);
      rows.push({ to: parts[0]!, amount: nft ? '' : parts[1]!, asset: parts[2]!, source });
      return;
    }
    if (parts.length !== 2) {
      issues.push({
        row: rows.length,
        field: 'row',
        message: `${source}: expected "address,amount[,asset]" or "address,nft:<collection>:<tokenId>", got ${parts.length} field(s)`,
      });
      rows.push({ to: parts[0] ?? '', amount: parts[1] ?? '', source });
      return;
    }
    rows.push({ to: parts[0]!, amount: parts[1]!, source });
  });
  return { rows, issues };
}

/** Strict decimal parse: rejects more fractional digits than `decimals` (no silent truncation). */
export function parseBulkAmount(input: string, decimals: number): bigint | null {
  const s = input.trim().replace(/_/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  const v = BigInt(intPart!) * 10n ** BigInt(decimals) + BigInt((frac || '0').padEnd(decimals, '0') || '0');
  return v;
}

export function validateBulkRows(
  input: BulkRowInput[],
  opts: {
    senderHex: string;
    decimals: number;
    /** Spendable balance in smallest units; null = unknown (validation then fails with a total issue). */
    balance: bigint | null;
    maxRows?: number;
    /** Extra issues from parsing (e.g. malformed CSV lines). */
    parseIssues?: BulkIssue[];
  }
): BulkValidation {
  const issues: BulkIssue[] = [...(opts.parseIssues ?? [])];
  const rows: BulkRowValid[] = [];
  const sender = opts.senderHex.replace(/^0x/i, '').toLowerCase();
  const seen = new Map<string, number>();
  const max = opts.maxRows ?? BULK_MAX_ROWS;
  const label = (i: number) => input[i]?.source ?? `Row ${i + 1}`;
  if (input.length === 0) issues.push({ row: -1, field: 'row', message: 'Add at least one recipient.' });
  if (input.length > max) issues.push({ row: -1, field: 'row', message: `Too many rows (${input.length}); the limit is ${max}.` });
  let total = 0n;
  input.forEach((r, i) => {
    if (issues.some((x) => x.row === i && x.field === 'row')) return;
    const toHex = r.to.replace(/\s/g, '').replace(/^0x/i, '').toLowerCase();
    let bad = false;
    if (!/^[0-9a-f]{64}$/.test(toHex)) {
      issues.push({ row: i, field: 'to', message: `${label(i)}: address must be 64 hex characters (0x optional)` });
      bad = true;
    } else if (toHex === sender) {
      issues.push({ row: i, field: 'to', message: `${label(i)}: cannot send to your own address` });
      bad = true;
    } else if (seen.has(toHex)) {
      issues.push({ row: i, field: 'to', message: `${label(i)}: duplicate recipient (same as ${label(seen.get(toHex)!)}); merge the rows` });
      bad = true;
    } else {
      seen.set(toHex, i);
    }
    const amount = parseBulkAmount(r.amount, opts.decimals);
    if (amount == null || amount <= 0n) {
      issues.push({
        row: i,
        field: 'amount',
        message: `${label(i)}: amount must be a positive number${opts.decimals === 0 ? ' (whole units)' : ` with at most ${opts.decimals} decimals`}`,
      });
      bad = true;
    }
    if (!bad && amount != null) {
      rows.push({ row: i, toHex, amount, amountInput: r.amount.trim() });
      total += amount;
    }
  });
  if (opts.balance == null) {
    issues.push({ row: -1, field: 'total', message: 'Balance unknown; refresh and try again.' });
  } else if (total > opts.balance) {
    issues.push({ row: -1, field: 'total', message: `Total ${total} exceeds balance ${opts.balance}.` });
  }
  return { ok: issues.length === 0 && rows.length === input.length, rows, issues, total };
}

export type BulkRowStatus = 'pending' | 'signing' | 'submitted' | 'failed' | 'not_sent';

export interface BulkRowResult {
  row: number;
  toHex: string;
  amount: bigint;
  status: BulkRowStatus;
  nonce?: bigint;
  txHash?: string;
  error?: string;
}

export interface BulkRunReport {
  results: BulkRowResult[];
  submitted: number;
  /** Row index of the failure that stopped the run, or null if all rows were submitted. */
  failedRow: number | null;
  cancelled: boolean;
}

/**
 * Sign + submit rows one by one with nonces `startNonce, startNonce+1, …`.
 * Stops at the first failure (sign throw, submit error or `success:false`); later rows are `not_sent`.
 * No retries. The nonce only advances after an accepted submit, so a failed row never leaves a nonce gap.
 */
export async function runSequentialBulkTransfer(opts: {
  rows: BulkRowValid[];
  startNonce: bigint;
  sign: (row: BulkRowValid, nonce: bigint) => Promise<string>;
  submit: (signedHex: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  onProgress?: (results: BulkRowResult[]) => void;
  /** Checked before each row; returning true stops the run (remaining rows `not_sent`). */
  shouldCancel?: () => boolean;
}): Promise<BulkRunReport> {
  const results: BulkRowResult[] = opts.rows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'pending' }));
  const emit = () => opts.onProgress?.(results.map((r) => ({ ...r })));
  let nonce = opts.startNonce;
  let failedRow: number | null = null;
  let cancelled = false;
  emit();
  for (let i = 0; i < opts.rows.length; i++) {
    const res = results[i]!;
    if (opts.shouldCancel?.()) {
      cancelled = true;
      for (let j = i; j < results.length; j++) {
        results[j]!.status = 'not_sent';
        results[j]!.error = 'Cancelled before sending';
      }
      break;
    }
    res.status = 'signing';
    res.nonce = nonce;
    emit();
    try {
      const hex = await opts.sign(opts.rows[i]!, nonce);
      const out = await opts.submit(hex);
      if (!out.success) throw new Error(out.error || 'Submit failed');
      res.status = 'submitted';
      res.txHash = out.txHash;
      nonce += 1n;
    } catch (e) {
      res.status = 'failed';
      res.error = e instanceof Error ? e.message : String(e);
      failedRow = res.row;
      for (let j = i + 1; j < results.length; j++) {
        results[j]!.status = 'not_sent';
        results[j]!.error = 'Not sent: stopped after the failed row';
      }
      emit();
      break;
    }
    emit();
  }
  return { results, submitted: results.filter((r) => r.status === 'submitted').length, failedRow, cancelled };
}

/** Plain-text report of a run (rows that succeeded, the failure, rows not sent). */
export function formatBulkReport(report: BulkRunReport, fmtAmount: (v: bigint) => string): string {
  const lines = report.results.map((r) => {
    const who = `${r.toHex.slice(0, 8)}…${r.toHex.slice(-6)}`;
    const head = `#${r.row + 1} ${who} ${fmtAmount(r.amount)}`;
    if (r.status === 'submitted') return `${head}: submitted${r.txHash ? ` (${r.txHash})` : ''}`;
    if (r.status === 'failed') return `${head}: FAILED: ${r.error ?? ''}`;
    return `${head}: not sent`;
  });
  const summary =
    report.failedRow == null
      ? report.cancelled
        ? `Cancelled: ${report.submitted} of ${report.results.length} submitted.`
        : `All ${report.submitted} transfers submitted.`
      : `Stopped at row ${report.failedRow + 1}: ${report.submitted} of ${report.results.length} submitted; the rest were not sent.`;
  return [summary, ...lines].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Native atomic batch (node release with `TransactionPayload::Batch`, see boing.network
// docs/NATIVE-BATCH-TRANSACTIONS.md). Up to 16 steps in ONE signed tx: all succeed or none do.
// ---------------------------------------------------------------------------------------------

/** Protocol cap on steps per batch tx (`MAX_BATCH_CALLS`). */
export const BATCH_MAX_STEPS = 16;
/** Gas schedule mirrored from boing-execution (`GAS_BATCH_BASE`, `GAS_PER_BATCH_*`). */
export const BATCH_GAS_BASE = 21_000n;
export const BATCH_GAS_PER_STEP = 7_000n;
/** 21 000 gas = 1 BOING (`GAS_UNITS_PER_BOING`, `GAS_PRICE` = 1). */
export const GAS_UNITS_PER_BOING = 21_000n;

export type BulkMode = 'batch' | 'sequential';

/** Batch when the node advertises support and the rows fit in one tx; otherwise one tx per row. */
export function planBulkMode(rowCount: number, batchSupported: boolean, maxSteps = BATCH_MAX_STEPS): BulkMode {
  return batchSupported && rowCount >= 1 && rowCount <= Math.min(maxSteps, BATCH_MAX_STEPS) ? 'batch' : 'sequential';
}

/** Fee in BOING for a batch: envelope + per-step gas + interpreter gas of token steps (from simulation, if known). */
export function estimateBatchFee(stepCount: number, interpreterGas = 0n): { gas: bigint; fee: bigint } {
  const gas = BATCH_GAS_BASE + BATCH_GAS_PER_STEP * BigInt(stepCount) + interpreterGas;
  return { gas, fee: (gas + GAS_UNITS_PER_BOING - 1n) / GAS_UNITS_PER_BOING };
}

/** Fee from a simulated batch's total `gas_used` (already includes envelope + steps). */
export function feeFromGas(gasUsed: bigint): bigint {
  return gasUsed <= 0n ? 0n : (gasUsed + GAS_UNITS_PER_BOING - 1n) / GAS_UNITS_PER_BOING;
}

/**
 * `true` when an RPC error means "this node cannot decode a batch payload" (pre-batch release):
 * bincode reports an out-of-range enum variant. Such a rejection means nothing was sent.
 */
export function isBatchUnsupportedError(message: string | undefined): boolean {
  if (!message) return false;
  return /variant index|unknown variant|expected variant|invalid value: integer `9`/i.test(message);
}

/** NFT asset keys look like `nft:<collection64>:<tokenId64>` (lowercase hex, no 0x). */
export function nftAssetKey(collectionHex: string, tokenIdHex: string): string {
  return `nft:${normalizeHex64(collectionHex)}:${normalizeHex64(tokenIdHex)}`;
}

export function isNftAssetKey(key: string): boolean {
  return key.startsWith('nft:');
}

export function parseNftAssetKey(key: string): { collectionHex: string; tokenIdHex: string } | null {
  const m = /^nft:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(key);
  return m ? { collectionHex: m[1]!, tokenIdHex: m[2]! } : null;
}

/** Short display for an NFT token id word: sequential ids as `#5`, opaque words as `#ab12…cd34`. */
export function nftTokenIdLabel(tokenIdHex: string): string {
  const v = BigInt(`0x${tokenIdHex}`);
  return v > 0n && v < 1n << 64n ? `#${v}` : `#${tokenIdHex.slice(0, 4)}…${tokenIdHex.slice(-4)}`;
}

/**
 * Resolve the CSV asset column to an asset key. Empty → `defaultKey`.
 * Returns `{ error }` for unknown tokens or malformed NFT references.
 */
export function resolveCsvAsset(
  raw: string | undefined,
  opts: { defaultKey: string; tokens: Array<{ tokenHex: string; symbol: string }> }
): { key: string } | { error: string } {
  const t = (raw ?? '').trim();
  if (!t) return { key: opts.defaultKey };
  if (/^boing$/i.test(t)) return { key: 'boing' };
  if (/^nft:/i.test(t)) {
    const [, coll = '', id = ''] = t.split(':');
    try {
      return { key: nftAssetKey(coll, parseTokenIdInput(id)) };
    } catch (e) {
      return { error: `bad NFT reference "${t}" (use nft:<collection hex>:<token id>): ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const hex = t.replace(/^0x/i, '').toLowerCase();
  const byHex = /^[0-9a-f]{64}$/.test(hex) ? opts.tokens.find((x) => x.tokenHex.replace(/^0x/i, '').toLowerCase() === hex) : undefined;
  if (byHex) return { key: byHex.tokenHex };
  const bySym = opts.tokens.filter((x) => x.symbol.toLowerCase() === t.toLowerCase());
  if (bySym.length === 1) return { key: bySym[0]!.tokenHex };
  if (bySym.length > 1) return { error: `token symbol "${t}" is ambiguous; use the token contract hex` };
  return { error: `unknown asset "${t}" (not BOING, a held token, or nft:…)` };
}

/** One row of a mixed-asset bulk send. `assetKey` is `'boing'`, a token contract hex, or an NFT key (`nft:…`). */
export interface MixedBulkRowInput extends BulkRowInput {
  assetKey: string;
}

export interface BulkAssetInfo {
  symbol: string;
  decimals: number;
  /** Spendable balance in smallest units; null = unknown. */
  balance: bigint | null;
}

export interface MixedBulkRowValid extends BulkRowValid {
  assetKey: string;
  /** Set for NFT rows (amount is always 1). */
  nft?: { collectionHex: string; tokenIdHex: string };
}

/** An NFT the user holds (same source as the Wallet tab: watchlist + ownership probe). */
export interface OwnedNft {
  collectionHex: string;
  tokenIdHex: string;
  label?: string;
}

export interface MixedBulkValidation {
  ok: boolean;
  rows: MixedBulkRowValid[];
  issues: BulkIssue[];
  /** Total per asset key (smallest units). */
  totals: Record<string, bigint>;
}

/**
 * Validate rows that may use different assets. Each asset is checked against its own decimals and
 * balance; duplicate recipients are only an error within the same asset.
 */
export function validateMixedBulkRows(
  input: MixedBulkRowInput[],
  opts: { senderHex: string; assets: Record<string, BulkAssetInfo>; maxRows?: number; nfts?: OwnedNft[] }
): MixedBulkValidation {
  const issues: BulkIssue[] = [];
  const max = opts.maxRows ?? BULK_MAX_ROWS;
  if (input.length === 0) issues.push({ row: -1, field: 'row', message: 'Add at least one recipient.' });
  if (input.length > max) issues.push({ row: -1, field: 'row', message: `Too many rows (${input.length}); the limit is ${max}.` });
  const groups = new Map<string, number[]>();
  const rows: MixedBulkRowValid[] = [];
  const sender = opts.senderHex.replace(/^0x/i, '').toLowerCase();
  const owned = new Set((opts.nfts ?? []).map((n) => nftAssetKey(n.collectionHex, n.tokenIdHex)));
  const seenNft = new Map<string, number>();
  const label = (i: number) => input[i]?.source ?? `Row ${i + 1}`;
  input.forEach((r, i) => {
    if (isNftAssetKey(r.assetKey)) {
      const toHex = r.to.replace(/\s/g, '').replace(/^0x/i, '').toLowerCase();
      const nft = parseNftAssetKey(r.assetKey);
      let bad = false;
      if (!/^[0-9a-f]{64}$/.test(toHex)) {
        issues.push({ row: i, field: 'to', message: `${label(i)}: address must be 64 hex characters (0x optional)` });
        bad = true;
      } else if (toHex === sender) {
        issues.push({ row: i, field: 'to', message: `${label(i)}: cannot send to your own address` });
        bad = true;
      }
      if (!nft) {
        issues.push({ row: i, field: 'row', message: `${label(i)}: invalid NFT reference` });
        bad = true;
      } else if (!owned.has(r.assetKey)) {
        issues.push({ row: i, field: 'row', message: `${label(i)}: you do not hold this NFT (${nftTokenIdLabel(nft.tokenIdHex)})` });
        bad = true;
      } else if (seenNft.has(r.assetKey)) {
        issues.push({ row: i, field: 'row', message: `${label(i)}: same NFT as ${label(seenNft.get(r.assetKey)!)}; an NFT can only be sent once` });
        bad = true;
      } else {
        seenNft.set(r.assetKey, i);
      }
      const amt = r.amount.trim();
      if (amt !== '' && amt !== '1') {
        issues.push({ row: i, field: 'amount', message: `${label(i)}: NFT rows have no amount` });
        bad = true;
      }
      if (!bad && nft) rows.push({ row: i, toHex, amount: 1n, amountInput: '1', assetKey: r.assetKey, nft });
      return;
    }
    const g = groups.get(r.assetKey) ?? [];
    g.push(i);
    groups.set(r.assetKey, g);
  });
  const totals: Record<string, bigint> = {};
  for (const [assetKey, idxs] of groups) {
    const info = opts.assets[assetKey];
    if (!info) {
      for (const i of idxs) issues.push({ row: i, field: 'row', message: `${input[i]!.source ?? `Row ${i + 1}`}: asset not available` });
      continue;
    }
    const sub = validateBulkRows(
      idxs.map((i) => input[i]!),
      {
        senderHex: opts.senderHex,
        decimals: info.decimals,
        balance: info.balance,
        maxRows: Number.MAX_SAFE_INTEGER,
      }
    );
    for (const is of sub.issues) {
      issues.push({
        ...is,
        row: is.row < 0 ? -1 : idxs[is.row]!,
        message: is.field === 'total' ? `${info.symbol}: ${is.message}` : is.message,
      });
    }
    for (const r of sub.rows) rows.push({ ...r, row: idxs[r.row]!, assetKey });
    totals[assetKey] = sub.total;
  }
  rows.sort((a, b) => a.row - b.row);
  return { ok: issues.length === 0 && rows.length === input.length, rows, issues, totals };
}

/** Human summary for the single Tx-history entry of a batch. */
export function batchHistorySummary(
  rows: MixedBulkRowValid[],
  fmt: (assetKey: string, v: bigint) => string,
  shortHex: (hex: string) => string
): { summary: string; steps: string[] } {
  const steps = rows.map((r, i) => `${i + 1}. ${fmt(r.assetKey, r.amount)} → ${shortHex(r.toHex)}`);
  const assets = new Set(rows.map((r) => (isNftAssetKey(r.assetKey) ? 'nft' : r.assetKey))).size;
  const nfts = rows.filter((r) => isNftAssetKey(r.assetKey)).length;
  if (nfts > 0) {
    const kinds = assets > 1 ? `, ${assets} asset types` : '';
    return { summary: `Batch of ${rows.length} (atomic)${kinds}, ${nfts} NFT${nfts === 1 ? '' : 's'}`, steps };
  }
  const summary = `Batch of ${rows.length} (atomic)${assets > 1 ? `, ${assets} assets` : `: ${fmt(rows[0]!.assetKey, rows.reduce((a, r) => a + r.amount, 0n))} total`}`;
  return { summary, steps };
}
