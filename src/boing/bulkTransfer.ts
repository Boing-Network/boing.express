/**
 * Bulk transfers (many recipients, one asset). The Boing tx format has no batch payload
 * (transfer / contract_call / deploy / bond / unbond / claim_unbond / qa_pool_vote only), so a bulk send is
 * N independent signed transactions with consecutive nonces. It is NOT atomic: rows before a failure stay
 * sent. The runner stops at the first failure and never retries. See docs/BULK-TRANSFER.md.
 */

export const BULK_MAX_ROWS = 100;

export interface BulkRowInput {
  to: string;
  amount: string;
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
 * Parse pasted CSV: one `address,amount` per line. Separators: comma, semicolon, tab or spaces.
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
    if (parts.length !== 2) {
      issues.push({ row: rows.length, field: 'row', message: `${source}: expected "address,amount", got ${parts.length} field(s)` });
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
