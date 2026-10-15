import { useRef, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex } from '../boing/types';
import { formatBalance } from '../boing/amount';
import { shortHexLabel } from '../boing/referenceNft';
import {
  BULK_MAX_ROWS,
  formatBulkReport,
  parseBulkCsv,
  runSequentialBulkTransfer,
  validateBulkRows,
  type BulkRowInput,
  type BulkRowResult,
  type BulkRowValid,
  type BulkRunReport,
} from '../boing/bulkTransfer';
import { buildReferenceFungibleTransfer } from '../boing/referenceFungible';
import type { TokenHolding } from '../boing/tokenHoldings';
import type { NetworkAdapter, BalanceResult } from '../networks/types';
import styles from '../screens/Dashboard.module.css';

type Row = { id: number; to: string; amount: string };

const STATUS_LABEL: Record<BulkRowResult['status'], string> = {
  pending: 'Waiting',
  signing: 'Sending…',
  submitted: 'Submitted',
  failed: 'Failed',
  not_sent: 'Not sent',
};

/**
 * Transfer > Bulk: many recipients, one asset. Sequential signed txs with consecutive nonces
 * (no native batch in the tx format), stop on first failure, no retries.
 */
export function BulkTransferPanel(props: {
  accountId: AccountId;
  network: NetworkAdapter;
  getPrivateKey: () => Uint8Array | null;
  balance: BalanceResult | null;
  holdings: TokenHolding[];
  onRowSent: (txHash: string | undefined, kind: 'send' | 'token_send', summary: string) => void;
  onFinished: () => void;
}) {
  const nextId = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ id: 1, to: '', amount: '' }]);
  const [csv, setCsv] = useState('');
  const [asset, setAsset] = useState('boing');
  const [issues, setIssues] = useState<string[]>([]);
  const [stage, setStage] = useState<'edit' | 'review' | 'progress'>('edit');
  const [validated, setValidated] = useState<{ rows: BulkRowValid[]; total: bigint } | null>(null);
  const [progress, setProgress] = useState<BulkRowResult[]>([]);
  const [report, setReport] = useState<BulkRunReport | null>(null);
  const [startError, setStartError] = useState('');
  const cancelRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);

  const token = props.holdings.find((t) => t.tokenHex === asset && t.balanceRaw != null) ?? null;
  const decimals = token ? token.decimals : (props.balance?.decimals ?? 0);
  const symbol = token ? token.symbol : (props.balance?.symbol ?? 'BOING');
  const balanceRaw: bigint | null = token
    ? BigInt(token.balanceRaw!)
    : props.balance
      ? BigInt(props.balance.value)
      : null;
  const fmt = (v: bigint) => `${formatBalance(v.toString(), decimals, decimals)} ${symbol}`;

  function newRow(to = '', amount = ''): Row {
    return { id: nextId.current++, to, amount };
  }

  function inputs(): BulkRowInput[] {
    return rows
      .map((r, i) => ({ to: r.to.trim(), amount: r.amount.trim(), source: `Row ${i + 1}` }))
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

  function review() {
    const v = validateBulkRows(inputs(), { senderHex: accountIdToHex(props.accountId), decimals, balance: balanceRaw });
    if (!v.ok) {
      setIssues(v.issues.map((i) => i.message));
      return;
    }
    setIssues([]);
    setValidated({ rows: v.rows, total: v.total });
    setStage('review');
  }

  async function run() {
    if (!validated) return;
    const pk = props.getPrivateKey();
    if (!pk) {
      setIssues(['Wallet locked']);
      setStage('edit');
      return;
    }
    const net = props.network;
    const sender = props.accountId;
    const tok = token;
    cancelRef.current = false;
    setCancelRequested(false);
    setReport(null);
    setStartError('');
    setProgress(validated.rows.map((r) => ({ row: r.row, toHex: r.toHex, amount: r.amount, status: 'pending' })));
    setStage('progress');
    let rep: BulkRunReport;
    try {
      const startNonce = await net.getNonce(sender);
      rep = await runSequentialBulkTransfer({
        rows: validated.rows,
        startNonce,
        sign: (row, nonce) =>
          tok
            ? buildReferenceFungibleTransfer({ network: net, sender, tokenHex: tok.tokenHex, toHex: row.toHex, amount: row.amount, nonce, privateKey: pk })
            : net.buildTransfer(sender, accountIdFromHex(row.toHex), row.amount, nonce, pk),
        submit: (hex) => net.submitTransaction(hex),
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
    } catch (e) {
      setStartError(`Could not start: ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`);
      return;
    }
    for (const r of rep.results) {
      if (r.status === 'submitted') props.onRowSent(r.txHash, tok ? 'token_send' : 'send', `Bulk #${r.row + 1}: ${fmt(r.amount)} → ${shortHexLabel(r.toHex, 6, 4)}`);
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
    setStartError('');
    setStage('edit');
  }

  const reportText = report ? formatBulkReport(report, fmt) : '';
  const submittedCount = progress.filter((p) => p.status === 'submitted').length;

  return (
    <section className={styles.section} data-testid="transfer-pane-bulk">
      <h2 className={styles.sectionTitle}>Bulk transfer</h2>
      {stage === 'edit' && (
        <div className={styles.form}>
          <p className={styles.faucetHint}>
            One asset, up to {BULK_MAX_ROWS} recipients. Boing has no batch transaction, so each row is its own signed transaction, sent in
            order with consecutive nonces. Not atomic: it stops at the first failure and never retries.
          </p>
          <select className={styles.input} value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Asset for bulk transfer" data-testid="bulk-asset">
            <option value="boing">
              {props.balance?.symbol ?? 'BOING'} · {props.balance ? formatBalance(props.balance.value, props.balance.decimals) : '…'}
            </option>
            {props.holdings
              .filter((t) => t.balanceRaw != null)
              .map((t) => (
                <option key={t.tokenHex} value={t.tokenHex}>
                  {t.symbol} · {t.balanceDisplay}
                </option>
              ))}
          </select>
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
            <summary className={styles.addressHint}>Paste CSV (address,amount per line)</summary>
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
          <button type="button" className={styles.primary} onClick={review} data-testid="bulk-review">
            Review
          </button>
        </div>
      )}

      {stage === 'review' && validated && (
        <div data-testid="bulk-review-screen">
          <p className={styles.addressHint}>
            {validated.rows.length} transfer{validated.rows.length === 1 ? '' : 's'} of {symbol} on {props.network.config.name}:{' '}
            {validated.rows.length} signatures, sent one after another.
          </p>
          <ol className={styles.bulkList} data-testid="bulk-review-list">
            {validated.rows.map((r) => (
              <li key={r.row} data-testid="bulk-review-row">
                <code className={styles.nftMono}>0x{r.toHex}</code> <strong>{fmt(r.amount)}</strong>
              </li>
            ))}
          </ol>
          <p>
            Total: <strong data-testid="bulk-review-total">{fmt(validated.total)}</strong>
          </p>
          <p className={styles.error} role="note">
            Each row is its own transaction. If one fails, earlier rows stay sent and later rows are not sent. Keep this page open until it
            finishes.
          </p>
          <div className={styles.inlineRow}>
            <button type="button" className={styles.secondary} onClick={() => setStage('edit')} data-testid="bulk-back">
              Edit
            </button>
            <button type="button" className={styles.primary} onClick={() => void run()} data-testid="bulk-confirm">
              Sign &amp; send all
            </button>
          </div>
        </div>
      )}

      {stage === 'progress' && (
        <div data-testid="bulk-progress">
          <p className={styles.addressHint} aria-live="polite" data-testid="bulk-progress-summary">
            {startError || (report ? reportText.split('\n')[0] : `${submittedCount} of ${progress.length} submitted…`)}
          </p>
          <ol className={styles.bulkList} data-testid="bulk-progress-list">
            {progress.map((r) => (
              <li key={r.row} data-testid="bulk-progress-row" data-status={r.status}>
                <code className={styles.nftMono}>{shortHexLabel(r.toHex, 8, 6)}</code> {fmt(r.amount)}{' '}
                <strong className={r.status === 'failed' ? styles.error : r.status === 'submitted' ? styles.success : undefined}>
                  {STATUS_LABEL[r.status]}
                </strong>
                {(r.error || r.txHash) && <div className={r.status === 'failed' ? styles.error : styles.addressHint}>{r.error ?? `Tx ${r.txHash}`}</div>}
              </li>
            ))}
          </ol>
          <div className={styles.inlineRow}>
            {!report && !startError ? (
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
                <button type="button" className={styles.primary} onClick={reset} data-testid="bulk-done">
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
