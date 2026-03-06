/**
 * Boing Express background service worker.
 * - Holds in-memory unlocked key when user unlocks in popup (cleared on lock).
 * - Tracks connected origins (sites allowed to see accounts / request signing).
 * - Handles EIP-1193 provider requests from content script: eth_requestAccounts, eth_accounts, personal_sign, eth_chainId, wallet_switchEthereumChain.
 */

import { signMessage } from '../src/crypto/keys';
import {
  BOING_TESTNET_CHAIN_ID,
  BOING_MAINNET_CHAIN_ID,
} from './config';

const STORAGE_KEY_WALLET = 'boing_wallet_enc';
const STORAGE_KEY_CONNECTED_SITES = 'boing_connected_sites';
const STORAGE_KEY_NETWORK = 'boing_selected_network_id';
const DEFAULT_NETWORK_ID = 'boing-testnet';

type UnlockedState = {
  accountHex: string;
  privateKey: Uint8Array;
};

let unlocked: UnlockedState | null = null;

function getAddressHexFromStorage(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_WALLET], (result) => {
      try {
        const raw = result[STORAGE_KEY_WALLET];
        if (!raw) {
          resolve(null);
          return;
        }
        const w = JSON.parse(raw) as { addressHex?: string };
        resolve(w?.addressHex ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

function getConnectedSites(): Promise<string[]> {
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

async function setConnectedSites(origins: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEY_CONNECTED_SITES]: JSON.stringify(origins) },
      resolve
    );
  });
}

async function addConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  if (sites.includes(origin)) return;
  await setConnectedSites([...sites, origin]);
}

async function removeConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  await setConnectedSites(sites.filter((o) => o !== origin));
}

function getSelectedNetworkId(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_NETWORK], (result) => {
      const id = result[STORAGE_KEY_NETWORK];
      resolve(
        id === 'boing-mainnet' || id === 'boing-testnet' ? id : DEFAULT_NETWORK_ID
      );
    });
  });
}

function chainIdForNetwork(networkId: string): string {
  return networkId === 'boing-mainnet' ? BOING_MAINNET_CHAIN_ID : BOING_TESTNET_CHAIN_ID;
}

/** Decode 0x-prefixed hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '');
  if (h.length % 2 !== 0) throw new Error('Invalid hex length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Normalize address to 0x + 64 hex (lowercase). */
function normalizeAddress(hex: string): string {
  const h = hex.replace(/^0x/i, '').toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/.test(h)) throw new Error('Invalid address');
  return '0x' + h;
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: unknown) => void
  ) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      sendResponse(undefined);
      return true;
    }

    const msg = message as { type: string; [k: string]: unknown };

    // From popup: unlock / lock
    if (msg.type === 'WALLET_UNLOCK') {
      const { accountHex, privateKey } = msg as {
        type: 'WALLET_UNLOCK';
        accountHex: string;
        privateKey: number[];
      };
      if (
        typeof accountHex === 'string' &&
        Array.isArray(privateKey) &&
        privateKey.length === 32
      ) {
        unlocked = {
          accountHex: accountHex.replace(/^0x/i, '').toLowerCase(),
          privateKey: new Uint8Array(privateKey),
        };
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'WALLET_LOCK') {
      unlocked = null;
      sendResponse({ ok: true });
      return true;
    }

    // From content script: provider request
    if (msg.type === 'BOING_PROVIDER_REQUEST') {
      const { id, method, params, origin } = msg as {
        type: 'BOING_PROVIDER_REQUEST';
        id: number | string;
        method: string;
        params: unknown[];
        origin: string;
      };
      handleProviderRequest(id, method, params ?? [], origin)
        .then((result) => sendResponse({ type: 'BOING_PROVIDER_RESPONSE', id, result, error: undefined }))
        .catch((err) =>
          sendResponse({
            type: 'BOING_PROVIDER_RESPONSE',
            id,
            result: undefined,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      return true; // keep channel open for async sendResponse
    }

    sendResponse(undefined);
    return true;
  }
);

async function handleProviderRequest(
  _id: number | string,
  method: string,
  params: unknown[],
  origin: string
): Promise<unknown> {
  const addressHex = await getAddressHexFromStorage();
  const connected = await getConnectedSites();
  const isConnected = connected.includes(origin);

  switch (method) {
    case 'eth_requestAccounts': {
      if (!addressHex) {
        throw new Error('No wallet. Create or import a wallet in Boing Express.');
      }
      await addConnectedSite(origin);
      const addr = addressHex.startsWith('0x') ? addressHex : '0x' + addressHex;
      return [addr];
    }

    case 'eth_accounts': {
      if (!isConnected || !addressHex) return [];
      const addr = addressHex.startsWith('0x') ? addressHex : '0x' + addressHex;
      return [addr];
    }

    case 'personal_sign': {
      // params: [messageHex, address] or [messageHex, address, password] (we ignore password)
      const messageHex = params[0];
      const requestedAddress = params[1];
      if (typeof messageHex !== 'string') {
        throw new Error('personal_sign: message (hex string) required');
      }
      if (!isConnected) {
        throw new Error('Site not connected. Call eth_requestAccounts first.');
      }
      if (!addressHex) {
        throw new Error('No wallet.');
      }
      const ourAddr = normalizeAddress(addressHex);
      const requested = requestedAddress != null ? normalizeAddress(String(requestedAddress)) : ourAddr;
      if (requested !== ourAddr) {
        throw new Error('Address does not match the wallet account.');
      }
      if (!unlocked) {
        throw new Error('Wallet is locked. Unlock Boing Express to sign.');
      }
      const messageBytes = hexToBytes(messageHex);
      const signature = await signMessage(messageBytes, unlocked.privateKey);
      return signature;
    }

    case 'eth_chainId': {
      const networkId = await getSelectedNetworkId();
      return chainIdForNetwork(networkId);
    }

    case 'wallet_switchEthereumChain': {
      const payload = params[0];
      const chainId =
        payload && typeof payload === 'object' && 'chainId' in payload
          ? String((payload as { chainId: string }).chainId)
          : null;
      if (!chainId) {
        throw new Error('wallet_switchEthereumChain: chainId required');
      }
      const normalized = chainId.replace(/^0x/i, '').toLowerCase();
      if (normalized === BOING_MAINNET_CHAIN_ID.replace(/^0x/i, '')) {
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: 'boing-mainnet' }, () => resolve());
        });
        return null;
      }
      if (normalized === BOING_TESTNET_CHAIN_ID.replace(/^0x/i, '')) {
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: 'boing-testnet' }, () => resolve());
        });
        return null;
      }
      throw new Error('Unsupported chain. Boing Express supports Boing Testnet and Mainnet.');
    }

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}
