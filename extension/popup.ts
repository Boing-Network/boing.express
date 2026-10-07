/**
 * Boing Express extension popup — the wallet for Boing Network. Uses shared wallet core from src/.
 * Build with: pnpm run build:extension
 */

// Ensure Ed25519 SHA-512 shim is set before any wallet code (create/import/unlock/sign).
import '../src/crypto/keys';

import {
  initExtensionWalletStorage,
  hasStoredWallet,
  getStoredWallet,
  unlockWallet,
  createAndSaveWallet,
  importAndSaveWallet,
  listAccountSummaries,
  setActiveAccountIndex,
  getActiveAccountIndex,
  createAdditionalAccount,
  importAdditionalAccount,
  removeAccountAtIndex,
} from '../src/storage/walletStore.extension';
import { assertFromMatchesSender, describeReferenceMintBatchCalldata, transactionFromDappJson } from '../src/boing/dappTxRequest';
import {
  observerNftCollectionUrl,
  observerNftItemUrl,
  parseTokenIdInput,
  shortHexLabel,
} from '../src/boing/referenceNft';
import {
  groupHoldingsByCollection,
  probeNftWatchlist,
  type NftHoldingStatus,
} from '../src/boing/nftHoldings';
import {
  discoverAndPersistOwnedNfts,
  NFT_DISCOVERY_SCAN_WINDOW,
  type NftDiscoveryResult,
} from '../src/boing/nftDiscovery';
import { hydrateNftDisplayMetaList, type NftDisplayMeta } from '../src/boing/nftMetadata';
import { transferOwnedNfts } from '../src/boing/nftTransfer';
import { addNftWatchEntries, listNftWatchlist, removeNftWatchEntry } from '../src/storage/nftWatchlist';
import { buildSignedTransactionHex } from '../src/boing/signing';
import { getNetwork, getDefaultNetwork, DEFAULT_NETWORK_ID } from '../src/networks';
import { accountIdFromHex, formatAddress, accountIdToHex } from '../src/boing/types';
import { formatBalance, parseDecimalAmount } from '../src/boing/amount';
import { normalizeBoingNetworkId } from './config';
import {
  buildExtensionNetworksCatalog,
  loadExtensionMetaCacheAsync,
  refreshExtensionBoingMetaForce,
  refreshExtensionBoingMetaIfStale,
} from './boingMetaExtension';

// Standalone unlock windows use ?surface=window; toolbar popups keep a fixed 380px width.
try {
  if (new URLSearchParams(window.location.search).get('surface') === 'window') {
    document.documentElement.dataset.surface = 'window';
  }
} catch {
  // Ignore malformed query strings; default popup sizing still applies.
}

let networksCatalog = buildExtensionNetworksCatalog(null);

async function rebuildNetworksCatalog(): Promise<void> {
  const entry = await loadExtensionMetaCacheAsync();
  networksCatalog = buildExtensionNetworksCatalog(entry?.meta ?? null);
}

function repopulateNetworkSelect(): void {
  const sel = document.getElementById('network-select') as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = networksCatalog
    .map(
      (n) =>
        `<option value="${n.config.id}" ${n.config.id === selectedNetworkId ? 'selected' : ''}>${n.config.name}</option>`
    )
    .join('');
}
const STORAGE_KEY_NETWORK = 'boing_selected_network_id';
const STORAGE_KEY_CONNECTED_SITES = 'boing_connected_sites';
const BOING_DECIMALS = 0;

type Screen = 'choose' | 'unlock' | 'create' | 'import' | 'backup' | 'dashboard' | 'add-pick';

let currentScreen: Screen = 'choose';
/** True when create/import screens are adding a second+ account from the dashboard. */
let addingAccountMode = false;
let accountId: Uint8Array | null = null;
let privateKey: Uint8Array | null = null;
let pendingBackupPassword = '';
let selectedNetworkId = DEFAULT_NETWORK_ID;
/** Last displayed balance string (for Max button). */
let lastDisplayBalance = '0';
/** Last raw balance (smallest units) for insufficient-balance check. */
let lastBalanceRaw = '0';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function showScreen(screen: Screen): void {
  currentScreen = screen;
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const el = document.getElementById(`screen-${screen}`);
  if (el) el.classList.remove('hidden');
}

function showLoading(): void {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const loading = document.getElementById('screen-loading');
  if (loading) loading.classList.remove('hidden');
}

function showError(id: string, message: string): void {
  const el = $(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideError(id: string): void {
  $(id).classList.add('hidden');
}

function showSuccess(id: string, message: string): void {
  const el = $(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

async function renderChoose(): void {
  if (hasStoredWallet()) {
    const w = getStoredWallet();
    const hint = w ? `${w.addressHex.slice(0, 8)}…${w.addressHex.slice(-8)}` : '';
    ($('unlock-hint') as HTMLParagraphElement).textContent = hint ? `Address: ${hint}` : '';
    const pendingEl = document.getElementById('unlock-pending-hint');
    if (pendingEl) {
      const params = new URLSearchParams(window.location.search);
      const pending = params.get('pending');
      if (pending === 'connect') {
        pendingEl.textContent = 'A site is waiting to connect. Unlock to continue.';
        pendingEl.classList.remove('hidden');
      } else if (pending === 'sign') {
        pendingEl.textContent = 'A site is waiting for your signature. Unlock to continue.';
        pendingEl.classList.remove('hidden');
      } else {
        pendingEl.textContent = '';
        pendingEl.classList.add('hidden');
      }
    }
    showScreen('unlock');
  } else {
    showScreen('choose');
  }
}

function getCurrentNetwork() {
  const network = getDefaultNetwork(networksCatalog);
  return getNetwork(selectedNetworkId, networksCatalog) ?? network;
}

function applyBalance(balance: { value: string; decimals: number; symbol: string }): void {
  const displayStr = formatBalance(balance.value, balance.decimals);
  lastDisplayBalance = displayStr;
  lastBalanceRaw = balance.value;
  ($('balance') as HTMLElement).textContent = displayStr;
  ($('symbol') as HTMLElement).textContent = balance.symbol;
}

async function refreshDashboardBalance(): Promise<void> {
  if (!accountId) return;
  const net = getCurrentNetwork();
  const retryBtn = document.getElementById('btn-balance-retry');
  ($('balance') as HTMLElement).textContent = '…';
  ($('balance-error') as HTMLElement).classList.add('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');
  try {
    const balance = await net.getBalance(accountId);
    applyBalance(balance);
    ($('balance-error') as HTMLElement).classList.add('hidden');
    if (retryBtn) retryBtn.classList.add('hidden');
  } catch (e) {
    ($('balance') as HTMLElement).textContent = '—';
    ($('balance-error') as HTMLElement).textContent = e instanceof Error ? e.message : String(e);
    ($('balance-error') as HTMLElement).classList.remove('hidden');
    if (retryBtn) retryBtn.classList.remove('hidden');
  }
}

function updateFaucetVisibility(): void {
  const net = getCurrentNetwork();
  const section = document.getElementById('faucet-section');
  const tabBtn = document.getElementById('tab-faucet');
  if (section) section.classList.toggle('hidden', !net.config.isTestnet);
  if (tabBtn) tabBtn.classList.toggle('hidden', !net.config.isTestnet);
}

function updateStakingVisibility(): void {
  const net = getCurrentNetwork();
  const section = document.getElementById('staking-section');
  const tabBtn = document.getElementById('tab-stake');
  const show = Boolean(net.buildBond || net.buildUnbond || net.buildClaimUnbond);
  if (section) section.classList.toggle('hidden', !show);
  if (tabBtn) tabBtn.classList.toggle('hidden', !show);
}

function getConnectedSitesFromStorage(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_CONNECTED_SITES], (result) => {
      try {
        const raw = result[STORAGE_KEY_CONNECTED_SITES];
        if (!raw) {
          resolve([]);
          return;
        }
        const arr = JSON.parse(raw) as unknown;
        resolve(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function setConnectedSitesInStorage(origins: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_CONNECTED_SITES]: JSON.stringify(origins) }, resolve);
  });
}

async function refreshConnectedSites(): Promise<void> {
  const listEl = document.getElementById('connected-sites-list');
  const emptyEl = document.getElementById('connected-sites-empty');
  if (!listEl || !emptyEl) return;
  const sites = await getConnectedSitesFromStorage();
  listEl.innerHTML = '';
  if (sites.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  for (const origin of sites) {
    const li = document.createElement('li');
    li.className = 'connected-site-row';
    const originSpan = document.createElement('span');
    originSpan.className = 'connected-site-origin';
    originSpan.textContent = origin;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-small btn-disconnect';
    btn.textContent = 'Disconnect';
    btn.setAttribute('aria-label', `Disconnect ${origin}`);
    btn.addEventListener('click', async () => {
      const updated = (await getConnectedSitesFromStorage()).filter((o) => o !== origin);
      await setConnectedSitesInStorage(updated);
      refreshConnectedSites();
    });
    li.appendChild(originSpan);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

type TabId = 'wallet' | 'transactions' | 'assets' | 'stake' | 'faucet';

function switchTab(tabId: TabId): void {
  document.querySelectorAll('.tab-btn').forEach((el) => {
    el.classList.remove('active');
    el.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((el) => {
    el.classList.remove('active');
    el.setAttribute('hidden', '');
  });
  const btn = document.getElementById(`tab-${tabId}`);
  const panel = document.getElementById(`panel-${tabId}`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  if (panel) {
    panel.classList.add('active');
    panel.removeAttribute('hidden');
  }
}

let lastStakeRaw = '0';
let lastPendingUnbondRaw = '0';
let lastUnbondUnlockHeight = 0;
let lastChainHeight: number | null = null;

async function refreshStake(): Promise<void> {
  if (!accountId) return;
  const net = getCurrentNetwork();
  if (!net.getStake && !net.getUnbondStatus) return;
  try {
    if (net.getStake) {
      const s = await net.getStake(accountId);
      lastStakeRaw = s;
      const displayStr = formatBalance(s, BOING_DECIMALS);
      ($('stake') as HTMLElement).textContent = displayStr;
    }
  } catch {
    ($('stake') as HTMLElement).textContent = '—';
  }

  const claimCard = document.getElementById('claim-unbond-card');
  const claimBtn = document.getElementById('btn-claim-unbond') as HTMLButtonElement | null;
  if (!net.getUnbondStatus || !claimCard) return;
  try {
    const [status, height] = await Promise.all([
      net.getUnbondStatus(accountId),
      net.getChainHeight?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    lastPendingUnbondRaw = status.pendingUnbond;
    lastUnbondUnlockHeight = status.unlockHeight;
    lastChainHeight = height;
    const pending = BigInt(status.pendingUnbond || '0');
    if (pending <= 0n) {
      claimCard.classList.add('hidden');
      return;
    }
    claimCard.classList.remove('hidden');
    ($('pending-unbond') as HTMLElement).textContent = formatBalance(status.pendingUnbond, BOING_DECIMALS);
    const hint = document.getElementById('claim-unbond-hint');
    const ready =
      status.unlockHeight <= 0 || height == null || height >= status.unlockHeight;
    if (hint) {
      hint.textContent = ready
        ? 'Matured — ready to claim into your balance.'
        : `Unlocks at block ${status.unlockHeight}${height != null ? ` (now ${height})` : ''}.`;
    }
    if (claimBtn) {
      claimBtn.disabled = !net.buildClaimUnbond || !ready;
      claimBtn.textContent = ready ? 'Claim unbond' : 'Waiting for unlock';
    }
  } catch {
    claimCard.classList.add('hidden');
  }
}

function refreshAccountSelect(): void {
  const sel = document.getElementById('account-select') as HTMLSelectElement | null;
  if (!sel) return;
  const summaries = listAccountSummaries();
  const active = getActiveAccountIndex();
  sel.innerHTML = summaries
    .map(
      (s, i) =>
        `<option value="${i}" ${i === active ? 'selected' : ''}>${s.addressHex.slice(0, 8)}…${s.addressHex.slice(-6)}</option>`
    )
    .join('');
  const rm = document.getElementById('btn-remove-account');
  if (rm) rm.classList.toggle('hidden', summaries.length <= 1);
}

let nftSelectedKeys = new Set<string>();
let nftConfirmBatch = false;
let nftStatusesCache: NftHoldingStatus[] = [];

function nftHoldingKey(item: { collectionHex: string; tokenIdHex: string }): string {
  return `${item.collectionHex}:${item.tokenIdHex}`;
}

function nftExplorerBase(): string {
  const net = getCurrentNetwork();
  return (net.config.explorerUrl ?? 'https://boing.observer').replace(/\/$/, '');
}

function formatNftDiscoveryNote(discovery: NftDiscoveryResult): string {
  if (discovery.error && discovery.blocksScanned === 0 && discovery.discovered.length === 0) {
    return `Scan issue: ${discovery.error}`;
  }
  const expected = Math.max(0, discovery.toHeight - discovery.fromHeight + 1);
  const parts = [
    `Scanned ${discovery.blocksScanned}/${expected} (window ≤${NFT_DISCOVERY_SCAN_WINDOW})`,
  ];
  if (discovery.blocksFailed > 0) {
    parts.push(`${discovery.blocksFailed} unavailable after retry — skipped`);
  }
  if (discovery.skippedOlderRange) {
    parts.push(`catch-up capped below ${discovery.fromHeight}`);
  }
  if (discovery.persistedCount > 0) parts.push(`+${discovery.persistedCount} new`);
  if (discovery.truncated) parts.push('hit scan cap');
  if (discovery.error) parts.push(`partial: ${discovery.error}`);
  return parts.join(' · ');
}

function updateNftTransferChrome(): void {
  const sel = document.getElementById('nft-transfer-selected');
  const btn = document.getElementById('btn-nft-transfer') as HTMLButtonElement | null;
  const n = nftSelectedKeys.size;
  if (sel) {
    sel.textContent =
      n === 0
        ? 'Select owned items (checkboxes) or Transfer on a row.'
        : n === 1
          ? 'Selected 1 owned item (1 transfer_nft tx).'
          : `Selected ${n} owned items → ${n} separate transfer_nft txs (no on-chain batch).`;
  }
  if (btn) {
    btn.disabled = n === 0;
    if (!nftConfirmBatch) {
      btn.textContent = n > 1 ? `Transfer ${n} NFTs` : 'Transfer NFT';
    }
  }
}

async function maybeWatchMintBatch(tx: { payload: { kind: string; contract?: Uint8Array; calldata?: Uint8Array } }): Promise<void> {
  if (!accountId || tx.payload.kind !== 'contract_call' || !tx.payload.contract || !tx.payload.calldata) return;
  const mint = describeReferenceMintBatchCalldata(tx.payload.calldata);
  if (!mint) return;
  const recipient = accountIdToHex(mint.to).toLowerCase();
  const mine = accountIdToHex(accountId).toLowerCase();
  if (recipient !== mine) return;
  const collectionHex = accountIdToHex(tx.payload.contract);
  await addNftWatchEntries(
    mine,
    selectedNetworkId,
    mint.tokenIds.map((tokenIdHex) => ({ collectionHex, tokenIdHex }))
  );
}

async function refreshNfts(): Promise<void> {
  if (!accountId) return;
  const listEl = document.getElementById('nft-list');
  const emptyEl = document.getElementById('nft-empty');
  const errEl = document.getElementById('nft-error');
  const statusEl = document.getElementById('nft-scan-status');
  if (!listEl || !emptyEl) return;
  listEl.replaceChildren();
  nftConfirmBatch = false;
  if (errEl) {
    errEl.classList.add('hidden');
    errEl.textContent = '';
  }
  try {
    const ownerHex = accountIdToHex(accountId);
    const net = getCurrentNetwork();
    const explorer = nftExplorerBase();
    const isTestnet = Boolean(net.config.isTestnet);
    const discovery = await discoverAndPersistOwnedNfts(
      net.config.rpcUrl,
      ownerHex,
      selectedNetworkId
    );
    if (statusEl) statusEl.textContent = formatNftDiscoveryNote(discovery);

    const entries = await listNftWatchlist(ownerHex, selectedNetworkId);
    if (entries.length === 0) {
      emptyEl.classList.remove('hidden');
      emptyEl.textContent =
        'No NFTs found in the recent scan window. Add a collection + token id below for older holdings.';
      nftStatusesCache = [];
      nftSelectedKeys = new Set();
      updateNftTransferChrome();
      return;
    }
    emptyEl.classList.add('hidden');
    const statuses = await probeNftWatchlist(net.config.rpcUrl, accountId, entries);
    nftStatusesCache = statuses;
    const ownedKeys = new Set(statuses.filter((s) => s.owned).map((s) => nftHoldingKey(s)));
    nftSelectedKeys = new Set([...nftSelectedKeys].filter((k) => ownedKeys.has(k)));

    let metaByKey = new Map<string, NftDisplayMeta>();
    try {
      metaByKey = await hydrateNftDisplayMetaList(statuses, {
        rpcUrl: net.config.rpcUrl,
        explorerBase: explorer,
        networkIsTestnet: isTestnet,
      });
    } catch {
      metaByKey = new Map();
    }

    for (const group of groupHoldingsByCollection(statuses)) {
      const header = document.createElement('li');
      header.className = 'nft-collection-header';
      const colLink = document.createElement('a');
      colLink.href = observerNftCollectionUrl(explorer, group.collectionHex, isTestnet);
      colLink.target = '_blank';
      colLink.rel = 'noopener noreferrer';
      colLink.textContent = `Collection ${shortHexLabel(group.collectionHex, 6, 4)} · ${group.items.length}`;
      header.appendChild(colLink);
      listEl.appendChild(header);

      for (const item of group.items) {
        const key = nftHoldingKey(item);
        const meta = metaByKey.get(key);
        const li = document.createElement('li');
        li.className = 'nft-item-row';
        const status = item.error
          ? 'Error'
          : item.owned
            ? 'Owned'
            : item.exists
              ? 'Not yours'
              : 'Not found';
        const title =
          meta?.name?.trim() || item.label || shortHexLabel(item.tokenIdHex, 8, 6);

        if (item.owned) {
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.className = 'nft-check';
          check.checked = nftSelectedKeys.has(key);
          check.setAttribute('aria-label', `Select ${title}`);
          check.addEventListener('change', () => {
            if (check.checked) nftSelectedKeys.add(key);
            else nftSelectedKeys.delete(key);
            nftConfirmBatch = false;
            updateNftTransferChrome();
          });
          li.appendChild(check);
        }

        const thumbWrap = document.createElement('a');
        thumbWrap.className = 'nft-thumb';
        thumbWrap.href = observerNftItemUrl(
          explorer,
          item.collectionHex,
          item.tokenIdHex,
          isTestnet
        );
        thumbWrap.target = '_blank';
        thumbWrap.rel = 'noopener noreferrer';
        if (meta?.imageUrl) {
          const img = document.createElement('img');
          img.src = meta.imageUrl;
          img.alt = '';
          img.loading = 'lazy';
          img.addEventListener('error', () => {
            img.remove();
            thumbWrap.textContent = 'NFT';
          });
          thumbWrap.appendChild(img);
        } else {
          thumbWrap.textContent = 'NFT';
        }
        li.appendChild(thumbWrap);

        const body = document.createElement('div');
        body.className = 'nft-item-body';
        const titleEl = document.createElement('div');
        titleEl.className = 'nft-item-title';
        titleEl.textContent = `${status} · ${title}`;
        body.appendChild(titleEl);
        if (meta?.description) {
          const desc = document.createElement('div');
          desc.className = 'nft-item-desc';
          desc.textContent = meta.description;
          body.appendChild(desc);
        } else if (meta?.unresolved && !meta.imageUrl) {
          const desc = document.createElement('div');
          desc.className = 'nft-item-desc muted';
          desc.textContent = 'No metadata URI';
          body.appendChild(desc);
        }
        li.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'nft-item-actions';
        const link = document.createElement('a');
        link.href = observerNftItemUrl(
          explorer,
          item.collectionHex,
          item.tokenIdHex,
          isTestnet
        );
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Profile';
        actions.appendChild(link);
        if (item.owned) {
          const xfer = document.createElement('button');
          xfer.type = 'button';
          xfer.className = 'btn-small';
          xfer.textContent = 'Transfer';
          xfer.addEventListener('click', () => {
            nftSelectedKeys = new Set([key]);
            nftConfirmBatch = false;
            updateNftTransferChrome();
          });
          actions.appendChild(xfer);
        }
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'btn-small btn-disconnect';
        rmBtn.textContent = 'Remove';
        rmBtn.addEventListener('click', async () => {
          await removeNftWatchEntry(
            ownerHex,
            selectedNetworkId,
            item.collectionHex,
            item.tokenIdHex
          );
          nftSelectedKeys.delete(key);
          await refreshNfts();
        });
        actions.appendChild(rmBtn);
        li.appendChild(actions);
        listEl.appendChild(li);
      }
    }
    updateNftTransferChrome();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
      errEl.classList.remove('hidden');
    }
  }
}

async function goDashboard(): Promise<void> {
  if (!accountId || !privateKey) return;
  const network = getDefaultNetwork(networksCatalog);
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? network;

  refreshAccountSelect();
  ($('address') as HTMLElement).textContent = formatAddress(accountId, false);
  const addressTxEl = document.getElementById('address-tx-tab');
  if (addressTxEl) addressTxEl.textContent = formatAddress(accountId, false);
  ($('balance') as HTMLElement).textContent = '…';
  repopulateNetworkSelect();

  updateFaucetVisibility();
  updateStakingVisibility();
  updateNetworkMetaHint();
  chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: selectedNetworkId });
  showScreen('dashboard');
  switchTab('wallet');
  refreshConnectedSites();
  await refreshDashboardBalance();
  await refreshStake();
  void refreshNfts();
}

// --- Choose
$('btn-create').addEventListener('click', () => showScreen('create'));
$('btn-import').addEventListener('click', () => showScreen('import'));

// --- Unlock
$('form-unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = ($('unlock-password') as HTMLInputElement).value;
  hideError('unlock-error');
  try {
    const [pub, priv] = await unlockWallet(password);
    accountId = pub;
    privateKey = priv;
    chrome.runtime.sendMessage({
      type: 'WALLET_UNLOCK',
      accountHex: accountIdToHex(pub),
      privateKey: Array.from(priv),
    });
    await goDashboard();
  } catch (err) {
    showError('unlock-error', err instanceof Error ? err.message : 'Invalid password');
  }
});
$('btn-unlock-back').addEventListener('click', () => renderChoose());

// --- Create
$('form-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = ($('create-password') as HTMLInputElement).value;
  const confirm = ($('create-confirm') as HTMLInputElement).value;
  hideError('create-error');
  if (password.length < 8) {
    showError('create-error', 'Password must be at least 8 characters');
    return;
  }
  if (password !== confirm) {
    showError('create-error', 'Passwords do not match');
    return;
  }
  try {
    const { privateKeyHex } = addingAccountMode
      ? await createAdditionalAccount(password)
      : await createAndSaveWallet(password);
    pendingBackupPassword = password;
    ($('backup-key') as HTMLElement).textContent = privateKeyHex;
    const ack = document.getElementById('backup-acknowledged') as HTMLInputElement;
    const btnContinue = $('btn-backup-continue') as HTMLButtonElement;
    if (ack) ack.checked = false;
    btnContinue.disabled = true;
    showScreen('backup');
  } catch (err) {
    showError('create-error', err instanceof Error ? err.message : 'Failed to create wallet');
  }
});

$('btn-backup-copy').addEventListener('click', async () => {
  const key = ($('backup-key') as HTMLElement).textContent;
  if (key) {
    await navigator.clipboard.writeText(key);
    const btn = $('btn-backup-copy') as HTMLButtonElement;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }
});

document.getElementById('backup-acknowledged')?.addEventListener('change', () => {
  const ack = document.getElementById('backup-acknowledged') as HTMLInputElement;
  const btnContinue = $('btn-backup-continue') as HTMLButtonElement;
  btnContinue.disabled = !ack?.checked;
});

$('btn-backup-continue').addEventListener('click', async () => {
  const password = pendingBackupPassword;
  pendingBackupPassword = '';
  hideError('backup-error');
  try {
    const [pub, priv] = await unlockWallet(password);
    accountId = pub;
    privateKey = priv;
    addingAccountMode = false;
    chrome.runtime.sendMessage({
      type: 'WALLET_UNLOCK',
      accountHex: accountIdToHex(pub),
      privateKey: Array.from(priv),
    });
    await goDashboard();
  } catch (err) {
    showError('backup-error', err instanceof Error ? err.message : 'Failed to unlock');
  }
});
$('btn-create-back').addEventListener('click', () => {
  if (addingAccountMode) {
    addingAccountMode = false;
    void goDashboard();
  } else {
    showScreen('choose');
  }
});

// --- Import
$('form-import').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hex = ($('import-key') as HTMLTextAreaElement).value.replace(/\s/g, '').replace(/^0x/i, '');
  const password = ($('import-password') as HTMLInputElement).value;
  const confirm = ($('import-confirm') as HTMLInputElement).value;
  hideError('import-error');
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    showError('import-error', 'Private key must be 64 hex characters');
    return;
  }
  if (password.length < 8) {
    showError('import-error', 'Password must be at least 8 characters');
    return;
  }
  if (password !== confirm) {
    showError('import-error', 'Passwords do not match');
    return;
  }
  const importBtn = document.querySelector('#form-import button[type="submit"]') as HTMLButtonElement;
  const originalImportText = importBtn?.textContent ?? 'Import wallet';
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
  }
  try {
    if (addingAccountMode) {
      await importAdditionalAccount(password, hex);
    } else {
      await importAndSaveWallet(password, hex);
    }
    const [pub, priv] = await unlockWallet(password);
    accountId = pub;
    privateKey = priv;
    addingAccountMode = false;
    chrome.runtime.sendMessage({
      type: 'WALLET_UNLOCK',
      accountHex: accountIdToHex(pub),
      privateKey: Array.from(priv),
    });
    await goDashboard();
  } catch (err) {
    showError('import-error', err instanceof Error ? err.message : 'Failed to import wallet');
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.textContent = originalImportText;
    }
  }
});
$('btn-import-back').addEventListener('click', () => {
  if (addingAccountMode) {
    addingAccountMode = false;
    void goDashboard();
  } else {
    showScreen('choose');
  }
});

// --- Dashboard
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabId = (btn as HTMLElement).getAttribute('data-tab');
    if (tabId === 'wallet' || tabId === 'transactions' || tabId === 'assets' || tabId === 'stake' || tabId === 'faucet')
      switchTab(tabId);
    if (tabId === 'assets') {
      void refreshDashboardBalance();
      void refreshNfts();
    }
  });
});

$('network-select').addEventListener('change', (e) => {
  selectedNetworkId = normalizeBoingNetworkId((e.target as HTMLSelectElement).value);
  chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: selectedNetworkId });
  refreshDashboardBalance();
  refreshStake();
  updateFaucetVisibility();
  updateStakingVisibility();
});

$('btn-lock').addEventListener('click', () => {
  accountId = null;
  privateKey = null;
  chrome.runtime.sendMessage({ type: 'WALLET_LOCK' });
  renderChoose();
});

const accountSelectEl = document.getElementById('account-select') as HTMLSelectElement | null;
if (accountSelectEl) {
  accountSelectEl.addEventListener('change', async () => {
    const idx = parseInt(accountSelectEl.value, 10);
    if (Number.isNaN(idx) || idx === getActiveAccountIndex()) return;
    await setActiveAccountIndex(idx);
    chrome.runtime.sendMessage({ type: 'BOING_ACTIVE_ACCOUNT_CHANGED' });
    accountId = null;
    privateKey = null;
    const w = getStoredWallet();
    ($('unlock-hint') as HTMLParagraphElement).textContent = w
      ? `Address: ${w.addressHex.slice(0, 8)}…${w.addressHex.slice(-8)}`
      : '';
    showScreen('unlock');
  });
}

document.getElementById('btn-add-account')?.addEventListener('click', () => {
  showScreen('add-pick');
});

document.getElementById('btn-remove-account')?.addEventListener('click', async () => {
  if (!confirm('Remove this account from Boing Express? This cannot be undone.')) return;
  const idx = getActiveAccountIndex();
  await removeAccountAtIndex(idx);
  chrome.runtime.sendMessage({ type: 'BOING_ACTIVE_ACCOUNT_CHANGED' });
  accountId = null;
  privateKey = null;
  if (!hasStoredWallet()) {
    renderChoose();
    return;
  }
  const w = getStoredWallet();
  ($('unlock-hint') as HTMLParagraphElement).textContent = w
    ? `Address: ${w.addressHex.slice(0, 8)}…${w.addressHex.slice(-8)}`
    : '';
  showScreen('unlock');
});

document.getElementById('btn-add-pick-create')?.addEventListener('click', () => {
  addingAccountMode = true;
  showScreen('create');
});

document.getElementById('btn-add-pick-import')?.addEventListener('click', () => {
  addingAccountMode = true;
  showScreen('import');
});

document.getElementById('btn-add-pick-back')?.addEventListener('click', () => {
  void goDashboard();
});

document.getElementById('btn-native-tx-submit')?.addEventListener('click', async () => {
  if (!accountId || !privateKey) return;
  const errEl = document.getElementById('native-tx-error') as HTMLElement | null;
  const okEl = document.getElementById('native-tx-success') as HTMLElement | null;
  const ta = document.getElementById('native-tx-json') as HTMLTextAreaElement | null;
  if (!errEl || !okEl || !ta) return;
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  const raw = ta.value.trim();
  if (!raw) {
    errEl.textContent = 'Paste JSON first.';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = document.getElementById('btn-native-tx-submit') as HTMLButtonElement;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const obj = JSON.parse(raw) as unknown;
    assertFromMatchesSender(obj, accountIdToHex(accountId));
    const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
    const nonce = await net.getNonce(accountId);
    const tx = transactionFromDappJson(obj, accountId, nonce);
    const signedHexNo0x = await buildSignedTransactionHex(tx, privateKey);
    const hex = signedHexNo0x.startsWith('0x') ? signedHexNo0x : `0x${signedHexNo0x}`;
    const result = await net.submitTransaction(hex);
    if (result.success) {
      okEl.textContent = result.txHash ? `Submitted: ${result.txHash.slice(0, 20)}…` : 'Submitted.';
      okEl.classList.remove('hidden');
      await maybeWatchMintBatch(tx);
      await refreshDashboardBalance();
      void refreshNfts();
    } else {
      errEl.textContent = result.error ?? 'Submit failed';
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.message : String(e);
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = prev ?? 'Sign & send';
  }
});

document.getElementById('form-nft-add')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId) return;
  const errEl = document.getElementById('nft-add-error');
  const colEl = document.getElementById('nft-collection') as HTMLInputElement | null;
  const tokEl = document.getElementById('nft-token-id') as HTMLInputElement | null;
  if (!errEl || !colEl || !tokEl) return;
  errEl.classList.add('hidden');
  try {
    const collectionHex = colEl.value.replace(/^0x/i, '').trim().toLowerCase();
    const tokenIdHex = parseTokenIdInput(tokEl.value);
    if (collectionHex.length !== 64 || !/^[0-9a-f]+$/.test(collectionHex)) {
      throw new Error('Collection must be 64 hex characters');
    }
    await addNftWatchEntries(accountIdToHex(accountId), selectedNetworkId, [
      { collectionHex, tokenIdHex },
    ]);
    colEl.value = '';
    tokEl.value = '';
    await refreshNfts();
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    errEl.classList.remove('hidden');
  }
});

document.getElementById('form-nft-transfer')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const errEl = document.getElementById('nft-transfer-error');
  const okEl = document.getElementById('nft-transfer-success');
  const toEl = document.getElementById('nft-transfer-to') as HTMLInputElement | null;
  if (!errEl || !okEl || !toEl) return;
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  const targets = nftStatusesCache.filter(
    (s) => s.owned && nftSelectedKeys.has(nftHoldingKey(s))
  );
  if (targets.length === 0) {
    errEl.textContent = 'Select one or more owned NFTs first.';
    errEl.classList.remove('hidden');
    return;
  }
  const net = getCurrentNetwork();
  if (!net.buildContractCall) {
    errEl.textContent = 'This network cannot send contract calls.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!nftConfirmBatch) {
    nftConfirmBatch = true;
    const btn = document.getElementById('btn-nft-transfer') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent =
        targets.length > 1
          ? `Confirm ${targets.length} transfers`
          : 'Confirm transfer';
      btn.disabled = false;
    }
    const sel = document.getElementById('nft-transfer-selected');
    if (sel) {
      sel.textContent = `Confirm: ${targets.length} separate transfer_nft tx(s) (protocol has no batch).`;
    }
    return;
  }
  const btn = document.getElementById('btn-nft-transfer') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Transferring…';
  try {
    const result = await transferOwnedNfts({
      network: net,
      accountId,
      privateKey,
      recipientHex: toEl.value,
      targets: targets.map((t) => ({
        collectionHex: t.collectionHex,
        tokenIdHex: t.tokenIdHex,
      })),
    });
    if (result.failed === 0) {
      okEl.textContent =
        result.txCount === 1
          ? result.results[0]?.txHash
            ? `Submitted: ${result.results[0].txHash.slice(0, 16)}…`
            : 'Submitted.'
          : `All ${result.submitted} transfers submitted (${result.txCount} txs).`;
      okEl.classList.remove('hidden');
      nftSelectedKeys = new Set();
      nftConfirmBatch = false;
      toEl.value = '';
      updateNftTransferChrome();
      window.setTimeout(() => {
        void refreshNfts();
      }, 2000);
    } else {
      errEl.textContent = `${result.submitted} submitted, ${result.failed} failed.`;
      errEl.classList.remove('hidden');
      nftConfirmBatch = false;
      updateNftTransferChrome();
      btn.disabled = false;
    }
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    errEl.classList.remove('hidden');
    nftConfirmBatch = false;
    updateNftTransferChrome();
    btn.disabled = false;
  }
});

$('btn-copy').addEventListener('click', async () => {
  if (!accountId) return;
  const addr = formatAddress(accountId, false);
  await navigator.clipboard.writeText(addr);
  const btn = $('btn-copy');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
});

$('btn-copy-tx-tab').addEventListener('click', async () => {
  if (!accountId) return;
  const addr = formatAddress(accountId, false);
  await navigator.clipboard.writeText(addr);
  const btn = $('btn-copy-tx-tab');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
});

$('btn-send-max').addEventListener('click', () => {
  ($('send-amount') as HTMLInputElement).value = lastDisplayBalance;
  ($('send-amount') as HTMLInputElement).focus();
});

$('form-send').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const toHex = ($('send-to') as HTMLInputElement).value.replace(/\s/g, '').replace(/^0x/i, '');
  const amountStr = ($('send-amount') as HTMLInputElement).value;
  hideError('send-error');
  ($('send-success') as HTMLElement).classList.add('hidden');
  if (toHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(toHex)) {
    showError('send-error', 'Invalid address: 64 hex chars required');
    return;
  }
  if (accountId && toHex.toLowerCase() === accountIdToHex(accountId).toLowerCase()) {
    showError('send-error', 'Cannot send to yourself');
    return;
  }
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, BOING_DECIMALS) : null;
  if (amount == null || amount <= 0n) {
    showError('send-error', 'Enter a valid whole BOING amount (e.g. 100)');
    return;
  }
  if (BigInt(lastBalanceRaw) < amount) {
    showError('send-error', 'Insufficient balance');
    return;
  }
  const sendBtn = document.getElementById('btn-send-submit') as HTMLButtonElement;
  const originalSendText = sendBtn?.textContent ?? 'Send';
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
  }
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  try {
    const nonce = await net.getNonce(accountId);
    const toId = accountIdFromHex(toHex);
    const signedHex = await net.buildTransfer(accountId, toId, amount, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      showSuccess('send-success', result.txHash ? `Sent! ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
      ($('send-amount') as HTMLInputElement).value = '';
      ($('send-to') as HTMLInputElement).value = '';
      const balance = await net.getBalance(accountId);
      applyBalance(balance);
      ($('send-amount') as HTMLInputElement).focus();
    } else {
      showError('send-error', result.error ?? 'Submit failed');
    }
  } catch (err) {
    showError('send-error', err instanceof Error ? err.message : String(err));
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = originalSendText;
    }
  }
});

$('btn-faucet').addEventListener('click', async () => {
  if (!accountId) return;
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  if (!net.faucetRequest) return;
  const faucetBtn = $('btn-faucet') as HTMLButtonElement;
  const originalFaucetText = faucetBtn.textContent ?? 'Request testnet BOING';
  faucetBtn.disabled = true;
  faucetBtn.textContent = 'Requesting…';
  ($('faucet-error') as HTMLElement).classList.add('hidden');
  try {
    const result = await net.faucetRequest(accountId);
    if (result.success) {
      const balance = await net.getBalance(accountId);
      applyBalance(balance);
    } else {
      ($('faucet-error') as HTMLElement).textContent = result.error ?? 'Faucet failed';
      ($('faucet-error') as HTMLElement).classList.remove('hidden');
    }
  } catch (err) {
    ($('faucet-error') as HTMLElement).textContent = err instanceof Error ? err.message : String(err);
    ($('faucet-error') as HTMLElement).classList.remove('hidden');
  } finally {
    faucetBtn.disabled = false;
    faucetBtn.textContent = originalFaucetText;
  }
});

$('btn-faucet-page').addEventListener('click', () => {
  if (!accountId) return;
  const addr = formatAddress(accountId, false);
  const url = `https://boing.network/faucet?address=${encodeURIComponent(addr)}`;
  window.open(url, '_blank');
});

$('btn-balance-retry').addEventListener('click', () => refreshDashboardBalance());

$('form-bond').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const amountStr = ($('bond-amount') as HTMLInputElement).value;
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  if (!net.buildBond) return;
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, BOING_DECIMALS) : null;
  ($('bond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('bond-error') as HTMLElement).textContent = 'Enter a valid whole BOING amount (e.g. 100)';
    ($('bond-error') as HTMLElement).classList.remove('hidden');
    return;
  }
  if (BigInt(lastBalanceRaw) < amount) {
    ($('bond-error') as HTMLElement).textContent = 'Insufficient balance';
    ($('bond-error') as HTMLElement).classList.remove('hidden');
    return;
  }
  const btn = $('btn-bond') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Bonding…';
  try {
    const nonce = await net.getNonce(accountId);
    const signedHex = await net.buildBond!(accountId, amount, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      await refreshDashboardBalance();
      await refreshStake();
      ($('bond-amount') as HTMLInputElement).value = '';
    } else {
      ($('bond-error') as HTMLElement).textContent = result.error ?? 'Bond failed';
      ($('bond-error') as HTMLElement).classList.remove('hidden');
    }
  } catch (err) {
    ($('bond-error') as HTMLElement).textContent = err instanceof Error ? err.message : String(err);
    ($('bond-error') as HTMLElement).classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bond';
  }
});

$('form-unbond').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const amountStr = ($('unbond-amount') as HTMLInputElement).value;
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  if (!net.buildUnbond) return;
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, BOING_DECIMALS) : null;
  ($('unbond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('unbond-error') as HTMLElement).textContent = 'Enter a valid whole BOING amount (e.g. 100)';
    ($('unbond-error') as HTMLElement).classList.remove('hidden');
    return;
  }
  if (BigInt(lastStakeRaw) < amount) {
    ($('unbond-error') as HTMLElement).textContent = 'Insufficient staked amount';
    ($('unbond-error') as HTMLElement).classList.remove('hidden');
    return;
  }
  const btn = $('btn-unbond') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Unbonding…';
  try {
    const nonce = await net.getNonce(accountId);
    const signedHex = await net.buildUnbond!(accountId, amount, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      await refreshDashboardBalance();
      await refreshStake();
      ($('unbond-amount') as HTMLInputElement).value = '';
    } else {
      ($('unbond-error') as HTMLElement).textContent = result.error ?? 'Unbond failed';
      ($('unbond-error') as HTMLElement).classList.remove('hidden');
    }
  } catch (err) {
    ($('unbond-error') as HTMLElement).textContent = err instanceof Error ? err.message : String(err);
    ($('unbond-error') as HTMLElement).classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unbond';
  }
});

$('btn-claim-unbond').addEventListener('click', async () => {
  if (!accountId || !privateKey) return;
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  if (!net.buildClaimUnbond) return;
  const errEl = $('claim-unbond-error') as HTMLElement;
  const okEl = $('claim-unbond-success') as HTMLElement;
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  const pending = BigInt(lastPendingUnbondRaw || '0');
  if (pending <= 0n) {
    errEl.textContent = 'No pending unbond to claim';
    errEl.classList.remove('hidden');
    return;
  }
  if (
    lastChainHeight != null &&
    lastUnbondUnlockHeight > 0 &&
    lastChainHeight < lastUnbondUnlockHeight
  ) {
    errEl.textContent = `Unlocks at block ${lastUnbondUnlockHeight} (current ${lastChainHeight}).`;
    errEl.classList.remove('hidden');
    return;
  }
  const btn = $('btn-claim-unbond') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Claiming…';
  try {
    const nonce = await net.getNonce(accountId);
    const signedHex = await net.buildClaimUnbond!(accountId, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      okEl.textContent = result.txHash ? `Claimed! Tx: ${result.txHash.slice(0, 16)}…` : 'Submitted';
      okEl.classList.remove('hidden');
      await refreshDashboardBalance();
      await refreshStake();
    } else {
      errEl.textContent = result.error ?? 'Claim failed';
      errEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Claim unbond';
  }
});

function updateNetworkMetaHint(): void {
  const el = document.getElementById('network-meta-hint');
  if (!el) return;
  const testnet = networksCatalog.find((n) => n.config.id === 'boing-testnet');
  if (!testnet?.config.rpcUrl) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = `Testnet RPC: ${testnet.config.rpcUrl}`;
  el.classList.remove('hidden');
}

const btnSyncMeta = document.getElementById('btn-sync-network-meta');
if (btnSyncMeta) {
  btnSyncMeta.addEventListener('click', async () => {
    btnSyncMeta.setAttribute('disabled', 'true');
    try {
      await refreshExtensionBoingMetaForce();
      await rebuildNetworksCatalog();
      repopulateNetworkSelect();
      updateNetworkMetaHint();
      if (currentScreen === 'dashboard' && accountId) {
        await refreshDashboardBalance();
        await refreshStake();
      }
    } finally {
      btnSyncMeta.removeAttribute('disabled');
    }
  });
}

// Init: refresh /api/networks meta, restore saved network, then choose / unlock / dashboard
showLoading();
void (async () => {
  try {
    await refreshExtensionBoingMetaIfStale();
    await rebuildNetworksCatalog();
  } catch {
    networksCatalog = buildExtensionNetworksCatalog(null);
  }
  updateNetworkMetaHint();

  chrome.storage.local.get([STORAGE_KEY_NETWORK], (result) => {
    const saved = normalizeBoingNetworkId(
      typeof result[STORAGE_KEY_NETWORK] === 'string' ? result[STORAGE_KEY_NETWORK] : DEFAULT_NETWORK_ID
    );
    if (saved && networksCatalog.some((n) => n.config.id === saved)) selectedNetworkId = saved;
    void initExtensionWalletStorage().then(() => {
      if (!hasStoredWallet()) {
        renderChoose();
        return;
      }
      chrome.runtime.sendMessage({ type: 'GET_SESSION_RESTORE' }, (response: { unlocked?: boolean; accountHex?: string; privateKey?: number[] } | undefined) => {
        if (
          response?.unlocked &&
          typeof response.accountHex === 'string' &&
          Array.isArray(response.privateKey) &&
          response.privateKey.length === 32
        ) {
          accountId = accountIdFromHex(response.accountHex);
          privateKey = new Uint8Array(response.privateKey);
          void goDashboard();
        } else {
          renderChoose();
        }
      });
    });
  });
})();
