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
  clearWallet,
} from '../src/storage/walletStore.extension';
import { createNetworks, getNetwork, getDefaultNetwork, DEFAULT_NETWORK_ID } from '../src/networks';
import { accountIdFromHex, formatAddress, accountIdToHex } from '../src/boing/types';
import { parseDecimalAmount } from '../src/boing/amount';
import { BOING_TESTNET_RPC, BOING_MAINNET_RPC } from './config';

const NETWORKS = createNetworks(BOING_TESTNET_RPC, BOING_MAINNET_RPC);
const STORAGE_KEY_NETWORK = 'boing_selected_network_id';
const STORAGE_KEY_CONNECTED_SITES = 'boing_connected_sites';
const BOING_DECIMALS = 18;

type Screen = 'choose' | 'unlock' | 'create' | 'import' | 'backup' | 'dashboard';

let currentScreen: Screen = 'choose';
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
    showScreen('unlock');
  } else {
    showScreen('choose');
  }
}

function getCurrentNetwork() {
  const network = getDefaultNetwork(NETWORKS);
  return getNetwork(selectedNetworkId, NETWORKS) ?? network;
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
    const displayStr = (
      Number(balance.value) / 10 ** balance.decimals
    ).toLocaleString(undefined, { maximumFractionDigits: 6 });
    lastDisplayBalance = displayStr;
    lastBalanceRaw = balance.value;
    ($('balance') as HTMLElement).textContent = displayStr;
    ($('symbol') as HTMLElement).textContent = balance.symbol;
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
  if (section) section.classList.toggle('hidden', !net.buildBond && !net.buildUnbond);
  if (tabBtn) tabBtn.classList.toggle('hidden', !net.buildBond && !net.buildUnbond);
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

type TabId = 'wallet' | 'stake' | 'faucet';

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
async function refreshStake(): Promise<void> {
  if (!accountId) return;
  const net = getCurrentNetwork();
  if (!net.getStake) return;
  try {
    const s = await net.getStake(accountId);
    lastStakeRaw = s;
    const displayStr = (Number(s) / 10 ** BOING_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 6 });
    ($('stake') as HTMLElement).textContent = displayStr;
  } catch {
    ($('stake') as HTMLElement).textContent = '—';
  }
}

async function goDashboard(): Promise<void> {
  if (!accountId || !privateKey) return;
  const network = getDefaultNetwork(NETWORKS);
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? network;

  ($('address') as HTMLElement).textContent = formatAddress(accountId, false);
  ($('balance') as HTMLElement).textContent = '…';
  ($('network-select') as HTMLSelectElement).innerHTML = NETWORKS.map(
    (n) => `<option value="${n.config.id}" ${n.config.id === selectedNetworkId ? 'selected' : ''}>${n.config.name}</option>`
  ).join('');

  await refreshDashboardBalance();
  await refreshStake();
  updateFaucetVisibility();
  updateStakingVisibility();
  chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: selectedNetworkId });
  showScreen('dashboard');
  switchTab('wallet');
  refreshConnectedSites();
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
    const { privateKeyHex } = await createAndSaveWallet(password);
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
$('btn-create-back').addEventListener('click', () => showScreen('choose'));

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
    await importAndSaveWallet(password, hex);
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
    showError('import-error', err instanceof Error ? err.message : 'Failed to import wallet');
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.textContent = originalImportText;
    }
  }
});
$('btn-import-back').addEventListener('click', () => showScreen('choose'));

// --- Dashboard
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabId = (btn as HTMLElement).getAttribute('data-tab');
    if (tabId === 'wallet' || tabId === 'stake' || tabId === 'faucet') switchTab(tabId);
  });
});

$('network-select').addEventListener('change', (e) => {
  selectedNetworkId = (e.target as HTMLSelectElement).value;
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

$('btn-copy').addEventListener('click', async () => {
  if (!accountId) return;
  const addr = formatAddress(accountId, false);
  await navigator.clipboard.writeText(addr);
  const btn = $('btn-copy');
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
  const explorerLink = document.getElementById('send-explorer-link') as HTMLAnchorElement;
  if (explorerLink) explorerLink.classList.add('hidden');
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
    showError('send-error', 'Enter a valid amount in BOING (e.g. 1 or 0.5)');
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
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
  try {
    const nonce = await net.getNonce(accountId);
    const toId = accountIdFromHex(toHex);
    const signedHex = await net.buildTransfer(accountId, toId, amount, nonce, privateKey);
    const result = await net.submitTransaction(signedHex);
    if (result.success) {
      showSuccess('send-success', result.txHash ? `Sent! ${result.txHash.slice(0, 16)}…` : 'Transaction submitted');
      const baseUrl = net.config.explorerUrl;
      if (result.txHash && baseUrl && explorerLink) {
        explorerLink.href = `${baseUrl.replace(/\/$/, '')}/tx/${result.txHash}`;
        explorerLink.classList.remove('hidden');
      }
      ($('send-amount') as HTMLInputElement).value = '';
      ($('send-to') as HTMLInputElement).value = '';
      const balance = await net.getBalance(accountId);
      ($('balance') as HTMLElement).textContent = (
        Number(balance.value) / 10 ** balance.decimals
      ).toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
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
      ($('balance') as HTMLElement).textContent = (
        Number(balance.value) / 10 ** balance.decimals
      ).toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  const url = `https://boing.network/network/faucet?address=${encodeURIComponent(addr)}`;
  window.open(url, '_blank');
});

$('btn-balance-retry').addEventListener('click', () => refreshDashboardBalance());

$('form-bond').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!accountId || !privateKey) return;
  const amountStr = ($('bond-amount') as HTMLInputElement).value;
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
  if (!net.buildBond) return;
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, BOING_DECIMALS) : null;
  ($('bond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('bond-error') as HTMLElement).textContent = 'Enter a valid amount in BOING';
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
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
  if (!net.buildUnbond) return;
  const amount = amountStr.trim() ? parseDecimalAmount(amountStr, BOING_DECIMALS) : null;
  ($('unbond-error') as HTMLElement).classList.add('hidden');
  if (amount == null || amount <= 0n) {
    ($('unbond-error') as HTMLElement).textContent = 'Enter a valid amount in BOING';
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

// Init: show loading, restore saved network, load wallet from chrome.storage.local, then show choose/unlock
showLoading();
chrome.storage.local.get([STORAGE_KEY_NETWORK], (result) => {
  const saved = result[STORAGE_KEY_NETWORK];
  if (saved && NETWORKS.some((n) => n.config.id === saved)) selectedNetworkId = saved;
  initExtensionWalletStorage().then(() => renderChoose());
});
