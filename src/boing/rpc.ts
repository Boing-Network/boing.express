/**
 * Boing JSON-RPC client. Aligned with boing-network docs/RPC-API-SPEC.md.
 * Methods: boing_getAccount, boing_getBalance, boing_getNonce, boing_submitTransaction,
 * boing_simulateTransaction, boing_faucetRequest, boing_chainHeight.
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

/** RPC error codes per JSON-RPC 2.0 and Boing spec. */
const RPC_ERROR_CODES: Record<number, string> = {
  [-32600]: 'Invalid request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid parameters',
  [-32000]: 'Server error',
  [-32016]: 'Rate limit exceeded. Please try again later.',
};

export function rpcErrorToMessage(code: number, message: string): string {
  const mapped = RPC_ERROR_CODES[code];
  if (mapped) return mapped;
  return message || `RPC error ${code}`;
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
      throw new Error('Request timed out. The network may be slow — try again.');
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
      throw new Error('Network unavailable or RPC not responding. Check your connection and try again.');
    }
    throw e;
  }
  clearTimeout(timeoutId);
  if (!res.ok) {
    if (res.status === 404) throw new Error('RPC endpoint not available. The network may not be running.');
    throw new Error(`RPC HTTP ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as JsonRpcResponse<T>;
  if (data.error) {
    throw new Error(rpcErrorToMessage(data.error.code, data.error.message || ''));
  }
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
  return rpcCall<string>(rpcUrl, 'boing_getBalance', [hexAccountId]).catch(() => '0');
}

/** boing_getNonce([hex_account_id]) — fallback when getAccount is not available. */
export function getNonce(rpcUrl: string, hexAccountId: string): Promise<bigint> {
  return rpcCall<string | number>(rpcUrl, 'boing_getNonce', [hexAccountId])
    .then((n) => (typeof n === 'string' ? BigInt(n) : BigInt(n)))
    .catch(() => BigInt(0));
}

/**
 * boing_qaCheck — Pre-flight QA check for contract deployment.
 * Returns allow | reject | unsure. Optional; returns -32601 when QA not enabled.
 */
export interface QaCheckResult {
  result: 'allow' | 'reject' | 'unsure';
  rule_id?: string;
  message?: string;
}

export function qaCheck(
  rpcUrl: string,
  hexBytecode: string,
  purposeCategory?: string,
  descriptionHash?: string
): Promise<QaCheckResult> {
  const params =
    purposeCategory != null
      ? descriptionHash != null
        ? [hexBytecode, purposeCategory, descriptionHash]
        : [hexBytecode, purposeCategory]
      : [hexBytecode];
  return rpcCall<QaCheckResult>(rpcUrl, 'boing_qaCheck', params).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Method not found')) {
      throw new Error('QA check is not enabled on this network.');
    }
    throw e;
  });
}
