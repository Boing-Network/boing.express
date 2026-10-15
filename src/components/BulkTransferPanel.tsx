import { useRef, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex } from '../boing/types';
import { formatBalance } from '../boing/amount';
import { shortHexLabel } from '../boing/referenceNft';
import {
  BATCH_MAX_STEPS,
  BULK_MAX_ROWS,
  batchHistorySummary,
  estimateBatchFee,
  feeFromGas,
  isBatchUnsupportedError,
  parseBulkCsv,
  planBulkMode,
  runSequentialBulkTransfer,
  validateMixedBulkRows,
  type BulkAssetInfo,
  type BulkMode,
  type BulkRowResult,
  type BulkRunReport,
  type MixedBulkRowInput,
  type MixedBulkRowValid,
} from '../boing/bulkTransfer';
import { buildReferenceFungibleTransfer, encodeReferenceFungibleTransferCalldata } from '../boing/referenceFungible';
import type { TokenHolding } from '../boing/tokenHoldings';
import type { NetworkAdapter, BalanceResult, BatchStep } from '../networks/types';
import styles from '../screens/Dashboard.module.css';

type Row = { id: number; to: string; amount: string; asset: string };

const STATUS_LABEL: Record<BulkRowResult['status'], string> = {
  pending: 'Waiting',
  signing: 'Sending…',
  submitted: 'Submitted',
  failed: 'Failed',
  not_sent: 'Not sent',
};

const BOING_KEY = 'boing';

/**
 * Transfer > Bulk: many recipients, BOING and tokens can be mixed.
 * - Batch mode (node advertises `tx_payload_batch`, ≤ 16 rows): ONE signed tx, all-or-nothing.
 * - Sequential fallback (older node, or > 16 rows): one tx per row, stop on first failure, no retries.
 */
export function BulkTransferPanel(props: {
  accountId: AccountId;
  network: NetworkAdapter;
  getPrivateKey: () => Uint8Array | null;
  balance: BalanceResult | null;
  holdings: TokenHolding[];
  onRowSent: (txHash: string | undefined, kind: 'send' | 'token_send', summary: string) => void;
  /** One Tx-history entry for a whole atomic batch. */
  onBatchSent?: (txHash: string | undefined, summary: string, steps: string[]) => void;
  onFinished: () => void;
}) {
  const nextId = useRef(2);
  const [defaultAsset, setDefaultAsset] = useState(BOING_KEY);
  const [rows, setRows] = useState<Row[]>([{ id: 1, to: '', amount: '', asset: BOING_KEY }]);
  const [csv, setCsv] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [stage, setStage] = useState<'edit' | 'review' | 'progress'>('edit');
  const [validated, setValidated] = useState<{ rows: MixedBulkRowValid[]; totals: Record<string, bigint> } | null>(null);
  const [mode, setMode] = useState<BulkMode>('sequential');
  const [modeNote, setModeNote] = useState('');
  const [fee, setFee] = useState<{ fee: bigint; exact: boolean } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [progress, setProgress] = useState<BulkRowResult[]>([]);
  const [runRows, setRunRows] = useState<MixedBulkRowValid[]>([]);
  const [report, setReport] = useState<BulkRunReport | null>(null);
  const [batchOutcome, setBatchOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [startError, setStartError] = useState('');
  const cancelRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  /** Set once the node rejected a batch payload it could not decode (pre-batch release). */
  const batchUnsupportedRef = useRef(false);

  const tokens = props.holdings.filter((t) => t.balanceRaw != null);
  const assets: Record<string, BulkAssetInfo> = {
    [BOING_KEY]: {
      symbol: props.balance?.symbol ?? 'BOING',
      decimals: props.balance?.decimals ?? 0,
      balance: props.balance ? BigInt(props.balance.value) : null,
    },
  };
  for (const t of tokens) assets[t.tokenHex] = { symbol: t.symbol, decimals: t.decimals, balance: BigInt(t.balanceRaw!) };
  const fmtAsset = (key: string, v: bigint) => {
    const a = assets[key] ?? assets[BOING_KEY]!;
    return `${formatBalance(v.toString(), a.decimals, a.decimals)} ${a.symbol}`;
  };
  const fmtBoing = (v: bigint) => fmtAsset(BOING_KEY, v);

  function newRow(to = '', amount = '', asset = defaultAsset): Row {
    return { id: nextId.current++, to, amount, asset };
  }

  function inputs(): MixedBulkRowInput[] {
    return rows
      .map((r, i) => ({ to: r.to.trim(), amount: r.amount.trim(), assetKey: r.asset, source: `Row ${i + 1}` }))
      .filter((r) => r.to || r.amount);
  }

  function importCsv() {
    const parsed = parseBulkCsv(csv);
    const kept = rows.filter((r) => r.to.trim() || r.amount.trim());
    const added = parsed.rows.map((r) => newRow(r.to, r.amount));
    const next = [...kept, ...added];
    setRows(next.length ? next : [newRow()]);
    setIssues(parsed.issues.map((i) => i.message));
    if (parsed.issues.length === 0) setCsv('');
  }

  function stepsFor(vrows: MixedBulkRowValid[]): BatchStep[] {
    return vrows.map((r) =>
      r.assetKey === BOING_KEY
        ? { kind: 'transfer', toHex: `0x${r.toHex}`, amount: r.amount }
        : { kind: 'contractCall', contractHex: r.assetKey, calldata: encodeReferenceFungibleTransferCalldata(r.toHex, r.amount) }
    );
  }

  async function review() {
    const v = validateMixedBulkRows(inputs(), { senderHex: accountIdToHex(props.accountId), assets });
    if (!v.ok) {
      setIssues(v.issues.map((i) => i.message));
      return;
    }
    setIssues([]);
    setReviewBusy(true);
    const net = props.network;
    let supported = false;
    let maxSteps = BATCH_MAX_STEPS;
    if (!batchUnsupportedRef.current && net.getBatchSupport && net.buildBatch) {
      try {
        const s = await net.getBatchSupport();
        supported = s.supported;
        maxSteps = s.maxSteps;
      } catch {
        supported = false;
      }
    }
    const m = planBulkMode(v.rows.length, supported, maxSteps);
    setMode(m);
    setModeNote(
      m === 'batch'
        ? ''
        : batchUnsupportedRef.current || !supported
          ? 'This node does not support batch transactions yet, so each row is sent as its own transaction.'
          : `More than ${Math.min(maxSteps, BATCH_MAX_STEPS)} rows: a batch holds at most ${Math.min(maxSteps, BATCH_MAX_STEPS)}, so each row is sent as its own transaction.`
    );
    // One fee estimate for the whole batch: simulate the signed batch when possible.
    let est: { fee: bigint; exact: boolean } | null = null;
    if (m === 'batch') {
      const fixed = estimateBatchFee(v.rows.length);
      est = { fee: fixed.fee, exact: false };
      const pk = props.getPrivateKey();
      if (pk && net.simulateGas) {
        try {
          const nonce = await net.getNonce(props.accountId);
          const hex = await net.buildBatch!(props.accountId, stepsFor(v.rows), nonce, pk);
          const sim = await net.simulateGas(hex);
          if (sim.success && sim.gasUsed != null && sim.gasUsed > 0n) est = { fee: feeFromGas(sim.gasUsed), exact: true };
          else if (!sim.success && sim.error) {
            if (isBatchUnsupportedError(sim.error)) {
              batchUnsupportedRef.current = true;
              setMode('sequential');
              setModeNote('This node does not support batch transactions yet, so each row is sent as its own transaction.');
              est = null;
            } else {
              setIssues([`Batch would fail: ${sim.error}`]);
              setReviewBusy(false);
              return;
            }
          }
        } catch {
          // Keep the fixed estimate.
        }
      }
      const boingTotal = v.totals[BOING_KEY] ?? 0n;
      const bal = assets[BOING_KEY]!.balance;
      if (est && bal != null && boingTotal + est.fee > bal) {
        setIssues([`BOING total ${fmtBoing(boingTotal)} plus fee ${fmtBoing(est.fee)} exceeds balance ${fmtBoing(bal)}.`]);
        setReviewBusy(false);
        return;
      }
    }
    setFee(est);
    setValidated({ rows: v.rows, totals: v.totals });
    setReviewBusy(false);
    setStage('review');
  }

  function rowSummary(r: MixedBulkRowValid) {
    return `${fmtAsset(r.assetKey, r.amount)} → ${shortHexLabel(r.toHex, 6, 4)}`;
  }

  async function runBatch(vrows: MixedBulkRowValid[], pk: Uint8Array) {
    const net = props.network;
    setProgress(vrows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'signing' })));
    setStage('progress');
    try {
      const nonce = await net.getNonce(props.accountId);
      const hex = await net.buildBatch!(props.accountId, stepsFor(vrows), nonce, pk);
      const out = await net.submitTransaction(hex);
      if (!out.success) {
        if (isBatchUnsupportedError(out.error)) {
          batchUnsupportedRef.current = true;
          setMode('sequential');
          setModeNote('This node rejected the batch format, so nothing was sent. Review again to send each row as its own transaction.');
          setStage('review');
          return;
        }
        setProgress(vrows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'failed', error: 'Batch rejected' })));
        setBatchOutcome({ ok: false, text: `Batch rejected: ${out.error ?? 'unknown error'}. Nothing was sent.` });
        return;
      }
      const txHash = out.txHash;
      setProgress(vrows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'submitted', nonce, txHash })));
      const { summary, steps } = batchHistorySummary(vrows, fmtAsset, (h) => shortHexLabel(h, 6, 4));
      if (props.onBatchSent) props.onBatchSent(txHash, summary, steps);
      else props.onRowSent(txHash, 'send', summary);
      setBatchOutcome({
        ok: true,
        text: `Batch of ${vrows.length} submitted as one transaction${txHash ? ` (${txHash.slice(0, 12)}…)` : ''}. It applies all-or-nothing when included in a block.`,
      });
      setValidated(null);
      props.onFinished();
    } catch (e) {
      setStartError(`Could not send the batch: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`);
    }
  }

  async function run() {
    if (!validated) return;
    const pk = props.getPrivateKey();
    if (!pk) {
      setIssues(['Wallet locked']);
      setStage('edit');
      return;
    }
    cancelRef.current = false;
    setCancelRequested(false);
    setReport(null);
    setBatchOutcome(null);
    setStartError('');
    setRunRows(validated.rows);
    if (mode === 'batch') {
      await runBatch(validated.rows, pk);
      return;
    }
    const net = props.network;
    const sender = props.accountId;
    setProgress(validated.rows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'pending' })));
    setStage('progress');
    let rep: BulkRunReport;
    const vrows = validated.rows;
    try {
      const startNonce = await net.getNonce(sender);
      rep = await runSequentialBulkTransfer({
        rows: vrows,
        startNonce,
        sign: (row, nonce) => {
          const assetKey = (row as MixedBulkRowValid).assetKey;
          return assetKey && assetKey !== BOING_KEY
            ? buildReferenceFungibleTransfer({ network: net, sender, tokenHex: assetKey, toHex: row.toHex, amount: row.amount, nonce, privateKey: pk })
            : net.buildTransfer(sender, accountIdFromHex(row.toHex), row.amount, nonce, pk);
        },
        submit: (hex) => net.submitTransaction(hex),
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
    } catch (e) {
      setStartError(`Could not start: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`);
      return;
    }
    for (const r of rep.results) {
      const vr = vrows.find((x) => x.row === r.row)!;
      if (r.status === 'submitted') props.onRowSent(r.txHash, vr.assetKey === BOING_KEY ? 'send' : 'token_send', `Bulk #${r.row + 1}: ${rowSummary(vr)}`);
    }
    setProgress(rep.results);
    setReport(rep);
    setValidated(null);
    props.onFinished();
  }

  function reset() {
    setRows([newRow()]);
    setIssues([]);
    setValidated(null);
    setProgress([]);
    setReport(null);
    setBatchOutcome(null);
    setStartError('');
    setFee(null);
    setStage('edit');
  }

  const reportText = report
    ? (() => {
        const lines = report.results.map((r) => {
          const vr = runRows.find((x) => x.row === r.row);
          const amt = vr ? fmtAsset(vr.assetKey, r.amount) : r.amount.toString();
          const head = `#${r.row + 1} ${r.toHex.slice(0, 8)}…${r.toHex.slice(-6)} ${amt}`;
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
      })()
    : '';
  const submittedCount = progress.filter((p) => p.status === 'submitted').length;
  const progressAsset = (row: number) => runRows.find((r) => r.row === row)?.assetKey ?? BOING_KEY;
  const totalsLine = validated
    ? Object.entries(validated.totals)
        .map(([k, v]) => fmtAsset(k, v))
        .join(' + ')
    : '';

  return (
    <section className={styles.section} data-testid="transfer-pane-bulk">
      <h2 className={styles.sectionTitle}>Bulk transfer</h2>
      {stage === 'edit' && (
        <div className={styles.form}>
          <p className={styles.faucetHint}>
            Up to {BULK_MAX_ROWS} recipients; BOING and tokens can be mixed. Up to {BATCH_MAX_STEPS} rows go out as one atomic batch
            transaction (one signature, all-or-nothing) on nodes that support it; otherwise each row is its own transaction.
          </p>
          <label className={styles.addressHint}>
            Asset for new rows{' '}
            <select className={styles.input} value={defaultAsset} onChange={(e) => setDefaultAsset(e.target.value)} aria-label="Asset for new rows" data-testid="bulk-asset">
              <option value={BOING_KEY}>
                {props.balance?.symbol ?? 'BOING'} · {props.balance ? formatBalance(props.balance.value, props.balance.decimals) : '…'}
              </option>
              {tokens.map((t) => (
                <option key={t.tokenHex} value={t.tokenHex}>
                  {t.symbol} · {t.balanceDisplay}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.bulkRows} data-testid="bulk-rows">
            {rows.map((r, i) => (
              <div key={r.id} className={styles.bulkRow} data-testid="bulk-row">
                <input
                  className={styles.input}
                  placeholder="Recipient (64 hex)"
                  value={r.to}
                  onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, to: e.target.value } : x)))}
                  aria-label={`Recipient row ${i + 1}`}
                  data-testid="bulk-row-to"
                />
                <select
                  className={styles.input}
                  value={r.asset}
                  onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, asset: e.target.value } : x)))}
                  aria-label={`Asset row ${i + 1}`}
                  data-testid="bulk-row-asset"
                >
                  <option value={BOING_KEY}>{props.balance?.symbol ?? 'BOING'}</option>
                  {tokens.map((t) => (
                    <option key={t.tokenHex} value={t.tokenHex}>
                      {t.symbol}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.input}
                  placeholder="Amount"
                  value={r.amount}
                  inputMode="decimal"
                  onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)))}
                  aria-label={`Amount row ${i + 1}`}
                  data-testid="bulk-row-amount"
                />
                <button
                  type="button"
                  className={styles.copyBtn}
                  aria-label={`Remove row ${i + 1}`}
                  onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : [newRow()])}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={styles.inlineRow}>
            <button type="button" className={styles.copyBtn} onClick={() => setRows([...rows, newRow()])} data-testid="bulk-add-row">
              + Row
            </button>
            <button type="button" className={styles.copyBtn} onClick={reset}>
              Clear
            </button>
          </div>
          <details className={styles.subDetails}>
            <summary className={styles.addressHint}>Paste CSV (address,amount per line; uses the asset for new rows)</summary>
            <textarea
              className={styles.input}
              rows={4}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={'0x7f3a…,100\n0x91bc…,25'}
              aria-label="CSV rows"
              data-testid="bulk-csv"
            />
            <button type="button" className={styles.secondary} onClick={importCsv} data-testid="bulk-csv-import">
              Add CSV rows
            </button>
          </details>
          {issues.length > 0 && (
            <ul className={`${styles.error} ${styles.bulkIssues}`} data-testid="bulk-issues">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.primary} onClick={() => void review()} disabled={reviewBusy} data-testid="bulk-review">
            {reviewBusy ? 'Checking…' : 'Review'}
          </button>
        </div>
      )}

      {stage === 'review' && validated && (
        <div data-testid="bulk-review-screen" data-mode={mode}>
          {mode === 'batch' ? (
            <p className={styles.addressHint} data-testid="bulk-review-mode">
              <strong>One atomic batch</strong> on {props.network.config.name}: {validated.rows.length} transfer
              {validated.rows.length === 1 ? '' : 's'}, one signature, one transaction.
            </p>
          ) : (
            <p className={styles.addressHint} data-testid="bulk-review-mode">
              {validated.rows.length} transfer{validated.rows.length === 1 ? '' : 's'} on {props.network.config.name}: {validated.rows.length}{' '}
              signatures, sent one after another.
            </p>
          )}
          {modeNote && (
            <p className={styles.faucetHint} data-testid="bulk-mode-note">
              {modeNote}
            </p>
          )}
          <ol className={styles.bulkList} data-testid="bulk-review-list">
            {validated.rows.map((r) => (
              <li key={r.row} data-testid="bulk-review-row">
                <code className={styles.nftMono}>0x{r.toHex}</code> <strong>{fmtAsset(r.assetKey, r.amount)}</strong>
              </li>
            ))}
          </ol>
          <p>
            Total: <strong data-testid="bulk-review-total">{totalsLine}</strong>
          </p>
          {mode === 'batch' && fee && (
            <p data-testid="bulk-review-fee">
              Network fee: <strong>{fee.exact ? '' : '≈ '}{fmtBoing(fee.fee)}</strong> for the whole batch
            </p>
          )}
          {mode === 'batch' ? (
            <p className={styles.faucetHint} role="note" data-testid="bulk-review-atomic">
              All-or-nothing: if any transfer in the batch fails, none of them happen and your balances stay unchanged.
            </p>
          ) : (
            <p className={styles.error} role="note">
              Each row is its own transaction. If one fails, earlier rows stay sent and later rows are not sent. Keep this page open until it
              finishes.
            </p>
          )}
          <div className={styles.inlineRow}>
            <button type="button" className={styles.secondary} onClick={() => setStage('edit')} data-testid="bulk-back">
              Edit
            </button>
            <button type="button" className={styles.primary} onClick={() => void run()} data-testid="bulk-confirm">
              {mode === 'batch' ? 'Sign & send batch' : 'Sign & send all'}
            </button>
          </div>
        </div>
      )}

      {stage === 'progress' && (
        <div data-testid="bulk-progress" data-mode={mode}>
          <p className={styles.addressHint} aria-live="polite" data-testid="bulk-progress-summary">
            {startError ||
              batchOutcome?.text ||
              (report ? reportText.split('\n')[0] : mode === 'batch' ? 'Sending batch…' : `${submittedCount} of ${progress.length} submitted…`)}
          </p>
          <ol className={styles.bulkList} data-testid="bulk-progress-list">
            {progress.map((r) => (
              <li key={r.row} data-testid="bulk-progress-row" data-status={r.status}>
                <code className={styles.nftMono}>{shortHexLabel(r.toHex, 8, 6)}</code> {fmtAsset(progressAsset(r.row), r.amount)}{' '}
                <strong className={r.status === 'failed' ? styles.error : r.status === 'submitted' ? styles.success : undefined}>
                  {STATUS_LABEL[r.status]}
                </strong>
                {mode !== 'batch' && (r.error || r.txHash) && (
                  <div className={r.status === 'failed' ? styles.error : styles.addressHint}>{r.error ?? `Tx ${r.txHash}`}</div>
                )}
              </li>
            ))}
          </ol>
          <div className={styles.inlineRow}>
            {mode !== 'batch' && !report && !startError ? (
              <button
                type="button"
                className={styles.secondary}
                disabled={cancelRequested}
                onClick={() => {
                  cancelRef.current = true;
                  setCancelRequested(true);
                }}
                data-testid="bulk-cancel"
              >
                Stop after current
              </button>
            ) : (
              <>
                {report && (
                  <button type="button" className={styles.copyBtn} onClick={() => void navigator.clipboard?.writeText(reportText)} data-testid="bulk-copy-report">
                    Copy report
                  </button>
                )}
                {(report || batchOutcome || startError) && (
                  <button type="button" className={styles.primary} onClick={reset} data-testid="bulk-done">
                    Done
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
