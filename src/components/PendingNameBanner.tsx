import { useEffect, useRef, useState } from 'react';
import { knownLedgerDecimals, oneBoing } from '../boing/nativeUnit';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import type { NetworkAdapter } from '../networks/types';
import { claimName, displayName, getNameInfo, rentFor } from '../boing/names';
import { getPendingName, setPendingName, type PendingNameClaim } from '../storage/pendingName';
import { nameTxContext, STEP_LABEL } from './NamesPanel';
import styles from '../screens/Dashboard.module.css';

/**
 * Finishes the name picked during wallet creation: waits for enough BOING, then commit → register →
 * primary automatically (the user opted in at creation). Shows progress and lets them cancel.
 */
export function PendingNameBanner(p: {
  accountId: AccountId;
  network: NetworkAdapter;
  getPrivateKey: () => Uint8Array | null;
  balance: bigint | null;
  onDone?: (name: string) => void;
}) {
  const me = accountIdToHex(p.accountId);
  const [pending, setPending] = useState<PendingNameClaim | null>(() => getPendingName());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const running = useRef(false);

  // Bind an unbound pending claim to the first account that opens the dashboard.
  useEffect(() => {
    const cur = getPendingName();
    if (cur && !cur.address) {
      const bound = { ...cur, address: me, networkId: p.network.config.id };
      setPendingName(bound);
      setPending(bound);
    } else {
      setPending(cur);
    }
  }, [me, p.network.config.id]);

  const mine = pending && pending.address === me && (!pending.networkId || pending.networkId === p.network.config.id) ? pending : null;
  // Rent + 3 name txs of headroom, in whole BOING, scaled to the balance's ledger units.
  const need = mine ? (rentFor(mine.name, 1) + 3n) * oneBoing(knownLedgerDecimals(p.network.config.rpcUrl)) : 0n;
  const funded = p.balance != null && p.balance >= need;

  useEffect(() => {
    if (!mine || !funded || running.current) return;
    running.current = true;
    setError('');
    void (async () => {
      try {
        const info = await getNameInfo(p.network.config.rpcUrl, mine.name);
        if (!info?.registry?.enabled || !info.registry.active) throw new Error('Names are not live on this network yet');
        if (!info.available) {
          if (info.record?.owner?.replace(/^0x/, '') === me) {
            setPendingName(null);
            setPending(null);
            p.onDone?.(mine.name);
            return;
          }
          throw new Error(`${displayName(mine.name)} was taken by someone else. Pick another in Settings → Names.`);
        }
        await claimName(nameTxContext(p), { name: mine.name, years: 1, primary: true, onStep: (s) => setStatus(STEP_LABEL[s]) });
        setPendingName(null);
        setPending(null);
        p.onDone?.(mine.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPendingName({ ...mine, lastError: msg });
      } finally {
        setStatus('');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.name, funded]);

  if (!mine) return null;
  return (
    <section className={styles.namePending} data-testid="pending-name">
      <strong>{displayName(mine.name)}</strong>{' '}
      {status ? (
        <span data-testid="pending-name-status">{status}</span>
      ) : funded ? (
        <span>is being claimed…</span>
      ) : (
        <span>
          will be claimed as soon as this wallet has {need.toString()} BOING ({rentFor(mine.name, 1).toString()} rent for one year + fees).
          {p.network.config.isTestnet ? ' Use the Faucet tab to get testnet BOING.' : ''}
        </span>
      )}
      {error && (
        <p className={styles.error} role="alert" data-testid="pending-name-error">
          {error}
        </p>
      )}
      {!status && (
        <button
          type="button"
          className={styles.copyBtn}
          onClick={() => {
            setPendingName(null);
            setPending(null);
          }}
          data-testid="pending-name-cancel"
        >
          {error ? 'Dismiss' : 'Cancel'}
        </button>
      )}
    </section>
  );
}