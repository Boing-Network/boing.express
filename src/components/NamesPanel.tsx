import { useCallback, useEffect, useRef, useState } from 'react';
import { knownLedgerDecimals, oneBoing } from '../boing/nativeUnit';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex } from '../boing/types';
import type { NetworkAdapter } from '../networks/types';
import {
  claimName,
  displayName,
  getNameInfo,
  NAME_MAX_YEARS,
  namesOwnedBy,
  normalizeName,
  rentFor,
  resolveRecipient,
  reverseName,
  sendNamePayload,
  type ClaimStep,
  type NameInfo,
  type NameRecord,
  type NameTxContext,
} from '../boing/names';
import { shortAddress } from '../boing/qr';
import styles from '../screens/Dashboard.module.css';

export type NamesPanelProps = {
  accountId: AccountId;
  network: NetworkAdapter;
  getPrivateKey: () => Uint8Array | null;
  /** Spendable BOING in ledger units (base units after the 18-decimals switch), for the affordability hint. */
  balance?: bigint | null;
  onTx?: (hash: string, summary: string) => void;
};

/** Network fee headroom per name tx (whole BOING, testnet). */
export const NAME_TX_FEE_HEADROOM = 1n;

export const STEP_LABEL: Record<ClaimStep, string> = {
  commit: 'Step 1/3: committing (your name stays hidden)…',
  wait: 'Step 1/3: waiting for the commit to land in a block…',
  register: 'Step 2/3: registering…',
  primary: 'Step 3/3: setting it as your primary name…',
  done: 'Done',
};

export function nameTxContext(p: Pick<NamesPanelProps, 'accountId' | 'network' | 'getPrivateKey'>): NameTxContext {
  const pk = p.getPrivateKey();
  if (!pk) throw new Error('Wallet locked');
  return {
    rpcUrl: p.network.config.rpcUrl,
    sender: p.accountId,
    privateKey: pk,
    getNonce: () => p.network.getNonce(p.accountId),
    submit: (hex) => p.network.submitTransaction(hex),
  };
}

type Action = { kind: 'renew' | 'transfer' | 'target'; name: string } | null;

/** Settings → Names: claim, list owned names, renew / transfer / point / primary / release. */
export function NamesPanel(p: NamesPanelProps) {
  const rpcUrl = p.network.config.rpcUrl;
  const me = accountIdToHex(p.accountId);
  const [owned, setOwned] = useState<NameRecord[] | null>(null);
  const [primary, setPrimary] = useState<string | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [blocksPerYear, setBlocksPerYear] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [years, setYears] = useState(1);
  const [check, setCheck] = useState<NameInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [actionValue, setActionValue] = useState('');
  const seq = useRef(0);

  const reload = useCallback(async () => {
    try {
      const [list, rev, info] = await Promise.all([namesOwnedBy(rpcUrl, me), reverseName(rpcUrl, me), getNameInfo(rpcUrl, 'boing')]);
      setOwned(list);
      setPrimary(rev?.name ?? null);
      setEnabled(Boolean(info?.registry?.enabled && info.registry.active));
      setHead(info?.head_height ?? null);
      setBlocksPerYear(info?.registry?.blocks_per_year ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOwned([]);
    }
  }, [rpcUrl, me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = ++seq.current;
    setCheck(null);
    const v = normalizeName(query);
    if (!query.trim() || !v.ok) return;
    const t = window.setTimeout(() => {
      void getNameInfo(rpcUrl, v.label).then((info) => {
        if (id === seq.current) setCheck(info);
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, rpcUrl]);

  async function run(label: string, fn: (ctx: NameTxContext) => Promise<string>, summary: string) {
    setError('');
    setOk('');
    setBusy(label);
    try {
      const hash = await fn(nameTxContext(p));
      if (hash) p.onTx?.(hash, summary);
      setOk(`${summary}: submitted${hash ? ` (${hash.slice(0, 12)}…)` : ''}`);
      setAction(null);
      setActionValue('');
      window.setTimeout(() => void reload(), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    const v = normalizeName(query);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError('');
    setOk('');
    try {
      const rec = await claimName(nameTxContext(p), {
        name: v.label,
        years,
        primary: !primary,
        onStep: (s) => setBusy(STEP_LABEL[s]),
      });
      setOk(`${displayName(v.label)} is yours${rec ? ` until block ${rec.expires_at.toLocaleString()}` : ''}.`);
      p.onTx?.('', `Claimed ${displayName(v.label)}`);
      setQuery('');
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const v = normalizeName(query);
  const label = v.ok ? v.label : '';
  const rent = label ? rentFor(label, years) : 0n;
  const canAfford =
    p.balance == null || p.balance >= (rent + 3n * NAME_TX_FEE_HEADROOM) * oneBoing(knownLedgerDecimals(p.network.config.rpcUrl));
  const expiresIn = (r: NameRecord) => {
    if (head == null || !blocksPerYear) return '';
    const left = r.expires_at - head;
    if (left <= 0) return 'expired (grace period)';
    const days = Math.floor((left / blocksPerYear) * 365);
    return days > 400 ? `~${(days / 365).toFixed(1)} years left` : `~${days} days left`;
  };

  return (
    <section className={styles.section} data-testid="settings-names">
      <h2 className={styles.sectionTitle}>Names</h2>
      <p className={styles.faucetHint}>
        A <strong>.boing</strong> name points at your address so people can send to <em>you.boing</em>. Yearly rent is burned:
        3 letters 10, 4 letters 5, 5 letters 2, 6+ letters 1 BOING.
      </p>
      {enabled === false && (
        <p className={styles.addressHint} data-testid="names-disabled">
          Names are not available on this network yet.
        </p>
      )}
      <div className={styles.form}>
        <div className={styles.namesQueryRow}>
          <input
            className={styles.input}
            placeholder="Find a name (e.g. alice)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Name to claim"
            data-testid="names-query"
            disabled={Boolean(busy)}
          />
          <select
            className={styles.namesYears}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            aria-label="Years"
            data-testid="names-years"
            disabled={Boolean(busy)}
          >
            {Array.from({ length: NAME_MAX_YEARS }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>
                {y} yr
              </option>
            ))}
          </select>
        </div>
        {query.trim() && !v.ok && <p className={styles.error}>{v.error}</p>}
        {v.ok && check && (
          <p className={check.available ? styles.success : styles.error} data-testid="names-availability">
            {check.available
              ? `${displayName(label)} is available: ${rent} BOING for ${years} year${years > 1 ? 's' : ''} (+ small network fees)`
              : check.reserved
                ? `${displayName(label)} is reserved`
                : `${displayName(label)} is taken${check.record ? ` (${check.record.status})` : ''}`}
          </p>
        )}
        {v.ok && check?.available && !canAfford && (
          <p className={styles.addressHint}>You need about {(rent + 3n).toString()} BOING. Use the faucet first.</p>
        )}
        <button
          type="button"
          className={styles.primary}
          disabled={!v.ok || !check?.available || !canAfford || Boolean(busy) || enabled === false}
          onClick={() => void claim()}
          data-testid="names-claim"
        >
          {busy && busy.startsWith('Step') ? busy : 'Claim name'}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert" data-testid="names-error">
          {error}
        </p>
      )}
      {ok && (
        <p className={styles.success} data-testid="names-ok">
          {ok}
        </p>
      )}
      <h3 className={styles.sectionTitle}>Your names</h3>
      {owned == null ? (
        <p className={styles.addressHint}>Loading…</p>
      ) : owned.length === 0 ? (
        <p className={styles.addressHint} data-testid="names-empty">
          You don&apos;t own any names yet.
        </p>
      ) : (
        <ul className={styles.txHistoryList} aria-label="Your names" data-testid="names-list">
          {owned.map((r) => {
            const isPrimary = primary === r.name;
            const pointsElsewhere = r.target.replace(/^0x/, '') !== me;
            return (
              <li key={r.name} className={styles.nameRow} data-testid="names-row">
                <div className={styles.nameRowHead}>
                  <strong>{r.display}</strong>
                  {isPrimary && <span className={styles.nameBadge}>primary</span>}
                  <span className={styles.addressHint}>{expiresIn(r)}</span>
                </div>
                {pointsElsewhere && (
                  <span className={styles.addressHint} title={r.target}>
                    points to {shortAddress(r.target, 8, 6)}
                  </span>
                )}
                <div className={styles.nameActions}>
                  <button type="button" className={styles.copyBtn} disabled={Boolean(busy)} onClick={() => setAction({ kind: 'renew', name: r.name })}>
                    Renew
                  </button>
                  {!isPrimary && !pointsElsewhere && (
                    <button
                      type="button"
                      className={styles.copyBtn}
                      disabled={Boolean(busy) || r.status !== 'active'}
                      onClick={() => void run('primary', (c) => sendNamePayload(c, { kind: 'name_set_primary', name: r.name }), `Set ${r.display} as primary`)}
                      data-testid="names-set-primary"
                    >
                      Make primary
                    </button>
                  )}
                  {isPrimary && (
                    <button
                      type="button"
                      className={styles.copyBtn}
                      disabled={Boolean(busy)}
                      onClick={() => void run('primary', (c) => sendNamePayload(c, { kind: 'name_set_primary', name: null }), 'Clear primary name')}
                    >
                      Clear primary
                    </button>
                  )}
                  <button type="button" className={styles.copyBtn} disabled={Boolean(busy)} onClick={() => setAction({ kind: 'target', name: r.name })}>
                    Point to…
                  </button>
                  <button type="button" className={styles.copyBtn} disabled={Boolean(busy)} onClick={() => setAction({ kind: 'transfer', name: r.name })}>
                    Transfer
                  </button>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (window.confirm(`Release ${r.display}? Anyone can register it afterwards. Rent is not refunded.`)) {
                        void run('release', (c) => sendNamePayload(c, { kind: 'name_release', name: r.name }), `Release ${r.display}`);
                      }
                    }}
                  >
                    Release
                  </button>
                </div>
                {action?.name === r.name && (
                  <div className={styles.sendAmountRow}>
                    {action.kind === 'renew' ? (
                      <select className={styles.input} value={actionValue || '1'} onChange={(e) => setActionValue(e.target.value)} aria-label="Renew years">
                        {Array.from({ length: NAME_MAX_YEARS }, (_, i) => i + 1).map((y) => (
                          <option key={y} value={y}>
                            {y} year{y > 1 ? 's' : ''} ({rentFor(r.name, y).toString()} BOING)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.input}
                        placeholder={action.kind === 'transfer' ? 'New owner (address or name.boing)' : 'Point to (address or name.boing)'}
                        value={actionValue}
                        onChange={(e) => setActionValue(e.target.value)}
                        aria-label={action.kind === 'transfer' ? 'New owner' : 'New target'}
                      />
                    )}
                    <button
                      type="button"
                      className={styles.maxBtn}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        if (action.kind === 'renew') {
                          const y = Number(actionValue || '1');
                          void run('renew', (c) => sendNamePayload(c, { kind: 'name_renew', name: r.name, years: y }), `Renew ${r.display} for ${y} year(s)`);
                          return;
                        }
                        void (async () => {
                          const to = await resolveRecipient(rpcUrl, actionValue);
                          if (!to.ok) {
                            setError(to.error);
                            return;
                          }
                          const id = accountIdFromHex(to.hex);
                          if (action.kind === 'transfer') {
                            if (!window.confirm(`Transfer ${r.display} to 0x${to.hex}? You will no longer control it.`)) return;
                            void run('transfer', (c) => sendNamePayload(c, { kind: 'name_transfer', name: r.name, new_owner: id }), `Transfer ${r.display}`);
                          } else {
                            void run('target', (c) => sendNamePayload(c, { kind: 'name_set_target', name: r.name, target: id }), `Point ${r.display}`);
                          }
                        })();
                      }}
                    >
                      {action.kind === 'renew' ? 'Renew' : action.kind === 'transfer' ? 'Transfer' : 'Save'}
                    </button>
                    <button type="button" className={styles.maxBtn} onClick={() => setAction(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}