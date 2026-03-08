/**
 * Boing JSON-RPC client. Aligned with boing-network docs/RPC-API-SPEC.md.
 * Methods: boing_getAccount, boing_getBalance, boing_getNonce, boing_submitTransaction,
 * boing_simulateTransaction, boing_faucetRequest, boing_chainHeight.
 */

const JSON_RPC_VERSION = '2.0';

export class RpcClientError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'RpcClientError';
    this.code = code;
  }
}

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

/** RPC error codes per RPC-API-SPEC.md and TECHNICAL-SPECIFICATION §11.3. */
const RPC_ERROR_CODES: Record<number, string> = {
  [-32600]: 'Invalid request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid parameters',
  [-32000]: 'Server error',
  [-32016]: 'Rate limit exceeded. Please try again later.',
  [-32050]: 'QA: Deployment rejected by protocol. Check rule_id and message.',
  [-32051]: 'QA: Deployment referred to community pool (unsure).',
};

export function rpcErrorToMessage(code: number, message: string): string {
  const mapped = RPC_ERROR_CODES[code];
  if (mapped) return mapped;
  return message || `RPC error ${code}`;
}

export function isMethodNotFoundError(error: unknown): boolean {
  return error instanceof RpcClientError
    ? error.code === -32601
    : error instanceof Error && error.message.includes('Method not found');
}

let rpcId = 0;

/** Default timeout for RPC requests (ms). Prevents hanging on slow or unresponsive RPC. */
const RPC_TIMEOUT_MS = 15_000;

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new RpcClientError('Request timed out. The network may be slow — try again.');
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
      throw new RpcClientError('Network unavailable or RPC not responding. Check your connection and try again.');
    }
    throw e;
  }
  clearTimeout(timeoutId);
  if (!res.ok) {
    if (res.status === 404) throw new RpcClientError('RPC endpoint not available. The network may not be running.');
    const friendly = res.status >= 500
      ? 'Network temporarily unavailable. Check your connection or try again later.'
      : res.status === 403 || res.status === 401
        ? 'Access denied. The RPC may not allow this request.'
        : null;
    throw new RpcClientError(friendly ?? `RPC HTTP ${res.status}: ${res.statusText || 'Error'}`);
  }
  const data = (await res.json()) as JsonRpcResponse<T>;
  if (data.error) {
    throw new RpcClientError(rpcErrorToMessage(data.error.code, data.error.message || ''), data.error.code);
  }
  if (data.result === undefined) throw new RpcClientError('RPC response missing result');
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

/** Testnet faucet: request BOING for account (hex AccountId). Maps -32016 (rate limit), -32601 (not enabled). */
export function faucetRequest(rpcUrl: string, hexAccountId: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_faucetRequest', [hexAccountId]).catch((e: Error) => {
    const msg = e.message;
    if (msg.includes('Rate limit')) throw e;
    if (msg.includes('Method not found')) throw new Error('Faucet is not enabled on this network.');
    throw e;
  });
}

/**
 * Account state: balance and nonce (and optionally stake) as decimal strings (u128).
 * Prefer this over separate getBalance/getNonce so nonce is consistent with balance.
 */
export interface BoingAccountState {
  balance: string;
  nonce: string;
  stake?: string;
}

/** boing_getAccount([hex_account_id]) — balance, nonce, stake as decimal strings. Throws if method not available. */
export function getAccount(rpcUrl: string, hexAccountId: string): Promise<BoingAccountState> {
  return rpcCall<{ balance: string; nonce: string | number; stake?: string }>(rpcUrl, 'boing_getAccount', [hexAccountId]).then(
    (r) => ({
      balance: String(r.balance ?? '0'),
      nonce: String(r.nonce ?? '0'),
      stake: r.stake != null ? String(r.stake) : undefined,
    })
  );
}

/**
 * boing_getBalance([hex_account_id]) — fallback when getAccount is not available.
 * Returns balance as decimal string (u128).
 */
export function getBalance(rpcUrl: string, hexAccountId: string): Promise<string> {
  return rpcCall<string>(rpcUrl, 'boing_getBalance', [hexAccountId]);
}

/** boing_getNonce([hex_account_id]) — fallback when getAccount is not available. */
export function getNonce(rpcUrl: string, hexAccountId: string): Promise<bigint> {
  return rpcCall<string | number>(rpcUrl, 'boing_getNonce', [hexAccountId])
    .then((n) => (typeof n === 'string' ? BigInt(n) : BigInt(n)));
}

/**
 * boing_qaCheck — Pre-flight QA check for contract deployment.
 * Returns allow | reject | unsure. Optional; returns -32601 when QA not enabled.
 */
export interface QaCheckResult {
  result: 'allow' | 'reject' | 'unsure';
  rule_id?: string;
  message?: string;
  doc_url?: string;
}

export function qaCheck(
  rpcUrl: string,
  hexBytecode: string,
  purposeCategory?: string,
  descriptionHash?: string,
  assetName?: string,
  assetSymbol?: string
): Promise<QaCheckResult> {
  const params: string[] = [hexBytecode];
  if (purposeCategory != null) {
    params.push(purposeCategory);
    if (descriptionHash != null) {
      params.push(descriptionHash);
      if (assetName != null) {
        params.push(assetName);
        if (assetSymbol != null) {
          params.push(assetSymbol);
        }
      }
    }
  }
  return rpcCall<QaCheckResult>(rpcUrl, 'boing_qaCheck', params).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Method not found')) {
      throw new Error('QA check is not enabled on this network.');
    }
    throw e;
  });
}
