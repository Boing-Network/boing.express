/**
 * Boing JSON-RPC client. Aligned with boing-network docs/RPC-API-SPEC.md.
 * Methods: boing_getAccount, boing_getBalance, boing_submitTransaction,
 * boing_simulateTransaction, boing_simulateContractCall, boing_faucetRequest, boing_chainHeight,
 * boing_listDexPools, boing_listDexTokens, boing_getDexToken, boing_getContractStorage.
 */

const JSON_RPC_VERSION = '2.0';

export class RpcClientError extends Error {
  code?: number;
  /** JSON-RPC `error.data` from the node (e.g. QA `rule_id` / `doc_url`). */
  data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'RpcClientError';
    this.code = code;
    this.data = data;
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
  error?: { code: number; message: string; data?: unknown };
}

/** RPC error codes per RPC-API-SPEC.md and TECHNICAL-SPECIFICATION §11.3. */
const RPC_ERROR_CODES: Record<number, string> = {
  [-32700]: 'Parse error',
  [-32600]: 'Invalid request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid parameters',
  [-32603]: 'Internal error',
  [-32000]: 'Server error',
  [-32016]: 'Rate limit exceeded. Please try again later.',
  [-32050]: 'QA: Deployment rejected by protocol. Check rule_id and message.',
  [-32051]: 'QA: Deployment referred to community pool (unsure).',
  [-32052]: 'QA pool: no pending item for this transaction.',
  [-32053]: 'QA pool: voter is not an administrator.',
  [-32054]: 'QA pool is disabled by governance.',
  [-32055]: 'QA pool is full (global cap).',
  [-32056]: 'QA pool: per-deployer cap reached.',
  [-32057]: 'Operator RPC: missing or invalid X-Boing-Operator header.',
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
    const nodeMsg = data.error.message != null ? String(data.error.message).trim() : '';
    const message =
      nodeMsg || rpcErrorToMessage(data.error.code, '');
    throw new RpcClientError(message, data.error.code, data.error.data);
  }
  if (data.result === undefined) throw new RpcClientError('RPC response missing result');
  return data.result as T;
}

/** Parsed `boing_submitTransaction` result per RPC-API-SPEC (`{ tx_hash: string }`). */
export interface SubmitTransactionResult {
  tx_hash: string;
}

/**
 * Normalize submit result to a tx hash string.
 * Current nodes return `{ tx_hash: "0x<64 hex>", tx_id }` (the real tx id); older nodes returned
 * `{ tx_hash: "ok" }`. Callers derive the id locally from the signed bytes either way (see boingAdapter).
 */
export function parseSubmitTransactionResult(result: unknown): string {
  if (typeof result === 'string' && result.length > 0) return result;
  if (result != null && typeof result === 'object' && !Array.isArray(result)) {
    const txHash = (result as { tx_hash?: unknown }).tx_hash;
    if (typeof txHash === 'string' && txHash.length > 0) return txHash;
  }
  throw new RpcClientError('RPC response missing tx_hash');
}

const TX_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/** The node's real transaction id from a submit result: `tx_id`, else `tx_hash` when it is a 32-byte hex id. */
export interface ParsedSubmitResponse {
  /** Real id (`0x` + 64 hex, lower case) when the node supplied one; absent on nodes that answered `"ok"`. */
  txId?: string;
  /** Raw `tx_hash` field (`"ok"` on nodes before 2026-10-16). */
  ack: string;
}

export function parseSubmitResponse(result: unknown): ParsedSubmitResponse {
  const ack = parseSubmitTransactionResult(result);
  let txId: string | undefined;
  if (result != null && typeof result === 'object' && !Array.isArray(result)) {
    const o = result as { tx_id?: unknown; tx_hash?: unknown };
    for (const c of [o.tx_id, o.tx_hash]) {
      if (typeof c === 'string' && TX_ID_RE.test(c)) {
        txId = c.toLowerCase();
        break;
      }
    }
  } else if (typeof result === 'string' && TX_ID_RE.test(result)) {
    txId = result.toLowerCase();
  }
  return { txId, ack };
}

/** Submit and return the node's full answer (real id when available). Throws RpcClientError (with `data.reason`) on rejection. */
export function submitTransactionDetailed(rpcUrl: string, hexSignedTx: string): Promise<ParsedSubmitResponse> {
  return rpcCall<unknown>(rpcUrl, 'boing_submitTransaction', [hexSignedTx]).then(parseSubmitResponse);
}

/** Submit signed tx hex. Returns tx hash string (e.g. `"ok"` or hex from QA pool). */
export function submitTransaction(rpcUrl: string, hexSignedTx: string): Promise<string> {
  return rpcCall<unknown>(rpcUrl, 'boing_submitTransaction', [hexSignedTx]).then(parseSubmitTransactionResult);
}

/** Current chain height. */
/** `boing_health` (includes `rpc_surface` capability flags such as `tx_payload_batch`). */
export function health(rpcUrl: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_health', []);
}

/** `boing_getValidators` (open validator set report). Older nodes: Method not found. */
export function getValidators(rpcUrl: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_getValidators', []);
}

export function chainHeight(rpcUrl: string): Promise<number> {
  return rpcCall<number>(rpcUrl, 'boing_chainHeight', []);
}

/**
 * Get block by height. Pass `includeReceipts: true` for txs + receipts
 * (needed for NFT discovery from mint_batch / transfer_nft calldata).
 */
export function getBlockByHeight(
  rpcUrl: string,
  height: number,
  includeReceipts?: boolean
): Promise<unknown> {
  const params =
    includeReceipts === true
      ? [height, true]
      : includeReceipts === false
        ? [height, false]
        : [height];
  return rpcCall<unknown>(rpcUrl, 'boing_getBlockByHeight', params);
}

/** Simulate transaction. */
export function simulateTransaction(rpcUrl: string, hexSignedTx: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_simulateTransaction', [hexSignedTx]);
}

/**
 * Dry-run a `contract_call` without signing (RPC-API-SPEC: `boing_simulateContractCall`).
 * Params shape matches the node: `[contract_hex, calldata_hex, sender_hex?, at_block?]`.
 */
export function simulateContractCall(rpcUrl: string, params: unknown[]): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_simulateContractCall', params);
}

/** First JSON-RPC param for DEX discovery methods: one object, same as boing-sdk list/get helpers. */
function dexDiscoveryRequestObject(params: unknown[]): Record<string, unknown> {
  const first = params[0];
  if (first != null && typeof first === 'object' && !Array.isArray(first)) {
    return first as Record<string, unknown>;
  }
  return {};
}

/** `boing_listDexPools` — params `[{ factory?, cursor?, limit?, light?, includeDiagnostics?, … }]` per RPC-API-SPEC. */
export function listDexPools(rpcUrl: string, params: unknown[] = [{}]): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_listDexPools', [dexDiscoveryRequestObject(params)]);
}

/** `boing_listDexTokens` — same param object shape as **`BoingClient.listDexTokensPage`**. */
export function listDexTokens(rpcUrl: string, params: unknown[] = [{}]): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_listDexTokens', [dexDiscoveryRequestObject(params)]);
}

/** `boing_getDexToken` — params `[{ id, factory?, light?, includeDiagnostics? }]`; node returns one row or JSON null. */
export function getDexToken(rpcUrl: string, params: unknown[] = [{}]): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_getDexToken', [dexDiscoveryRequestObject(params)]);
}

/**
 * `boing_getContractStorage([contract_hex, key_hex])` — one 32-byte VM storage word.
 * Used for reference NFT owner/metadata XOR slots (see BOING-REFERENCE-NFT.md).
 */
export function getContractStorage(
  rpcUrl: string,
  contractHex32: string,
  keyHex32: string
): Promise<unknown> {
  const contract = contractHex32.startsWith('0x') ? contractHex32 : `0x${contractHex32}`;
  const key = keyHex32.startsWith('0x') ? keyHex32 : `0x${keyHex32}`;
  return rpcCall<unknown>(rpcUrl, 'boing_getContractStorage', [contract, key]);
}

/** Testnet faucet: request BOING for account (hex AccountId). Maps -32016 (rate limit), -32601 (not enabled). */
export function faucetRequest(rpcUrl: string, hexAccountId: string): Promise<unknown> {
  return rpcCall<unknown>(rpcUrl, 'boing_faucetRequest', [hexAccountId]).catch((e: Error) => {
    const msg = e.message;
    const code = (e as { code?: number }).code;
    if (code === -32016 || msg.includes('Rate limit') || msg.includes('cooldown')) {
      throw new Error(
        msg.toLowerCase().includes('faucet cooldown')
          ? `${msg} (one request per address every 60 seconds)`
          : 'Faucet cooldown: one request per address every 60 seconds. Try again in a minute.'
      );
    }
    if (msg.includes('Method not found')) throw new Error('Faucet is not enabled on this network.');
    if (msg.includes('balance too low')) throw new Error('The testnet faucet is empty right now. Please report it (boing.network/support) and try again later.');
    throw e;
  });
}

/**
 * Account state: balance and nonce (and optionally stake / unbond queue) as decimal strings (u128).
 * Sole source of the account nonce (boing-node has no separate nonce method).
 */
export interface BoingAccountState {
  balance: string;
  nonce: string;
  stake?: string;
  /** Stake waiting for unbonding delay (RPC `pending_unbond`). */
  pendingUnbond?: string;
  /** Block height when `pending_unbond` may be claimed (RPC `unbond_unlock_height`). */
  unbondUnlockHeight?: number;
  /** Ledger decimals of the amounts (18 = base units, 0 = whole BOING); absent on nodes before testnet-v0.1.17. */
  decimals?: number;
}

/** boing_getAccount([hex_account_id]) — balance, nonce, stake, pending unbond. Throws if method not available. */
export function getAccount(rpcUrl: string, hexAccountId: string): Promise<BoingAccountState> {
  return rpcCall<{
    balance: string;
    nonce: string | number;
    stake?: string;
    pending_unbond?: string;
    unbond_unlock_height?: number | string;
    decimals?: number;
  }>(rpcUrl, 'boing_getAccount', [hexAccountId]).then((r) => {
    const unlockRaw = r.unbond_unlock_height;
    let unbondUnlockHeight: number | undefined;
    if (unlockRaw != null && unlockRaw !== '') {
      const n = typeof unlockRaw === 'number' ? unlockRaw : Number(unlockRaw);
      if (Number.isFinite(n)) unbondUnlockHeight = n;
    }
    return {
      balance: String(r.balance ?? '0'),
      nonce: String(r.nonce ?? '0'),
      stake: r.stake != null ? String(r.stake) : undefined,
      pendingUnbond: r.pending_unbond != null ? String(r.pending_unbond) : undefined,
      unbondUnlockHeight,
      decimals: typeof r.decimals === 'number' ? r.decimals : undefined,
    };
  });
}

/**
 * boing_getBalance([hex_account_id]) — fallback when getAccount is not available.
 * Returns balance as decimal string (u128).
 */
export function getBalance(rpcUrl: string, hexAccountId: string): Promise<string> {
  return rpcCall<string>(rpcUrl, 'boing_getBalance', [hexAccountId]);
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
