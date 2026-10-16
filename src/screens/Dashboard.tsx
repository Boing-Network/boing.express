import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { formatAddress, accountIdFromHex, accountIdToHex } from '../boing/types';
import { formatBalance, parseDecimalAmount, parseU128String } from '../boing/amount';
import { validateContractBytecode, VALID_PURPOSE_CATEGORIES } from '../boing/qa';
import * as rpc from '../boing/rpc';
import { addTxHistory, getTxHistory } from '../storage/txHistory';
import { chainRowToDisplay, fetchChainTxPage, mergeTxHistory, type DisplayTxEntry } from '../boing/chainTxHistory';
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
import { NftHoldingsPanel } from '../components/NftHoldingsPanel';
import { RevealPrivateKeyPanel } from '../components/RevealPrivateKeyPanel';
import { ConnectedSitesPanel } from '../components/ConnectedSitesPanel';
import { TokenHoldingsPanel } from '../components/TokenHoldingsPanel';
import { TokenSendForm } from '../components/TokenSendForm';
import { BulkTransferPanel } from '../components/BulkTransferPanel';
import { ValidatorPanel } from '../components/ValidatorPanel';
import { useTokenHoldings } from '../components/useTokenHoldings';
import { SendConfirm } from '../components/SendConfirm';
import { resolveRecipient, reverseName } from '../boing/names';
import { NamesPanel } from '../components/NamesPanel';
import { PendingNameBanner } from '../components/PendingNameBanner';
import { AddressQrModal } from '../components/AddressQrModal';
import { ScanQrButton } from '../components/ScanQrButton';
import styles from './Dashboard.module.css';

type WalletTabId = 'wallet' | 'transactions' | 'transfer' | 'validate' | 'faucet' | 'settings';
type TransferMode = 'boing' | 'token' | 'nft' | 'bulk';

const WALLET_TABS: { id: Exclude<WalletTabId, 'settings'>; label: string; aria?: string }[] = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'transactions', label: 'Tx', aria: 'Transaction history' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'validate', label: 'Validate', aria: 'Validate and stake' },
  { id: 'faucet', label: 'Faucet' },
];


export function Dashboard() {
  const navigate = useNavigate();
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
    accountList,
    activeAccountIndex,
    switchVaultAccount,
  } = useWallet();

  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [chainHeight, setChainHeight] = useState<number | null>(null);
  const [sendTo, setSendTo] = useState('');
  /** Validated send waiting for the review/confirm step. */
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [sendReview, setSendReview] = useState<{ toHex: string; toName?: string; amount: bigint; amountText: string } | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');
  const [sending, setSending] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [faucetError, setFaucetError] = useState('');
  const [faucetResult, setFaucetResult] = useState<{ amount?: string; warning?: string } | null>(null);
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
  const [pendingUnbond, setPendingUnbond] = useState<string | null>(null);
  const [unbondUnlockHeight, setUnbondUnlockHeight] = useState<number | null>(null);
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [qaBytecode, setQaBytecode] = useState('');
  const [qaPurpose, setQaPurpose] = useState<string>('');
  const [qaDescriptionHash, setQaDescriptionHash] = useState('');
  const [qaResult, setQaResult] = useState<{ result: 'allow' | 'reject' | 'unsure'; ruleId?: string; message?: string; docUrl?: string } | null>(null);
  const [qaValidating, setQaValidating] = useState(false);
  const [qaUseRpc, setQaUseRpc] = useState(true);
  const [onboarding, setOnboarding] = useState(getOnboardingState);
  const [txHistory, setTxHistory] = useState<ReturnType<typeof getTxHistory>>([]);
  const [chainTx, setChainTx] = useState<DisplayTxEntry[]>([]);
  const [chainCursor, setChainCursor] = useState<string | null>(null);
  const [chainLoaded, setChainLoaded] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainUnsupported, setChainUnsupported] = useState(false);
  const [chainError, setChainError] = useState('');
  const [showRpcOverride, setShowRpcOverride] = useState(false);
  const [rpcOverrideInput, setRpcOverrideInput] = useState('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txHashCopied, setTxHashCopied] = useState(false);
  const [activeTab, setActiveTabRaw] = useState<WalletTabId>('wallet');
  const [lastMainTab, setLastMainTab] = useState<WalletTabId>('wallet');
  const [transferMode, setTransferMode] = useState<TransferMode>('boing');
  const [nftPreselect, setNftPreselect] = useState<string | null>(null);
  const tokens = useTokenHoldings(accountId, network);
  const setActiveTab = useCallback((t: WalletTabId) => {
    setActiveTabRaw(t);
    if (t !== 'settings') setLastMainTab(t);
  }, []);

  const showStakeTab = Boolean(network.buildBond || network.buildUnbond || network.buildClaimUnbond);
  const showFaucetTab = Boolean(network.config.isTestnet);
  const showValidatorTab = Boolean(network.config.isTestnet || network.buildBond);
  /** One tab for validating (open registration) and the secondary bond/unbond actions. */
  const showValidateTab = showStakeTab || showValidatorTab;

  const address = accountId ? formatAddress(accountId, false) : '';
  const addressHint = address ? `${address.slice(0, 8)}…${address.slice(-8)}` : '';
  useEffect(() => {
    if (!address) return;
    let live = true;
    setPrimaryName(null);
    void reverseName(network.config.rpcUrl, address)
      .then((r) => {
        if (live) setPrimaryName(r?.name ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address, network.config.rpcUrl]);

  const refreshData = useCallback(async () => {
    if (!accountId) return;
    setRefreshing(true);
    setBalanceError(null);
    setStakeError(null);
    try {
      const [bal, h, st, unbondStatus] = await Promise.all([
        network.getBalance(accountId).catch((e) => {
          setBalanceError(e instanceof Error ? e.message : String(e));
          return null;
        }),
        network.getChainHeight?.().catch(() => null) ?? Promise.resolve(null),
        network.getStake ? network.getStake(accountId).catch((e) => {
          setStakeError(e instanceof Error ? e.message : String(e));
          return null;
        }) : Promise.resolve(null),
        network.getUnbondStatus
          ? network.getUnbondStatus(accountId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (bal) setBalance(bal);
      if (h != null) setChainHeight(h);
      if (st != null) setStake(st);
      if (unbondStatus) {
        setPendingUnbond(unbondStatus.pendingUnbond);
        setUnbondUnlockHeight(unbondStatus.unlockHeight);
      } else {
        setPendingUnbond(null);
        setUnbondUnlockHeight(null);
      }
    } finally {
      setRefreshing(false);
    }
  }, [accountId, network]);

  /** Faucet / txs can commit before RPC balance reflects the new state — refresh now and again after short delays. */
  const scheduleBalanceCatchUp = useCallback(() => {
    void refreshData();
    window.setTimeout(() => {
      void refreshData();
    }, 2_000);
    window.setTimeout(() => {
      void refreshData();
    }, 5_000);
  }, [refreshData]);

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
    if (activeTab === 'validate' && !showValidateTab) setActiveTab('wallet');
    if (activeTab === 'faucet' && !showFaucetTab) setActiveTab('wallet');
  }, [activeTab, showValidateTab, showFaucetTab]);

  useEffect(() => {
    if (addressHint && accountId) {
      setTxHistory(getTxHistory(addressHint, network.config.id));
      setRpcOverrideInput(rpcOverrides[network.config.id] ?? '');
    }
  }, [addressHint, accountId, network.config.id, rpcOverrides]);

  const historyDecimals = balance?.decimals ?? 0;
  const loadChainHistory = useCallback(
    async (cursor: string | null) => {
      if (!accountId || !network.config.rpcUrl) return;
      setChainLoading(true);
      setChainError('');
      try {
        const page = await fetchChainTxPage(network.config.rpcUrl, accountIdToHex(accountId), cursor, 25);
        if (!page) {
          setChainUnsupported(true);
          setChainTx([]);
          setChainCursor(null);
          return;
        }
        setChainUnsupported(false);
        const rows = page.transactions.map((r) => chainRowToDisplay(r, historyDecimals));
        setChainTx((prev) => {
          if (!cursor) return rows;
          const seen = new Set(prev.map((e) => e.txHash));
          return [...prev, ...rows.filter((e) => !seen.has(e.txHash))];
        });
        setChainCursor(page.next_cursor);
        setChainLoaded(true);
      } catch (e) {
        setChainError(e instanceof Error ? e.message : String(e));
      } finally {
        setChainLoading(false);
      }
    },
    [accountId, network.config.rpcUrl, historyDecimals]
  );

  useEffect(() => {
    setChainTx([]);
    setChainCursor(null);
    setChainLoaded(false);
    setChainUnsupported(false);
  }, [accountId, network.config.id]);

  useEffect(() => {
    if (activeTab === 'transactions') void loadChainHistory(null);
  }, [activeTab, loadChainHistory]);

  function refreshTxHistory() {
    if (addressHint && accountId) {
      setTxHistory(getTxHistory(addressHint, network.config.id));
      // Pick up the new tx once it is committed.
      window.setTimeout(() => void loadChainHistory(null), 4_000);
    }
  }

  const mergedHistory = mergeTxHistory(txHistory, chainTx, { chainLoaded });

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
    let resolved: Awaited<ReturnType<typeof resolveRecipient>>;
    try {
      resolved = await resolveRecipient(network.config.rpcUrl, sendTo);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!resolved.ok) {
      setSendError(resolved.error);
      return;
    }
    const toHex = resolved.hex;
    if (accountId && toHex.toLowerCase() === accountIdToHex(accountId).toLowerCase()) {
      setSendError('Cannot send to yourself');
      return;
    }
    const decimals = balance?.decimals ?? 0;
    const amount = sendAmount.trim() ? parseDecimalAmount(sendAmount, decimals) : null;
    if (amount == null || amount <= 0n) {
      setSendError('Enter a valid whole BOING amount (e.g. 100)');
      return;
    }
    if (balance && BigInt(balance.value) < amount) {
      setSendError('Insufficient balance');
      return;
    }
    setSendReview({ toHex: toHex.toLowerCase(), toName: resolved.name, amount, amountText: `${sendAmount.trim()} ${balance?.symbol ?? 'BOING'}` });
  }

  async function doSend(toHex: string, amount: bigint, toName?: string) {
    setSendError('');
    const privateKey = getPrivateKey();
    if (!accountId || !privateKey) {
      setSendError('Wallet locked');
      return;
    }
    setSending(true);
    try {
      if (toName) {
        // Re-resolve at confirm time: refuse if the name now points somewhere else.
        const again = await resolveRecipient(network.config.rpcUrl, toName);
        if (!again.ok || again.hex !== toHex) {
          setSendError(`${toName}.boing changed since review. Go back and check the recipient.`);
          return;
        }
      }
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
          addTxHistory(addressHint, network.config.id, result.txHash, 'send', `${amount} BOING → ${toName ? `${toName}.boing` : `${toHex.slice(0, 6)}…${toHex.slice(-4)}`}`);
          refreshTxHistory();
          markSentTx();
          setOnboarding(getOnboardingState());
          setLastTxHash(result.txHash);
        }
        setSendSuccess(result.txHash ? `Sent! Tx: ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
        setSendAmount('');
        setSendTo('');
        setSendReview(null);
        scheduleBalanceCatchUp();
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
    setFaucetResult(null);
    try {
      const result = await network.faucetRequest(accountId);
      if (result.success) {
        setFaucetResult({ amount: result.amount, warning: result.warning });
        markGotTestnetBoing();
        setOnboarding(getOnboardingState());
        setFaucetStatus('ok');
        scheduleBalanceCatchUp();
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
      setBondError('Enter a valid whole BOING amount (e.g. 100)');
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
        scheduleBalanceCatchUp();
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
      setUnbondError('Enter a valid whole BOING amount (e.g. 100)');
      return;
    }
    const staked = stake ? parseU128String(stake) : 0n;
    if (staked == null) {
      setUnbondError('Could not read staked amount from network');
      return;
    }
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
        scheduleBalanceCatchUp();
      } else {
        setUnbondError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setUnbondError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnbonding(false);
    }
  }

  async function handleClaimUnbond(e: React.FormEvent) {
    e.preventDefault();
    if (!network.buildClaimUnbond || !accountId) return;
    setClaimError('');
    setClaimSuccess('');
    const pending = pendingUnbond ? parseU128String(pendingUnbond) : 0n;
    if (pending == null || pending <= 0n) {
      setClaimError('No pending unbond to claim');
      return;
    }
    if (
      chainHeight != null &&
      unbondUnlockHeight != null &&
      unbondUnlockHeight > 0 &&
      chainHeight < unbondUnlockHeight
    ) {
      setClaimError(
        `Unlocks at block ${unbondUnlockHeight} (current height ${chainHeight}). Wait ${unbondUnlockHeight - chainHeight} more block(s).`
      );
      return;
    }
    const privateKey = getPrivateKey();
    if (!privateKey) {
      setClaimError('Wallet locked');
      return;
    }
    setClaiming(true);
    try {
      const nonce = await network.getNonce(accountId);
      const signedHex = await network.buildClaimUnbond(accountId, nonce, privateKey);
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        if (result.txHash) {
          addTxHistory(addressHint, network.config.id, result.txHash, 'claim_unbond');
          refreshTxHistory();
          setLastTxHash(result.txHash);
        }
        setClaimSuccess(result.txHash ? `Claimed! Tx: ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
        scheduleBalanceCatchUp();
      } else {
        setClaimError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaiming(false);
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

  if (!accountId) {
    return (
      <div className={`${styles.wrap} page-app`}>
        <p className={styles.addressHint}>Loading wallet…</p>
      </div>
    );
  }

  const displayStake =
    stake != null
      ? formatBalance(stake, balance?.decimals ?? 0)
      : stakeError
        ? '—'
        : network.getStake
          ? '…'
          : null;

  const pendingRaw = pendingUnbond ? parseU128String(pendingUnbond) : 0n;
  const hasPendingUnbond = pendingRaw != null && pendingRaw > 0n;
  const displayPendingUnbond = hasPendingUnbond
    ? formatBalance(pendingUnbond!, balance?.decimals ?? 0)
    : null;
  const claimReady =
    hasPendingUnbond &&
    (unbondUnlockHeight == null ||
      unbondUnlockHeight <= 0 ||
      chainHeight == null ||
      chainHeight >= unbondUnlockHeight);

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
          {accountId && (
            <button
              type="button"
              className={`${styles.lockBtn} ${styles.gearBtn}`}
              onClick={() => setShowQr(true)}
              aria-label="Show address QR code"
              title="Show address QR code"
              data-testid="wallet-header-qr"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className={`${styles.lockBtn} ${styles.gearBtn} ${activeTab === 'settings' ? styles.gearBtnActive : ''}`}
            onClick={() => setActiveTab(activeTab === 'settings' ? lastMainTab : 'settings')}
            aria-label="Settings"
            aria-expanded={activeTab === 'settings'}
            aria-controls="panel-settings"
            title="Settings"
            data-testid="wallet-header-settings"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {accountId && (
            <button type="button" className={styles.lockBtn} onClick={copyAddress} aria-label="Copy address" title={address} data-testid="wallet-header-copy">
              {copied ? 'Copied' : 'Copy address'}
            </button>
          )}
          <button type="button" className={styles.lockBtn} onClick={lock} data-testid="wallet-header-lock">
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
        <nav className={styles.tabBar} role="tablist" aria-label="Wallet sections">
          {WALLET_TABS.map(({ id, label, aria }) => {
            if (id === 'validate' && !showValidateTab) return null;
            if (id === 'faucet' && !showFaucetTab) return null;
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={selected}
                aria-controls={`panel-${id}`}
                className={`${styles.tabBtn} ${selected ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab(id)}
                data-testid={`wallet-tab-${id}`}
                aria-label={aria}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className={styles.tabPanels}>
          <div
            id="panel-wallet"
            role="tabpanel"
            aria-labelledby="tab-wallet"
            hidden={activeTab !== 'wallet'}
            className={`${styles.tabPanel} ${activeTab === 'wallet' ? styles.tabPanelActive : ''}`}
          >
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
                <button
                  type="button"
                  className={styles.onboardingDismiss}
                  data-testid="wallet-onboarding-dismiss"
                  onClick={() => {
                    dismissOnboarding();
                    setOnboarding(getOnboardingState());
                  }}
                >
                  Dismiss
                </button>
              </section>
            )}

            {accountId && (
              <PendingNameBanner
                accountId={accountId}
                network={network}
                getPrivateKey={getPrivateKey}
                balance={balance ? BigInt(balance.value) : null}
                onDone={(n) => {
                  setPrimaryName(n);
                  scheduleBalanceCatchUp();
                }}
              />
            )}
            {showQr && address && <AddressQrModal address={address} onClose={() => setShowQr(false)} />}
            <div className={styles.assetsComposition} data-testid="assets-composition">
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Address</h2>

          {accountList.length > 1 && (
            <div className={styles.accountSwitchRow}>
              <label htmlFor="web-account-select" className={styles.accountSwitchLabel}>
                Active account
              </label>
              <select
                id="web-account-select"
                className={styles.accountSwitchSelect}
                value={activeAccountIndex}
                onChange={(e) => switchVaultAccount(Number(e.target.value))}
                aria-label="Switch wallet account"
                data-testid="wallet-account-switch"
              >
                {accountList.map((a) => (
                  <option key={a.index} value={a.index}>
                    {a.addressHex.slice(0, 8)}…{a.addressHex.slice(-6)}
                  </option>
                ))}
              </select>
              <p className={styles.accountSwitchHint}>Switching locks the wallet — unlock again with your password.</p>
            </div>
          )}
          {primaryName && (
            <p className={styles.primaryName} data-testid="wallet-primary-name">
              {primaryName}.boing
            </p>
          )}
          <div className={styles.addressRow}>
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
            Use this address to receive BOING, tokens and NFTs. On testnet, use the Faucet tab to request funds. Send from the Transfer tab.
          </p>
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
        </section>

              {accountId && (
                <TokenHoldingsPanel
                  native={{
                    display: displayBalance,
                    symbol: balance?.symbol ?? 'BOING',
                    chainHeight,
                    error: balanceError,
                    refreshing,
                    onRefresh: refreshData,
                  }}
                  accountId={accountId}
                  networkId={network.config.id}
                  holdings={tokens.holdings}
                  loading={tokens.loading}
                  error={tokens.error}
                  onChanged={() => void tokens.refresh()}
                />
              )}
              <div className={styles.assetsCollectibles}>
                {accountId && activeTab === 'wallet' && (
                  <NftHoldingsPanel
                    accountId={accountId}
                    network={network}
                    rpcUrl={network.config.rpcUrl}
                    getPrivateKey={getPrivateKey}
                    addressHint={addressHint}
                    onTxRecorded={refreshTxHistory}
                    mode="view"
                    onTransferItem={(key) => {
                      setNftPreselect(key);
                      setTransferMode('nft');
                      setActiveTab('transfer');
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div
            id="panel-transactions"
            role="tabpanel"
            aria-labelledby="tab-transactions"
            hidden={activeTab !== 'transactions'}
            className={`${styles.tabPanel} ${activeTab === 'transactions' ? styles.tabPanelActive : ''}`}
          >
            <section className={styles.section}>
              <div className={styles.balanceHeader}>
                <h2 className={styles.sectionTitle}>Transaction history</h2>
                {explorerBase && (
                  <a href={accountExplorerUrl} target="_blank" rel="noopener noreferrer" className={styles.explorerLink}>
                    Full history on explorer
                  </a>
                )}
              </div>
              <p className={styles.addressHint}>
                {chainUnsupported
                  ? 'This node does not serve account history yet; showing transactions sent from this browser.'
                  : 'All transactions for this account on chain (sent, received, dApp-signed, faucet), plus pending ones from this device.'}
              </p>
              <div className={styles.balanceHeader}>
                <button
                  type="button"
                  className={styles.explorerLink}
                  onClick={() => void loadChainHistory(null)}
                  disabled={chainLoading}
                  data-testid="tx-history-refresh"
                >
                  {chainLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {chainError && (
                <p className={styles.addressHint} role="alert" data-testid="tx-history-error">
                  Could not load on-chain history: {chainError}
                </p>
              )}
              {mergedHistory.length === 0 ? (
                <p className={styles.addressHint} data-testid="tx-history-empty">
                  {chainLoading && !chainLoaded ? 'Loading transactions…' : 'No transactions yet.'}
                </p>
              ) : (
                <ul className={styles.txHistoryList} data-testid="tx-history-list">
                  {mergedHistory.map((entry) => {
                    const hash = entry.txHash;
                    const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
                    const meta = [
                      entry.status === 'pending' ? 'Pending' : entry.status === 'failed' ? 'Failed' : null,
                      entry.blockHeight != null ? `Block ${entry.blockHeight}` : null,
                      when,
                    ].filter(Boolean).join(' · ');
                    return (
                      <li
                        key={hash}
                        className={styles.txHistoryItem}
                        data-testid="tx-history-row"
                        data-status={entry.status}
                        data-source={entry.source}
                        title={entry.error ?? undefined}
                      >
                        <span className={styles.txType}>{entry.label}</span>
                        <span className={styles.txSummary}>
                          {entry.summary}
                          <br />
                          <small className={styles.addressHint}>{meta}</small>
                          {entry.steps && entry.steps.length > 0 && (
                            <details className={styles.subDetails} data-testid="tx-history-steps">
                              <summary className={styles.addressHint}>{entry.steps.length} steps</summary>
                              <ol className={styles.bulkList}>
                                {entry.steps.map((s, i) => (
                                  <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>
                                ))}
                              </ol>
                            </details>
                          )}
                        </span>
                        {explorerBase ? (
                          <a className={styles.txHash} href={`${explorerBase}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
                            {hash.slice(0, 12)}…
                          </a>
                        ) : (
                          <code className={styles.txHash}>{hash.slice(0, 12)}…</code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {chainCursor && (
                <button
                  type="button"
                  className={styles.explorerLink}
                  onClick={() => void loadChainHistory(chainCursor)}
                  disabled={chainLoading}
                  data-testid="tx-history-more"
                >
                  {chainLoading ? 'Loading…' : 'Load older transactions'}
                </button>
              )}
            </section>
          </div>

          <div
            id="panel-transfer"
            role="tabpanel"
            aria-labelledby="tab-transfer"
            hidden={activeTab !== 'transfer'}
            className={`${styles.tabPanel} ${activeTab === 'transfer' ? styles.tabPanelActive : ''}`}
          >
            <div className={styles.segmented} role="tablist" aria-label="Asset to transfer">
              {(['boing', 'token', 'nft', 'bulk'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={transferMode === m}
                  className={`${styles.segmentedBtn} ${transferMode === m ? styles.segmentedBtnActive : ''}`}
                  onClick={() => setTransferMode(m)}
                  data-testid={`transfer-mode-${m}`}
                >
                  {m === 'boing' ? 'BOING' : m === 'token' ? 'Token' : m === 'nft' ? 'NFT' : 'Bulk'}
                </button>
              ))}
            </div>
            {transferMode === 'boing' && (
              <section className={styles.section} data-testid="transfer-pane-boing">
                {sendReview && accountId ? (
                  <SendConfirm
                    title={`Send ${balance?.symbol ?? 'BOING'}`}
                    to={sendReview.toHex}
                    toName={sendReview.toName}
                    amount={sendReview.amountText}
                    network={network}
                    buildSigned={async () => {
                      const pk = getPrivateKey();
                      if (!pk) throw new Error('Wallet locked');
                      return network.buildTransfer(accountId, accountIdFromHex(sendReview.toHex), sendReview.amount, await network.getNonce(accountId), pk);
                    }}
                    busy={sending}
                    error={sendError}
                    onBack={() => {
                      setSendReview(null);
                      setSendError('');
                    }}
                    onConfirm={() => void doSend(sendReview.toHex, sendReview.amount, sendReview.toName)}
                  />
                ) : (
                <>
                <h2 className={styles.sectionTitle}>Send BOING</h2>
                {isMainnet && sendAmount.trim() && (
                  <div className={styles.mainnetWarning} role="alert">
                    You are on Mainnet. Real BOING is at risk. Double-check the amount and recipient.
                  </div>
                )}
                <form onSubmit={handleSend} className={styles.form}>
                  <div className={styles.sendAmountRow}>
                    <input
                      type="text"
                      placeholder="To address or name.boing"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      className={styles.input}
                      aria-label="Recipient address"
                      data-testid="send-to"
                    />
                    <ScanQrButton className={styles.maxBtn} testId="send-to-scan" onResult={(a) => setSendTo(a)} />
                  </div>
                  <div className={styles.sendAmountRow}>
                    <input
                      type="text"
                      placeholder="Amount in BOING (whole units, e.g. 100)"
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                      className={styles.input}
                      inputMode="decimal"
                      aria-label="Amount to send"
                      data-testid="send-amount"
                    />
                    <button
                      type="button"
                      className={styles.maxBtn}
                      onClick={() => setSendAmount(displayBalance !== '…' && displayBalance !== '—' ? displayBalance : '')}
                    >
                      Max
                    </button>
                  </div>
                  {sendError && <p className={styles.error} data-testid="send-error">{sendError}</p>}
                  {sendSuccess && (
                    <p className={styles.success} data-testid="send-success">
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
                  <button type="submit" className={styles.primary} disabled={sending} data-testid="send-submit">
                    {sending ? 'Sending…' : 'Review send'}
                  </button>
                </form>
                </>
                )}
              </section>

            )}
            {transferMode === 'token' && accountId && (
              <TokenSendForm
                accountId={accountId}
                network={network}
                getPrivateKey={getPrivateKey}
                holdings={tokens.holdings}
                onSent={(hash, summary) => {
                  if (hash) addTxHistory(addressHint, network.config.id, hash, 'token_send', summary);
                  refreshTxHistory();
                  window.setTimeout(() => void tokens.refresh(), 2000);
                }}
              />
            )}
            {transferMode === 'nft' && accountId && activeTab === 'transfer' && (
              <NftHoldingsPanel
                key={nftPreselect ?? 'none'}
                accountId={accountId}
                network={network}
                rpcUrl={network.config.rpcUrl}
                getPrivateKey={getPrivateKey}
                addressHint={addressHint}
                onTxRecorded={refreshTxHistory}
                mode="transfer"
                initialSelectedKey={nftPreselect}
              />
            )}
            {transferMode === 'bulk' && accountId && (
              <BulkTransferPanel
                accountId={accountId}
                network={network}
                getPrivateKey={getPrivateKey}
                balance={balance}
                holdings={tokens.holdings}
                onRowSent={(hash, kind, summary) => {
                  if (hash) addTxHistory(addressHint, network.config.id, hash, kind, summary);
                }}
                onBatchSent={(hash, summary, steps) => {
                  if (hash) addTxHistory(addressHint, network.config.id, hash, 'batch', summary, steps);
                }}
                onFinished={() => {
                  refreshTxHistory();
                  scheduleBalanceCatchUp();
                  window.setTimeout(() => void tokens.refresh(), 2000);
                }}
              />
            )}
          </div>

          {showValidateTab && (
            <div
              id="panel-validate"
              role="tabpanel"
              aria-labelledby="tab-validate"
              hidden={activeTab !== 'validate'}
              className={`${styles.tabPanel} ${activeTab === 'validate' ? styles.tabPanelActive : ''}`}
            >
              {showValidatorTab && accountId && activeTab === 'validate' && (
                <ValidatorPanel
                  network={network}
                  accountId={accountId}
                  getPrivateKey={getPrivateKey}
                  onSubmitted={(hash, type) => {
                    addTxHistory(addressHint, network.config.id, hash, type);
                    refreshTxHistory();
                    setLastTxHash(hash);
                    scheduleBalanceCatchUp();
                  }}
                />
              )}
              {showStakeTab && (
          <section className={styles.section} data-testid="stake-secondary">
            <h2 className={styles.sectionTitle}>Bond stake (optional)</h2>
            {displayStake != null && (
              <p className={styles.balance}>
                {displayStake} <span className={styles.symbol}>BOING</span> <span className={styles.stakeLabel}>staked</span>
              </p>
            )}
            {displayPendingUnbond != null && (
              <p className={styles.balance}>
                {displayPendingUnbond} <span className={styles.symbol}>BOING</span>{' '}
                <span className={styles.stakeLabel}>
                  pending unbond
                  {unbondUnlockHeight != null && unbondUnlockHeight > 0
                    ? claimReady
                      ? ' · ready to claim'
                      : ` · unlocks at block ${unbondUnlockHeight}${
                          chainHeight != null ? ` (now ${chainHeight})` : ''
                        }`
                    : ''}
                </span>
              </p>
            )}
            <p className={styles.faucetHint} data-testid="stake-min-hint">
              Not needed to validate today: registering a validator above locks its own 100 BOING bond. Bonding is
              separate stake (any amount). A future stake-based validator mode would require at least 10,000 BOING
              bonded; it is not active on this network.
            </p>
            {network.buildBond && (
              <form onSubmit={handleBond} className={`${styles.form} ${styles.stakeForm}`}>
                <input
                  type="text"
                  placeholder="Amount (BOING)"
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
              <form onSubmit={handleUnbond} className={`${styles.form} ${styles.stakeForm}`}>
                <input
                  type="text"
                  placeholder="Amount (BOING)"
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
            {network.buildClaimUnbond && hasPendingUnbond && !showValidatorTab && (
              <form onSubmit={handleClaimUnbond} className={styles.form}>
                <p className={styles.faucetHint}>
                  Claim matured pending unbond into your spendable balance
                  {unbondUnlockHeight != null && unbondUnlockHeight > 0 && !claimReady
                    ? ` after block ${unbondUnlockHeight}`
                    : ''}
                  .
                </p>
                {claimError && <p className={styles.error}>{claimError}</p>}
                {claimSuccess && (
                  <p className={styles.success} role="status">
                    {claimSuccess}
                  </p>
                )}
                <button type="submit" className={styles.primary} disabled={claiming || !claimReady}>
                  {claiming ? 'Claiming…' : claimReady ? 'Claim unbond' : 'Waiting for unlock'}
                </button>
              </form>
            )}
            <p className={styles.stakingHint}>
              Unbond queues stake for ~100 blocks; claim it from the validator section above once it unlocks.
            </p>
          </section>
              )}
            </div>
          )}

          {showFaucetTab && (
            <div
              id="panel-faucet"
              role="tabpanel"
              aria-labelledby="tab-faucet"
              hidden={activeTab !== 'faucet'}
              className={`${styles.tabPanel} ${activeTab === 'faucet' ? styles.tabPanelActive : ''}`}
            >
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Testnet faucet</h2>
                <p className={styles.faucetHint}>
                  Get testnet BOING for development and testing (one request per 60 seconds). Same faucet as boing.network/faucet, which also has wallet onboarding.
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
                {faucetStatus === 'ok' && faucetResult && (
                  <p className={styles.success} data-testid="faucet-success">
                    {faucetResult.amount ? `${faucetResult.amount} testnet BOING requested.` : 'Testnet BOING requested.'} It arrives with the
                    next block (a few seconds); your balance updates automatically.
                    {accountExplorerUrl && (
                      <>
                        {' '}
                        <a href={accountExplorerUrl} target="_blank" rel="noopener noreferrer">View on Boing Observer</a>.
                      </>
                    )}{' '}
                    Next: send your first transfer from the Transfer tab (about 1 BOING fee).
                    {faucetResult.warning && <><br />Note: {faucetResult.warning}</>}
                  </p>
                )}
                {faucetError && <p className={styles.error}>{faucetError}</p>}
              </section>
            </div>
          )}
          <div
            id="panel-settings"
            role="region"
            aria-label="Settings"
            hidden={activeTab !== 'settings'}
            className={`${styles.tabPanel} ${activeTab === 'settings' ? styles.tabPanelActive : ''}`}
            data-testid="settings-panel"
          >
            <div className={styles.settingsHeader}>
              <button type="button" className={styles.copyBtn} onClick={() => setActiveTab(lastMainTab)} data-testid="settings-back">
                ← Back
              </button>
              <h2 className={styles.assetsTitle}>Settings</h2>
            </div>
            <section className={styles.section} data-testid="settings-accounts">
              <h2 className={styles.sectionTitle}>Accounts</h2>
              <button
                type="button"
                className={styles.addAccountBtn}
                onClick={() => navigate('/wallet/add-account')}
                data-testid="wallet-dashboard-add-account"
              >
                Add account
              </button>
              <p className={styles.addAccountHint}>Create or import another key in the same vault. Your password stays the same.</p>
            </section>
            {activeTab === 'settings' && accountId && (
              <NamesPanel
                accountId={accountId}
                network={network}
                getPrivateKey={getPrivateKey}
                balance={balance ? BigInt(balance.value) : null}
                onTx={(hash, summary) => {
                  if (hash) addTxHistory(addressHint, network.config.id, hash, 'send', summary);
                  refreshTxHistory();
                  scheduleBalanceCatchUp();
                  void reverseName(network.config.rpcUrl, address).then((r) => setPrimaryName(r?.name ?? null)).catch(() => {});
                }}
              />
            )}
            {activeTab === 'settings' && <ConnectedSitesPanel />}
            {activeTab === 'settings' && <RevealPrivateKeyPanel />}
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
          </div>

        </div>
      </main>
    </div>
  );
}
