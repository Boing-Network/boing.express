import { useEffect, useState } from 'react';
import { useWallet, NETWORKS } from '../context/WalletContext';
import { formatAddress, accountIdFromHex, accountIdToHex } from '../boing/types';
import { parseDecimalAmount } from '../boing/amount';
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

  function openFaucetPage() {
    const hex = address;
    const url = network.config.faucetUrl
      ? `${network.config.faucetUrl}?address=${encodeURIComponent(hex)}`
      : `https://boing.network/network/faucet?address=${encodeURIComponent(hex)}`;
    window.open(url, '_blank');
  }

  if (!accountId) return null;

  const displayBalance =
    balance != null
      ? (Number(balance.value) / 10 ** balance.decimals).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })
      : balanceError
        ? '—'
        : '…';

  return (
    <div className={styles.wrap}>
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
