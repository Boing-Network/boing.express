import { useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { normalizeHex64, shortHexLabel } from '../boing/referenceNft';
import type { TokenHolding } from '../boing/tokenHoldings';
import { addTokenWatchEntry, removeTokenWatchEntry } from '../storage/tokenWatchlist';
import styles from '../screens/Dashboard.module.css';

export function TokenHoldingsPanel(props: {
  accountId: AccountId;
  networkId: string;
  holdings: TokenHolding[];
  loading: boolean;
  error: string;
  onChanged: () => void;
}) {
  const { holdings } = props;
  const [contract, setContract] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('');
  const [addError, setAddError] = useState('');
  const owner = accountIdToHex(props.accountId);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    let tokenHex: string;
    try {
      tokenHex = normalizeHex64(contract);
    } catch {
      setAddError('Token contract must be 64 hex characters.');
      return;
    }
    const d = decimals.trim() === '' ? undefined : Number(decimals);
    if (d != null && (!Number.isInteger(d) || d < 0 || d > 38)) {
      setAddError('Decimals must be a whole number 0–38.');
      return;
    }
    await addTokenWatchEntry(owner, props.networkId, { tokenHex, symbol: symbol || undefined, decimals: d });
    setContract('');
    setSymbol('');
    setDecimals('');
    props.onChanged();
  }

  return (
    <section className={styles.section} data-testid="wallet-tokens">
      <div className={styles.balanceHeader}>
        <h2 className={styles.sectionTitle}>Tokens</h2>
        <button type="button" className={styles.refreshBtn} onClick={props.onChanged} disabled={props.loading} aria-label="Refresh tokens">
          {props.loading ? '…' : '↻'}
        </button>
      </div>
      {props.error && <p className={styles.error}>{props.error}</p>}
      {holdings.length === 0 ? (
        <p className={styles.addressHint}>No tokens found. Watch a token contract below; tokens listed in the DEX directory show up when you hold them.</p>
      ) : (
        <ul className={styles.txHistoryList} aria-label="Fungible tokens">
          {holdings.map((t) => (
            <li key={t.tokenHex} className={styles.txHistoryItem} data-testid="token-row">
              <span className={styles.tokenSymbol}>{t.symbol}</span>
              <code className={styles.txHash} title={t.tokenHex}>
                {shortHexLabel(t.tokenHex, 6, 4)}
              </code>
              <span className={styles.tokenBalance} title={t.error}>
                {t.error ? 'unavailable' : t.balanceDisplay}
              </span>
              {t.watched && (
                <button
                  type="button"
                  className={styles.copyBtn}
                  aria-label={`Stop watching ${t.symbol}`}
                  onClick={async () => {
                    await removeTokenWatchEntry(owner, props.networkId, t.tokenHex);
                    props.onChanged();
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <details className={styles.subDetails}>
        <summary className={styles.addressHint}>Add token</summary>
        <form onSubmit={(e) => void add(e)} className={styles.form}>
          <input className={styles.input} placeholder="Token contract (64 hex)" value={contract} onChange={(e) => setContract(e.target.value)} aria-label="Token contract" data-testid="token-add-contract" />
          <div className={styles.inlineRow}>
            <input className={styles.input} placeholder="Symbol (optional)" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Token symbol" />
            <input className={styles.input} placeholder="Decimals" value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" aria-label="Token decimals" />
          </div>
          {addError && <p className={styles.error}>{addError}</p>}
          <button type="submit" className={styles.secondary} data-testid="token-add-submit">
            Watch token
          </button>
        </form>
      </details>
    </section>
  );
}
