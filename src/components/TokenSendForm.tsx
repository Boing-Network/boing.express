import { useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { formatBalance } from '../boing/amount';
import { shortHexLabel } from '../boing/referenceNft';
import { validateBulkRows } from '../boing/bulkTransfer';
import { buildReferenceFungibleTransfer } from '../boing/referenceFungible';
import type { TokenHolding } from '../boing/tokenHoldings';
import type { NetworkAdapter } from '../networks/types';
import styles from '../screens/Dashboard.module.css';
import { SendConfirm } from './SendConfirm';
import { ScanQrButton } from './ScanQrButton';

/** Transfer > Token: reference fungible transfer (v1/v2). Self-transfer is refused before signing. */
export function TokenSendForm(props: {
  accountId: AccountId;
  network: NetworkAdapter;
  getPrivateKey: () => Uint8Array | null;
  holdings: TokenHolding[];
  onSent: (txHash: string | undefined, summary: string) => void;
  /** Extension: open the scanner in a tab instead of inline. */
  onExternalScan?: () => void;
}) {
  const [review, setReview] = useState<{ toHex: string; amount: bigint; tokenHex: string } | null>(null);
  const usable = props.holdings.filter((t) => t.balanceRaw != null);
  const [tokenHex, setTokenHex] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!usable.some((t) => t.tokenHex === tokenHex)) setTokenHex(usable[0]?.tokenHex ?? '');
  }, [usable, tokenHex]);
  const token = usable.find((t) => t.tokenHex === tokenHex) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!token || token.balanceRaw == null) {
      setError('Pick a token first (watch one on the Wallet tab).');
      return;
    }
    const toHex = to.replace(/\s/g, '').replace(/^0x/i, '').toLowerCase();
    const v = validateBulkRows([{ to: toHex, amount }], {
      senderHex: accountIdToHex(props.accountId),
      decimals: token.decimals,
      balance: BigInt(token.balanceRaw),
    });
    if (!v.ok) {
      setError(v.issues.map((i) => i.message.replace(/^Row 1: /, '')).join(' '));
      return;
    }
    setReview({ toHex, amount: v.rows[0]!.amount, tokenHex: token.tokenHex });
  }

  function sign(r: { toHex: string; amount: bigint; tokenHex: string }) {
    return async () => {
      const pk = props.getPrivateKey();
      if (!pk) throw new Error('Wallet locked');
      const nonce = await props.network.getNonce(props.accountId);
      return buildReferenceFungibleTransfer({ network: props.network, sender: props.accountId, tokenHex: r.tokenHex, toHex: r.toHex, amount: r.amount, nonce, privateKey: pk });
    };
  }

  async function confirm() {
    if (!review || !token) return;
    setError('');
    setBusy(true);
    try {
      const signed = await sign(review)();
      const res = await props.network.submitTransaction(signed);
      if (!res.success) throw new Error(res.error ?? 'Submit failed');
      props.onSent(res.txHash, `${formatBalance(review.amount.toString(), token.decimals, token.decimals)} ${token.symbol} → ${shortHexLabel(review.toHex, 6, 4)}`);
      setSuccess(res.txHash ? `Sent! Tx: ${res.txHash.slice(0, 16)}…` : 'Transaction submitted');
      setTo('');
      setAmount('');
      setReview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (review && token) {
    return (
      <section className={styles.section} data-testid="transfer-pane-token">
        <SendConfirm
          title={`Send ${token.symbol}`}
          to={review.toHex}
          amount={`${formatBalance(review.amount.toString(), token.decimals, token.decimals)} ${token.symbol}`}
          network={props.network}
          buildSigned={sign(review)}
          busy={busy}
          error={error}
          onBack={() => {
            setReview(null);
            setError('');
          }}
          onConfirm={() => void confirm()}
        />
      </section>
    );
  }

  return (
    <section className={styles.section} data-testid="transfer-pane-token">
      <h2 className={styles.sectionTitle}>Send token</h2>
      <p className={styles.faucetHint}>Boing reference tokens (v1 and v2). Sending to your own address is refused (v1 self-transfer bug).</p>
      {usable.length === 0 ? (
        <p className={styles.addressHint}>No tokens with a readable balance. Watch a token on the Wallet tab.</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className={styles.form}>
          <select className={styles.input} value={tokenHex} onChange={(e) => setTokenHex(e.target.value)} aria-label="Token" data-testid="token-send-asset">
            {usable.map((t) => (
              <option key={t.tokenHex} value={t.tokenHex}>
                {t.symbol} · {t.balanceDisplay}
              </option>
            ))}
          </select>
          <div className={styles.inlineRow}>
            <input className={styles.input} placeholder="Recipient (64 hex)" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Token recipient" data-testid="token-send-to" />
            <ScanQrButton className={styles.copyBtn} testId="token-send-to-scan" onResult={(a) => setTo(a)} onExternal={props.onExternalScan} />
          </div>
          <div className={styles.inlineRow}>
            <input className={styles.input} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Token amount" data-testid="token-send-amount" />
            <button type="button" className={styles.copyBtn} onClick={() => token?.balanceRaw && setAmount(formatBalance(token.balanceRaw, token.decimals, token.decimals))}>
              Max
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}
          <button type="submit" className={styles.primary} disabled={busy} data-testid="token-send-submit">
            {busy ? 'Sending…' : 'Review send'}
          </button>
        </form>
      )}
    </section>
  );
}
