import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { formatAddress, accountIdFromHex, accountIdToHex } from '../boing/types';
import { formatBalance, parseDecimalAmount } from '../boing/amount';
import { validateContractBytecode, VALID_PURPOSE_CATEGORIES } from '../boing/qa';
import * as rpc from '../boing/rpc';
import { addTxHistory, getTxHistory } from '../storage/txHistory';
import {
  getOnboardingState,
  markWalletCreated,
  markGotTestnetBoing,
  markSentTx,
  dismissOnboarding,
} from '../storage/onboarding';
import { getLockAfterLabel } from '../storage/lockSettings';
import type { BalanceResult } from '../networks/types';
import { chainIdHexToDecimal } from '../networks/chainIds';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const {
    accountId,
    network,
    availableNetworks,
    networkDiscovery,
    setNetwork,
    lock,
    logout,
    getPrivateKey,
    rpcOverrides,
    setRpcOverride,
    lockAfterMinutes,
    setLockAfterMinutes,
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
  const [qaDescriptionHash, setQaDescriptionHash] = useState('');
  const [qaResult, setQaResult] = useState<{ result: 'allow' | 'reject' | 'unsure'; ruleId?: string; message?: string; docUrl?: string } | null>(null);
  const [qaValidating, setQaValidating] = useState(false);
  const [qaUseRpc, setQaUseRpc] = useState(true);
  const [onboarding, setOnboarding] = useState(getOnboardingState);
  const [txHistory, setTxHistory] = useState<ReturnType<typeof getTxHistory>>([]);
  const [showRpcOverride, setShowRpcOverride] = useState(false);
  const [rpcOverrideInput, setRpcOverrideInput] = useState('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txHashCopied, setTxHashCopied] = useState(false);

  const address = accountId ? formatAddress(accountId, false) : '';
  const addressHint = address ? `${address.slice(0, 8)}…${address.slice(-8)}` : '';

  const refreshData = useCallback(async () => {
    if (!accountId) return;
    setRefreshing(true);
    setBalanceError(null);
    setStakeError(null);
    try {
      const [bal, h, st] = await Promise.all([
        network.getBalance(accountId).catch((e) => {
          setBalanceError(e instanceof Error ? e.message : String(e));
          return null;
        }),
        network.getChainHeight?.().catch(() => null) ?? Promise.resolve(null),
        network.getStake ? network.getStake(accountId).catch((e) => {
          setStakeError(e instanceof Error ? e.message : String(e));
          return null;
        }) : Promise.resolve(null),
      ]);
      if (bal) setBalance(bal);
      if (h != null) setChainHeight(h);
      if (st != null) setStake(st);
    } finally {
      setRefreshing(false);
    }
  }, [accountId, network]);

  useEffect(() => {
    if (!accountId) return;
    refreshData();
  }, [accountId, refreshData]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && accountId) refreshData();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [accountId, refreshData]);

  useEffect(() => {
    if (!accountId) return;
    const id = setInterval(refreshData, 45_000);
    return () => clearInterval(id);
  }, [accountId, refreshData]);

  useEffect(() => {
    markWalletCreated();
  }, []);

  useEffect(() => {
    if (addressHint && accountId) {
      setTxHistory(getTxHistory(addressHint, network.config.id));
      setRpcOverrideInput(rpcOverrides[network.config.id] ?? '');
    }
  }, [addressHint, accountId, network.config.id, rpcOverrides]);

  function refreshTxHistory() {
    if (addressHint && accountId) {
      setTxHistory(getTxHistory(addressHint, network.config.id));
    }
  }

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyTxHash() {
    if (!lastTxHash) return;
    await navigator.clipboard.writeText(lastTxHash);
    setTxHashCopied(true);
    setTimeout(() => setTxHashCopied(false), 2000);
  }

  const explorerBase = network.config.explorerUrl?.replace(/\/$/, '') ?? '';
  const isMainnet = !network.config.isTestnet;
  const accountExplorerUrl = explorerBase ? `${explorerBase}/account/${address}` : '';

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
    const decimals = balance?.decimals ?? 0;
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
        if (result.txHash) {
          addTxHistory(addressHint, network.config.id, result.txHash, 'send');
          refreshTxHistory();
          markSentTx();
          setOnboarding(getOnboardingState());
          setLastTxHash(result.txHash);
        }
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
        markGotTestnetBoing();
        setOnboarding(getOnboardingState());
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
    const decimals = balance?.decimals ?? 0;
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
        if (result.txHash) {
          addTxHistory(addressHint, network.config.id, result.txHash, 'bond');
          refreshTxHistory();
          setLastTxHash(result.txHash);
        }
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
    const decimals = balance?.decimals ?? 0;
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
        if (result.txHash) {
          addTxHistory(addressHint, network.config.id, result.txHash, 'unbond');
          refreshTxHistory();
          setLastTxHash(result.txHash);
        }
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
      : `https://boing.network/faucet?address=${encodeURIComponent(hex)}`;
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
            qaDescriptionHash.trim() || undefined
          );
          result = {
            result: rpcResult.result,
            ruleId: rpcResult.rule_id ?? result.ruleId,
            message: rpcResult.message ?? result.message,
            docUrl: rpcResult.doc_url,
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
      ? formatBalance(stake, balance?.decimals ?? 0)
      : stakeError
        ? '—'
        : network.getStake
          ? '…'
          : null;

  const displayBalance =
    balance != null
      ? formatBalance(balance.value, balance.decimals)
      : balanceError
        ? '—'
        : '…';

  const showNetworkDiscoveryBar =
    networkDiscovery.status === 'loading' ||
    networkDiscovery.status === 'error' ||
    (networkDiscovery.status === 'ok' &&
      (networkDiscovery.fetchedLive ||
        networkDiscovery.usedStaleCache ||
        networkDiscovery.skippedLiveFetch ||
        networkDiscovery.officialWebsiteUrl ||
        !!networkDiscovery.meta?.boing_testnet_download_tag));

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
            {availableNetworks.map((n) => (
              <option key={n.config.id} value={n.config.id}>
                {n.config.name}
              </option>
            ))}
          </select>
          <label className={styles.lockAfterLabel}>
            Lock after:
            <select
              value={lockAfterMinutes}
              onChange={(e) => setLockAfterMinutes(Number(e.target.value) as 0 | 5 | 15 | 30)}
              className={styles.lockAfterSelect}
              aria-label="Auto-lock after inactivity"
            >
              <option value={0}>{getLockAfterLabel(0)}</option>
              <option value={5}>{getLockAfterLabel(5)}</option>
              <option value={15}>{getLockAfterLabel(15)}</option>
              <option value={30}>{getLockAfterLabel(30)}</option>
            </select>
          </label>
          <button
            type="button"
            className={styles.networkSyncBtn}
            onClick={() => void networkDiscovery.refresh()}
            disabled={networkDiscovery.status === 'loading'}
            title="Refresh RPC and links from boing.network/api/networks"
          >
            {networkDiscovery.status === 'loading' ? 'Syncing…' : 'Sync network'}
          </button>
          <button type="button" className={styles.lockBtn} onClick={lock}>
            Lock
          </button>
          <button type="button" className={styles.logoutBtn} onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {showNetworkDiscoveryBar && (
        <aside className={styles.networkDiscoveryBar} aria-live="polite">
          {networkDiscovery.status === 'loading' && (
            <span className={styles.networkDiscoveryText}>Checking boing.network for latest endpoints…</span>
          )}
          {networkDiscovery.status === 'ok' && networkDiscovery.fetchedLive && !networkDiscovery.usedStaleCache && (
            <span className={styles.networkDiscoveryText}>Endpoints synced from boing.network</span>
          )}
          {networkDiscovery.status === 'ok' && networkDiscovery.usedStaleCache && (
            <span className={styles.networkDiscoveryText}>
              Could not refresh live list; using cached endpoints from boing.network.
            </span>
          )}
          {networkDiscovery.status === 'ok' && networkDiscovery.skippedLiveFetch && (
            <span className={styles.networkDiscoveryText}>
              Using saved network info (refreshes about every hour)
              {networkDiscovery.bootnodeCount > 0
                ? ` · ${networkDiscovery.bootnodeCount} bootnodes in registry`
                : ''}
            </span>
          )}
          {networkDiscovery.status === 'error' && networkDiscovery.errorMessage && (
            <span className={styles.networkDiscoveryError}>{networkDiscovery.errorMessage}</span>
          )}
          {networkDiscovery.officialWebsiteUrl && (
            <a
              href={networkDiscovery.officialWebsiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.networkDiscoveryLink}
            >
              Boing Network
            </a>
          )}
          {networkDiscovery.meta?.boing_testnet_download_tag && (
            <span className={styles.networkDiscoveryTag} title="Official node release tag from /api/networks">
              Node zip: {networkDiscovery.meta.boing_testnet_download_tag}
            </span>
          )}
        </aside>
      )}

      <main className={styles.main}>
        {!onboarding.dismissed && (
          <section className={styles.onboardingSection}>
            <h2 className={styles.sectionTitle}>Getting started</h2>
            <ul className={styles.onboardingList}>
              <li className={onboarding.walletCreated ? styles.onboardingDone : ''}>
                {onboarding.walletCreated ? '✓' : '○'} Create wallet
              </li>
              <li className={onboarding.gotTestnetBoing ? styles.onboardingDone : ''}>
                {onboarding.gotTestnetBoing ? '✓' : '○'} Get testnet BOING (testnet)
              </li>
              <li className={onboarding.sentTx ? styles.onboardingDone : ''}>
                {onboarding.sentTx ? '✓' : '○'} Send a transaction
              </li>
            </ul>
            <button type="button" className={styles.onboardingDismiss} onClick={() => { dismissOnboarding(); setOnboarding(getOnboardingState()); }}>
              Dismiss
            </button>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Address</h2>
          <div className={styles.addressRow}>
            <code className={styles.address}>{address}</code>
            <button type="button" className={styles.copyBtn} onClick={copyAddress}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            {explorerBase && (
              <a
                href={accountExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
                aria-label="View address on explorer"
              >
                View on explorer
              </a>
            )}
          </div>
          <p className={styles.addressHint}>
            Use this address to receive BOING. On testnet, you can also use it with the faucet.
          </p>
        </section>

        <section className={styles.section}>
          <div className={styles.balanceHeader}>
            <h2 className={styles.sectionTitle}>Balance</h2>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={refreshData}
              disabled={refreshing || !accountId}
              aria-label="Refresh balance and chain data"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
          <p className={styles.balance}>
            {displayBalance} <span className={styles.symbol}>{balance?.symbol ?? 'BOING'}</span>
          </p>
          {chainHeight != null && (
            <p className={styles.chainHeight} aria-label="Chain height">
              Block #{chainHeight.toLocaleString()}
            </p>
          )}
          {network.config.chainId && (
            <p className={styles.chainHeight} aria-label="Chain ID for dApps">
              Chain ID {network.config.chainId}{' '}
              <span className={styles.chainIdDecimal}>(decimal {chainIdHexToDecimal(network.config.chainId)})</span>
            </p>
          )}
          <p className={styles.chainIdNote}>
            This is the ID Boing Express reports to sites like boing.finance. Block headers on Boing L1 do not carry
            chain ID — private devnets often still use <code className={styles.inlineCode}>6913</code> for compatibility;
            confirm with your operator if unsure.
          </p>
          {balanceError && (
            <p className={styles.error}>
              {balanceError}
              <button type="button" className={styles.retryBtn} onClick={refreshData}>
                Retry
              </button>
            </p>
          )}
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
                {bondSuccess && (
                  <p className={styles.success}>
                    {bondSuccess}
                    {lastTxHash && (
                      <>
                        {' · '}
                        <button type="button" className={styles.copyTxBtn} onClick={copyTxHash}>{txHashCopied ? 'Copied' : 'Copy tx hash'}</button>
                      </>
                    )}
                  </p>
                )}
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
                {unbondSuccess && (
                  <p className={styles.success}>
                    {unbondSuccess}
                    {lastTxHash && (
                      <>
                        {' · '}
                        <button type="button" className={styles.copyTxBtn} onClick={copyTxHash}>{txHashCopied ? 'Copied' : 'Copy tx hash'}</button>
                      </>
                    )}
                  </p>
                )}
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
          {isMainnet && sendAmount.trim() && (
            <div className={styles.mainnetWarning} role="alert">
              You are on Mainnet. Real BOING is at risk. Double-check the amount and recipient.
            </div>
          )}
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
            {sendSuccess && (
              <p className={styles.success}>
                {sendSuccess}
                {lastTxHash && (
                  <>
                    {' · '}
                    <button type="button" className={styles.copyTxBtn} onClick={copyTxHash}>
                      {txHashCopied ? 'Copied' : 'Copy tx hash'}
                    </button>
                  </>
                )}
              </p>
            )}
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
            <div className={styles.qaPurposeRow}>
              <label htmlFor="qa-description-hash" className={styles.qaLabel}>Description hash (optional)</label>
              <input
                id="qa-description-hash"
                type="text"
                placeholder="0x..."
                value={qaDescriptionHash}
                onChange={(e) => setQaDescriptionHash(e.target.value)}
                className={styles.input}
                aria-label="Description hash"
              />
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
                {qaResult.docUrl && (
                  <p className={styles.qaMessage}>
                    <a href={qaResult.docUrl} target="_blank" rel="noopener noreferrer" className={styles.explorerLink}>
                      Open canonical QA guidance
                    </a>
                  </p>
                )}
              </div>
            )}
          </form>
        </section>

        {network.config.isTestnet && (
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
        )}

        {txHistory.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent transactions</h2>
            <ul className={styles.txHistoryList}>
              {txHistory.slice(0, 10).map((entry) => (
                <li key={entry.txHash} className={styles.txHistoryItem}>
                  <span className={styles.txType}>{entry.type}</span>
                  <code className={styles.txHash}>{entry.txHash.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section}>
          <button
            type="button"
            className={styles.rpcToggle}
            onClick={() => setShowRpcOverride(!showRpcOverride)}
            aria-expanded={showRpcOverride}
          >
            {showRpcOverride ? '−' : '+'} RPC override (dev)
          </button>
          {showRpcOverride && (
            <div className={styles.rpcOverrideForm}>
              <p className={styles.faucetHint}>
                Override RPC URL for the current network (e.g. http://localhost:8545 for local node). Leave empty to use default.
                Chain ID above does not change — it stays the testnet/mainnet value Boing Express uses for{' '}
                <code className={styles.inlineCode}>boing_chainId</code>. Custom RPC must still match that network (same
                genesis / operator expectations).
              </p>
              <div className={styles.rpcOverrideRow}>
                <label htmlFor="rpc-override" className={styles.qaLabel}>
                  {network.config.name} RPC URL
                </label>
                <input
                  id="rpc-override"
                  type="text"
                  placeholder={network.config.rpcUrl}
                  value={rpcOverrideInput}
                  onChange={(e) => setRpcOverrideInput(e.target.value)}
                  className={styles.input}
                />
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setRpcOverride(network.config.id, rpcOverrideInput);
                  }}
                >
                  Save
                </button>
              </div>
              {rpcOverrides[network.config.id] && (
                <p className={styles.success}>Using override: {rpcOverrides[network.config.id]}</p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
