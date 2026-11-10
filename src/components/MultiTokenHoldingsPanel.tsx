/**
 * Reference multi-token ("game items") holdings for the unlocked Express account:
 * item type + quantity per watched (contract, item id), recent-block discovery, manual add,
 * and a reviewed `transfer` (0x21) send per item.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex } from '../boing/types';
import { describeWalletError } from '../boing/errorMessages';
import {
  encodeMultiTokenTransferCalldata,
  mtHex32,
  parseMultiTokenAmount,
  parseMultiTokenItemId,
} from '../boing/referenceMultiToken';
import {
  discoverAndPersistMultiTokens,
  groupMultiTokenHoldings,
  isReferenceMultiTokenContract,
  probeMultiTokenWatchlist,
  type MultiTokenHolding,
} from '../boing/multiTokenHoldings';
import { shortHexLabel } from '../boing/referenceNft';
import { resolveRecipient } from '../boing/names';
import {
  addMultiTokenWatchEntries,
  listMultiTokenWatchlist,
  removeMultiTokenWatchEntry,
} from '../storage/multiTokenWatchlist';
import { addTxHistory } from '../storage/txHistory';
import type { NetworkAdapter } from '../networks/types';
import { SendConfirm } from './SendConfirm';
import styles from '../screens/Dashboard.module.css';

export interface MultiTokenHoldingsPanelProps {
  accountId: AccountId;
  network: NetworkAdapter;
  rpcUrl: string;
  getPrivateKey: () => Uint8Array | null;
  addressHint: string;
  onTxRecorded?: () => void;
}

const keyOf = (h: { contractHex: string; itemId: bigint }) => `${h.contractHex}:${h.itemId}`;

/** Observer item-type page (metadata hash, supply, your balance). */
export function observerMultiTokenItemUrl(
  explorerBase: string,
  contractHex: string,
  itemId: bigint,
  networkIsTestnet: boolean
): string {
  const base = explorerBase.replace(/\/$/, '');
  return `${base}/items/${mtHex32(contractHex)}/${itemId}?network=${networkIsTestnet ? 'testnet' : 'mainnet'}`;
}

export function MultiTokenHoldingsPanel({
  accountId,
  network,
  rpcUrl,
  getPrivateKey,
  addressHint,
  onTxRecorded,
}: MultiTokenHoldingsPanelProps) {
  const ownerHex = accountIdToHex(accountId).replace(/^0x/i, '').toLowerCase();
  const explorerBase = network.config.explorerUrl?.replace(/\/$/, '') ?? 'https://boing.observer';
  const isTestnet = Boolean(network.config.isTestnet);
  const [holdings, setHoldings] = useState<MultiTokenHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [addContract, setAddContract] = useState('');
  const [addItem, setAddItem] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [sendKey, setSendKey] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendQty, setSendQty] = useState('');
  const [recipient, setRecipient] = useState<{ hex: string; name?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await discoverAndPersistMultiTokens(rpcUrl, ownerHex, network.config.id);
      const entries = await listMultiTokenWatchlist(ownerHex, network.config.id);
      setHoldings(entries.length ? await probeMultiTokenWatchlist(rpcUrl, ownerHex, entries) : []);
    } catch (e) {
      setError(describeWalletError(e));
    } finally {
      setLoading(false);
    }
  }, [network.config.id, ownerHex, rpcUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendItem = sendKey ? holdings.find((h) => keyOf(h) === sendKey) ?? null : null;

  function resetSend() {
    setSendKey(null);
    setSendTo('');
    setSendQty('');
    setRecipient(null);
    setConfirming(false);
    setSendError('');
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    try {
      const contractHex = mtHex32(addContract);
      const itemId = parseMultiTokenItemId(addItem);
      if (!(await isReferenceMultiTokenContract(rpcUrl, contractHex))) {
        throw new Error('That contract is not a Boing reference multi-token (item) contract');
      }
      await addMultiTokenWatchEntries(ownerHex, network.config.id, [
        { contractHex, itemId, label: addLabel || undefined },
      ]);
      setAddContract('');
      setAddItem('');
      setAddLabel('');
      await refresh();
    } catch (err) {
      setAddError(describeWalletError(err));
    }
  }

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setSendError('');
    setSendSuccess('');
    if (!sendItem) return;
    try {
      const qty = parseMultiTokenAmount(sendQty);
      if (qty > sendItem.balance) throw new Error(`You hold ${sendItem.balance} of this item`);
      const r = await resolveRecipient(network.config.rpcUrl, sendTo);
      if (!r.ok) throw new Error(r.error);
      if (r.hex.replace(/^0x/i, '').toLowerCase() === ownerHex) throw new Error('Cannot send items to yourself');
      setRecipient(r);
      setConfirming(true);
    } catch (err) {
      setSendError(describeWalletError(err));
    }
  }

  async function buildSigned(): Promise<string> {
    const pk = getPrivateKey();
    if (!pk || !sendItem || !recipient || !network.buildContractCall) throw new Error('Wallet locked');
    const calldata = encodeMultiTokenTransferCalldata(recipient.hex, sendItem.itemId, parseMultiTokenAmount(sendQty));
    return network.buildContractCall(
      accountId,
      accountIdFromHex(sendItem.contractHex),
      calldata,
      await network.getNonce(accountId),
      pk
    );
  }

  async function confirmSend() {
    if (!sendItem || !recipient) return;
    setSending(true);
    setSendError('');
    try {
      if (recipient.name) {
        const again = await resolveRecipient(network.config.rpcUrl, recipient.name);
        if (!again.ok || again.hex !== recipient.hex) {
          throw new Error(`${recipient.name}.boing changed since review. Go back and check the recipient.`);
        }
      }
      const signed = await buildSigned();
      const result = await network.submitTransaction(signed);
      if (!result.success) throw new Error(result.error ?? 'Submit failed');
      const label = sendItem.label ?? `item #${sendItem.itemId}`;
      const summary = `${sendQty.trim()} × ${label} → ${shortHexLabel(recipient.hex, 6, 4)}`;
      if (result.txHash) addTxHistory(addressHint, network.config.id, result.txHash, 'contract_call', summary);
      onTxRecorded?.();
      setSendSuccess(result.txHash ? `Sent. Tx: ${result.txHash.slice(0, 16)}…` : 'Sent');
      resetSend();
      window.setTimeout(() => void refresh(), 2_500);
      window.setTimeout(() => void refresh(), 6_000);
    } catch (err) {
      setSendError(describeWalletError(err));
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  const visible = showEmpty ? holdings : holdings.filter((h) => h.balance > 0n);
  const groups = groupMultiTokenHoldings(visible);
  const hiddenEmpty = holdings.length - holdings.filter((h) => h.balance > 0n).length;

  return (
    <>
      <section className={styles.section} data-testid="mt-holdings">
        <div className={styles.balanceHeader}>
          <h2 className={styles.sectionTitle}>Items</h2>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh game items"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {sendSuccess && <p className={styles.success}>{sendSuccess}</p>}
        {visible.length === 0 && !loading && (
          <p className={styles.addressHint} data-testid="mt-empty">
            No game items yet
          </p>
        )}
        {groups.map(({ contractHex, items }) => (
          <div key={contractHex} className={styles.nftCollectionBlock}>
            <div className={styles.nftCollectionHeader}>
              <span className={styles.nftCollectionLabel}>Item collection</span>
              <span className={styles.nftCollectionCount}>{shortHexLabel(contractHex, 6, 4)}</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((h) => {
                const k = keyOf(h);
                const title = h.label ?? `Item #${h.itemId}`;
                return (
                  <li key={k} data-testid="mt-item" style={{ padding: '0.4rem 0', opacity: h.balance > 0n ? 1 : 0.55 }}>
                    <div className={styles.inlineRow} style={{ justifyContent: 'space-between', gap: '0.5rem' }}>
                      <a
                        href={observerMultiTokenItemUrl(explorerBase, h.contractHex, h.itemId, isTestnet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.nftTitleLink}
                        title={`Item #${h.itemId} · supply ${h.totalSupply}`}
                      >
                        {title}
                      </a>
                      <strong data-testid="mt-item-qty">× {h.balance.toString()}</strong>
                    </div>
                    <div className={styles.addressHint}>
                      Item #{h.itemId.toString()} · supply {h.totalSupply.toString()}
                      {h.error ? ` · ${h.error}` : ''}
                    </div>
                    <div className={styles.inlineRow} style={{ gap: '0.5rem' }}>
                      {h.balance > 0n && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => {
                            resetSend();
                            setSendSuccess('');
                            setSendKey(k);
                          }}
                          data-testid="mt-item-send"
                        >
                          Send
                        </button>
                      )}
                      {h.balance === 0n && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() =>
                            void removeMultiTokenWatchEntry(ownerHex, network.config.id, h.contractHex, h.itemId.toString()).then(
                              () => refresh()
                            )
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {sendKey === k && !confirming && (
                      <form onSubmit={(ev) => void review(ev)} className={styles.form}>
                        <input
                          type="text"
                          placeholder="To address or name.boing"
                          value={sendTo}
                          onChange={(e) => setSendTo(e.target.value)}
                          className={styles.input}
                          aria-label="Item recipient"
                          data-testid="mt-send-to"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={`Quantity (max ${h.balance})`}
                          value={sendQty}
                          onChange={(e) => setSendQty(e.target.value)}
                          className={styles.input}
                          aria-label="Item quantity"
                          data-testid="mt-send-qty"
                        />
                        {sendError && <p className={styles.error}>{sendError}</p>}
                        <div className={styles.inlineRow} style={{ gap: '0.5rem' }}>
                          <button type="submit" className={styles.primary}>
                            Review
                          </button>
                          <button type="button" className={styles.copyBtn} onClick={resetSend}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                    {sendKey === k && confirming && recipient && (
                      <SendConfirm
                        title="Send items"
                        to={recipient.hex}
                        toName={recipient.name}
                        amount={`${sendQty.trim()} × ${title}`}
                        network={network}
                        buildSigned={() => buildSigned()}
                        showPriorityTip={false}
                        busy={sending}
                        error={sendError}
                        onBack={() => setConfirming(false)}
                        onConfirm={() => void confirmSend()}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {hiddenEmpty > 0 && (
          <button type="button" className={styles.copyBtn} onClick={() => setShowEmpty((v) => !v)}>
            {showEmpty ? 'Hide empty items' : `Show ${hiddenEmpty} empty item${hiddenEmpty === 1 ? '' : 's'}`}
          </button>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add item</h2>
        <form onSubmit={(ev) => void handleAdd(ev)} className={styles.form}>
          <input
            type="text"
            placeholder="Item contract (64 hex)"
            value={addContract}
            onChange={(e) => setAddContract(e.target.value)}
            className={styles.input}
            aria-label="Item contract account id"
            data-testid="mt-add-contract"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="Item id (e.g. 1)"
            value={addItem}
            onChange={(e) => setAddItem(e.target.value)}
            className={styles.input}
            aria-label="Item id"
            data-testid="mt-add-item"
          />
          <input
            type="text"
            placeholder="Label (optional, e.g. Iron ore)"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            className={styles.input}
            aria-label="Item label"
          />
          {addError && <p className={styles.error}>{addError}</p>}
          <button type="submit" className={styles.primary}>
            Add
          </button>
        </form>
      </section>
    </>
  );
}
