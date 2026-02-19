/**
 * Boing Wallet extension popup — uses shared wallet core from src/.
 * Build with: pnpm run build:extension
 */

import {
  hasStoredWallet,
  getStoredWallet,
  unlockWallet,
  createAndSaveWallet,
  importAndSaveWallet,
  clearWallet,
} from '../src/storage/walletStore';
import { createNetworks, getNetwork, getDefaultNetwork, DEFAULT_NETWORK_ID } from '../src/networks';
import { accountIdFromHex, formatAddress } from '../src/boing/types';
import { BOING_TESTNET_RPC, BOING_MAINNET_RPC } from './config';

const NETWORKS = createNetworks(BOING_TESTNET_RPC, BOING_MAINNET_RPC);

type Screen = 'choose' | 'unlock' | 'create' | 'import' | 'dashboard';

let currentScreen: Screen = 'choose';
let accountId: Uint8Array | null = null;
let privateKey: Uint8Array | null = null;
let selectedNetworkId = DEFAULT_NETWORK_ID;

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

async function goDashboard(): Promise<void> {
  if (!accountId || !privateKey) return;
  const network = getDefaultNetwork(NETWORKS);
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? network;

  ($('address') as HTMLElement).textContent = formatAddress(accountId, false);
  ($('network-select') as HTMLSelectElement).innerHTML = NETWORKS.map(
    (n) => `<option value="${n.config.id}" ${n.config.id === selectedNetworkId ? 'selected' : ''}>${n.config.name}</option>`
  ).join('');

  try {
    const balance = await net.getBalance(accountId);
    ($('balance') as HTMLElement).textContent = (
      Number(balance.value) / 10 ** balance.decimals
    ).toLocaleString(undefined, { maximumFractionDigits: 6 });
    ($('symbol') as HTMLElement).textContent = balance.symbol;
    ($('balance-error') as HTMLElement).classList.add('hidden');
  } catch (e) {
    ($('balance') as HTMLElement).textContent = '—';
    ($('balance-error') as HTMLElement).textContent = e instanceof Error ? e.message : String(e);
    ($('balance-error') as HTMLElement).classList.remove('hidden');
  }

  showScreen('dashboard');
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
    await createAndSaveWallet(password);
    const [pub, priv] = await unlockWallet(password);
    accountId = pub;
    privateKey = priv;
    await goDashboard();
  } catch (err) {
    showError('create-error', err instanceof Error ? err.message : 'Failed to create wallet');
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
  try {
    await importAndSaveWallet(password, hex);
    const [pub, priv] = await unlockWallet(password);
    accountId = pub;
    privateKey = priv;
    await goDashboard();
  } catch (err) {
    showError('import-error', err instanceof Error ? err.message : 'Failed to import wallet');
  }
});
$('btn-import-back').addEventListener('click', () => showScreen('choose'));

// --- Dashboard
$('network-select').addEventListener('change', (e) => {
  selectedNetworkId = (e.target as HTMLSelectElement).value;
});

$('btn-lock').addEventListener('click', () => {
  accountId = null;
  privateKey = null;
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
  let amount: bigint;
  try {
    amount = BigInt(amountStr);
  } catch {
    showError('send-error', 'Invalid amount');
    return;
  }
  if (amount <= 0n) {
    showError('send-error', 'Amount must be positive');
    return;
  }
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
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
      ($('balance') as HTMLElement).textContent = (
        Number(balance.value) / 10 ** balance.decimals
      ).toLocaleString(undefined, { maximumFractionDigits: 6 });
    } else {
      showError('send-error', result.error ?? 'Submit failed');
    }
  } catch (err) {
    showError('send-error', err instanceof Error ? err.message : String(err));
  }
});

$('btn-faucet').addEventListener('click', async () => {
  if (!accountId) return;
  const net = getNetwork(selectedNetworkId, NETWORKS) ?? getDefaultNetwork(NETWORKS);
  if (!net.faucetRequest) return;
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
  }
});

$('btn-faucet-page').addEventListener('click', () => {
  if (!accountId) return;
  const addr = formatAddress(accountId, false);
  const url = `https://boing.network/network/faucet?address=${encodeURIComponent(addr)}`;
  chrome.tabs.create({ url });
});

// Init
renderChoose();
