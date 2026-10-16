import { useEffect, useState } from 'react';
import type { NetworkAdapter } from '../networks/types';
import { estimateSendFee, feeLabel, type FeeEstimate } from '../boing/feeEstimate';
import { shortAddress } from '../boing/qr';
import styles from './SendConfirm.module.css';

export type SendConfirmProps = {
  /** e.g. "Send BOING", "Send tBOING", "Send NFT" */
  title: string;
  /** Recipient, 64 hex with or without 0x. */
  to: string;
  /** Human amount line, e.g. "40 BOING" or "2 NFTs (#7, #8)". */
  amount: string;
  network: NetworkAdapter;
  /** Signs (does not submit) the tx to simulate it for the fee. */
  buildSigned: () => Promise<string>;
  /** Number of txs this confirm covers (fee multiplier). */
  txCount?: number;
  busy?: boolean;
  error?: string;
  mascotSrc?: string;
  onConfirm: () => void;
  onBack: () => void;
};

/** Review step before any send (BOING, token, NFT): recipient, amount, simulated fee, one big confirm. */
export function SendConfirm(p: SendConfirmProps) {
  const [est, setEst] = useState<FeeEstimate | null>(null);
  useEffect(() => {
    let live = true;
    setEst(null);
    void estimateSendFee(p.network, p.buildSigned, p.txCount ?? 1).then((e) => {
      if (live) setEst(e);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.to, p.amount, p.txCount]);
  const to = p.to.startsWith('0x') ? p.to : `0x${p.to}`;
  const failed = est?.state === 'fail';
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
        <div className={styles.row}>
          <dt>To</dt>
          <dd title={to} data-testid="send-confirm-to">{shortAddress(to, 8, 6)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Amount</dt>
          <dd className={styles.amount} data-testid="send-confirm-amount">{p.amount}</dd>
        </div>
        <div className={styles.row}>
          <dt>Estimated fee</dt>
          <dd data-testid="send-confirm-fee" data-exact={est?.state === 'ok' && est.exact ? 'true' : 'false'}>
            {feeLabel(est)}
            {est?.state === 'ok' && (p.txCount ?? 1) > 1 ? ` (${p.txCount} txs)` : ''}
          </dd>
        </div>
      </dl>
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
      <button type="button" className={styles.confirm} onClick={p.onConfirm} disabled={p.busy || failed} data-testid="send-confirm-submit">
        {p.busy ? 'Sending…' : 'Confirm send'}
      </button>
    </section>
  );
}
