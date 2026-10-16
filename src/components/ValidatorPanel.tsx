import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex } from '../boing/types';
import { buildSignedTransactionHex } from '../boing/signing';
import { suggestedAccessList } from '../boing/accessList';
import type { Payload, Transaction } from '../boing/types';
import * as rpc from '../boing/rpc';
import {
  buildRegisterPayload,
  bytesToHex,
  canUnjail,
  generateNodeSecret,
  nodeIdFromSecret,
  parseNodeSecretHex,
  registrationAvailability,
  validatorsOwnedBy,
  type ValidatorEntry,
  type ValidatorsReport,
} from '../boing/openValidator';
import type { NetworkAdapter } from '../networks/types';
import type { TxHistoryEntry } from '../storage/txHistory';
import styles from '../screens/Dashboard.module.css';

interface Props {
  network: NetworkAdapter;
  accountId: AccountId;
  getPrivateKey: () => Uint8Array | null;
  onSubmitted: (txHash: string, type: TxHistoryEntry['type']) => void;
}

const LIST_STYLE: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '0 0 8px' };
const ROW_STYLE: React.CSSProperties = {
  display: 'block',
  padding: '8px 0',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  overflowWrap: 'anywhere',
};

function short(hex: string): string {
  const h = hex.replace(/^0x/, '');
  return `0x${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function ValidatorPanel({ network, accountId, getPrivateKey, onSubmitted }: Props) {
  const rpcUrl = network.config.rpcUrl;
  const ownerHex = accountIdToHex(accountId);
  const [report, setReport] = useState<ValidatorsReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodeKeyInput, setNodeKeyInput] = useState('');
  const [generatedShown, setGeneratedShown] = useState(false);
  const [nodeIdPreview, setNodeIdPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingUnbond, setPendingUnbond] = useState<{ amount: string; unlock: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await rpc.getValidators(rpcUrl)) as ValidatorsReport;
      setReport(r);
      setLoadError(null);
    } catch (e) {
      setReport(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    if (network.getUnbondStatus) {
      try {
        const u = await network.getUnbondStatus(accountId);
        setPendingUnbond(u.pendingUnbond !== '0' ? { amount: u.pendingUnbond, unlock: u.unlockHeight } : null);
      } catch {
        setPendingUnbond(null);
      }
    }
  }, [rpcUrl, network, accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Derive the node id locally as the key is typed (key itself never leaves this component).
  useEffect(() => {
    let cancelled = false;
    if (!nodeKeyInput.trim()) {
      setNodeIdPreview(null);
      return;
    }
    try {
      const seed = parseNodeSecretHex(nodeKeyInput);
      void nodeIdFromSecret(seed).then((id) => {
        if (!cancelled) setNodeIdPreview(accountIdToHex(id));
      });
    } catch {
      setNodeIdPreview(null);
    }
    return () => {
      cancelled = true;
    };
  }, [nodeKeyInput]);

  async function send(payload: Payload, type: TxHistoryEntry['type'], label: string) {
    setError('');
    setSuccess('');
    const pk = getPrivateKey();
    if (!pk) {
      setError('Wallet locked');
      return false;
    }
    setBusy(true);
    try {
      const nonce = await network.getNonce(accountId);
      const tx: Transaction = { nonce, sender: accountId, payload, access_list: suggestedAccessList(accountId, payload) };
      const signed = await buildSignedTransactionHex(tx, pk);
      const res = await network.submitTransaction(signed);
      if (!res.success) {
        setError(res.error ?? 'Submit failed');
        return false;
      }
      if (res.txHash) onSubmitted(res.txHash, type);
      setSuccess(`${label} submitted${res.txHash ? `. Tx: ${res.txHash.slice(0, 18)}…` : ''}`);
      setTimeout(() => void refresh(), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    let seed: Uint8Array;
    try {
      seed = parseNodeSecretHex(nodeKeyInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const payload = await buildRegisterPayload(accountId, seed);
    seed.fill(0);
    const ok = await send(payload, 'validator_register', 'Registration');
    if (ok) {
      setNodeKeyInput('');
      setGeneratedShown(false);
    }
  }

  function handleGenerate() {
    const seed = generateNodeSecret();
    setNodeKeyInput(bytesToHex(seed));
    seed.fill(0);
    setGeneratedShown(true);
  }

  const avail = registrationAvailability(report);
  const mine = validatorsOwnedBy(report, ownerHex);
  const height = report?.height ?? 0;
  const open = report?.open ?? null;
  const thresholdPct = open ? open.miss_threshold_bps / 100 : 10;

  function row(v: ValidatorEntry, actions: boolean) {
    const nodeId = accountIdFromHex(v.id);
    return (
      <li key={v.id} style={ROW_STYLE} data-testid={`validator-row-${v.id.replace(/^0x/, '').slice(0, 8)}`}>
        <div>
          <strong>{short(v.id)}</strong> <span className={styles.txType}>{v.kind}</span>{' '}
          <span data-testid="validator-status">
            {v.status}
            {v.status === 'jailed' && v.jailed_until != null ? ` until block ${v.jailed_until}` : ''}
            {v.in_set ? ' · in set' : ''}
          </span>
        </div>
        <div className={styles.faucetHint} data-testid="validator-stats">
          {v.status === 'jailed' ? 'Since jailing: ' : ''}Uptime {v.uptime_pct.toFixed(1)}% · missed {v.missed_proposals}/
          {v.scheduled_proposals} blocks · bond {v.bond} BOING
        </div>
        {v.status === 'jailed' && (
          <div className={styles.faucetHint} data-testid="validator-last-jail">
            {v.last_jail
              ? `At jailing (block ${v.last_jail.jailed_at}): uptime ${v.last_jail.uptime_pct.toFixed(1)}% · missed ${v.last_jail.missed_proposals}/${v.last_jail.scheduled_proposals} blocks`
              : 'At jailing: stats not recorded by this node'}
          </div>
        )}
        {actions && (
          <div className={styles.qaButtonRow}>
            {(v.status === 'pending' || v.status === 'active' || v.status === 'jailed') && (
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                data-testid="validator-deregister"
                onClick={() => void send({ kind: 'validator_deregister', node_id: nodeId }, 'validator_deregister', 'Deregistration')}
              >
                Deregister
              </button>
            )}
            {v.status === 'jailed' && (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !canUnjail(v, height)}
                data-testid="validator-unjail"
                onClick={() => void send({ kind: 'validator_unjail', node_id: nodeId }, 'validator_unjail', 'Unjail')}
              >
                {canUnjail(v, height) ? 'Unjail' : `Unjail after block ${v.jailed_until}`}
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <section className={styles.section} data-testid="validator-panel">
      <h2 className={styles.sectionTitle}>Validator</h2>
      {loading && !report && !loadError && <p className={styles.faucetHint}>Loading validator set…</p>}

      {(avail.state === 'unsupported' || avail.state === 'not_open' || avail.state === 'scheduled') && !loading && (
        <div data-testid="validator-coming-soon">
          <p className={styles.faucetHint}>
            <strong>Open validator registration: coming soon.</strong>{' '}
            {avail.state === 'scheduled'
              ? `Registration opens at block ${avail.activationHeight} (current block ${avail.height}).`
              : 'This network does not accept permissionless validator registration yet. Watch the Boing announcements for the activation height.'}
          </p>
          <p className={styles.stakingHint}>
            Once open: lock a 100 BOING bond, join at the next epoch (every 100 blocks), stay online to keep your uptime
            above 90%. Jailed validators keep their bond and can unjail after a cooldown.
          </p>
        </div>
      )}

      {report && (
        <p className={styles.faucetHint} data-testid="validator-summary">
          Mode <strong>{report.mode}</strong> · block {report.height} · {report.validator_count} validator
          {report.validator_count === 1 ? '' : 's'} in set
          {open?.next_epoch_height != null ? ` · next epoch at block ${open.next_epoch_height}` : ''}
          {open ? ` · bond ${open.bond} BOING` : ''}
        </p>
      )}
      {loadError && (
        <p className={styles.faucetHint} data-testid="validator-load-error">
          Could not load validators from this node ({loadError}).
        </p>
      )}

      {avail.state === 'open' && (
        <>
          {mine.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Your validators</h3>
              <ul style={LIST_STYLE}>{mine.map((v) => row(v, true))}</ul>
            </>
          )}
          {mine.length === 0 && (
            <form onSubmit={handleRegister} className={styles.form} data-testid="validator-register-form">
              <p className={styles.mainnetWarning} role="note" data-testid="validator-key-warning">
                Your node key is the secret your validator node signs blocks with. It is used only in this browser tab to
                sign a proof that the node belongs to this wallet; it is never stored or sent anywhere. Keep a copy in
                your node config (BOING_VALIDATOR_KEY) and never share it.
              </p>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Node key (64 hex chars)"
                value={nodeKeyInput}
                onChange={(e) => {
                  setNodeKeyInput(e.target.value);
                  setGeneratedShown(false);
                }}
                className={styles.input}
                aria-label="Node key"
                data-testid="validator-node-key"
              />
              <button type="button" className={styles.secondary} onClick={handleGenerate} data-testid="validator-generate">
                Generate a new node key
              </button>
              {generatedShown && (
                <p className={styles.faucetHint} data-testid="validator-generated-hint">
                  A new key was generated locally. Copy it from the field above (it is hidden; select and copy) into your
                  node's config before registering; it cannot be recovered later.
                </p>
              )}
              {nodeIdPreview && (
                <p className={styles.faucetHint} data-testid="validator-node-id">
                  Node id: <code className={styles.inlineCode}>{short(nodeIdPreview)}</code>
                </p>
              )}
              <p className={styles.stakingHint}>
                Registering locks {open?.bond ?? '100'} BOING. You join at block {open?.next_epoch_height ?? '?'} (next
                epoch). Missing more than {thresholdPct}% of your proposals over the last {open?.liveness_window ?? 1000}{' '}
                produced blocks jails you at the following epoch (bond kept; unjail after {open?.jail_cooldown ?? 500}{' '}
                blocks).
              </p>
              <button type="submit" className={styles.primary} disabled={busy || !nodeIdPreview} data-testid="validator-register">
                {busy ? 'Submitting…' : `Register validator (${open?.bond ?? '100'} BOING bond)`}
              </button>
            </form>
          )}
        </>
      )}

      {pendingUnbond && network.buildClaimUnbond && (
        <div className={styles.form} data-testid="validator-claim">
          <p className={styles.faucetHint}>
            {pendingUnbond.amount} BOING unbonding
            {pendingUnbond.unlock > height ? `, unlocks at block ${pendingUnbond.unlock}` : ', ready to claim'}.
          </p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || pendingUnbond.unlock > height}
            onClick={() => void send({ kind: 'claim_unbond' }, 'claim_unbond', 'Claim')}
          >
            Claim unbond
          </button>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {success && (
        <p className={styles.success} role="status" data-testid="validator-success">
          {success}
        </p>
      )}

      {report && report.validators.length > 0 && (
        <details className={styles.subDetails} open={avail.state === 'open'}>
          <summary>All validators ({report.validators.length})</summary>
          <ul style={LIST_STYLE} data-testid="validator-list">
            {report.validators.map((v) => row(v, false))}
          </ul>
        </details>
      )}
      <button type="button" className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading}>
        Refresh
      </button>
    </section>
  );
}
