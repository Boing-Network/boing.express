import { useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { normalizeHex64, shortHexLabel } from '../boing/referenceNft';
import type { TokenHolding, TokenHoldingsLoadMeta } from '../boing/tokenHoldings';
import { addTokenWatchEntry, removeTokenWatchEntry } from '../storage/tokenWatchlist';
import styles from '../screens/Dashboard.module.css';

export type NativeBalanceRow = {
  display: string;
  symbol: string;
  chainHeight: number | null;
  error?: string | null;
  refreshing?: boolean;
  onRefresh: () => void;
};

export function TokenHoldingsPanel(props: {
  /** Native BOING (account balance): always the first asset row. */
  native?: NativeBalanceRow;
  accountId: AccountId;
  networkId: string;
  holdings: TokenHolding[];
  /** Optional discovery stats for honest empty / truncated hints. */
  meta?: TokenHoldingsLoadMeta | null;
  loading: boolean;
  error: string;
  onChanged: () => void;
}) {
  const { holdings } = props;
  const held = holdings.filter((t) => t.balanceRaw != null && t.balanceRaw !== '0');
  const watchedZero = holdings.filter((t) => t.watched && (t.balanceRaw === '0' || t.balanceRaw == null));
  const [contract, setContract] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('');
  const [addError, setAddError] = useState('');
  const owner = accountIdToHex(props.accountId);

  function renderRow(t: TokenHolding) {
    return (
      <li key={t.tokenHex} className={styles.txHistoryItem} data-testid="token-row">
        <span className={styles.tokenSymbol} title={t.name}>
          {t.symbol}
        </span>
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
    );
  }

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
      <p className={styles.addressHint}>
        Native BOING, then fungibles you hold from the DEX directory, pool legs, recent local history, and optional
        deploy scan. Zero-balance directory noise is hidden; watchlist rows stay visible at zero.
      </p>
      {props.native && (
        <ul className={styles.txHistoryList} aria-label="Native balance">
          <li className={styles.txHistoryItem} data-testid="token-row-native">
            <span className={styles.tokenSymbol}>{props.native.symbol}</span>
            <span className={styles.txHash}>native</span>
            <span className={styles.tokenBalance} data-testid="native-balance">
              {props.native.display}
            </span>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={props.native.onRefresh}
              disabled={props.native.refreshing}
              aria-label="Refresh balance and chain data"
            >
              {props.native.refreshing ? '…' : '↻'}
            </button>
          </li>
          {props.native.chainHeight != null && (
            <li className={styles.chainHeight} aria-label="Chain height" style={{ listStyle: 'none' }}>
              Block #{props.native.chainHeight.toLocaleString()}
            </li>
          )}
          {props.native.error && (
            <li className={styles.error} style={{ listStyle: 'none' }}>
              {props.native.error}
              <button type="button" className={styles.retryBtn} onClick={props.native.onRefresh}>
                Retry
              </button>
            </li>
          )}
        </ul>
      )}
      {props.error && <p className={styles.error}>{props.error}</p>}
      {held.length > 0 && (
        <>
          <h3 className={styles.addressHint} style={{ marginTop: '0.75rem', fontWeight: 600 }}>
            Fungibles you hold
          </h3>
          <ul className={styles.txHistoryList} aria-label="Fungible tokens held">
            {held.map(renderRow)}
          </ul>
        </>
      )}
      {held.length === 0 && !props.loading && (
        <p className={styles.addressHint} data-testid="token-empty-held">
          No tokens found in the directory yet — add a contract to your watchlist below. Tokens only appear here when
          this wallet holds a non-zero balance (or they are watched).
        </p>
      )}
      {watchedZero.length > 0 && (
        <>
          <h3 className={styles.addressHint} style={{ marginTop: '0.75rem', fontWeight: 600 }}>
            Watchlist
          </h3>
          <ul className={styles.txHistoryList} aria-label="Watched tokens">
            {watchedZero.map(renderRow)}
          </ul>
        </>
      )}
      {props.meta?.truncatedDirectory && (
        <p className={styles.addressHint}>
          DEX directory pagination hit this wallet’s page cap — some listed tokens may still need a watchlist add
          until a full ownership index exists.
        </p>
      )}
      <details className={styles.subDetails}>
        <summary className={styles.addressHint}>Add token to watchlist</summary>
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
