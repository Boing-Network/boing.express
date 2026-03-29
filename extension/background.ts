/**
 * Boing Express background service worker.
 * - Keeps the unlocked key in extension session storage so MV3 worker restarts do not break signing.
 * - Tracks connected origins (sites allowed to see accounts / request signing).
 * - Enforces per-signature approval.
 * - Broadcasts provider events to connected pages.
 */

import { signMessage } from '../src/crypto/keys';
import { buildSignedTransactionHex } from '../src/boing/signing';
import { accountIdFromHex } from '../src/boing/types';
import {
  assertFromMatchesSender,
  transactionFromDappJson,
  transactionSummary,
} from '../src/boing/dappTxRequest';
import {
  getAccount,
  getNonce,
  RpcClientError,
  simulateTransaction,
  submitTransaction,
} from '../src/boing/rpc';
import {
  BOING_MAINNET_CHAIN_ID,
  BOING_MAINNET_NETWORK_ID,
  BOING_MAINNET_RPC,
  BOING_TESTNET_CHAIN_ID,
  BOING_TESTNET_NETWORK_ID,
  BOING_TESTNET_RPC,
  isBoingMainnetConfigured,
  normalizeBoingNetworkId,
} from './config';

const STORAGE_KEY_WALLET = 'boing_wallet_enc';
const STORAGE_KEY_CONNECTED_SITES = 'boing_connected_sites';
const STORAGE_KEY_NETWORK = 'boing_selected_network_id';
const STORAGE_KEY_UNLOCKED_SESSION = 'boing_unlocked_session';
const DEFAULT_NETWORK_ID = BOING_TESTNET_NETWORK_ID;
const APPROVAL_WINDOW_WIDTH = 420;
const APPROVAL_WINDOW_HEIGHT = 640;
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;
const PENDING_UNLOCK_TIMEOUT_MS = 2 * 60 * 1000;

type PendingUnlockItem = {
  id: number | string;
  method: string;
  params: unknown[];
  origin: string;
  sendResponse: (response: object) => void;
  timeoutId: number;
};

const BOING_METHODS = {
  REQUEST_ACCOUNTS: 'boing_requestAccounts',
  ACCOUNTS: 'boing_accounts',
  SIGN_MESSAGE: 'boing_signMessage',
  SIGN_TRANSACTION: 'boing_signTransaction',
  SEND_TRANSACTION: 'boing_sendTransaction',
  CHAIN_ID: 'boing_chainId',
  SWITCH_CHAIN: 'boing_switchChain',
} as const;

const METHOD_ALIASES: Record<string, string> = {
  eth_requestAccounts: BOING_METHODS.REQUEST_ACCOUNTS,
  eth_accounts: BOING_METHODS.ACCOUNTS,
  personal_sign: BOING_METHODS.SIGN_MESSAGE,
  eth_chainId: BOING_METHODS.CHAIN_ID,
  wallet_switchEthereumChain: BOING_METHODS.SWITCH_CHAIN,
};

const PROVIDER_ERROR_CODES = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  UNSUPPORTED_CHAIN: 4901,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type UnlockedState = {
  accountHex: string;
  privateKey: Uint8Array;
};

type ProviderEventMessage =
  | { type: 'BOING_PROVIDER_EVENT'; event: 'accountsChanged'; payload: { accounts: string[]; origins?: string[] } }
  | { type: 'BOING_PROVIDER_EVENT'; event: 'chainChanged'; payload: { chainId: string } }
  | { type: 'BOING_PROVIDER_EVENT'; event: 'disconnect'; payload: { origins?: string[]; code?: number; message: string } };

type PendingSignatureApproval = {
  requestId: string;
  origin: string;
  chainId: string;
  address: string;
  message: string;
  resolve: () => void;
  reject: (error: BoingProviderError) => void;
  timeoutId: number;
  windowId?: number;
};

type ApprovalRecord = Pick<PendingSignatureApproval, 'requestId' | 'origin' | 'chainId' | 'address' | 'message'>;

class BoingProviderError extends Error {
  code: number;
  data: { boingCode: string };

  constructor(code: number, boingCode: string, message: string) {
    super(message);
    this.code = code;
    this.data = { boingCode };
    this.name = 'BoingProviderError';
  }
}

/** Thrown when a request is queued for after-unlock; listener must not call sendResponse. */
class QueuedForUnlock extends Error {
  constructor() {
    super('Queued for unlock');
    this.name = 'QueuedForUnlock';
  }
}

let unlocked: UnlockedState | null = null;
let nextApprovalId = 1;
let unlockWindowId: number | null = null;
const pendingUnlockQueue: PendingUnlockItem[] = [];

const pendingSignatureApprovals = new Map<string, PendingSignatureApproval>();
const approvalRequestIdsByWindowId = new Map<number, string>();

function providerError(code: number, boingCode: string, message: string): BoingProviderError {
  return new BoingProviderError(code, boingCode, message);
}

function persistUnlockedSession(state: UnlockedState | null): Promise<void> {
  return new Promise((resolve) => {
    if (!chrome.storage.session) {
      resolve();
      return;
    }
    if (!state) {
      chrome.storage.session.remove([STORAGE_KEY_UNLOCKED_SESSION], () => resolve());
      return;
    }
    chrome.storage.session.set(
      {
        [STORAGE_KEY_UNLOCKED_SESSION]: {
          accountHex: state.accountHex,
          privateKey: Array.from(state.privateKey),
        },
      },
      () => resolve()
    );
  });
}

async function getUnlockedState(): Promise<UnlockedState | null> {
  if (unlocked) return unlocked;
  if (!chrome.storage.session) return null;

  return new Promise((resolve) => {
    chrome.storage.session.get([STORAGE_KEY_UNLOCKED_SESSION], (result) => {
      const raw = result[STORAGE_KEY_UNLOCKED_SESSION];
      if (
        raw &&
        typeof raw === 'object' &&
        typeof raw.accountHex === 'string' &&
        Array.isArray(raw.privateKey) &&
        raw.privateKey.length === 32
      ) {
        unlocked = {
          accountHex: raw.accountHex.replace(/^0x/i, '').toLowerCase(),
          privateKey: new Uint8Array(raw.privateKey),
        };
        resolve(unlocked);
        return;
      }
      resolve(null);
    });
  });
}

function serializeProviderError(error: unknown): { code: number; message: string; data: { boingCode: string } } {
  if (error instanceof BoingProviderError) {
    return { code: error.code, message: error.message, data: error.data };
  }
  if (error instanceof Error) {
    return {
      code: PROVIDER_ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
      data: { boingCode: 'BOING_INTERNAL_ERROR' },
    };
  }
  return {
    code: PROVIDER_ERROR_CODES.INTERNAL_ERROR,
    message: 'Internal wallet error.',
    data: { boingCode: 'BOING_INTERNAL_ERROR' },
  };
}

function getAddressHexFromStorage(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_WALLET], (result) => {
      try {
        const raw = result[STORAGE_KEY_WALLET];
        if (!raw) {
          resolve(null);
          return;
        }
        const parsed = JSON.parse(raw) as { addressHex?: string };
        resolve(parsed.addressHex ?? null);
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
        const parsed = JSON.parse(raw) as unknown;
        resolve(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function setConnectedSites(origins: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_CONNECTED_SITES]: JSON.stringify(origins) }, resolve);
  });
}

async function addConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  if (!sites.includes(origin)) {
    await setConnectedSites([...sites, origin]);
  }
}

function getSelectedNetworkId(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_NETWORK], (result) => {
      const value = result[STORAGE_KEY_NETWORK];
      resolve(normalizeBoingNetworkId(typeof value === 'string' ? value : DEFAULT_NETWORK_ID));
    });
  });
}

function chainIdForNetwork(networkId: string): string {
  return networkId === BOING_MAINNET_NETWORK_ID ? BOING_MAINNET_CHAIN_ID : BOING_TESTNET_CHAIN_ID;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/^0x/i, '');
  if (normalized.length % 2 !== 0) {
    throw providerError(PROVIDER_ERROR_CODES.INVALID_PARAMS, 'BOING_INVALID_HEX', 'Invalid hex length.');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function messageToBytes(message: unknown): Uint8Array {
  if (typeof message !== 'string') {
    throw providerError(
      PROVIDER_ERROR_CODES.INVALID_PARAMS,
      'BOING_INVALID_MESSAGE',
      'boing_signMessage requires a UTF-8 string or 0x-prefixed hex string.'
    );
  }
  const trimmed = message.trim();
  if (trimmed.startsWith('0x') && /^0x[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 2) {
    return hexToBytes(trimmed);
  }
  return new TextEncoder().encode(message);
}

function normalizeAddress(hex: string): string {
  const normalized = hex.replace(/^0x/i, '').toLowerCase();
  if (normalized.length !== 64 || !/^[0-9a-f]+$/.test(normalized)) {
    throw providerError(PROVIDER_ERROR_CODES.INVALID_PARAMS, 'BOING_ADDRESS_MISMATCH', 'Address must be 0x + 64 hex characters.');
  }
  return '0x' + normalized;
}

async function rpcUrlForSelectedNetwork(): Promise<string> {
  const networkId = await getSelectedNetworkId();
  if (networkId === BOING_MAINNET_NETWORK_ID && isBoingMainnetConfigured()) {
    return BOING_MAINNET_RPC;
  }
  return BOING_TESTNET_RPC;
}

async function signOrSendBoingTransaction(
  method: string,
  params: unknown[],
  origin: string,
  unlockedState: UnlockedState,
  addressHex: string
): Promise<unknown> {
  const connectedOrigins = await getConnectedSites();
  if (!connectedOrigins.includes(origin)) {
    throw providerError(
      PROVIDER_ERROR_CODES.UNAUTHORIZED,
      'BOING_ORIGIN_NOT_CONNECTED',
      'Origin is not connected. Call boing_requestAccounts first.'
    );
  }
  const txReq = params[0];
  if (txReq == null || typeof txReq !== 'object') {
    throw providerError(
      PROVIDER_ERROR_CODES.INVALID_PARAMS,
      'BOING_INVALID_TX',
      'Pass one argument: a transaction object (type: transfer | bond | unbond | contract_call | contract_deploy_purpose | contract_deploy_meta | …). Deployments must declare a valid purpose_category (protocol QA).'
    );
  }

  const normalizedAddr = normalizeAddress(addressHex.startsWith('0x') ? addressHex : '0x' + addressHex);
  assertFromMatchesSender(txReq, normalizedAddr.slice(2));

  const sender = accountIdFromHex(normalizedAddr);
  const rpcUrl = await rpcUrlForSelectedNetwork();
  const hexForRpc = normalizedAddr;

  const req = txReq as Record<string, unknown>;
  const hasExplicitNonce =
    Object.prototype.hasOwnProperty.call(req, 'nonce') &&
    req.nonce !== undefined &&
    req.nonce !== null &&
    String(req.nonce).trim() !== '';

  let nonceDefault = 0n;
  if (!hasExplicitNonce) {
    try {
      const acc = await getAccount(rpcUrl, hexForRpc);
      nonceDefault = BigInt(acc.nonce);
    } catch {
      try {
        nonceDefault = await getNonce(rpcUrl, hexForRpc);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw providerError(PROVIDER_ERROR_CODES.INTERNAL_ERROR, 'BOING_RPC_NONCE', `Could not load nonce: ${msg}`);
      }
    }
  }

  const tx = transactionFromDappJson(txReq, sender, nonceDefault);
  const networkId = await getSelectedNetworkId();
  const chainId = chainIdForNetwork(networkId);

  await requestSignatureApproval({
    origin,
    chainId,
    address: normalizedAddr,
    message: transactionSummary(tx),
  });

  const signedHexNoPrefix = await buildSignedTransactionHex(tx, unlockedState.privateKey);
  const rpcHex = signedHexNoPrefix.startsWith('0x') ? signedHexNoPrefix : `0x${signedHexNoPrefix}`;

  const isSend = method === BOING_METHODS.SEND_TRANSACTION;
  if (!isSend) {
    return rpcHex;
  }

  try {
    try {
      const sim = (await simulateTransaction(rpcUrl, rpcHex)) as { success?: boolean; error?: string };
      if (sim && typeof sim === 'object' && sim.success === false) {
        throw providerError(
          PROVIDER_ERROR_CODES.INTERNAL_ERROR,
          'BOING_SIMULATION_FAILED',
          sim.error ?? 'Simulation reported failure.'
        );
      }
    } catch (e) {
      if (e instanceof BoingProviderError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      const notFound =
        msg.includes('Method not found') ||
        msg.includes('-32601') ||
        (e instanceof RpcClientError && e.code === -32601);
      if (!notFound) {
        throw providerError(PROVIDER_ERROR_CODES.INTERNAL_ERROR, 'BOING_SIMULATION_ERROR', msg);
      }
    }

    return await submitTransaction(rpcUrl, rpcHex);
  } catch (e) {
    if (e instanceof BoingProviderError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw providerError(PROVIDER_ERROR_CODES.INTERNAL_ERROR, 'BOING_SUBMIT_FAILED', msg);
  }
}

function broadcastProviderEvent(message: ProviderEventMessage): void {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Ignore broadcast failures when no extension contexts are listening.
  }
}

function toApprovalRecord(pending: PendingSignatureApproval): ApprovalRecord {
  return {
    requestId: pending.requestId,
    origin: pending.origin,
    chainId: pending.chainId,
    address: pending.address,
    message: pending.message,
  };
}

function clearPendingApproval(requestId: string): PendingSignatureApproval | null {
  const pending = pendingSignatureApprovals.get(requestId);
  if (!pending) return null;
  pendingSignatureApprovals.delete(requestId);
  clearTimeout(pending.timeoutId);
  if (pending.windowId != null) {
    approvalRequestIdsByWindowId.delete(pending.windowId);
  }
  return pending;
}

function rejectPendingApproval(requestId: string, error: BoingProviderError): void {
  const pending = clearPendingApproval(requestId);
  if (!pending) return;
  if (pending.windowId != null) {
    chrome.windows.remove(pending.windowId, () => {
      void chrome.runtime.lastError;
    });
  }
  pending.reject(error);
}

function rejectPendingUnlockItem(item: PendingUnlockItem, error: BoingProviderError): void {
  clearTimeout(item.timeoutId);
  try {
    item.sendResponse({
      type: 'BOING_PROVIDER_RESPONSE',
      id: item.id,
      result: undefined,
      error: serializeProviderError(error),
    });
  } catch {
    // sendResponse may be invalid if context disconnected
  }
}

function rejectAllPendingUnlockRequests(reason: BoingProviderError): void {
  while (pendingUnlockQueue.length > 0) {
    const item = pendingUnlockQueue.shift();
    if (item) rejectPendingUnlockItem(item, reason);
  }
  unlockWindowId = null;
}

function openUnlockWindow(pendingAction?: 'connect' | 'sign'): void {
  if (unlockWindowId != null) return;
  const qs = pendingAction ? `?pending=${pendingAction}` : '';
  chrome.windows.create(
    {
      url: chrome.runtime.getURL('popup.html' + qs),
      type: 'popup',
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
    },
    (createdWindow) => {
      if (createdWindow?.id != null) {
        unlockWindowId = createdWindow.id;
      }
    }
  );
}

async function processPendingUnlockQueue(): Promise<void> {
  const addressHex = await getAddressHexFromStorage();
  const account = addressHex ? (addressHex.startsWith('0x') ? addressHex : '0x' + addressHex) : null;
  const unlockedState = await getUnlockedState();

  while (pendingUnlockQueue.length > 0 && unlockedState) {
    const item = pendingUnlockQueue.shift();
    if (!item) break;

    clearTimeout(item.timeoutId);

    const sendResp = (result: unknown, error?: { code: number; message: string; data: { boingCode: string } }) => {
      try {
        item.sendResponse({
          type: 'BOING_PROVIDER_RESPONSE',
          id: item.id,
          result: error ? undefined : result,
          error,
        });
      } catch {
        // ignore
      }
    };

    if (item.method === BOING_METHODS.REQUEST_ACCOUNTS || (METHOD_ALIASES[item.method] === BOING_METHODS.REQUEST_ACCOUNTS)) {
      if (!account) {
        sendResp(undefined, serializeProviderError(providerError(PROVIDER_ERROR_CODES.UNAUTHORIZED, 'BOING_NO_WALLET', 'No wallet found.')));
      } else {
        await addConnectedSite(item.origin);
        broadcastProviderEvent({
          type: 'BOING_PROVIDER_EVENT',
          event: 'accountsChanged',
          payload: { accounts: [account], origins: [item.origin] },
        });
        sendResp([account]);
      }
      continue;
    }

    if (item.method === BOING_METHODS.SIGN_MESSAGE || METHOD_ALIASES[item.method] === BOING_METHODS.SIGN_MESSAGE) {
      const messageParam = item.params[0];
      const requestedAddress = item.params[1];
      try {
        if (messageParam === undefined || messageParam === null) {
          sendResp(undefined, serializeProviderError(providerError(PROVIDER_ERROR_CODES.INVALID_PARAMS, 'BOING_INVALID_MESSAGE', 'boing_signMessage requires a message string.')));
          continue;
        }
        if (!addressHex) {
          sendResp(undefined, serializeProviderError(providerError(PROVIDER_ERROR_CODES.UNAUTHORIZED, 'BOING_NO_WALLET', 'No wallet found.')));
          continue;
        }
        const activeAddress = normalizeAddress(addressHex);
        const requested = requestedAddress != null ? normalizeAddress(String(requestedAddress)) : activeAddress;
        if (requested !== activeAddress) {
          sendResp(undefined, serializeProviderError(providerError(PROVIDER_ERROR_CODES.INVALID_PARAMS, 'BOING_ADDRESS_MISMATCH', 'Requested address does not match the active wallet account.')));
          continue;
        }
        const networkId = await getSelectedNetworkId();
        const chainId = chainIdForNetwork(networkId);
        const message = typeof messageParam === 'string' ? messageParam : String(messageParam);
        await requestSignatureApproval({
          origin: item.origin,
          chainId,
          address: activeAddress,
          message,
        });
        const messageBytes = messageToBytes(messageParam);
        const signature = signMessage(messageBytes, unlockedState.privateKey);
        sendResp(signature);
      } catch (err) {
        sendResp(undefined, serializeProviderError(err instanceof BoingProviderError ? err : providerError(PROVIDER_ERROR_CODES.INTERNAL_ERROR, 'BOING_INTERNAL_ERROR', err instanceof Error ? err.message : 'Sign failed.')));
      }
      continue;
    }

    if (item.method === BOING_METHODS.SIGN_TRANSACTION || item.method === BOING_METHODS.SEND_TRANSACTION) {
      try {
        if (!addressHex) {
          sendResp(undefined, serializeProviderError(providerError(PROVIDER_ERROR_CODES.UNAUTHORIZED, 'BOING_NO_WALLET', 'No wallet found.')));
          continue;
        }
        const result = await signOrSendBoingTransaction(
          item.method,
          item.params,
          item.origin,
          unlockedState,
          addressHex
        );
        sendResp(result);
      } catch (err) {
        sendResp(
          undefined,
          serializeProviderError(
            err instanceof BoingProviderError
              ? err
              : providerError(
                  PROVIDER_ERROR_CODES.INTERNAL_ERROR,
                  'BOING_INTERNAL_ERROR',
                  err instanceof Error ? err.message : 'Transaction failed.'
                )
          )
        );
      }
      continue;
    }
  }
}

function resolvePendingApproval(requestId: string): void {
  const pending = clearPendingApproval(requestId);
  if (!pending) return;
  if (pending.windowId != null) {
    chrome.windows.remove(pending.windowId, () => {
      void chrome.runtime.lastError;
    });
  }
  pending.resolve();
}

async function requestSignatureApproval(data: { origin: string; chainId: string; address: string; message: string }): Promise<void> {
  const requestId = `sign-${Date.now()}-${nextApprovalId++}`;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      rejectPendingApproval(
        requestId,
        providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_SIGNATURE_APPROVAL_TIMEOUT', 'Signature approval timed out.')
      );
    }, APPROVAL_TIMEOUT_MS) as unknown as number;

    pendingSignatureApprovals.set(requestId, {
      requestId,
      origin: data.origin,
      chainId: data.chainId,
      address: data.address,
      message: data.message,
      resolve,
      reject,
      timeoutId,
    });

    chrome.windows.create(
      {
        url: chrome.runtime.getURL(`approval.html?requestId=${encodeURIComponent(requestId)}`),
        type: 'popup',
        width: APPROVAL_WINDOW_WIDTH,
        height: APPROVAL_WINDOW_HEIGHT,
      },
      (createdWindow) => {
        if (chrome.runtime.lastError || !createdWindow?.id) {
          rejectPendingApproval(
            requestId,
            providerError(
              PROVIDER_ERROR_CODES.INTERNAL_ERROR,
              'BOING_APPROVAL_UI_UNAVAILABLE',
              'Unable to open the signature approval window.'
            )
          );
          return;
        }
        const pending = pendingSignatureApprovals.get(requestId);
        if (!pending) return;
        pending.windowId = createdWindow.id;
        approvalRequestIdsByWindowId.set(createdWindow.id, requestId);
      }
    );
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === unlockWindowId) {
    rejectAllPendingUnlockRequests(
      providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_USER_REJECTED', 'Wallet window closed. Unlock Boing Express to connect or sign.')
    );
    return;
  }
  const requestId = approvalRequestIdsByWindowId.get(windowId);
  if (!requestId) return;
  rejectPendingApproval(
    requestId,
    providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_USER_REJECTED_SIGNING', 'User rejected signing request.')
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[STORAGE_KEY_NETWORK]) {
    const newValue = changes[STORAGE_KEY_NETWORK].newValue;
    const networkId = normalizeBoingNetworkId(typeof newValue === 'string' ? newValue : DEFAULT_NETWORK_ID);
    broadcastProviderEvent({
      type: 'BOING_PROVIDER_EVENT',
      event: 'chainChanged',
      payload: { chainId: chainIdForNetwork(networkId) },
    });
  }

  if (changes[STORAGE_KEY_CONNECTED_SITES]) {
    let oldOrigins: string[] = [];
    let newOrigins: string[] = [];
    try {
      oldOrigins = changes[STORAGE_KEY_CONNECTED_SITES].oldValue ? JSON.parse(changes[STORAGE_KEY_CONNECTED_SITES].oldValue) : [];
      newOrigins = changes[STORAGE_KEY_CONNECTED_SITES].newValue ? JSON.parse(changes[STORAGE_KEY_CONNECTED_SITES].newValue) : [];
    } catch {
      oldOrigins = [];
      newOrigins = [];
    }
    const removedOrigins = oldOrigins.filter((origin) => !newOrigins.includes(origin));
    if (removedOrigins.length > 0) {
      broadcastProviderEvent({
        type: 'BOING_PROVIDER_EVENT',
        event: 'accountsChanged',
        payload: { accounts: [], origins: removedOrigins },
      });
      broadcastProviderEvent({
        type: 'BOING_PROVIDER_EVENT',
        event: 'disconnect',
        payload: { origins: removedOrigins, code: PROVIDER_ERROR_CODES.UNAUTHORIZED, message: 'Site disconnected in Boing Express.' },
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    sendResponse(undefined);
    return true;
  }

  const msg = message as { type: string; [key: string]: unknown };

  if (msg.type === 'WALLET_UNLOCK') {
    const accountHex = typeof msg.accountHex === 'string' ? msg.accountHex : null;
    const privateKey = Array.isArray(msg.privateKey) ? msg.privateKey : null;
    if (accountHex && privateKey && privateKey.length === 32) {
      unlocked = {
        accountHex: accountHex.replace(/^0x/i, '').toLowerCase(),
        privateKey: new Uint8Array(privateKey),
      };
      persistUnlockedSession(unlocked).then(() => getConnectedSites()).then((origins) => {
        if (origins.length > 0) {
          broadcastProviderEvent({
            type: 'BOING_PROVIDER_EVENT',
            event: 'accountsChanged',
            payload: { accounts: ['0x' + unlocked!.accountHex], origins },
          });
        }
      });
      unlockWindowId = null;
      processPendingUnlockQueue();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'WALLET_LOCK') {
    unlocked = null;
    persistUnlockedSession(null).then(() => getConnectedSites()).then((origins) => {
      if (origins.length > 0) {
        broadcastProviderEvent({
          type: 'BOING_PROVIDER_EVENT',
          event: 'accountsChanged',
          payload: { accounts: [], origins },
        });
        broadcastProviderEvent({
          type: 'BOING_PROVIDER_EVENT',
          event: 'disconnect',
          payload: { origins, code: PROVIDER_ERROR_CODES.UNAUTHORIZED, message: 'Wallet locked in Boing Express.' },
        });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_SESSION_RESTORE') {
    getUnlockedState().then((state) => {
      if (state && state.accountHex && state.privateKey && state.privateKey.length === 32) {
        sendResponse({
          unlocked: true,
          accountHex: state.accountHex,
          privateKey: Array.from(state.privateKey),
        });
      } else {
        sendResponse({ unlocked: false });
      }
    });
    return true;
  }

  if (msg.type === 'GET_SIGN_APPROVAL') {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
    const pending = pendingSignatureApprovals.get(requestId);
    sendResponse({ ok: !!pending, approval: pending ? toApprovalRecord(pending) : null });
    return true;
  }

  if (msg.type === 'RESOLVE_SIGN_APPROVAL') {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
    const approved = msg.approved === true;
    if (approved) {
      resolvePendingApproval(requestId);
    } else {
      rejectPendingApproval(
        requestId,
        providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_USER_REJECTED_SIGNING', 'User rejected signing request.')
      );
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'BOING_PROVIDER_REQUEST') {
    const id = msg.id as number | string;
    const method = typeof msg.method === 'string' ? msg.method : '';
    const params = Array.isArray(msg.params) ? msg.params : [];
    const origin = typeof msg.origin === 'string' ? msg.origin : '';
    handleProviderRequest(id, method, params, origin, sendResponse)
      .then((result) => sendResponse({ type: 'BOING_PROVIDER_RESPONSE', id, result, error: undefined }))
      .catch((error) => {
        if (error instanceof QueuedForUnlock) return;
        sendResponse({ type: 'BOING_PROVIDER_RESPONSE', id, result: undefined, error: serializeProviderError(error) });
      });
    return true;
  }

  sendResponse(undefined);
  return true;
});

async function handleProviderRequest(
  id: number | string,
  method: string,
  params: unknown[],
  origin: string,
  sendResponse: (response: object) => void
): Promise<unknown> {
  const normalizedMethod = METHOD_ALIASES[method] ?? method;
  const addressHex = await getAddressHexFromStorage();
  const connectedOrigins = await getConnectedSites();
  const isConnected = connectedOrigins.includes(origin);

  switch (normalizedMethod) {
    case BOING_METHODS.REQUEST_ACCOUNTS: {
      if (!addressHex) {
        throw providerError(
          PROVIDER_ERROR_CODES.UNAUTHORIZED,
          'BOING_NO_WALLET',
          'No wallet found. Create or import a wallet in Boing Express.'
        );
      }
      const unlockedState = await getUnlockedState();
      if (!unlockedState) {
        openUnlockWindow('connect');
        const timeoutId = setTimeout(() => {
          const idx = pendingUnlockQueue.findIndex((p) => p.id === id);
          if (idx !== -1) {
            const [item] = pendingUnlockQueue.splice(idx, 1);
            rejectPendingUnlockItem(
              item,
              providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_UNLOCK_TIMEOUT', 'Unlock timed out. Please try again.')
            );
          }
        }, PENDING_UNLOCK_TIMEOUT_MS) as unknown as number;
        pendingUnlockQueue.push({ id, method, params, origin, sendResponse, timeoutId });
        throw new QueuedForUnlock();
      }
      await addConnectedSite(origin);
      const account = addressHex.startsWith('0x') ? addressHex : '0x' + addressHex;
      broadcastProviderEvent({
        type: 'BOING_PROVIDER_EVENT',
        event: 'accountsChanged',
        payload: { accounts: [account], origins: [origin] },
      });
      return [account];
    }

    case BOING_METHODS.ACCOUNTS: {
      const unlockedState = await getUnlockedState();
      if (!unlockedState || !isConnected || !addressHex) return [];
      return [addressHex.startsWith('0x') ? addressHex : '0x' + addressHex];
    }

    case BOING_METHODS.SIGN_MESSAGE: {
      const messageParam = params[0];
      const requestedAddress = params[1];
      if (messageParam === undefined || messageParam === null) {
        throw providerError(
          PROVIDER_ERROR_CODES.INVALID_PARAMS,
          'BOING_INVALID_MESSAGE',
          'boing_signMessage requires a message string.'
        );
      }
      if (!isConnected) {
        throw providerError(
          PROVIDER_ERROR_CODES.UNAUTHORIZED,
          'BOING_ORIGIN_NOT_CONNECTED',
          'Origin is not connected. Call boing_requestAccounts first.'
        );
      }
      if (!addressHex) {
        throw providerError(
          PROVIDER_ERROR_CODES.UNAUTHORIZED,
          'BOING_NO_WALLET',
          'No wallet found. Create or import a wallet in Boing Express.'
        );
      }
      const unlockedState = await getUnlockedState();
      if (!unlockedState) {
        openUnlockWindow('sign');
        const timeoutId = setTimeout(() => {
          const idx = pendingUnlockQueue.findIndex((p) => p.id === id);
          if (idx !== -1) {
            const [item] = pendingUnlockQueue.splice(idx, 1);
            rejectPendingUnlockItem(
              item,
              providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_UNLOCK_TIMEOUT', 'Unlock timed out. Please try again.')
            );
          }
        }, PENDING_UNLOCK_TIMEOUT_MS) as unknown as number;
        pendingUnlockQueue.push({ id, method, params, origin, sendResponse, timeoutId });
        throw new QueuedForUnlock();
      }
      const activeAddress = normalizeAddress(addressHex);
      const requested = requestedAddress != null ? normalizeAddress(String(requestedAddress)) : activeAddress;
      if (requested !== activeAddress) {
        throw providerError(
          PROVIDER_ERROR_CODES.INVALID_PARAMS,
          'BOING_ADDRESS_MISMATCH',
          'Requested address does not match the active wallet account.'
        );
      }

      const networkId = await getSelectedNetworkId();
      const chainId = chainIdForNetwork(networkId);
      const message = typeof messageParam === 'string' ? messageParam : String(messageParam);
      await requestSignatureApproval({
        origin,
        chainId,
        address: activeAddress,
        message,
      });

      const messageBytes = messageToBytes(messageParam);
      return signMessage(messageBytes, unlockedState.privateKey);
    }

    case BOING_METHODS.SIGN_TRANSACTION:
    case BOING_METHODS.SEND_TRANSACTION: {
      if (!isConnected) {
        throw providerError(
          PROVIDER_ERROR_CODES.UNAUTHORIZED,
          'BOING_ORIGIN_NOT_CONNECTED',
          'Origin is not connected. Call boing_requestAccounts first.'
        );
      }
      if (!addressHex) {
        throw providerError(
          PROVIDER_ERROR_CODES.UNAUTHORIZED,
          'BOING_NO_WALLET',
          'No wallet found. Create or import a wallet in Boing Express.'
        );
      }
      const unlockedStateTx = await getUnlockedState();
      if (!unlockedStateTx) {
        openUnlockWindow('sign');
        const timeoutId = setTimeout(() => {
          const idx = pendingUnlockQueue.findIndex((p) => p.id === id);
          if (idx !== -1) {
            const [item] = pendingUnlockQueue.splice(idx, 1);
            rejectPendingUnlockItem(
              item,
              providerError(PROVIDER_ERROR_CODES.USER_REJECTED, 'BOING_UNLOCK_TIMEOUT', 'Unlock timed out. Please try again.')
            );
          }
        }, PENDING_UNLOCK_TIMEOUT_MS) as unknown as number;
        pendingUnlockQueue.push({ id, method, params, origin, sendResponse, timeoutId });
        throw new QueuedForUnlock();
      }
      return signOrSendBoingTransaction(normalizedMethod, params, origin, unlockedStateTx, addressHex);
    }

    case BOING_METHODS.CHAIN_ID: {
      const networkId = await getSelectedNetworkId();
      return chainIdForNetwork(networkId);
    }

    case BOING_METHODS.SWITCH_CHAIN: {
      const payload = params[0];
      const chainId =
        payload && typeof payload === 'object' && 'chainId' in payload
          ? String((payload as { chainId: string }).chainId)
          : typeof payload === 'string'
            ? payload
            : null;

      if (!chainId) {
        throw providerError(
          PROVIDER_ERROR_CODES.INVALID_PARAMS,
          'BOING_INVALID_CHAIN',
          'boing_switchChain requires a chainId, e.g. { chainId: "0x1b01" }.'
        );
      }

      const normalized = chainId.replace(/^0x/i, '').toLowerCase();
      if (normalized === BOING_MAINNET_CHAIN_ID.replace(/^0x/i, '')) {
        if (!isBoingMainnetConfigured()) {
          throw providerError(
            PROVIDER_ERROR_CODES.UNSUPPORTED_CHAIN,
            'BOING_UNSUPPORTED_CHAIN',
            'Mainnet is not enabled in this Boing Express build.'
          );
        }
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: BOING_MAINNET_NETWORK_ID }, resolve);
        });
        return null;
      }
      if (normalized === BOING_TESTNET_CHAIN_ID.replace(/^0x/i, '')) {
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY_NETWORK]: BOING_TESTNET_NETWORK_ID }, resolve);
        });
        return null;
      }

      throw providerError(
        PROVIDER_ERROR_CODES.UNSUPPORTED_CHAIN,
        'BOING_UNSUPPORTED_CHAIN',
        'Unsupported chain. Boing Express supports 0x1b01 (testnet) and 0x1b02 (mainnet).'
      );
    }

    default:
      throw providerError(
        PROVIDER_ERROR_CODES.UNSUPPORTED_METHOD,
        'BOING_UNSUPPORTED_METHOD',
        `Unsupported provider method: ${method}`
      );
  }
}
