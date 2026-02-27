import { useEffect, useState } from 'react';
import { useWallet, NETWORKS } from '../context/WalletContext';
import { formatAddress, accountIdFromHex, accountIdToHex } from '../boing/types';
import { parseDecimalAmount } from '../boing/amount';
import { validateContractBytecode, VALID_PURPOSE_CATEGORIES } from '../boing/qa';
import * as rpc from '../boing/rpc';
import type { BalanceResult } from '../networks/types';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const {
    accountId,
    network,
    setNetwork,
    lock,
    logout,
    getPrivateKey,
  } = useWallet();

  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [chainHeight, setChainHeight] = useState<number | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');
  const [sending, setSending] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [faucetError, setFaucetError] = useState('');
  const [copied, setCopied] = useState(false);
  const [stake, setStake] = useState<string | null>(null);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [bondAmount, setBondAmount] = useState('');
  const [bondError, setBondError] = useState('');
  const [bondSuccess, setBondSuccess] = useState('');
  const [bonding, setBonding] = useState(false);
  const [unbondAmount, setUnbondAmount] = useState('');
  const [unbondError, setUnbondError] = useState('');
  const [unbondSuccess, setUnbondSuccess] = useState('');
  const [unbonding, setUnbonding] = useState(false);
  const [qaBytecode, setQaBytecode] = useState('');
  const [qaPurpose, setQaPurpose] = useState<string>('');
  const [qaResult, setQaResult] = useState<{ result: 'allow' | 'reject' | 'unsure'; ruleId?: string; message?: string } | null>(null);
  const [qaValidating, setQaValidating] = useState(false);
  const [qaUseRpc, setQaUseRpc] = useState(true);

  const address = accountId ? formatAddress(accountId, false) : '';

  useEffect(() => {
    if (!accountId) return;
    setBalanceError(null);
    network
      .getBalance(accountId)
      .then(setBalance)
      .catch((e) => {
        setBalance(null);
        setBalanceError(e instanceof Error ? e.message : String(e));
      });
  }, [accountId, network]);

  useEffect(() => {
    if (!network.getChainHeight) return;
    network.getChainHeight().then(setChainHeight).catch(() => setChainHeight(null));
  }, [network]);

  useEffect(() => {
    if (!accountId || !network.getStake) return;
    setStakeError(null);
    network
      .getStake(accountId)
      .then(setStake)
      .catch((e) => {
        setStake(null);
        setStakeError(e instanceof Error ? e.message : String(e));
      });
  }, [accountId, network]);

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSendError('');
    setSendSuccess('');
    const toHex = sendTo.replace(/\s/g, '').replace(/^0x/i, '');
    if (toHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(toHex)) {
      setSendError('Invalid address: must be 64 hex characters');
      return;
    }
    if (accountId && toHex.toLowerCase() === accountIdToHex(accountId).toLowerCase()) {
      setSendError('Cannot send to yourself');
      return;
    }
    const decimals = balance?.decimals ?? 18;
    const amount = sendAmount.trim() ? parseDecimalAmount(sendAmount, decimals) : null;
    if (amount == null || amount <= 0n) {
      setSendError('Enter a valid amount in BOING (e.g. 1 or 0.5)');
      return;
    }
    if (balance && BigInt(balance.value) < amount) {
      setSendError('Insufficient balance');
      return;
    }
    const privateKey = getPrivateKey();
    if (!accountId || !privateKey) {
      setSendError('Wallet locked');
      return;
    }
    setSending(true);
    try {
      const nonce = await network.getNonce(accountId);
      const toId = accountIdFromHex(toHex);
      const signedHex = await network.buildTransfer(
        accountId,
        toId,
        amount,
        nonce,
        privateKey
      );
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        setSendSuccess(result.txHash ? `Sent! Tx: ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
        setSendAmount('');
        setSendTo('');
        setBalance(null);
        network.getBalance(accountId).then(setBalance).catch(() => {});
      } else {
        setSendError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleFaucet() {
    if (!accountId || !network.faucetRequest) return;
    setFaucetStatus('loading');
    setFaucetError('');
    try {
      const result = await network.faucetRequest(accountId);
      if (result.success) {
        setFaucetStatus('ok');
        setBalance(null);
        network.getBalance(accountId).then(setBalance).catch(() => {});
      } else {
        setFaucetStatus('err');
        setFaucetError(result.error ?? 'Faucet request failed');
      }
    } catch (err) {
      setFaucetStatus('err');
      setFaucetError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBond(e: React.FormEvent) {
    e.preventDefault();
    if (!network.buildBond || !accountId) return;
    setBondError('');
    setBondSuccess('');
    const decimals = balance?.decimals ?? 18;
    const amount = bondAmount.trim() ? parseDecimalAmount(bondAmount, decimals) : null;
    if (amount == null || amount <= 0n) {
      setBondError('Enter a valid amount in BOING (e.g. 1 or 0.5)');
      return;
    }
    if (balance && BigInt(balance.value) < amount) {
      setBondError('Insufficient balance');
      return;
    }
    const privateKey = getPrivateKey();
    if (!privateKey) {
      setBondError('Wallet locked');
      return;
    }
    setBonding(true);
    try {
      const nonce = await network.getNonce(accountId);
      const signedHex = await network.buildBond(accountId, amount, nonce, privateKey);
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        setBondSuccess(result.txHash ? `Bonded! Tx: ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
        setBondAmount('');
        setBalance(null);
        setStake(null);
        network.getBalance(accountId).then(setBalance).catch(() => {});
        if (network.getStake) network.getStake(accountId).then(setStake).catch(() => {});
      } else {
        setBondError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setBondError(err instanceof Error ? err.message : String(err));
    } finally {
      setBonding(false);
    }
  }

  async function handleUnbond(e: React.FormEvent) {
    e.preventDefault();
    if (!network.buildUnbond || !accountId) return;
    setUnbondError('');
    setUnbondSuccess('');
    const decimals = balance?.decimals ?? 18;
    const amount = unbondAmount.trim() ? parseDecimalAmount(unbondAmount, decimals) : null;
    if (amount == null || amount <= 0n) {
      setUnbondError('Enter a valid amount in BOING (e.g. 1 or 0.5)');
      return;
    }
    const staked = stake ? BigInt(stake) : 0n;
    if (amount > staked) {
      setUnbondError('Insufficient staked amount');
      return;
    }
    const privateKey = getPrivateKey();
    if (!privateKey) {
      setUnbondError('Wallet locked');
      return;
    }
    setUnbonding(true);
    try {
      const nonce = await network.getNonce(accountId);
      const signedHex = await network.buildUnbond(accountId, amount, nonce, privateKey);
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        setUnbondSuccess(result.txHash ? `Unbonded! Tx: ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
        setUnbondAmount('');
        setBalance(null);
        setStake(null);
        network.getBalance(accountId).then(setBalance).catch(() => {});
        if (network.getStake) network.getStake(accountId).then(setStake).catch(() => {});
      } else {
        setUnbondError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setUnbondError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnbonding(false);
    }
  }

  function openFaucetPage() {
    const hex = address;
    const url = network.config.faucetUrl
      ? `${network.config.faucetUrl}?address=${encodeURIComponent(hex)}`
      : `https://boing.network/network/faucet?address=${encodeURIComponent(hex)}`;
    window.open(url, '_blank');
  }

  async function handleQaValidate(e: React.FormEvent) {
    e.preventDefault();
    setQaResult(null);
    const hex = qaBytecode.replace(/\s/g, '').replace(/^0x/i, '');
    if (!hex) {
      setQaResult({ result: 'reject', ruleId: 'MALFORMED_BYTECODE', message: 'Enter contract bytecode (hex).' });
      return;
    }
    setQaValidating(true);
    try {
      let result = validateContractBytecode(hex);
      if (result.result === 'allow' && qaUseRpc) {
        try {
          const hexWithPrefix = hex.startsWith('0x') ? hex : `0x${hex}`;
          const rpcResult = await rpc.qaCheck(
            network.config.rpcUrl,
            hexWithPrefix,
            qaPurpose.trim() || undefined,
            undefined
          );
          result = {
            result: rpcResult.result,
            ruleId: rpcResult.rule_id ?? result.ruleId,
            message: rpcResult.message ?? result.message,
          };
        } catch {
          // boing_qaCheck not available; keep client result
        }
      }
      setQaResult(result);
    } catch (err) {
      setQaResult({
        result: 'reject',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQaValidating(false);
    }
  }

  if (!accountId) return null;

  const displayStake =
    stake != null
      ? (Number(stake) / 10 ** (balance?.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })
      : stakeError
        ? '—'
        : network.getStake
          ? '…'
          : null;

  const displayBalance =
    balance != null
      ? (Number(balance.value) / 10 ** balance.decimals).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })
      : balanceError
        ? '—'
        : '…';

  return (
    <div className={`${styles.wrap} page-app`}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <div className={styles.headerActions}>
          <select
            value={network.config.id}
            onChange={(e) => setNetwork(e.target.value)}
            className={styles.networkSelect}
          >
            {NETWORKS.map((n) => (
              <option key={n.config.id} value={n.config.id}>
                {n.config.name}
              </option>
            ))}
          </select>
          <button type="button" className={styles.lockBtn} onClick={lock}>
            Lock
          </button>
          <button type="button" className={styles.logoutBtn} onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Address</h2>
          <div className={styles.addressRow}>
            <code className={styles.address}>{address}</code>
            <button type="button" className={styles.copyBtn} onClick={copyAddress}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={styles.addressHint}>
            Use this address to receive BOING and in the faucet.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Balance</h2>
          <p className={styles.balance}>
            {displayBalance} <span className={styles.symbol}>{balance?.symbol ?? 'BOING'}</span>
          </p>
          {chainHeight != null && (
            <p className={styles.chainHeight} aria-label="Chain height">
              Block #{chainHeight.toLocaleString()}
            </p>
          )}
          {balanceError && <p className={styles.error}>{balanceError}</p>}
        </section>

        {(network.buildBond || network.buildUnbond) && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Staking</h2>
            {displayStake != null && (
              <p className={styles.balance}>
                {displayStake} <span className={styles.symbol}>BOING</span> <span className={styles.stakeLabel}>staked</span>
              </p>
            )}
            {network.buildBond && (
              <form onSubmit={handleBond} className={styles.form}>
                <input
                  type="text"
                  placeholder="Amount to bond (e.g. 1.5)"
                  value={bondAmount}
                  onChange={(e) => setBondAmount(e.target.value)}
                  className={styles.input}
                  inputMode="decimal"
                  aria-label="Amount to bond"
                />
                {bondError && <p className={styles.error}>{bondError}</p>}
                {bondSuccess && <p className={styles.success}>{bondSuccess}</p>}
                <button type="submit" className={styles.primary} disabled={bonding}>
                  {bonding ? 'Bonding…' : 'Bond'}
                </button>
              </form>
            )}
            {network.buildUnbond && (
              <form onSubmit={handleUnbond} className={styles.form}>
                <input
                  type="text"
                  placeholder="Amount to unbond (e.g. 0.5)"
                  value={unbondAmount}
                  onChange={(e) => setUnbondAmount(e.target.value)}
                  className={styles.input}
                  inputMode="decimal"
                  aria-label="Amount to unbond"
                />
                {unbondError && <p className={styles.error}>{unbondError}</p>}
                {unbondSuccess && <p className={styles.success}>{unbondSuccess}</p>}
                <button type="submit" className={styles.secondary} disabled={unbonding}>
                  {unbonding ? 'Unbonding…' : 'Unbond'}
                </button>
              </form>
            )}
            <p className={styles.stakingHint}>
              Bond BOING to stake and participate in PoS validation. Unbond to return staked BOING to your balance.
            </p>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Send</h2>
          <form onSubmit={handleSend} className={styles.form}>
            <input
              type="text"
              placeholder="To address (64 hex or 0x…)"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className={styles.input}
            />
            <div className={styles.sendAmountRow}>
              <input
                type="text"
                placeholder="Amount in BOING (e.g. 1.5)"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                className={styles.input}
                inputMode="decimal"
              />
              <button
                type="button"
                className={styles.maxBtn}
                onClick={() => setSendAmount(displayBalance !== '…' && displayBalance !== '—' ? displayBalance : '')}
              >
                Max
              </button>
            </div>
            {sendError && <p className={styles.error}>{sendError}</p>}
            {sendSuccess && <p className={styles.success}>{sendSuccess}</p>}
            <button type="submit" className={styles.primary} disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Deploy contract (QA Pillar)</h2>
          <p className={styles.faucetHint}>
            Validate contract bytecode before deployment. REJECT → blocked. ALLOW → deploy. UNSURE → community QA pool.
          </p>
          <form onSubmit={handleQaValidate} className={styles.form}>
            <textarea
              placeholder="Contract bytecode (hex, e.g. 0x6080604052...)"
              value={qaBytecode}
              onChange={(e) => {
                setQaBytecode(e.target.value);
                setQaResult(null);
              }}
              className={styles.qaTextarea}
              rows={4}
              spellCheck={false}
              aria-label="Contract bytecode"
            />
            <div className={styles.qaPurposeRow}>
              <label htmlFor="qa-purpose" className={styles.qaLabel}>Purpose (optional, for boing_qaCheck)</label>
              <select
                id="qa-purpose"
                value={qaPurpose}
                onChange={(e) => setQaPurpose(e.target.value)}
                className={styles.qaPurposeSelect}
                aria-label="Purpose category"
              >
                <option value="">— None —</option>
                {VALID_PURPOSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <label className={styles.qaCheckbox}>
              <input
                type="checkbox"
                checked={qaUseRpc}
                onChange={(e) => setQaUseRpc(e.target.checked)}
              />
              Also call boing_qaCheck (when available)
            </label>
            <div className={styles.qaButtonRow}>
              <button type="submit" className={styles.primary} disabled={qaValidating}>
                {qaValidating ? 'Validating…' : 'Validate'}
              </button>
            </div>
            {qaResult && (
              <div
                className={
                  qaResult.result === 'allow'
                    ? styles.qaAllow
                    : qaResult.result === 'reject'
                      ? styles.qaReject
                      : styles.qaUnsure
                }
                role="status"
              >
                <strong>{qaResult.result.toUpperCase()}</strong>
                {qaResult.ruleId && <span className={styles.qaRuleId}> ({qaResult.ruleId})</span>}
                {qaResult.message && <p className={styles.qaMessage}>{qaResult.message}</p>}
              </div>
            )}
          </form>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Testnet faucet</h2>
          <p className={styles.faucetHint}>
            Request testnet BOING for this address.
          </p>
          <div className={styles.faucetRow}>
            {network.faucetRequest ? (
              <button
                type="button"
                className={styles.primary}
                onClick={handleFaucet}
                disabled={faucetStatus === 'loading'}
              >
                {faucetStatus === 'loading'
                  ? 'Requesting…'
                  : faucetStatus === 'ok'
                    ? 'Requested'
                    : 'Request testnet BOING'}
              </button>
            ) : null}
            <button type="button" className={styles.secondary} onClick={openFaucetPage}>
              Open faucet page
            </button>
          </div>
          {faucetError && <p className={styles.error}>{faucetError}</p>}
        </section>
      </main>
    </div>
  );
}
