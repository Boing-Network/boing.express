import { useEffect, useMemo, useState } from 'react';
import type { NetworkAdapter } from '../networks/types';
import {
  estimateSendFee,
  feeLabel,
  priorityTipLadderForUi,
  type FeeEstimate,
} from '../boing/feeEstimate';
import { formatNative } from '../boing/nativeUnit';
import { shortAddress } from '../boing/qr';
import styles from './SendConfirm.module.css';

export type SendConfirmProps = {
  /** e.g. "Send BOING", "Send tBOING", "Send NFT" */
  title: string;
  /** Recipient, 64 hex with or without 0x. */
  to: string;
  /** When the user typed a `.boing` name: the normalized label (the resolved address is shown under it). */
  toName?: string;
  /** Human amount line, e.g. "40 BOING" or "2 NFTs (#7, #8)". */
  amount: string;
  network: NetworkAdapter;
  /** Signs (does not submit) the tx to simulate it for the fee. Receives the selected tip. */
  buildSigned: (priorityTip: bigint) => Promise<string>;
  /** Number of txs this confirm covers (fee multiplier). */
  txCount?: number;
  busy?: boolean;
  error?: string;
  mascotSrc?: string;
  /** Confirm send with the selected priority tip (ledger base units). */
  onConfirm: (priorityTip: bigint) => void;
  onBack: () => void;
  /** Show optional tip ladder (BOING sends). Default true. */
  showPriorityTip?: boolean;
};

const TIP_LABELS: Record<string, string> = {
  normal: 'Normal',
  faster: 'Faster',
  priority: 'Priority',
  urgent: 'Urgent',
};

/** Review step before any send (BOING, token, NFT): recipient, amount, simulated fee, one big confirm. */
export function SendConfirm(p: SendConfirmProps) {
  const showTip = p.showPriorityTip !== false;
  const ladder = useMemo(() => (showTip ? priorityTipLadderForUi() : []), [showTip]);
  const [tipIndex, setTipIndex] = useState(0);
  const priorityTip = ladder[tipIndex]?.tip ?? 0n;
  const [est, setEst] = useState<FeeEstimate | null>(null);

  useEffect(() => {
    let live = true;
    setEst(null);
    void estimateSendFee(p.network, () => p.buildSigned(priorityTip), p.txCount ?? 1).then((e) => {
      if (live) setEst(e);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.to, p.amount, p.txCount, priorityTip]);

  const to = p.to.startsWith('0x') ? p.to : `0x${p.to}`;
  const failed = est?.state === 'fail';
  const tipRow = ladder[tipIndex];
  const decimals = est?.state === 'ok' ? est.decimals : 18;

  return (
    <section className={styles.card} data-testid="send-confirm" aria-label={`${p.title}: review`}>
      <div className={styles.top}>
        <button type="button" className={styles.back} onClick={p.onBack} disabled={p.busy} aria-label="Back to edit" data-testid="send-confirm-back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
      <img src={p.mascotSrc ?? '/assets/mascot-default.png'} alt="" className={styles.mascot} aria-hidden />
      <h2 className={styles.title}>{p.title}</h2>
      <dl className={styles.rows}>
        {p.toName ? (
          <>
            <div className={styles.row}>
              <dt>To</dt>
              <dd data-testid="send-confirm-to-name">{p.toName}.boing</dd>
            </div>
            <div className={styles.row}>
              <dt>Resolves to</dt>
              <dd title={to} data-testid="send-confirm-to" className={styles.resolved}>
                {shortAddress(to, 10, 8)}
              </dd>
            </div>
          </>
        ) : (
          <div className={styles.row}>
            <dt>To</dt>
            <dd title={to} data-testid="send-confirm-to">{shortAddress(to, 8, 6)}</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt>Amount</dt>
          <dd className={styles.amount} data-testid="send-confirm-amount">{p.amount}</dd>
        </div>
        <div className={styles.row}>
          <dt>Network fee</dt>
          <dd data-testid="send-confirm-fee" data-exact={est?.state === 'ok' && est.exact ? 'true' : 'false'}>
            {feeLabel(est)}
            {est?.state === 'ok' && (p.txCount ?? 1) > 1 ? ` (${p.txCount} txs)` : ''}
          </dd>
        </div>
        {showTip && tipRow && tipRow.tip > 0n && (
          <div className={styles.row}>
            <dt>Priority tip</dt>
            <dd data-testid="send-confirm-tip">{formatNative(tipRow.tip, decimals)} BOING</dd>
          </div>
        )}
      </dl>
      {showTip && ladder.length > 0 && (
        <div className={styles.tipGroup} role="group" aria-label="Priority tip" data-testid="send-confirm-tip-ladder">
          <p className={styles.tipHint}>Optional tip for faster inclusion (base fee still applies).</p>
          <div className={styles.tipOptions}>
            {ladder.map((tier, i) => (
              <button
                key={tier.label}
                type="button"
                className={`${styles.tipBtn} ${i === tipIndex ? styles.tipBtnActive : ''}`}
                onClick={() => setTipIndex(i)}
                disabled={p.busy}
                data-testid={`send-confirm-tip-${tier.label}`}
              >
                {TIP_LABELS[tier.label] ?? tier.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {failed && (
        <p className={styles.error} role="alert" data-testid="send-confirm-sim-error">
          This transaction would fail: {est.error}
        </p>
      )}
      {p.error && (
        <p className={styles.error} role="alert" data-testid="send-confirm-error">
          {p.error}
        </p>
      )}
      <button
        type="button"
        className={styles.confirm}
        onClick={() => p.onConfirm(priorityTip)}
        disabled={p.busy || failed}
        data-testid="send-confirm-submit"
      >
        {p.busy ? 'Sending…' : 'Confirm send'}
      </button>
    </section>
  );
}
