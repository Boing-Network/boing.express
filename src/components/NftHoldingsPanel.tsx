/**
 * Reference NFT holdings for the unlocked Express account.
 * Watchlist + XOR owner storage probes; deep-links to boing.observer item profiles.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdFromHex, accountIdToHex, formatAddress } from '../boing/types';
import {
  encodeReferenceTransferNftCalldata,
  normalizeHex64,
  observerNftCollectionUrl,
  observerNftItemUrl,
  parseTokenIdInput,
  shortHexLabel,
} from '../boing/referenceNft';
import {
  filterOwnedHoldings,
  groupHoldingsByCollection,
  probeNftWatchlist,
  type NftHoldingStatus,
} from '../boing/nftHoldings';
import {
  discoverAndPersistOwnedNfts,
  NFT_DISCOVERY_SCAN_WINDOW,
} from '../boing/nftDiscovery';
import {
  addNftWatchEntries,
  listNftWatchlist,
  removeNftWatchEntry,
} from '../storage/nftWatchlist';
import { addTxHistory } from '../storage/txHistory';
import type { NetworkAdapter } from '../networks/types';
import styles from '../screens/Dashboard.module.css';

export interface NftHoldingsPanelProps {
  accountId: AccountId;
  network: NetworkAdapter;
  rpcUrl: string;
  getPrivateKey: () => Uint8Array | null;
  addressHint: string;
  onTxRecorded?: () => void;
}

export function NftHoldingsPanel({
  accountId,
  network,
  rpcUrl,
  getPrivateKey,
  addressHint,
  onTxRecorded,
}: NftHoldingsPanelProps) {
  const [statuses, setStatuses] = useState<NftHoldingStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addCollection, setAddCollection] = useState('');
  const [addTokenId, setAddTokenId] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferTarget, setTransferTarget] = useState<NftHoldingStatus | null>(null);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');
  const [transferring, setTransferring] = useState(false);

  const explorerBase = network.config.explorerUrl?.replace(/\/$/, '') ?? 'https://boing.observer';
  const isTestnet = Boolean(network.config.isTestnet);
  const ownerHex = accountIdToHex(accountId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDiscovering(true);
    setError(null);
    setDiscoveryNote(null);
    try {
      const discovery = await discoverAndPersistOwnedNfts(
        rpcUrl,
        ownerHex,
        network.config.id
      );
      if (discovery.error) {
        setDiscoveryNote(`Scan skipped: ${discovery.error}`);
      } else {
        const range =
          discovery.toHeight >= discovery.fromHeight
            ? `blocks ${discovery.fromHeight}–${discovery.toHeight}`
            : 'no new blocks';
        const parts = [
          `Scanned ${discovery.blocksScanned} blocks (${range}; window ≤${NFT_DISCOVERY_SCAN_WINDOW})`,
        ];
        if (discovery.persistedCount > 0) {
          parts.push(`found ${discovery.persistedCount} new item(s)`);
        }
        if (discovery.truncated) parts.push('hit scan cap');
        setDiscoveryNote(parts.join(' · '));
      }

      const entries = await listNftWatchlist(ownerHex, network.config.id);
      if (entries.length === 0) {
        setStatuses([]);
        return;
      }
      const probed = await probeNftWatchlist(rpcUrl, accountId, entries);
      setStatuses(probed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
      setLoading(false);
    }
  }, [accountId, network.config.id, ownerHex, rpcUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    try {
      const collectionHex = normalizeHex64(addCollection);
      const tokenIdHex = parseTokenIdInput(addTokenId);
      await addNftWatchEntries(ownerHex, network.config.id, [{ collectionHex, tokenIdHex }]);
      setAddCollection('');
      setAddTokenId('');
      setAddSuccess('Added to watchlist — verifying ownership…');
      await refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(item: NftHoldingStatus) {
    await removeNftWatchEntry(ownerHex, network.config.id, item.collectionHex, item.tokenIdHex);
    if (transferTarget?.tokenIdHex === item.tokenIdHex && transferTarget.collectionHex === item.collectionHex) {
      setTransferTarget(null);
    }
    await refresh();
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError('');
    setTransferSuccess('');
    if (!transferTarget) {
      setTransferError('Select an NFT you own to transfer');
      return;
    }
    if (!network.buildContractCall) {
      setTransferError('This network adapter cannot send contract calls');
      return;
    }
    const toHex = transferTo.replace(/\s/g, '').replace(/^0x/i, '');
    if (toHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(toHex)) {
      setTransferError('Invalid address: must be 64 hex characters');
      return;
    }
    if (toHex.toLowerCase() === ownerHex.toLowerCase()) {
      setTransferError('Cannot transfer to yourself');
      return;
    }
    if (!transferTarget.owned) {
      setTransferError('You do not own this NFT (owner storage mismatch)');
      return;
    }
    const privateKey = getPrivateKey();
    if (!privateKey) {
      setTransferError('Wallet locked');
      return;
    }
    setTransferring(true);
    try {
      const toId = accountIdFromHex(toHex);
      const collectionId = accountIdFromHex(transferTarget.collectionHex);
      const calldata = encodeReferenceTransferNftCalldata(toId, transferTarget.tokenIdHex);
      const nonce = await network.getNonce(accountId);
      const signedHex = await network.buildContractCall(
        accountId,
        collectionId,
        calldata,
        nonce,
        privateKey
      );
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        if (result.txHash) {
          addTxHistory(addressHint, network.config.id, result.txHash, 'send');
          onTxRecorded?.();
        }
        setTransferSuccess(
          result.txHash
            ? `Transfer submitted. Tx: ${result.txHash.slice(0, 16)}…`
            : 'Transfer submitted'
        );
        setTransferTo('');
        setTransferTarget(null);
        window.setTimeout(() => {
          void refresh();
        }, 2_000);
        window.setTimeout(() => {
          void refresh();
        }, 5_000);
      } else {
        setTransferError(result.error ?? 'Submit failed');
      }
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : String(err));
    } finally {
      setTransferring(false);
    }
  }

  const owned = filterOwnedHoldings(statuses);
  const groups = groupHoldingsByCollection(statuses);
  const watchedNotOwned = statuses.filter((s) => s.exists && !s.owned && !s.error);
  const missing = statuses.filter((s) => !s.exists && !s.error);

  return (
    <>
      <section className={styles.section}>
        <div className={styles.balanceHeader}>
          <h2 className={styles.sectionTitle}>NFTs</h2>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void refresh()}
            disabled={loading || discovering}
            aria-label="Refresh NFT holdings"
          >
            {loading || discovering ? '…' : '↻'}
          </button>
        </div>
        <p className={styles.faucetHint}>
          Auto-discovers reference NFTs by scanning recent blocks for{' '}
          <code className={styles.inlineCode}>mint_batch</code> /{' '}
          <code className={styles.inlineCode}>transfer_nft</code> to this account (window ≤
          {NFT_DISCOVERY_SCAN_WINDOW} blocks — not a full-history indexer). Findings are saved to your local
          watchlist; ownership is checked via XOR owner storage. You can still add older items manually. Profiles
          on{' '}
          <a href={explorerBase} target="_blank" rel="noopener noreferrer" className={styles.explorerLink}>
            boing.observer
          </a>
          .
        </p>
        {discoveryNote && <p className={styles.addressHint}>{discoveryNote}</p>}
        {error && <p className={styles.error}>{error}</p>}
        {statuses.length === 0 && !loading && (
          <p className={styles.addressHint}>
            No NFTs found in the recent scan window. Add a collection and token id below for older holdings.
          </p>
        )}
        {groups.map(({ collectionHex, items }) => (
          <div key={collectionHex} className={styles.nftCollectionBlock}>
            <div className={styles.nftCollectionHeader}>
              <span className={styles.nftCollectionLabel}>Collection</span>
              <code className={styles.nftMono}>{shortHexLabel(collectionHex, 8, 6)}</code>
              <a
                href={observerNftCollectionUrl(explorerBase, collectionHex, isTestnet)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
              >
                View collection
              </a>
            </div>
            <ul className={styles.nftItemList}>
              {items.map((item) => {
                const itemUrl = observerNftItemUrl(
                  explorerBase,
                  item.collectionHex,
                  item.tokenIdHex,
                  isTestnet
                );
                const statusLabel = item.error
                  ? 'Error'
                  : item.owned
                    ? 'Owned'
                    : item.exists
                      ? 'Not yours'
                      : 'Not found';
                return (
                  <li key={`${item.collectionHex}:${item.tokenIdHex}`} className={styles.nftItem}>
                    <div className={styles.nftItemMain}>
                      <span
                        className={
                          item.owned
                            ? styles.nftBadgeOwned
                            : item.exists
                              ? styles.nftBadgeOther
                              : styles.nftBadgeMissing
                        }
                      >
                        {statusLabel}
                      </span>
                      <code className={styles.nftMono} title={item.tokenIdHex}>
                        {item.label || shortHexLabel(item.tokenIdHex, 10, 8)}
                      </code>
                    </div>
                    <div className={styles.nftItemActions}>
                      <a
                        href={itemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.explorerLink}
                      >
                        Details
                      </a>
                      {item.owned && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => {
                            setTransferTarget(item);
                            setTransferError('');
                            setTransferSuccess('');
                          }}
                        >
                          Transfer
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={() => void handleRemove(item)}
                      >
                        Remove
                      </button>
                    </div>
                    {item.error && <p className={styles.error}>{item.error}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {owned.length > 0 && (
          <p className={styles.addressHint}>
            {owned.length} owned · {watchedNotOwned.length} watched (other owner) · {missing.length} not on-chain
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add NFT</h2>
        <p className={styles.faucetHint}>
          Paste the collection AccountId and token id word from the mint receipt or observer item URL (
          <code className={styles.inlineCode}>/asset/…/item/…</code>).
        </p>
        <form onSubmit={(ev) => void handleAdd(ev)} className={styles.form}>
          <input
            type="text"
            placeholder="Collection (64 hex or 0x…)"
            value={addCollection}
            onChange={(e) => setAddCollection(e.target.value)}
            className={styles.input}
            aria-label="NFT collection account id"
            data-testid="nft-add-collection"
          />
          <input
            type="text"
            placeholder="Token id (64 hex word or sequential 1, 2, …)"
            value={addTokenId}
            onChange={(e) => setAddTokenId(e.target.value)}
            className={styles.input}
            aria-label="NFT token id"
            data-testid="nft-add-token-id"
          />
          {addError && <p className={styles.error}>{addError}</p>}
          {addSuccess && <p className={styles.success}>{addSuccess}</p>}
          <button type="submit" className={styles.primary}>
            Add to watchlist
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Transfer NFT</h2>
        <p className={styles.faucetHint}>
          Sends reference <code className={styles.inlineCode}>transfer_nft</code> (<code className={styles.inlineCode}>0x04</code>) to
          the collection contract. Only items verified as owned by this account can be transferred.
        </p>
        {transferTarget ? (
          <p className={styles.addressHint}>
            Selected: <code className={styles.nftMono}>{shortHexLabel(transferTarget.tokenIdHex, 10, 8)}</code> in{' '}
            <code className={styles.nftMono}>{shortHexLabel(transferTarget.collectionHex, 8, 6)}</code>
          </p>
        ) : (
          <p className={styles.addressHint}>Select Transfer on an owned item above.</p>
        )}
        <form onSubmit={(ev) => void handleTransfer(ev)} className={styles.form}>
          <input
            type="text"
            placeholder="To address (64 hex or 0x…)"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className={styles.input}
            aria-label="NFT transfer recipient"
            data-testid="nft-transfer-to"
          />
          {transferError && <p className={styles.error}>{transferError}</p>}
          {transferSuccess && <p className={styles.success}>{transferSuccess}</p>}
          <button
            type="submit"
            className={styles.primary}
            disabled={transferring || !transferTarget}
            data-testid="nft-transfer-submit"
          >
            {transferring ? 'Transferring…' : 'Transfer NFT'}
          </button>
        </form>
        <p className={styles.addressHint}>
          Receive: share your address ({formatAddress(accountId, false).slice(0, 8)}…) — mints and transfers to you
          appear after you add the collection + token id (or after extension <code className={styles.inlineCode}>mint_batch</code>{' '}
          when you are the recipient).
        </p>
      </section>
    </>
  );
}
