/**
 * Boing JSON-RPC client. Methods: boing_submitTransaction, boing_chainHeight,
 * boing_getBlockByHeight, boing_simulateTransaction, boing_faucetRequest.
 * Balance: if RPC has boing_getBalance we use it; otherwise document indexer/state approach.
 */

const JSON_RPC_VERSION = '2.0';

export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

let rpcId = 0;

function nextId(): number {
  return ++rpcId;
}

export async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const body: JsonRpcRequest = {
    jsonrpc: JSON_RPC_VERSION,
    id: nextId(),
    method,
    params,
  };
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as JsonRpcResponse<T>;
  if (data.error) throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
  if (data.result === undefined) throw new Error('RPC response missing result');
  return data.result as T;
}

/** Submit signed tx hex. Returns tx hash or error. */
export function submitTransaction(rpcUrl: string, hexSignedTx: string): Promise<string> {
  return rpcCall<string>(rpcUrl, 'boing_submitTransaction', [hexSignedTx]);
}

/** Current chain height. */
export function chainHeight(rpcUrl: string): Promise<number> {
  return rpcCall<number>(rpcUrl, 'boing_chainHeight', []);
}

/** Get block by height (optional). */
export function getBlockByHeight(rpcUrl: string, height: number): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_getBlockByHeight', [height]);
}

/** Simulate transaction. */
export function simulateTransaction(rpcUrl: string, hexSignedTx: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_simulateTransaction', [hexSignedTx]);
}

/** Testnet faucet: request BOING for account (hex AccountId). */
export function faucetRequest(rpcUrl: string, hexAccountId: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_faucetRequest', [hexAccountId]);
}

/**
 * Balance: Boing RPC may expose boing_getBalance(account_hex). If not in spec,
 * balance can be derived from state (e.g. boing_getAccountState) or an indexer.
 * We try boing_getBalance first; fallback to 0 and document.
 */
export function getBalance(rpcUrl: string, hexAccountId: string): Promise<string> {
  return rpcCall<string>(rpcUrl, 'boing_getBalance', [hexAccountId]).catch(() => {
    // If method not implemented, return "0" and document that indexer/state is needed
    return '0';
  });
}

/** Nonce for account. RPC may expose boing_getNonce(account_hex). */
export function getNonce(rpcUrl: string, hexAccountId: string): Promise<bigint> {
  return rpcCall<string | number>(rpcUrl, 'boing_getNonce', [hexAccountId])
    .then((n) => (typeof n === 'string' ? BigInt(n) : BigInt(n)))
    .catch(() => BigInt(0));
}
