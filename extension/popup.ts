/**
 * Boing Express extension popup — the wallet for Boing Network. Uses shared wallet core from src/.
 * Build with: pnpm run build:extension
 */

// Ensure Ed25519 SHA-512 shim is set before any wallet code (create/import/unlock/sign).
import { describeWalletError } from '../src/boing/errorMessages';
import { resolveRecipient, reverseName } from '../src/boing/names';
import { setPendingName } from '../src/storage/pendingName';
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
import { parseTransferRecipientHex, transferOwnedNfts } from '../src/boing/nftTransfer';
import { addNftWatchEntries, listNftWatchlist, removeNftWatchEntry } from '../src/storage/nftWatchlist';
import { addTokenWatchEntry, listTokenWatchlist, removeTokenWatchEntry } from '../src/storage/tokenWatchlist';
import { addTxHistory, getTxHistory, type TxHistoryEntry } from '../src/storage/txHistory';
import { chainRowToDisplay, fetchChainTxPage, mergeTxHistory, type DisplayTxEntry } from '../src/boing/chainTxHistory';
import { mergeWithDefaultTokens } from '../src/boing/defaultTokens';
import { confirmSendIsland, renderBulkIsland, renderClaimNameIsland, renderNamesIsland, renderPendingNameIsland, renderValidatorIsland, showAddressQrIsland } from './popupIslands';
import { loadTokenHoldings, type TokenHolding } from '../src/boing/tokenHoldings';
import { buildReferenceFungibleTransfer } from '../src/boing/referenceFungible';
import { encodeReferenceTransferNftCalldata, normalizeHex64 } from '../src/boing/referenceNft';
import {
  formatBulkReport,
  parseBulkCsv,
  runSequentialBulkTransfer,
  validateBulkRows,
  type BulkRowInput,
  type BulkRowResult,
  type BulkRowValid,
} from '../src/boing/bulkTransfer';
import { buildSignedTransactionHex, signingChainIdForRpc } from '../src/boing/signing';
import { getNetwork, getDefaultNetwork, DEFAULT_NETWORK_ID } from '../src/networks';
import { accountIdFromHex, formatAddress, accountIdToHex } from '../src/boing/types';
import { formatBalance, parseDecimalAmount } from '../src/boing/amount';
import { fetchNativeCurrency, formatNative, knownLedgerDecimals, ledgerDecimalsAt, maxSendableInput, plainTransferFeeLabel } from '../src/boing/nativeUnit';
import { normalizeBoingNetworkId } from './config';
import { isBackupConfirmed } from '../src/security/backupVerify';
import { checkNodeCompat, configuredChainIdDecimal } from '../src/boing/nodeCompat';
import { AUTO_LOCK_OPTIONS, autoLockLabel, isSessionExpired, normalizeAutoLockMinutes, STORAGE_KEY_AUTO_LOCK_MINUTES } from '../src/security/autoLock';
import { RevealError, createRevealSession, revealActivePrivateKeyHex, type RevealState } from '../src/security/revealPrivateKey';
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
/**
 * Ledger decimals of native BOING amounts from the node (18 = base units after the 18-decimals switch,
 * 0 = whole BOING before it). Updated from every balance response.
 */
let nativeDecimals = 0;

type Screen = 'choose' | 'unlock' | 'create' | 'import' | 'backup' | 'claim-name' | 'dashboard' | 'add-pick';

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
  if (screen === 'dashboard') void consumeScanResult();
}

// --- QR scan hand-off (scan.html runs in a tab; result comes back through chrome.storage.local)
const SCAN_RESULT_KEY = 'boing_scan_result';
const SCAN_FIELD_MODE: Record<string, 'boing' | 'token' | 'nft'> = { 'send-to': 'boing', 'token-send-to': 'token', 'nft-transfer-to': 'nft' };

async function consumeScanResult(): Promise<void> {
  const got = await new Promise<Record<string, unknown>>((r) => chrome.storage.local.get([SCAN_RESULT_KEY], (x) => r(x ?? {})));
  const res = got[SCAN_RESULT_KEY] as { field?: string; value?: string; ts?: number } | undefined;
  if (!res) return;
  chrome.storage.local.remove([SCAN_RESULT_KEY]);
  const mode = res.field ? SCAN_FIELD_MODE[res.field] : undefined;
  if (!mode || !res.value || !/^0x[0-9a-f]{64}$/i.test(res.value) || Date.now() - (res.ts ?? 0) > 10 * 60_000) return;
  switchTab('transfer');
  setTransferMode(mode);
  const input = document.getElementById(res.field!) as HTMLInputElement | null;
  if (input) {
    input.value = res.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-scan-field]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const field = btn.getAttribute('data-scan-field') ?? 'send-to';
    void chrome.tabs.create({ url: chrome.runtime.getURL(`scan.html?field=${encodeURIComponent(field)}`) });
  });
});

document.getElementById('btn-qr')?.addEventListener('click', () => {
  if (accountId) showAddressQrIsland(formatAddress(accountId, false));
});

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
  nativeDecimals = balance.decimals;
  const displayStr = formatNative(balance.value, balance.decimals);
  lastDisplayBalance = displayStr;
  lastBalanceRaw = balance.value;
  ($('balance') as HTMLElement).textContent = displayStr;
  ($('symbol') as HTMLElement).textContent = balance.symbol;
  mountNameIslands();
}

function namesRpcUrl(): string {
  return (getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog)).config.rpcUrl;
}

let primaryNameSeq = 0;
async function refreshPrimaryName(): Promise<void> {
  const el = document.getElementById('primary-name');
  if (!el || !accountId) return;
  const seq = ++primaryNameSeq;
  let name: string | null = null;
  try {
    const r = await reverseName(namesRpcUrl(), accountIdToHex(accountId));
    name = r ? r.display || `${r.name}.boing` : null;
  } catch {
    name = null;
  }
  if (seq !== primaryNameSeq) return;
  el.textContent = name ?? '';
  el.classList.toggle('hidden', !name);
}

/** Mount the web wallet's name components (pending-name banner + Settings → Names). */
function mountNameIslands(): void {
  if (!accountId) return;
  const network = getCurrentNetwork();
  let bal: bigint | null = null;
  try { bal = BigInt(lastBalanceRaw); } catch { bal = null; }
  const getPrivateKey = () => privateKey;
  const pendingEl = document.getElementById('pending-name-root');
  if (pendingEl) {
    renderPendingNameIsland(pendingEl, {
      accountId, network, getPrivateKey, balance: bal,
      onDone: () => { void refreshPrimaryName(); void refreshDashboardBalance(); },
    }, islandKey());
  }
  const namesEl = document.getElementById('names-root');
  if (namesEl) {
    renderNamesIsland(namesEl, {
      accountId, network, getPrivateKey, balance: bal,
      onTx: (hash, summary) => {
        recordTx(hash, 'contract_call', summary);
        void refreshDashboardBalance();
        void refreshPrimaryName();
      },
    }, islandKey());
  }
}

/** Verify the selected node really is the network the user picked; warn (or block sending) on mismatch. */
async function refreshNodeCompat(): Promise<void> {
  const banner = document.getElementById('compat-banner');
  if (!banner) return;
  const net = getCurrentNetwork();
  const forNetwork = selectedNetworkId;
  const status = await checkNodeCompat(net.config.rpcUrl, {
    chainId: configuredChainIdDecimal(net.config.chainId),
    networkName: net.config.name,
  });
  if (forNetwork !== selectedNetworkId) return; // user switched while we were checking
  // An unreachable node is already reported by the balance error; only show real mismatches here.
  const issues = status.issues.filter((i) => i.code !== 'unreachable');
  if (issues.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  banner.textContent = issues.map((i) => i.message).join(' ');
  banner.classList.toggle('error', status.level === 'error');
  banner.classList.toggle('hint', status.level !== 'error');
  banner.classList.remove('hidden');
}

async function refreshDashboardBalance(): Promise<void> {
  if (!accountId) return;
  const net = getCurrentNetwork();
  void refreshNodeCompat();
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
    ($('balance-error') as HTMLElement).textContent = describeWalletError(e);
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
  const show = Boolean(net.buildBond || net.buildUnbond || net.buildClaimUnbond);
  const showValidator = Boolean(net.config.isTestnet || net.buildBond);
  if (section) section.classList.toggle('hidden', !show);
  document.getElementById('validator-card')?.classList.toggle('hidden', !showValidator);
  // One "Validate" tab: open validator registration first, bond/unbond below.
  document.getElementById('tab-validate')?.classList.toggle('hidden', !(show || showValidator));
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

type TabId = 'wallet' | 'transactions' | 'transfer' | 'validate' | 'faucet' | 'settings';

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
  const gear = document.getElementById('btn-settings');
  if (gear) {
    gear.classList.toggle('active', tabId === 'settings');
    gear.setAttribute('aria-expanded', tabId === 'settings' ? 'true' : 'false');
  }
  if (tabId !== 'settings') lastMainTab = tabId;
}

let lastMainTab: TabId = 'wallet';

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
      const displayStr = formatNative(s, knownLedgerDecimals(net.config.rpcUrl) || nativeDecimals);
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
    ($('pending-unbond') as HTMLElement).textContent = formatNative(status.pendingUnbond, knownLedgerDecimals(net.config.rpcUrl) || nativeDecimals);
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
/** Display titles of watched NFTs (filled by refreshNfts) for the Transfer tab picker. */
const nftTitles = new Map<string, string>();

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

function renderNftTransferPick(): void {
  const pick = document.getElementById('nft-transfer-pick');
  if (!pick) return;
  pick.replaceChildren();
  const owned = nftStatusesCache.filter((s) => s.owned);
  if (owned.length === 0) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'No owned NFTs found. Holdings are listed on the Wallet tab.';
    pick.appendChild(li);
    return;
  }
  for (const item of owned) {
    const key = nftHoldingKey(item);
    const title = nftTitles.get(key) ?? shortHexLabel(item.tokenIdHex, 8, 6);
    const li = document.createElement('li');
    li.className = 'nft-pick-row';
    const label = document.createElement('label');
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
    const span = document.createElement('span');
    span.textContent = `${title} · ${shortHexLabel(item.collectionHex, 6, 4)}`;
    label.append(check, span);
    li.appendChild(label);
    pick.appendChild(li);
  }
}

function updateNftTransferChrome(): void {
  renderNftTransferPick();
  const sel = document.getElementById('nft-transfer-selected');
  const btn = document.getElementById('btn-nft-transfer') as HTMLButtonElement | null;
  const n = nftSelectedKeys.size;
  if (sel) {
    sel.textContent =
      n === 0
        ? 'Select owned items above.'
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
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
    }

    const entries = await listNftWatchlist(ownerHex, selectedNetworkId);
    if (entries.length === 0) {
      emptyEl.classList.remove('hidden');
      emptyEl.textContent = 'No NFTs yet';
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
      colLink.textContent = `Collection · ${group.items.length}`;
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
        const title = meta?.name?.trim() || item.label || 'NFT';
        nftTitles.set(key, title);

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
            nftTitles.set(key, title);
            switchTab('transfer');
            setTransferMode('nft');
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
      errEl.textContent = describeWalletError(e);
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
  ($('balance') as HTMLElement).textContent = '…';
  repopulateNetworkSelect();

  updateFaucetVisibility();
  updateStakingVisibility();
  updateNetworkMetaHint();
  chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: selectedNetworkId });
  showScreen('dashboard');
  switchTab('wallet');
  refreshConnectedSites();
  setTransferMode('boing');
  refreshTxHistory();
  await refreshDashboardBalance();
  await refreshStake();
  void refreshNfts();
  void refreshTokens();
  mountNameIslands();
  void refreshPrimaryName();
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
    const confirmInput = document.getElementById('backup-confirm') as HTMLInputElement | null;
    if (confirmInput) confirmInput.value = '';
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

function updateBackupContinue(): void {
  const ack = document.getElementById('backup-acknowledged') as HTMLInputElement | null;
  const typed = (document.getElementById('backup-confirm') as HTMLInputElement | null)?.value ?? '';
  const keyHex = ($('backup-key') as HTMLElement).textContent ?? '';
  ($('btn-backup-continue') as HTMLButtonElement).disabled = !(ack?.checked && isBackupConfirmed(keyHex, typed));
}
document.getElementById('backup-acknowledged')?.addEventListener('change', updateBackupContinue);
document.getElementById('backup-confirm')?.addEventListener('input', updateBackupContinue);

$('btn-backup-continue').addEventListener('click', async () => {
  if (addingAccountMode) {
    await finishBackup();
    return;
  }
  const root = $('claim-name-root') as HTMLElement;
  const render = (busy: boolean) =>
    renderClaimNameIsland(root, {
      rpcUrl: namesRpcUrl(),
      mascotSrc: 'images/mascot-default.webp',
      busy,
      onReserve: (label) => {
        setPendingName({ name: label, createdAt: Date.now() });
        render(true);
        void finishBackup();
      },
      onSkip: () => {
        render(true);
        void finishBackup();
      },
    });
  render(false);
  showScreen('claim-name');
});

async function finishBackup(): Promise<void> {
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
    showScreen('backup');
    showError('backup-error', err instanceof Error ? err.message : 'Failed to unlock');
  }
}
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
    if (tabId === 'wallet' || tabId === 'transactions' || tabId === 'transfer' || tabId === 'validate' || tabId === 'faucet')
      switchTab(tabId);
    if (tabId === 'validate') mountValidatorIsland();
    if (tabId === 'wallet') {
      void refreshDashboardBalance();
      void refreshNfts();
      void refreshTokens();
    }
    if (tabId === 'transactions') {
      refreshTxHistory();
      void loadChainHistory(null);
    }
    if (tabId === 'transfer') {
      void refreshDashboardBalance();
      updateNftTransferChrome();
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
  refreshTxHistory();
  void refreshNfts();
  void refreshTokens();
});

// --- Settings (gear): connected sites, export private key, advanced tx
document.getElementById('btn-settings')?.addEventListener('click', () => {
  if (document.getElementById('panel-settings')?.hasAttribute('hidden')) {
    switchTab('settings');
    void refreshConnectedSites();
  } else {
    revealSession.clear();
    switchTab(lastMainTab);
  }
});
document.getElementById('btn-settings-back')?.addEventListener('click', () => {
  revealSession.clear();
  switchTab(lastMainTab);
});

// --- Reveal private key (password re-entry, in-memory only, hidden by default, auto-clear; never sent to background/dApps)
const revealSession = createRevealSession((s: RevealState) => {
  const out = document.getElementById('reveal-key-output');
  const form = document.getElementById('form-reveal-key');
  const val = document.getElementById('reveal-key-value');
  const toggle = document.getElementById('btn-reveal-key-toggle');
  const copyBtn = document.getElementById('btn-reveal-key-copy');
  if (!out || !form || !val || !toggle) return;
  out.classList.toggle('hidden', !s.keyHex);
  form.classList.toggle('hidden', !!s.keyHex);
  val.textContent = s.keyHex ? (s.visible ? s.keyHex : '•'.repeat(64)) : '';
  (val as HTMLElement).style.userSelect = s.visible ? 'all' : 'none';
  toggle.textContent = s.visible ? 'Hide' : 'Show';
  if (!s.keyHex && copyBtn) copyBtn.textContent = 'Copy';
});
document.getElementById('form-reveal-key')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError('reveal-key-error');
  const input = document.getElementById('reveal-key-password') as HTMLInputElement | null;
  const password = input?.value ?? '';
  if (input) input.value = '';
  try {
    const hex = await revealActivePrivateKeyHex(password, {
      unlock: unlockWallet,
      expectedAddressHex: getStoredWallet()?.addressHex ?? null,
    });
    revealSession.set(hex);
  } catch (err) {
    showError('reveal-key-error', err instanceof RevealError ? err.message : 'Could not reveal the key.');
  }
});
document.getElementById('btn-reveal-key-toggle')?.addEventListener('click', () => revealSession.toggleVisible());
document.getElementById('btn-reveal-key-done')?.addEventListener('click', () => revealSession.clear());
document.getElementById('btn-reveal-key-copy')?.addEventListener('click', async () => {
  const hex = revealSession.getState().keyHex;
  if (!hex) return;
  try {
    await navigator.clipboard.writeText(hex);
    const b = document.getElementById('btn-reveal-key-copy');
    if (b) b.textContent = 'Copied';
  } catch {
    showError('reveal-key-error', 'Copy failed. Select the key manually.');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') revealSession.clear();
});
window.addEventListener('pagehide', () => revealSession.clear());
// --- Auto-lock: the background also enforces the same idle limit; this closes an idle popup that is left open.
let autoLockMinutes = normalizeAutoLockMinutes(undefined);
let lastInteractionAt = Date.now();
let lastActivityPingAt = 0;
chrome.storage.local.get([STORAGE_KEY_AUTO_LOCK_MINUTES], (r) => {
  autoLockMinutes = normalizeAutoLockMinutes(r?.[STORAGE_KEY_AUTO_LOCK_MINUTES]);
  const sel = document.getElementById('auto-lock-select') as HTMLSelectElement | null;
  if (!sel) return;
  for (const m of AUTO_LOCK_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(m);
    o.textContent = autoLockLabel(m);
    sel.appendChild(o);
  }
  sel.value = String(autoLockMinutes);
  sel.addEventListener('change', () => {
    autoLockMinutes = normalizeAutoLockMinutes(sel.value);
    chrome.storage.local.set({ [STORAGE_KEY_AUTO_LOCK_MINUTES]: autoLockMinutes });
  });
});
function noteInteraction(): void {
  const now = Date.now();
  lastInteractionAt = now;
  if (privateKey && now - lastActivityPingAt > 10_000) {
    lastActivityPingAt = now;
    chrome.runtime.sendMessage({ type: 'WALLET_ACTIVITY' }, () => void chrome.runtime.lastError);
  }
}
for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(ev, noteInteraction, { passive: true });
setInterval(() => {
  if (privateKey && isSessionExpired(lastInteractionAt, Date.now(), autoLockMinutes)) $('btn-lock').click();
}, 15_000);
$('btn-lock').addEventListener('click', () => {
  accountId = null;
  revealSession.clear();
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
    const signedHexNo0x = await buildSignedTransactionHex(tx, privateKey, await signingChainIdForRpc(net.config.rpcUrl));
    const hex = signedHexNo0x.startsWith('0x') ? signedHexNo0x : `0x${signedHexNo0x}`;
    const result = await net.submitTransaction(hex);
    if (result.success) {
      if (result.txHash) recordTx(result.txHash, 'contract_call', tx.payload.kind);
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
    errEl.textContent = describeWalletError(e);
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
    errEl.textContent = describeWalletError(err);
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
  let nftToHex: string;
  let nftToName: string | undefined;
  try {
    const r = await resolveRecipient(namesRpcUrl(), toEl.value);
    if (!r.ok) throw new Error(r.error);
    nftToHex = parseTransferRecipientHex(r.hex, accountIdToHex(accountId));
    nftToName = r.name;
  } catch (err) {
    errEl.textContent = describeWalletError(err);
    errEl.classList.remove('hidden');
    return;
  }
  const acct = accountId;
  const pk = privateKey;
  const first = targets[0]!;
  const okToSend = await confirmSendIsland({
    title: targets.length > 1 ? `Send ${targets.length} NFTs` : 'Send NFT',
    to: nftToHex,
    toName: nftToName,
    amount: targets.map((t) => `#${shortHexLabel(t.tokenIdHex, 4, 4)}`).join(', '),
    network: net,
    txCount: targets.length,
    mascotSrc: 'images/mascot-default.webp',
    buildSigned: async () => {
      if (nftToName) {
        // Re-resolve at confirm so a name re-pointed meanwhile can't redirect the NFT.
        const again = await resolveRecipient(namesRpcUrl(), nftToName);
        if (!again.ok || again.hex.toLowerCase() !== nftToHex.toLowerCase()) {
          throw new Error(`${nftToName} changed target; review the recipient again.`);
        }
      }
      return net.buildContractCall!(
        acct,
        accountIdFromHex(normalizeHex64(first.collectionHex)),
        encodeReferenceTransferNftCalldata(accountIdFromHex(nftToHex), normalizeHex64(first.tokenIdHex)),
        await net.getNonce(acct),
        pk
      );
    },
  });
  if (!okToSend) return;
  const btn = document.getElementById('btn-nft-transfer') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Transferring…';
  try {
    const result = await transferOwnedNfts({
      network: net,
      accountId,
      privateKey,
      recipientHex: nftToHex,
      targets: targets.map((t) => ({
        collectionHex: t.collectionHex,
        tokenIdHex: t.tokenIdHex,
      })),
    });
    for (const r of result.results) {
      if (r.success && r.txHash) recordTx(r.txHash, 'nft_send', `NFT ${shortHexLabel(r.tokenIdHex, 6, 4)} → ${shortHexLabel(toEl.value.replace(/^0x/i, ''), 6, 4)}`);
    }
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
    errEl.textContent = describeWalletError(err);
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

$('btn-send-max').addEventListener('click', () => {
  // Whole balance minus one transfer fee (0.021 BOING with base units), exact to the base unit.
  ($('send-amount') as HTMLInputElement).value = maxSendableInput(lastBalanceRaw, nativeDecimals);
  ($('send-amount') as HTMLInputElement).focus();
});

$('form-send').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const amountStr = ($('send-amount') as HTMLInputElement).value;
  hideError('send-error');
  ($('send-success') as HTMLElement).classList.add('hidden');
  const rpcUrlForNames = (getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog)).config.rpcUrl;
  let toName: string | undefined;
  let toHex: string;
  try {
    const r = await resolveRecipient(rpcUrlForNames, ($('send-to') as HTMLInputElement).value);
    if (!r.ok) {
      showError('send-error', r.error);
      return;
    }
    toHex = r.hex;
    toName = r.name;
  } catch (err) {
    showError('send-error', describeWalletError(err));
    return;
  }
  if (accountId && toHex.toLowerCase() === accountIdToHex(accountId).toLowerCase()) {
    showError('send-error', 'Cannot send to yourself');
    return;
  }
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, nativeDecimals) : null;
  if (amount == null || amount <= 0n) {
    showError('send-error', (nativeDecimals === 0 ? 'Enter a valid whole BOING amount (e.g. 100)' : 'Enter a valid BOING amount (e.g. 100 or 0.5)'));
    return;
  }
  if (BigInt(lastBalanceRaw) < amount) {
    showError('send-error', 'Insufficient balance');
    return;
  }
  {
    const cnet = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
    const acct = accountId;
    const pk = privateKey;
    const ok = await confirmSendIsland({
      title: 'Send BOING',
      to: toHex,
      toName,
      amount: `${amountStr.trim()} BOING`,
      network: cnet,
      mascotSrc: 'images/mascot-default.webp',
      buildSigned: async () => cnet.buildTransfer(acct, accountIdFromHex(toHex), amount, await cnet.getNonce(acct), pk),
    });
    if (!ok) return;
  }
  const sendBtn = document.getElementById('btn-send-submit') as HTMLButtonElement;
  const originalSendText = sendBtn?.textContent ?? 'Send';
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
  }
  const net = getNetwork(selectedNetworkId, networksCatalog) ?? getDefaultNetwork(networksCatalog);
  try {
    if (toName) {
      const again = await resolveRecipient(net.config.rpcUrl, toName);
      if (!again.ok || again.hex !== toHex) throw new Error(`${toName}.boing changed since review. Check the recipient.`);
    }
    const nonce = await net.getNonce(accountId);
    const toId = accountIdFromHex(toHex);
    const signedHex = await net.buildTransfer(accountId, toId, amount, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      if (result.txHash) recordTx(result.txHash, 'send', `${amountStr.trim()} BOING → ${shortHexLabel(toHex, 6, 4)}`);
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
    showError('send-error', describeWalletError(err));
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
  document.getElementById('faucet-success')?.classList.add('hidden');
  try {
    const result = await net.faucetRequest(accountId);
    if (result.success) {
      const okEl = document.getElementById('faucet-success');
      if (okEl) {
        const explorer = (net.config.explorerUrl ?? '').replace(/\/$/, '');
        okEl.replaceChildren(
          document.createTextNode(
            `${result.amount ? `${result.amount} BOING requested from the testnet faucet.` : 'Testnet BOING requested.'} It arrives with the next block (a few seconds); your balance updates automatically. `
          )
        );
        if (explorer) {
          const a = document.createElement('a');
          a.href = `${explorer}/account/${formatAddress(accountId, false)}`;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = 'View on Boing Observer';
          okEl.append(a, document.createTextNode('. '));
        }
        okEl.append(document.createTextNode(`Next: send your first transfer from the Transfer tab (network fee about ${plainTransferFeeLabel(knownLedgerDecimals(net.config.rpcUrl))}).`));
        if (result.warning) okEl.append(document.createElement('br'), document.createTextNode(`Note: ${result.warning}`));
        okEl.classList.remove('hidden');
      }
      for (const ms of [2000, 5000]) window.setTimeout(() => void refreshDashboardBalance(), ms);
      const balance = await net.getBalance(accountId);
      applyBalance(balance);
    } else {
      ($('faucet-error') as HTMLElement).textContent = result.error ?? 'Faucet failed';
      ($('faucet-error') as HTMLElement).classList.remove('hidden');
    }
  } catch (err) {
    ($('faucet-error') as HTMLElement).textContent = describeWalletError(err);
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
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, nativeDecimals) : null;
  ($('bond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('bond-error') as HTMLElement).textContent = (nativeDecimals === 0 ? 'Enter a valid whole BOING amount (e.g. 100)' : 'Enter a valid BOING amount (e.g. 100 or 0.5)');
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
    ($('bond-error') as HTMLElement).textContent = describeWalletError(err);
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
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, nativeDecimals) : null;
  ($('unbond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('unbond-error') as HTMLElement).textContent = (nativeDecimals === 0 ? 'Enter a valid whole BOING amount (e.g. 100)' : 'Enter a valid BOING amount (e.g. 100 or 0.5)');
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
    ($('unbond-error') as HTMLElement).textContent = describeWalletError(err);
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
    errEl.textContent = describeWalletError(err);
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

// --- Tx history (local, per address + network)
function txAddressHint(): string {
  if (!accountId) return '';
  const a = formatAddress(accountId, false);
  return `${a.slice(0, 8)}…${a.slice(-8)}`;
}

function recordTx(txHash: string, type: TxHistoryEntry['type'], summary?: string): void {
  addTxHistory(txAddressHint(), selectedNetworkId, txHash, type, summary);
  refreshTxHistory();
}

// Chain-backed history (boing_getAccountTransactions) merged with local entries (pending + richer summaries).
let chainTx: DisplayTxEntry[] = [];
let chainCursor: string | null = null;
let chainLoaded = false;
let chainUnsupported = false;
let chainKey = '';
let chainLoading = false;

async function loadChainHistory(cursor: string | null): Promise<void> {
  if (!accountId || chainLoading) return;
  const net = getCurrentNetwork();
  const key = `${accountIdToHex(accountId)}:${selectedNetworkId}`;
  if (key !== chainKey) {
    chainKey = key;
    chainTx = [];
    chainCursor = null;
    chainLoaded = false;
    chainUnsupported = false;
  }
  const errEl = document.getElementById('tx-history-error');
  const refreshBtn = document.getElementById('btn-tx-history-refresh') as HTMLButtonElement | null;
  chainLoading = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
  }
  errEl?.classList.add('hidden');
  try {
    const page = await fetchChainTxPage(net.config.rpcUrl, accountIdToHex(accountId), cursor, 25);
    if (key !== chainKey) return;
    if (!page) {
      chainUnsupported = true;
      chainTx = [];
      chainCursor = null;
    } else {
      chainUnsupported = false;
      // Native amounts are whole BOING before the 18-decimals switch height, base units from it.
      const nc = await fetchNativeCurrency(net.config.rpcUrl);
      const decimalsAt = nc.info ? (h: number) => ledgerDecimalsAt(nc.info, h) : () => nativeDecimals;
      const rows = page.transactions.map((r) => chainRowToDisplay(r, decimalsAt));
      if (!cursor) chainTx = rows;
      else {
        const seen = new Set(chainTx.map((e) => e.txHash));
        chainTx = [...chainTx, ...rows.filter((e) => !seen.has(e.txHash))];
      }
      chainCursor = page.next_cursor;
      chainLoaded = true;
    }
  } catch (e) {
    if (errEl) {
      errEl.textContent = `Could not load on-chain history: ${describeWalletError(e)}`;
      errEl.classList.remove('hidden');
    }
  } finally {
    chainLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
    refreshTxHistory();
  }
}

document.getElementById('btn-tx-history-refresh')?.addEventListener('click', () => void loadChainHistory(null));
document.getElementById('btn-tx-history-more')?.addEventListener('click', () => void loadChainHistory(chainCursor));

function refreshTxHistory(): void {
  const list = document.getElementById('tx-history-list');
  const empty = document.getElementById('tx-history-empty');
  const explorerLink = document.getElementById('tx-history-explorer') as HTMLAnchorElement | null;
  if (!list || !empty || !accountId) return;
  const explorer = (getCurrentNetwork().config.explorerUrl ?? '').replace(/\/$/, '');
  if (explorerLink) {
    explorerLink.classList.toggle('hidden', !explorer);
    if (explorer) explorerLink.href = `${explorer}/account/${formatAddress(accountId, false)}`;
  }
  const key = `${accountIdToHex(accountId)}:${selectedNetworkId}`;
  const sameAccount = key === chainKey;
  const entries = mergeTxHistory(getTxHistory(txAddressHint(), selectedNetworkId), sameAccount ? chainTx : [], {
    chainLoaded: sameAccount && chainLoaded,
  });
  const hint = document.getElementById('tx-history-hint');
  if (hint) {
    hint.textContent = chainUnsupported
      ? 'This node does not serve account history yet; showing transactions sent from this device.'
      : 'All transactions for this account on chain (sent, received, dApp-signed, faucet), plus pending ones from this device.';
  }
  document.getElementById('btn-tx-history-more')?.classList.toggle('hidden', !(sameAccount && chainCursor));
  list.replaceChildren();
  empty.textContent = chainLoading && !chainLoaded ? 'Loading transactions…' : 'No transactions yet.';
  empty.classList.toggle('hidden', entries.length > 0);
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'tx-history-row';
    li.setAttribute('data-testid', 'tx-history-row');
    li.setAttribute('data-status', e.status);
    li.setAttribute('data-source', e.source);
    if (e.error) li.title = e.error;
    const main = document.createElement('div');
    main.className = 'tx-history-main';
    const title = document.createElement('span');
    title.className = 'tx-history-type';
    title.textContent = e.label;
    const when = document.createElement('span');
    when.className = 'tx-history-time';
    when.textContent = [
      e.status === 'pending' ? 'Pending' : null,
      e.timestamp ? new Date(e.timestamp).toLocaleString() : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (e.status === 'failed') {
      const badge = document.createElement('span');
      badge.className = 'tx-badge-failed';
      badge.setAttribute('data-testid', 'tx-failed-badge');
      badge.textContent = 'Failed';
      title.append(' ', badge);
    }
    main.append(title, when);
    li.appendChild(main);
    if (e.summary) {
      const sum = document.createElement('div');
      sum.className = 'tx-history-summary';
      sum.textContent = e.summary;
      li.appendChild(sum);
    }
    if (e.steps && e.steps.length) {
      const det = document.createElement('details');
      det.setAttribute('data-testid', 'tx-history-steps');
      const s = document.createElement('summary');
      s.className = 'hint';
      s.textContent = `${e.steps.length} steps`;
      const ol = document.createElement('ol');
      for (const st of e.steps) {
        const item = document.createElement('li');
        item.textContent = st.replace(/^\d+\.\s*/, '');
        ol.appendChild(item);
      }
      det.append(s, ol);
      li.appendChild(det);
    }
    const hash = e.txHash.startsWith('0x') ? e.txHash : `0x${e.txHash}`;
    const link = document.createElement(explorer ? 'a' : 'code') as HTMLElement;
    link.className = 'tx-history-hash';
    link.textContent = `${hash.slice(0, 12)}…${hash.slice(-8)}`;
    if (explorer && link instanceof HTMLAnchorElement) {
      link.href = `${explorer}/tx/${hash}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    li.appendChild(link);
    list.appendChild(li);
  }
}

// --- Transfer tab: asset mode switch
type TransferMode = 'boing' | 'token' | 'nft' | 'bulk';

function setTransferMode(mode: TransferMode): void {
  document.querySelectorAll<HTMLElement>('[data-transfer-mode]').forEach((b) => {
    const on = b.dataset.transferMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  for (const m of ['boing', 'token', 'nft', 'bulk'] as const) {
    document.getElementById(`transfer-pane-${m}`)?.classList.toggle('hidden', m !== mode);
  }
  if (mode === 'nft') updateNftTransferChrome();
  if (mode === 'token') populateAssetSelects();
  if (mode === 'bulk') mountBulkIsland();
}

document.querySelectorAll<HTMLElement>('[data-transfer-mode]').forEach((b) => {
  b.addEventListener('click', () => setTransferMode(b.dataset.transferMode as TransferMode));
});

// --- Fungible tokens (Wallet list + Transfer > Token)
let tokenHoldings: TokenHolding[] = [];

async function refreshTokens(): Promise<void> {
  if (!accountId) return;
  const list = document.getElementById('token-list');
  const empty = document.getElementById('token-empty');
  const err = document.getElementById('token-error');
  if (!list || !empty) return;
  err?.classList.add('hidden');
  const ownerHex = accountIdToHex(accountId);
  try {
    const net = getCurrentNetwork();
    const watch = mergeWithDefaultTokens(await listTokenWatchlist(ownerHex, selectedNetworkId), net.config.chainId);
    const result = await loadTokenHoldings({
      rpcUrl: net.config.rpcUrl,
      ownerHex,
      watchlist: watch,
      networkId: net.config.id,
      bypassCache: true,
    });
    tokenHoldings = result.holdings;
  } catch (e) {
    tokenHoldings = [];
    if (err) {
      err.textContent = describeWalletError(e);
      err.classList.remove('hidden');
    }
  }
  list.replaceChildren();
  empty.classList.toggle('hidden', tokenHoldings.length > 0);
  if (empty && tokenHoldings.length === 0) {
    empty.textContent = 'No tokens yet';
  }
  const explorerBase = (getCurrentNetwork().config.explorerUrl ?? 'https://boing.observer').replace(/\/$/, '');
  const isTestnet = Boolean(getCurrentNetwork().config.isTestnet);
  for (const t of tokenHoldings) {
    const li = document.createElement('li');
    li.className = 'token-row';
    li.setAttribute('data-testid', 'token-row');
    const left = document.createElement('a');
    left.className = 'token-row-left';
    left.href = `${explorerBase}/asset/${t.tokenHex}?network=${isTestnet ? 'testnet' : 'mainnet'}`;
    left.target = '_blank';
    left.rel = 'noopener noreferrer';
    left.title = t.name || t.symbol;
    const sym = document.createElement('span');
    sym.className = 'token-symbol';
    sym.textContent = t.symbol;
    left.append(sym);
    const bal = document.createElement('span');
    bal.className = 'token-balance';
    bal.textContent = t.error ? 'unavailable' : t.balanceDisplay;
    if (t.error) bal.title = t.error;
    li.append(left, bal);
    if (t.watched) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn-small btn-disconnect';
      rm.textContent = '×';
      rm.setAttribute('aria-label', `Stop watching ${t.symbol}`);
      rm.addEventListener('click', async () => {
        await removeTokenWatchEntry(ownerHex, selectedNetworkId, t.tokenHex);
        void refreshTokens();
      });
      li.appendChild(rm);
    }
    list.appendChild(li);
  }
  populateAssetSelects();
}

function populateAssetSelects(): void {
  const fill = (sel: HTMLSelectElement | null, includeBoing: boolean) => {
    if (!sel) return;
    const prev = sel.value;
    sel.replaceChildren();
    if (includeBoing) sel.appendChild(new Option(`BOING · ${lastDisplayBalance}`, 'boing'));
    for (const t of tokenHoldings) {
      if (t.balanceRaw == null) continue;
      sel.appendChild(new Option(`${t.symbol} · ${t.balanceDisplay}`, t.tokenHex));
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  };
  fill(document.getElementById('token-send-asset') as HTMLSelectElement | null, false);
  const btn = document.getElementById('btn-token-send') as HTMLButtonElement | null;
  // Default tokens (USDC / BOING) are always listed; sending needs a positive balance.
  if (btn) btn.disabled = !tokenHoldings.some((t) => t.balanceRaw != null && BigInt(t.balanceRaw) > 0n);
}

document.getElementById('form-token-add')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId) return;
  hideError('token-add-error');
  const c = (document.getElementById('token-add-contract') as HTMLInputElement).value;
  const symbol = (document.getElementById('token-add-symbol') as HTMLInputElement).value.trim();
  const decRaw = (document.getElementById('token-add-decimals') as HTMLInputElement).value.trim();
  let tokenHex: string;
  try {
    tokenHex = normalizeHex64(c);
  } catch {
    showError('token-add-error', 'Token contract must be 64 hex characters.');
    return;
  }
  const decimals = decRaw === '' ? undefined : Number(decRaw);
  if (decimals != null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 38)) {
    showError('token-add-error', 'Decimals must be a whole number 0–38.');
    return;
  }
  await addTokenWatchEntry(accountIdToHex(accountId), selectedNetworkId, { tokenHex, symbol: symbol || undefined, decimals });
  (document.getElementById('token-add-contract') as HTMLInputElement).value = '';
  (document.getElementById('token-add-symbol') as HTMLInputElement).value = '';
  (document.getElementById('token-add-decimals') as HTMLInputElement).value = '';
  await refreshTokens();
});

function selectedToken(selId: string): TokenHolding | null {
  const v = (document.getElementById(selId) as HTMLSelectElement | null)?.value ?? '';
  return tokenHoldings.find((t) => t.tokenHex === v) ?? null;
}

document.getElementById('btn-token-send-max')?.addEventListener('click', () => {
  const t = selectedToken('token-send-asset');
  if (t?.balanceRaw != null) (document.getElementById('token-send-amount') as HTMLInputElement).value = formatBalance(t.balanceRaw, t.decimals, t.decimals);
});

document.getElementById('form-token-send')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  hideError('token-send-error');
  ($('token-send-success') as HTMLElement).classList.add('hidden');
  const t = selectedToken('token-send-asset');
  if (!t || t.balanceRaw == null) {
    showError('token-send-error', 'Pick a token first (add one on the Wallet tab).');
    return;
  }
  let toHex: string;
  let toName: string | undefined;
  try {
    const r = await resolveRecipient(getCurrentNetwork().config.rpcUrl, ($('token-send-to') as HTMLInputElement).value);
    if (!r.ok) {
      showError('token-send-error', r.error);
      return;
    }
    toHex = r.hex;
    toName = r.name;
  } catch (err) {
    showError('token-send-error', describeWalletError(err));
    return;
  }
  const v = validateBulkRows([{ to: toHex, amount: ($('token-send-amount') as HTMLInputElement).value }], {
    senderHex: accountIdToHex(accountId),
    decimals: t.decimals,
    balance: BigInt(t.balanceRaw),
  });
  if (!v.ok) {
    showError('token-send-error', v.issues.map((i) => i.message.replace(/^Row 1: /, '')).join(' '));
    return;
  }
  const amount = v.rows[0]!.amount;
  {
    const cnet = getCurrentNetwork();
    const acct = accountId;
    const pk = privateKey;
    const ok = await confirmSendIsland({
      title: `Send ${t.symbol}`,
      to: toHex,
      toName,
      amount: `${formatBalance(amount.toString(), t.decimals, t.decimals)} ${t.symbol}`,
      network: cnet,
      mascotSrc: 'images/mascot-default.webp',
      buildSigned: async () =>
        buildReferenceFungibleTransfer({ network: cnet, sender: acct, tokenHex: t.tokenHex, toHex, amount, nonce: await cnet.getNonce(acct), privateKey: pk }),
    });
    if (!ok) return;
  }
  const btn = $('btn-token-send') as HTMLButtonElement;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Sending…';
  try {
    const net = getCurrentNetwork();
    if (toName) {
      const again = await resolveRecipient(net.config.rpcUrl, toName);
      if (!again.ok || again.hex !== toHex) throw new Error(`${toName}.boing changed since review. Check the recipient.`);
    }
    const nonce = await net.getNonce(accountId);
    const signed = await buildReferenceFungibleTransfer({ network: net, sender: accountId, tokenHex: t.tokenHex, toHex, amount, nonce, privateKey });
    const res = await net.submitTransaction(signed);
    if (!res.success) throw new Error(res.error ?? 'Submit failed');
    if (res.txHash) recordTx(res.txHash, 'token_send', `${formatBalance(amount.toString(), t.decimals, t.decimals)} ${t.symbol} → ${shortHexLabel(toHex, 6, 4)}`);
    showSuccess('token-send-success', res.txHash ? `Sent! ${res.txHash.slice(0, 16)}…` : 'Transaction submitted');
    ($('token-send-amount') as HTMLInputElement).value = '';
    ($('token-send-to') as HTMLInputElement).value = '';
    window.setTimeout(() => void refreshTokens(), 2000);
  } catch (err) {
    showError('token-send-error', describeWalletError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = prev ?? 'Send token';
  }
});

// --- Shared React components (same as the web wallet): mixed bulk + Validator tab
function islandKey(): string {
  return `${accountId ? accountIdToHex(accountId) : 'none'}:${selectedNetworkId}`;
}

function mountBulkIsland(): void {
  const el = document.getElementById('bulk-root');
  if (!el || !accountId) return;
  const net = getCurrentNetwork();
  let balance: { value: string; decimals: number; symbol: string } | null = null;
  try {
    balance = { value: BigInt(lastBalanceRaw).toString(), decimals: nativeDecimals, symbol: 'BOING' };
  } catch {
    balance = null;
  }
  renderBulkIsland(
    el,
    {
      accountId,
      network: net,
      getPrivateKey: () => privateKey,
      balance,
      holdings: tokenHoldings,
      onRowSent: (hash, kind, summary) => {
        if (hash) recordTx(hash, kind, summary);
      },
      onBatchSent: (hash, summary, steps) => {
        if (hash) {
          addTxHistory(txAddressHint(), selectedNetworkId, hash, 'batch', summary, steps);
          refreshTxHistory();
        }
      },
      onFinished: () => {
        window.setTimeout(() => {
          void refreshDashboardBalance();
          void refreshTokens();
        }, 2000);
      },
    },
    islandKey()
  );
}

function mountValidatorIsland(): void {
  const el = document.getElementById('validator-root');
  if (!el || !accountId) return;
  renderValidatorIsland(
    el,
    {
      network: getCurrentNetwork(),
      accountId,
      getPrivateKey: () => privateKey,
      onSubmitted: (hash, type) => {
        recordTx(hash, type);
        for (const ms of [2000, 5000]) window.setTimeout(() => void refreshDashboardBalance(), ms);
      },
    },
    islandKey()
  );
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
