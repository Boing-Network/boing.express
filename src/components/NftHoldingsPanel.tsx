/**
 * Reference NFT holdings for the unlocked Express account.
 * Watchlist + XOR owner storage probes; image gallery with in-extension detail modal
 * (transfer / explorer / local remove); Transfer-tab multi-select as N× transfer_nft.
 */

import { describeWalletError } from '../boing/errorMessages';
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
import { discoverAndPersistOwnedNfts } from '../boing/nftDiscovery';
import {
  hydrateNftDisplayMetaList,
  type NftDisplayMeta,
} from '../boing/nftMetadata';
import { parseTransferRecipientHex, transferOwnedNfts } from '../boing/nftTransfer';
import { accountIdFromHex } from '../boing/types';
import { encodeReferenceTransferNftCalldata } from '../boing/referenceNft';
import { SendConfirm } from './SendConfirm';
import { resolveRecipient } from '../boing/names';
import { ScanQrButton } from './ScanQrButton';
import { NftDetailModal } from './NftDetailModal';
import { fetchOwnerIndexHoldings, type OwnerIndexResult } from '../boing/nftOwnerIndex';
import {
  findFreshmintCollectionLink,
  freshmintCollectionsIndexUrl,
  resolveFreshmintMarketplaceBaseUrl,
  type FreshmintCollectionLink,
} from '../boing/freshmintMarketplace';
import {
  companionsByCollection,
  listLinkedNftTokenLinks,
  observerCompanionAccountUrl,
} from '../boing/linkedNftTokenRegistry';
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
  /**
   * `view` (Wallet tab): image-only tiles; click opens an in-extension detail modal (transfer / explorer / remove).
   * `transfer` (Transfer tab): owned items only, with selection and the batch transfer form.
   */
  mode?: 'view' | 'transfer';
  /** Pre-select one item (`collectionHex:tokenIdHex`) in transfer mode. */
  initialSelectedKey?: string | null;
}

function holdingKey(item: { collectionHex: string; tokenIdHex: string }): string {
  return `${item.collectionHex}:${item.tokenIdHex}`;
}

export function NftHoldingsPanel({
  accountId,
  network,
  rpcUrl,
  getPrivateKey,
  addressHint,
  onTxRecorded,
  mode = 'view',
  initialSelectedKey,
}: NftHoldingsPanelProps) {
  const transferMode = mode === 'transfer';
  const [statuses, setStatuses] = useState<NftHoldingStatus[]>([]);
  const [metaByKey, setMetaByKey] = useState<Map<string, NftDisplayMeta>>(new Map());
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [freshmintLinkByCollection, setFreshmintLinkByCollection] = useState<
    Map<string, FreshmintCollectionLink>
  >(new Map());
  /** Collection → linked fungible token ids from on-chain registry (display only). */
  const [companionsByColl, setCompanionsByColl] = useState<Map<string, string[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [addCollection, setAddCollection] = useState('');
  const [addTokenId, setAddTokenId] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [nftRecipient, setNftRecipient] = useState<{ hex: string; name?: string } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(transferMode && initialSelectedKey ? [initialSelectedKey] : [])
  );
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState<string | null>(null);
  /** Wallet-tab detail sheet (`collectionHex:tokenIdHex`). */
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const explorerBase = network.config.explorerUrl?.replace(/\/$/, '') ?? 'https://boing.observer';
  const isTestnet = Boolean(network.config.isTestnet);
  const ownerHex = accountIdToHex(accountId);
  const freshmintBaseUrl = resolveFreshmintMarketplaceBaseUrl();

  const refresh = useCallback(async () => {
    setLoading(true);
    setDiscovering(true);
    setError(null);
    try {
      // Durable NFT-by-owner index first, then bounded recent-block scan (quiet UI — no status prose).
      let ownerIndex: OwnerIndexResult | null = null;
      try {
        ownerIndex = await fetchOwnerIndexHoldings(explorerBase, ownerHex, isTestnet);
      } catch (e) {
        ownerIndex = {
          available: false,
          items: [],
          indexer: null,
          reason: describeWalletError(e),
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

      await discoverAndPersistOwnedNfts(rpcUrl, ownerHex, network.config.id);

      // Linked NFT↔token peers (read-only; omit UI chrome when none / on failure).
      try {
        const listed = await listLinkedNftTokenLinks(rpcUrl, { networkIsTestnet: isTestnet });
        setCompanionsByColl(
          listed.ok ? companionsByCollection(listed.links) : new Map()
        );
      } catch {
        setCompanionsByColl(new Map());
      }

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
      setError(describeWalletError(e));
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
      setAddError(describeWalletError(err));
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
    if (detailKey === key) setDetailKey(null);
    await refresh();
  }

  function openDetail(item: NftHoldingStatus) {
    const key = holdingKey(item);
    setDetailKey(key);
    setConfirmBatch(false);
    setTransferError('');
    setTransferSuccess('');
    setTransferProgress(null);
    setNftRecipient(null);
    if (item.owned) setSelectedKeys(new Set([key]));
  }

  function closeDetail() {
    setDetailKey(null);
    setConfirmBatch(false);
    setTransferError('');
    setTransferSuccess('');
    setTransferProgress(null);
    setNftRecipient(null);
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
  const groups = groupHoldingsByCollection(transferMode ? owned : statuses);
  const selectedCount = selectedKeys.size;
  const detailItem = detailKey
    ? statuses.find((s) => holdingKey(s) === detailKey) ?? null
    : null;
  const detailMeta = detailItem ? metaByKey.get(holdingKey(detailItem)) : undefined;
  const detailTitle =
    detailMeta?.name?.trim() || detailItem?.label || 'NFT';
  const detailItemUrl = detailItem
    ? observerNftItemUrl(
        explorerBase,
        detailItem.collectionHex,
        detailItem.tokenIdHex,
        isTestnet
      )
    : '';

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

    const targets =
      detailKey && !transferMode
        ? statuses.filter((s) => s.owned && holdingKey(s) === detailKey)
        : statuses.filter((s) => s.owned && selectedKeys.has(holdingKey(s)));
    if (targets.length === 0) {
      setTransferError(
        detailKey && !transferMode
          ? 'This NFT is not owned by this wallet'
          : 'Select one or more owned NFTs to transfer'
      );
      return;
    }
    if (!confirmBatch) {
      try {
        const r = await resolveRecipient(network.config.rpcUrl, transferTo);
        if (!r.ok) throw new Error(r.error);
        parseTransferRecipientHex(r.hex, accountIdToHex(accountId));
        setNftRecipient(r);
      } catch (err) {
        setTransferError(describeWalletError(err));
        return;
      }
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
      let recipientHex = nftRecipient?.hex ?? transferTo;
      if (nftRecipient?.name) {
        const again = await resolveRecipient(network.config.rpcUrl, nftRecipient.name);
        if (!again.ok || again.hex !== nftRecipient.hex) {
          throw new Error(`${nftRecipient.name}.boing changed since review. Go back and check the recipient.`);
        }
        recipientHex = again.hex;
      }
      const result = await transferOwnedNfts({
        network,
        accountId,
        privateKey,
        recipientHex,
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
        if (detailKey) {
          window.setTimeout(() => closeDetail(), 1_200);
        }
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
      setTransferError(describeWalletError(err));
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
          <h2 className={styles.sectionTitle}>{transferMode ? 'Owned NFTs' : 'NFTs'}</h2>
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
        {error && <p className={styles.error}>{error}</p>}
        {statuses.length === 0 && !loading && (
          <p className={styles.addressHint} data-testid="nft-empty-owned">
            No NFTs yet
          </p>
        )}
        {transferMode && owned.length > 0 && (
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
        {groups.map(({ collectionHex, items }) => {
          const companions = companionsByColl.get(collectionHex) ?? [];
          const collectionUrl = observerNftCollectionUrl(explorerBase, collectionHex, isTestnet);
          return (
          <div key={collectionHex} className={styles.nftCollectionBlock}>
            <div className={styles.nftCollectionHeader}>
              <a
                href={collectionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.nftTitleLink}
              >
                Collection
              </a>
              <span className={styles.nftCollectionCount}>{items.length}</span>
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
                      : 'Browse FreshMint collections'
                  }
                >
                  FreshMint ↗
                </a>
              )}
            </div>
            {companions.length > 0 && (
              <div
                className={styles.nftCompanions}
                data-testid="nft-companions"
                aria-label="Linked coins"
              >
                <ul className={styles.nftCompanionsList}>
                  {companions.map((tokenHex) => (
                    <li key={tokenHex} className={styles.nftCompanionItem}>
                      <a
                        href={observerCompanionAccountUrl(explorerBase, tokenHex, isTestnet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.nftTitleLink}
                      >
                        Linked coin
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className={transferMode ? styles.nftItemList : styles.nftTileGrid}>
              {items.map((item) => {
                const key = holdingKey(item);
                const meta = metaByKey.get(key);
                const title =
                  meta?.name?.trim() ||
                  item.label ||
                  'NFT';
                const thumb = (
                  <>
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
                    />
                  </>
                );

                if (!transferMode) {
                  return (
                    <li key={key} className={styles.nftTile}>
                      <button
                        type="button"
                        className={styles.nftTileBtn}
                        onClick={() => openDetail(item)}
                        aria-label={title}
                        data-testid="nft-tile"
                      >
                        <span className={styles.nftThumbLink}>{thumb}</span>
                      </button>
                    </li>
                  );
                }

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
                      <button
                        type="button"
                        className={styles.nftThumbLink}
                        onClick={() => {
                          if (item.owned) toggleSelected(item);
                        }}
                        disabled={!item.owned}
                        aria-label={title}
                        data-testid="nft-tile"
                      >
                        {thumb}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </section>

      {!transferMode && (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add NFT</h2>
        <form onSubmit={(ev) => void handleAdd(ev)} className={styles.form}>
          <input
            type="text"
            placeholder="Collection (64 hex)"
            value={addCollection}
            onChange={(e) => setAddCollection(e.target.value)}
            className={styles.input}
            aria-label="NFT collection account id"
            data-testid="nft-add-collection"
          />
          <input
            type="text"
            placeholder="Token id"
            value={addTokenId}
            onChange={(e) => setAddTokenId(e.target.value)}
            className={styles.input}
            aria-label="NFT token id"
            data-testid="nft-add-token-id"
          />
          {addError && <p className={styles.error}>{addError}</p>}
          {addSuccess && <p className={styles.success}>{addSuccess}</p>}
          <button type="submit" className={styles.primary}>
            Add
          </button>
        </form>
      </section>
      )}

      {transferMode && (
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
            Select owned items above (checkboxes).
          </p>
        )}
        {confirmBatch && selectedCount > 0 && (() => {
          const targets = statuses.filter((s) => s.owned && selectedKeys.has(holdingKey(s)));
          const first = targets[0];
          return (
            <SendConfirm
              title={selectedCount > 1 ? `Send ${selectedCount} NFTs` : 'Send NFT'}
              to={nftRecipient?.hex ?? transferTo.replace(/\s/g, '')}
              toName={nftRecipient?.name}
              amount={targets.map((t) => `#${shortHexLabel(t.tokenIdHex, 4, 4)}`).join(', ')}
              network={network}
              txCount={selectedCount}
              buildSigned={async () => {
                const pk = getPrivateKey();
                if (!pk || !first || !network.buildContractCall) throw new Error('Wallet locked');
                const toHex = parseTransferRecipientHex(nftRecipient?.hex ?? transferTo, accountIdToHex(accountId));
                const calldata = encodeReferenceTransferNftCalldata(accountIdFromHex(toHex), normalizeHex64(first.tokenIdHex));
                return network.buildContractCall(accountId, accountIdFromHex(normalizeHex64(first.collectionHex)), calldata, await network.getNonce(accountId), pk);
              }}
              showPriorityTip={false}
              busy={transferring}
              error={transferError}
              onBack={() => setConfirmBatch(false)}
              onConfirm={() => void handleTransfer({ preventDefault() {} } as React.FormEvent)}
            />
          );
        })()}
        <form onSubmit={(ev) => void handleTransfer(ev)} className={styles.form} hidden={confirmBatch && selectedCount > 0}>
          <div className={styles.inlineRow}>
            <input
              type="text"
              placeholder="To address or name.boing"
              value={transferTo}
              onChange={(e) => {
                setTransferTo(e.target.value);
                setConfirmBatch(false);
              }}
              className={styles.input}
              aria-label="NFT transfer recipient"
              data-testid="nft-transfer-to"
            />
            <ScanQrButton className={styles.copyBtn} testId="nft-transfer-to-scan" onResult={(a) => setTransferTo(a)} />
          </div>
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
      )}

      {!transferMode && detailItem ? (
        <NftDetailModal
          item={detailItem}
          meta={detailMeta}
          itemUrl={detailItemUrl}
          title={detailTitle}
          onClose={closeDetail}
          onRemove={() => void handleRemove(detailItem)}
          canTransfer={detailItem.owned}
          transferTo={transferTo}
          onTransferToChange={(value) => {
            setTransferTo(value);
            setConfirmBatch(false);
          }}
          onTransferSubmit={(ev) => void handleTransfer(ev)}
          transferring={transferring}
          transferError={transferError}
          transferSuccess={transferSuccess}
          transferProgress={transferProgress}
          confirmBatch={confirmBatch}
          sendConfirm={
            confirmBatch && detailItem.owned
              ? {
                  to: nftRecipient?.hex ?? transferTo.replace(/\s/g, ''),
                  toName: nftRecipient?.name,
                  amount: `#${shortHexLabel(detailItem.tokenIdHex, 4, 4)}`,
                  network,
                  buildSigned: async () => {
                    const pk = getPrivateKey();
                    if (!pk || !network.buildContractCall) throw new Error('Wallet locked');
                    const toHex = parseTransferRecipientHex(
                      nftRecipient?.hex ?? transferTo,
                      accountIdToHex(accountId)
                    );
                    const calldata = encodeReferenceTransferNftCalldata(
                      accountIdFromHex(toHex),
                      normalizeHex64(detailItem.tokenIdHex)
                    );
                    return network.buildContractCall(
                      accountId,
                      accountIdFromHex(normalizeHex64(detailItem.collectionHex)),
                      calldata,
                      await network.getNonce(accountId),
                      pk
                    );
                  },
                  onBack: () => setConfirmBatch(false),
                  onConfirm: () => void handleTransfer({ preventDefault() {} } as React.FormEvent),
                }
              : null
          }
        />
      ) : null}
    </>
  );
}
