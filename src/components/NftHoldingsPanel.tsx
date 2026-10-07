/**
 * Reference NFT holdings for the unlocked Express account.
 * Watchlist + XOR owner storage probes; metadata gallery; observer deep links;
 * multi-select transfer as N× transfer_nft (no on-chain batch).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex, formatAddress } from '../boing/types';
import {
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
  type NftDiscoveryResult,
} from '../boing/nftDiscovery';
import {
  hydrateNftDisplayMetaList,
  type NftDisplayMeta,
} from '../boing/nftMetadata';
import { transferOwnedNfts } from '../boing/nftTransfer';
import { fetchOwnerIndexHoldings, formatOwnerIndexNote, type OwnerIndexResult } from '../boing/nftOwnerIndex';
import {
  findFreshmintCollectionLink,
  freshmintCollectionsIndexUrl,
  resolveFreshmintMarketplaceBaseUrl,
  type FreshmintCollectionLink,
} from '../boing/freshmintMarketplace';
import {
  addNftWatchEntries,
  listNftWatchlist,
  removeNftWatchEntry,
} from '../storage/nftWatchlist';
import { addTxHistory } from '../storage/txHistory';
import type { NetworkAdapter } from '../networks/types';
import styles from '../screens/Dashboard.module.css';

/** Cap how many distinct collections get a best-effort FreshMint lookup per refresh. */
const FRESHMINT_LOOKUP_MAX_COLLECTIONS = 10;

export interface NftHoldingsPanelProps {
  accountId: AccountId;
  network: NetworkAdapter;
  rpcUrl: string;
  getPrivateKey: () => Uint8Array | null;
  addressHint: string;
  onTxRecorded?: () => void;
}

function holdingKey(item: { collectionHex: string; tokenIdHex: string }): string {
  return `${item.collectionHex}:${item.tokenIdHex}`;
}

function formatDiscoveryNote(discovery: NftDiscoveryResult): string {
  if (discovery.error && discovery.blocksScanned === 0 && discovery.discovered.length === 0) {
    return `Scan issue: ${discovery.error}`;
  }
  const range =
    discovery.toHeight >= discovery.fromHeight
      ? `blocks ${discovery.fromHeight}–${discovery.toHeight}`
      : 'no new blocks';
  const expected = Math.max(0, discovery.toHeight - discovery.fromHeight + 1);
  const parts = [
    `Scanned ${discovery.blocksScanned}/${expected} (${range}; window ≤${NFT_DISCOVERY_SCAN_WINDOW})`,
  ];
  if (discovery.blocksFailed > 0) {
    const sample = discovery.failedHeights.slice(0, 3).join(', ');
    parts.push(
      `${discovery.blocksFailed} unavailable after retry${sample ? ` (e.g. ${sample})` : ''} — tracked as a gap, not dropped`
    );
  }
  if (discovery.gapRetriesAttempted > 0) {
    parts.push(
      `retried ${discovery.gapRetriesAttempted} previously-missing block(s)` +
        (discovery.recoveredGapCount > 0 ? `, recovered ${discovery.recoveredGapCount}` : '')
    );
  }
  if (discovery.openGapCount > 0) {
    const sample = discovery.openGapHeights.slice(0, 3).join(', ');
    parts.push(
      `${discovery.openGapCount} block(s) still missing${sample ? ` (e.g. ${sample})` : ''} — retried each refresh`
    );
  }
  if (discovery.lastSuccessfulHeight != null) {
    parts.push(`confirmed clean through height ${discovery.lastSuccessfulHeight}`);
  }
  if (discovery.skippedOlderRange) {
    parts.push(
      `catch-up capped: skipped below ${discovery.fromHeight} (cursor was ${discovery.previousCursor ?? '—'})`
    );
  }
  if (discovery.persistedCount > 0) {
    parts.push(`found ${discovery.persistedCount} new item(s)`);
  }
  if (discovery.truncated) parts.push('hit scan cap');
  if (discovery.error) parts.push(`partial error: ${discovery.error}`);
  return parts.join(' · ');
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
  const [metaByKey, setMetaByKey] = useState<Map<string, NftDisplayMeta>>(new Map());
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);
  const [ownerIndexNote, setOwnerIndexNote] = useState<string | null>(null);
  const [freshmintLinkByCollection, setFreshmintLinkByCollection] = useState<
    Map<string, FreshmintCollectionLink>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [addCollection, setAddCollection] = useState('');
  const [addTokenId, setAddTokenId] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState<string | null>(null);

  const explorerBase = network.config.explorerUrl?.replace(/\/$/, '') ?? 'https://boing.observer';
  const isTestnet = Boolean(network.config.isTestnet);
  const ownerHex = accountIdToHex(accountId);
  const freshmintBaseUrl = resolveFreshmintMarketplaceBaseUrl();

  const refresh = useCallback(async () => {
    setLoading(true);
    setDiscovering(true);
    setError(null);
    setDiscoveryNote(null);
    setOwnerIndexNote(null);
    try {
      // Durable NFT-by-owner index first (observer proxy to the owner-indexer Worker) —
      // covers holdings older than the bounded scan window below. Graceful no-op when
      // the indexer is unconfigured, unreachable, or still empty for this account.
      let ownerIndex: OwnerIndexResult | null = null;
      try {
        ownerIndex = await fetchOwnerIndexHoldings(explorerBase, ownerHex, isTestnet);
      } catch (e) {
        ownerIndex = {
          available: false,
          items: [],
          indexer: null,
          reason: e instanceof Error ? e.message : String(e),
          pagesFetched: 0,
          truncated: false,
        };
      }
      if (ownerIndex.available && ownerIndex.items.length > 0) {
        await addNftWatchEntries(
          ownerHex,
          network.config.id,
          ownerIndex.items.map((it) => ({ collectionHex: it.collectionHex, tokenIdHex: it.tokenIdHex }))
        );
      }
      setOwnerIndexNote(formatOwnerIndexNote(ownerIndex));

      const discovery = await discoverAndPersistOwnedNfts(
        rpcUrl,
        ownerHex,
        network.config.id
      );
      setDiscoveryNote(formatDiscoveryNote(discovery));

      const entries = await listNftWatchlist(ownerHex, network.config.id);
      if (entries.length === 0) {
        setStatuses([]);
        setMetaByKey(new Map());
        setSelectedKeys(new Set());
        return;
      }
      const probed = await probeNftWatchlist(rpcUrl, accountId, entries);
      setStatuses(probed);
      setSelectedKeys((prev) => {
        const ownedKeys = new Set(
          probed.filter((p) => p.owned).map((p) => holdingKey(p))
        );
        return new Set([...prev].filter((k) => ownedKeys.has(k)));
      });

      const meta = await hydrateNftDisplayMetaList(probed, {
        rpcUrl,
        explorerBase,
        networkIsTestnet: isTestnet,
      });
      setMetaByKey(meta);

      if (freshmintBaseUrl) {
        const collections = [...new Set(probed.map((p) => p.collectionHex))].slice(
          0,
          FRESHMINT_LOOKUP_MAX_COLLECTIONS
        );
        void Promise.all(
          collections.map(async (collectionHex) => {
            const link = await findFreshmintCollectionLink(freshmintBaseUrl, collectionHex);
            setFreshmintLinkByCollection((prev) => {
              const next = new Map(prev);
              next.set(collectionHex, link);
              return next;
            });
          })
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
      setLoading(false);
    }
  }, [accountId, explorerBase, freshmintBaseUrl, isTestnet, network.config.id, ownerHex, rpcUrl]);

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
    const key = holdingKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    await refresh();
  }

  function toggleSelected(item: NftHoldingStatus) {
    if (!item.owned) return;
    const key = holdingKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmBatch(false);
    setTransferError('');
    setTransferSuccess('');
  }

  const owned = filterOwnedHoldings(statuses);
  const groups = groupHoldingsByCollection(statuses);
  const watchedNotOwned = statuses.filter((s) => s.exists && !s.owned && !s.error);
  const missing = statuses.filter((s) => !s.exists && !s.error);
  const selectedCount = selectedKeys.size;

  function selectAllOwned() {
    setSelectedKeys(new Set(owned.map((o) => holdingKey(o))));
    setConfirmBatch(false);
  }

  function clearSelection() {
    setSelectedKeys(new Set());
    setConfirmBatch(false);
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError('');
    setTransferSuccess('');
    setTransferProgress(null);

    const targets = statuses.filter((s) => s.owned && selectedKeys.has(holdingKey(s)));
    if (targets.length === 0) {
      setTransferError('Select one or more owned NFTs to transfer');
      return;
    }
    if (!confirmBatch) {
      setConfirmBatch(true);
      return;
    }

    const privateKey = getPrivateKey();
    if (!privateKey) {
      setTransferError('Wallet locked');
      return;
    }

    setTransferring(true);
    try {
      const result = await transferOwnedNfts({
        network,
        accountId,
        privateKey,
        recipientHex: transferTo,
        targets: targets.map((t) => ({
          collectionHex: t.collectionHex,
          tokenIdHex: t.tokenIdHex,
        })),
        onProgress: (done, total, last) => {
          setTransferProgress(
            `${done}/${total}: ${last.success ? 'ok' : last.error ?? 'failed'} · ${shortHexLabel(last.tokenIdHex, 6, 4)}`
          );
        },
      });
      for (const r of result.results) {
        if (r.success && r.txHash) {
          addTxHistory(addressHint, network.config.id, r.txHash, 'send');
        }
      }
      if (result.submitted > 0) onTxRecorded?.();

      if (result.failed === 0) {
        setTransferSuccess(
          result.txCount === 1
            ? result.results[0]?.txHash
              ? `Transfer submitted. Tx: ${result.results[0].txHash.slice(0, 16)}…`
              : 'Transfer submitted'
            : `All ${result.submitted} transfers submitted (${result.txCount} separate transfer_nft txs).`
        );
        setTransferTo('');
        setSelectedKeys(new Set());
        setConfirmBatch(false);
      } else {
        setTransferError(
          `${result.submitted} submitted, ${result.failed} failed. Protocol sends one transfer_nft per item.`
        );
        setConfirmBatch(false);
      }
      window.setTimeout(() => {
        void refresh();
      }, 2_000);
      window.setTimeout(() => {
        void refresh();
      }, 5_000);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : String(err));
      setConfirmBatch(false);
    } finally {
      setTransferring(false);
      setTransferProgress(null);
    }
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.balanceHeader}>
          <h2 className={styles.sectionTitle}>Collectibles</h2>
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
          Checks the durable NFT-by-owner index (when the operator has one deployed) for holdings
          beyond the recent-block window, then scans recent blocks for{' '}
          <code className={styles.inlineCode}>mint_batch</code> /{' '}
          <code className={styles.inlineCode}>transfer_nft</code> to this account (window ≤
          {NFT_DISCOVERY_SCAN_WINDOW} blocks). Blocks that fail to fetch (pruned RPC) are retried
          every refresh and tracked as an open gap instead of being silently skipped. Grouped by
          collection; media from on-chain metadata (observer profiles for full detail).
        </p>
        {ownerIndexNote && <p className={styles.addressHint}>{ownerIndexNote}</p>}
        {discoveryNote && <p className={styles.addressHint}>{discoveryNote}</p>}
        {error && <p className={styles.error}>{error}</p>}
        {statuses.length === 0 && !loading && (
          <p className={styles.addressHint}>
            No NFTs found in the recent scan window. Add a collection and token id below for older
            holdings.
          </p>
        )}
        {owned.length > 0 && (
          <div className={styles.nftSelectBar}>
            <button type="button" className={styles.copyBtn} onClick={selectAllOwned}>
              Select all owned ({owned.length})
            </button>
            {selectedCount > 0 && (
              <button type="button" className={styles.copyBtn} onClick={clearSelection}>
                Clear ({selectedCount})
              </button>
            )}
          </div>
        )}
        {groups.map(({ collectionHex, items }) => (
          <div key={collectionHex} className={styles.nftCollectionBlock}>
            <div className={styles.nftCollectionHeader}>
              <span className={styles.nftCollectionLabel}>Collection</span>
              <code className={styles.nftMono}>{shortHexLabel(collectionHex, 8, 6)}</code>
              <span className={styles.nftCollectionCount}>{items.length}</span>
              <a
                href={observerNftCollectionUrl(explorerBase, collectionHex, isTestnet)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
              >
                Open collection
              </a>
              {freshmintBaseUrl && (
                <a
                  href={
                    freshmintLinkByCollection.get(collectionHex)?.url ??
                    freshmintCollectionsIndexUrl(freshmintBaseUrl)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.explorerLink}
                  title={
                    freshmintLinkByCollection.get(collectionHex)?.matched
                      ? 'Open this collection on FreshMint'
                      : 'Browse FreshMint collections (no confirmed match yet)'
                  }
                >
                  FreshMint ↗
                </a>
              )}
            </div>
            <ul className={styles.nftItemList}>
              {items.map((item) => {
                const key = holdingKey(item);
                const itemUrl = observerNftItemUrl(
                  explorerBase,
                  item.collectionHex,
                  item.tokenIdHex,
                  isTestnet
                );
                const meta = metaByKey.get(key);
                const statusLabel = item.error
                  ? 'Error'
                  : item.owned
                    ? 'Owned'
                    : item.exists
                      ? 'Not yours'
                      : 'Not found';
                const title =
                  meta?.name?.trim() ||
                  item.label ||
                  shortHexLabel(item.tokenIdHex, 10, 8);
                return (
                  <li key={key} className={styles.nftItem}>
                    <div className={styles.nftGalleryRow}>
                      {item.owned ? (
                        <label className={styles.nftCheck}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleSelected(item)}
                            aria-label={`Select ${title}`}
                            data-testid="nft-select"
                          />
                        </label>
                      ) : (
                        <span className={styles.nftCheckSpacer} aria-hidden />
                      )}
                      <a
                        href={itemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.nftThumbLink}
                        title="Open on observer"
                      >
                        {meta?.imageUrl ? (
                          <img
                            src={meta.imageUrl}
                            alt=""
                            className={styles.nftThumb}
                            loading="lazy"
                            onError={(ev) => {
                              (ev.currentTarget as HTMLImageElement).style.display = 'none';
                              const ph = ev.currentTarget.nextElementSibling;
                              if (ph instanceof HTMLElement) ph.hidden = false;
                            }}
                          />
                        ) : null}
                        <span
                          className={styles.nftThumbPlaceholder}
                          hidden={Boolean(meta?.imageUrl)}
                          aria-hidden
                        >
                          NFT
                        </span>
                      </a>
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
                        <a
                          href={itemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.nftTitleLink}
                        >
                          {title}
                        </a>
                        {meta?.description ? (
                          <p className={styles.nftDescription}>{meta.description}</p>
                        ) : meta?.unresolved && !meta?.imageUrl ? (
                          <p className={styles.nftDescriptionMuted}>No metadata URI</p>
                        ) : null}
                        <code className={styles.nftMono} title={item.tokenIdHex}>
                          {shortHexLabel(item.tokenIdHex, 10, 8)}
                        </code>
                      </div>
                    </div>
                    <div className={styles.nftItemActions}>
                      <a
                        href={itemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.explorerLink}
                      >
                        Item profile
                      </a>
                      {item.owned && (
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => {
                            setSelectedKeys(new Set([key]));
                            setConfirmBatch(false);
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
        {statuses.length > 0 && (
          <p className={styles.addressHint}>
            {owned.length} owned · {watchedNotOwned.length} watched (other owner) · {missing.length}{' '}
            not on-chain
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add NFT</h2>
        <p className={styles.faucetHint}>
          Paste the collection AccountId and token id word from the mint receipt or observer item URL
          (<code className={styles.inlineCode}>/asset/…/item/…</code>).
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
          Sends reference <code className={styles.inlineCode}>transfer_nft</code> (
          <code className={styles.inlineCode}>0x04</code>) per item — the protocol has no batch
          transfer selector, so multiple selections become multiple transactions.
        </p>
        {selectedCount > 0 ? (
          <p className={styles.addressHint}>
            Selected {selectedCount} owned item{selectedCount === 1 ? '' : 's'}
            {selectedCount > 1 ? ` → ${selectedCount} txs` : ''}.
          </p>
        ) : (
          <p className={styles.addressHint}>
            Select owned items above (checkboxes) or use Transfer on a single row.
          </p>
        )}
        <form onSubmit={(ev) => void handleTransfer(ev)} className={styles.form}>
          <input
            type="text"
            placeholder="To address (64 hex or 0x…)"
            value={transferTo}
            onChange={(e) => {
              setTransferTo(e.target.value);
              setConfirmBatch(false);
            }}
            className={styles.input}
            aria-label="NFT transfer recipient"
            data-testid="nft-transfer-to"
          />
          {confirmBatch && selectedCount > 0 && (
            <p className={styles.nftConfirmNote} role="status">
              Confirm: send {selectedCount} separate <code className={styles.inlineCode}>transfer_nft</code>{' '}
              transaction{selectedCount === 1 ? '' : 's'} to the recipient above.
            </p>
          )}
          {transferProgress && <p className={styles.addressHint}>{transferProgress}</p>}
          {transferError && <p className={styles.error}>{transferError}</p>}
          {transferSuccess && <p className={styles.success}>{transferSuccess}</p>}
          <button
            type="submit"
            className={styles.primary}
            disabled={transferring || selectedCount === 0}
            data-testid="nft-transfer-submit"
          >
            {transferring
              ? 'Transferring…'
              : confirmBatch
                ? selectedCount > 1
                  ? `Confirm ${selectedCount} transfers`
                  : 'Confirm transfer'
                : selectedCount > 1
                  ? `Transfer ${selectedCount} NFTs`
                  : 'Transfer NFT'}
          </button>
        </form>
        <p className={styles.addressHint}>
          Receive: share your address ({formatAddress(accountId, false).slice(0, 8)}…) — mints and
          transfers to you appear after scan or manual add (extension{' '}
          <code className={styles.inlineCode}>mint_batch</code> also auto-watches when you are the
          recipient).
        </p>
      </section>
    </>
  );
}
