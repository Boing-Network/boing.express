/**
 * dApp helpers aligned with **boing-sdk** `walletProvider.ts`, extended for Boing Express
 * `data.boingCode` / nested node RPC errors. Vend from this repo when you want the same
 * behavior without adding **boing-sdk** (prefer **boing-sdk** for new work).
 */

import { rpcErrorToMessage } from './rpc';

const BOING_SEND = 'boing_sendTransaction';
const BOING_ACCOUNTS = 'boing_requestAccounts';
const BOING_CHAIN = 'boing_chainId';
const ETH_CHAIN = 'eth_chainId';
const ETH_ACCOUNTS = 'eth_requestAccounts';

/**
 * EIP-1193 methods Boing-native dApps typically rely on (Boing Express implements these).
 */
export const BOING_WALLET_RPC_METHODS_NATIVE_DAPP = [BOING_CHAIN, BOING_ACCOUNTS, BOING_SEND] as const;

export function explainEthSendTransactionInsufficientForBoingNativeCall(): string {
  return [
    'Boing `contract_call` transactions use 32-byte account ids, explicit access lists, and bincode signing—not the implicit 20-byte `to`/`data` shape most `eth_sendTransaction` wallets assume.',
    'Use Boing Express (or an injected provider that implements `boing_sendTransaction` / `boing_chainId`) or sign server-side with `boing-sdk` and `boing_submitTransaction`.',
    `Methods to look for: ${BOING_WALLET_RPC_METHODS_NATIVE_DAPP.join(', ')}.`,
  ].join('\n');
}

export type Eip1193Requester = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

function asRequester(v: unknown): Eip1193Requester | undefined {
  if (v != null && typeof v === 'object' && typeof (v as Eip1193Requester).request === 'function') {
    return v as Eip1193Requester;
  }
  return undefined;
}

export function getInjectedEip1193Provider(globalObj: typeof globalThis = globalThis): Eip1193Requester | undefined {
  const g = globalObj as Record<string, unknown>;
  return asRequester(g.boing) ?? asRequester(g.ethereum);
}

export async function providerSupportsBoingNativeRpc(provider: Eip1193Requester): Promise<boolean> {
  try {
    const r = await provider.request({ method: BOING_CHAIN, params: [] });
    return typeof r === 'string' && r.startsWith('0x');
  } catch {
    return false;
  }
}

export async function boingSendTransaction(
  provider: Eip1193Requester,
  tx: Record<string, unknown>
): Promise<string> {
  const out = await provider.request({ method: BOING_SEND, params: [tx] });
  if (typeof out !== 'string') {
    throw new Error('boing_sendTransaction: expected string tx hash from wallet');
  }
  return out;
}

export async function requestAccounts(provider: Eip1193Requester): Promise<string[]> {
  try {
    const a = await provider.request({ method: BOING_ACCOUNTS, params: [] });
    if (Array.isArray(a) && a.every((x) => typeof x === 'string')) return a as string[];
  } catch {
    /* fall through */
  }
  const a = await provider.request({ method: ETH_ACCOUNTS, params: [] });
  if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) {
    throw new Error('requestAccounts: wallet did not return string[]');
  }
  return a as string[];
}

export async function readChainIdHex(provider: Eip1193Requester): Promise<string> {
  try {
    const id = await provider.request({ method: BOING_CHAIN, params: [] });
    if (typeof id === 'string' && id.startsWith('0x')) return id.toLowerCase();
  } catch {
    /* fall through */
  }
  const id = await provider.request({ method: ETH_CHAIN, params: [] });
  if (typeof id !== 'string' || !id.startsWith('0x')) {
    throw new Error('readChainIdHex: wallet did not return 0x-prefixed chain id');
  }
  return id.toLowerCase();
}

export type BoingInjectedWalletConnectResult = {
  accounts: string[];
  chainIdHex: string;
  supportsBoingNativeRpc: boolean;
};

export async function connectInjectedBoingWallet(provider: Eip1193Requester): Promise<BoingInjectedWalletConnectResult> {
  const [accounts, chainIdHex, supportsBoingNativeRpc] = await Promise.all([
    requestAccounts(provider),
    readChainIdHex(provider),
    providerSupportsBoingNativeRpc(provider),
  ]);
  return { accounts, chainIdHex, supportsBoingNativeRpc };
}

type ProviderErrorShape = {
  code?: number;
  message?: string;
  data?: {
    boingCode?: string;
    rpc?: { code?: number; message?: string; data?: unknown };
    suggested_access_list?: { read: string[]; write: string[] };
    access_list_covers_suggestion?: boolean;
  };
};

const BOING_UI: Record<string, string> = {
  BOING_ORIGIN_NOT_CONNECTED: 'Connect this site first (call boing_requestAccounts from the page).',
  BOING_NO_WALLET: 'No wallet in Boing Express. Create or import a wallet in the extension.',
  BOING_WALLET_LOCKED: 'Unlock Boing Express to continue.',
  BOING_UNLOCK_TIMEOUT: 'Unlock timed out. Open Boing Express and try again.',
  BOING_USER_REJECTED_SIGNING: 'Request was cancelled in the wallet.',
  BOING_USER_REJECTED: 'Request was cancelled in the wallet.',
  BOING_UNSUPPORTED_METHOD: 'This action is not supported by Boing Express.',
  BOING_UNSUPPORTED_CHAIN: 'Switch to Boing testnet or mainnet in the wallet.',
  BOING_INVALID_PARAMS: 'Invalid request. Check parameters and try again.',
  BOING_INVALID_HEX: 'Invalid hex data in the request.',
  BOING_INVALID_MESSAGE: 'Invalid message for signing.',
  BOING_INVALID_TX: 'Invalid transaction object. Use Boing-native types (32-byte accounts, access_list for contract_call).',
  BOING_ADDRESS_MISMATCH: 'The requested account does not match the active wallet account.',
  BOING_SIMULATION_FAILED: 'Transaction simulation failed on the network. Check balances, access_list, and calldata.',
  BOING_SIMULATION_ERROR: 'Could not simulate the transaction. Try again or check your RPC connection.',
  BOING_SUBMIT_FAILED: 'Could not submit the transaction. Try again.',
  BOING_RPC_NONCE: 'Could not load your account nonce from the network.',
  BOING_INTERNAL_ERROR: 'Something went wrong in the wallet. Try again.',
  BOING_SIGNATURE_APPROVAL_TIMEOUT: 'Approval timed out. Open Boing Express and try again.',
  BOING_APPROVAL_UI_UNAVAILABLE: 'Could not open the approval window. Check extension permissions.',
  BOING_ACCOUNT_SWITCHED: 'Active account changed in the wallet. Unlock again to continue.',
};

/**
 * Map injected provider / Boing Express errors to short UI strings.
 * Superset of **boing-sdk** `mapInjectedProviderErrorToUiMessage` (adds `data.boingCode` + node RPC).
 */
export function mapInjectedProviderErrorToUiMessage(err: unknown): string {
  const o = err as ProviderErrorShape;
  const code = typeof o?.code === 'number' ? o.code : undefined;
  const msg = typeof o?.message === 'string' ? o.message : '';
  const data = o?.data && typeof o.data === 'object' ? o.data : undefined;
  const boingCode = typeof data?.boingCode === 'string' ? data.boingCode : undefined;

  if (boingCode === 'BOING_SIMULATION_FAILED' && data?.suggested_access_list) {
    const base = BOING_UI.BOING_SIMULATION_FAILED;
    const cov =
      data.access_list_covers_suggestion === false
        ? ' The network suggested accounts to add to your access_list — update the transaction and retry.'
        : '';
    return base + cov;
  }

  if (boingCode === 'BOING_NODE_JSONRPC' && data?.rpc && typeof data.rpc.code === 'number') {
    const rc = data.rpc.code;
    const rm =
      typeof data.rpc.message === 'string' && data.rpc.message.trim()
        ? data.rpc.message.trim()
        : rpcErrorToMessage(rc, '');
    return rm;
  }

  if (boingCode && BOING_UI[boingCode]) {
    return BOING_UI[boingCode];
  }

  if (code === 4001 || /user rejected|denied|rejected/i.test(msg)) {
    return 'Request was cancelled in the wallet.';
  }
  if (code === -32603 || /internal error/i.test(msg)) {
    return 'The wallet reported an internal error. Try again or switch networks.';
  }
  if (/method not found|not supported|does not exist/i.test(msg)) {
    return 'This wallet may not support Boing RPC methods. Use Boing Express or sign with boing-sdk on the server.';
  }
  if (/network|chain/i.test(msg) && /wrong|invalid|mismatch/i.test(msg)) {
    return 'Wrong network selected in the wallet. Switch to the Boing chain and retry.';
  }
  if (msg.trim().length > 0) {
    return msg.length > 200 ? `${msg.slice(0, 197)}…` : msg;
  }
  return 'Wallet request failed. Try again or use a Boing-compatible wallet.';
}
