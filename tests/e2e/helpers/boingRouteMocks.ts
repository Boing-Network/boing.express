import type { BrowserContext, Route } from '@playwright/test';

/**
 * Hostnames to mock JSON-RPC for, in addition to `isLikelyBoingRpcUrl`.
 * Populated from build-time RPC env vars and optional `EXTENSION_E2E_RPC_MOCK_HOSTS`.
 */
function tryHostnameFromRpcUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

function collectExtraMockRpcHostnames(): Set<string> {
  const hosts = new Set<string>();
  for (const key of ['VITE_BOING_TESTNET_RPC', 'VITE_BOING_MAINNET_RPC'] as const) {
    const h = tryHostnameFromRpcUrl(process.env[key]);
    if (h) hosts.add(h);
  }
  const extra = process.env.EXTENSION_E2E_RPC_MOCK_HOSTS ?? '';
  for (const part of extra.split(',')) {
    const item = part.trim();
    if (!item) continue;
    const fromUrl = tryHostnameFromRpcUrl(item);
    if (fromUrl) {
      hosts.add(fromUrl);
      continue;
    }
    const bare = item.replace(/^https?:\/\//i, '').split('/')[0]?.trim();
    if (bare) hosts.add(bare);
  }
  return hosts;
}

/**
 * Minimal JSON-RPC responses for extension popup dashboard (balance / nonce / height).
 * Keeps E2E off the public internet so flows are fast and deterministic.
 */
function jsonRpcResult(id: number | string | undefined, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, result });
}

function jsonRpcError(id: number | string | undefined, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, error: { code, message } });
}

async function fulfillJsonRpc(route: Route, body: string): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body,
  });
}

function isLikelyBoingRpcUrl(url: URL): boolean {
  const h = url.hostname;
  if (h === 'testnet-rpc.boing.network' || h === 'rpc.boing.network') return true;
  if (h.endsWith('.boing.network') && (h.includes('rpc') || h.includes('testnet'))) return true;
  return false;
}

const extraMockRpcHosts = collectExtraMockRpcHostnames();

function shouldMockJsonRpcUrl(url: URL): boolean {
  if (isLikelyBoingRpcUrl(url)) return true;
  if (extraMockRpcHosts.has(url.hostname)) return true;
  return false;
}

/**
 * Stub `GET https://boing.network/api/networks` and POSTs to Boing JSON-RPC hosts used by the wallet build.
 * Call right after `launchPersistentContext`, before opening the popup.
 */
export interface BoingMockOptions {
  /** 1-based index of the `boing_submitTransaction` call that should fail (JSON-RPC error). */
  failSubmitAt?: number;
  /** Receives every signed tx hex passed to `boing_submitTransaction`, in order. */
  submitted?: string[];
  /** Advertise native batch support in `boing_health.rpc_surface`. */
  batchSupport?: boolean;
  /** Reject batch payloads like a pre-batch node (bincode variant error) on simulate + submit. */
  rejectBatchDecode?: boolean;
  /** `gas_used` returned by `boing_simulateTransaction` (default: field omitted). */
  simulateGasUsed?: number;
  /** Tokens returned by `boing_listDexTokens` (mocked fungible holdings). */
  dexTokens?: Array<{ id: string; symbol: string; decimals: number }>;
  /**
   * `boing_getContractStorage` override: return a 64-hex word (no 0x) for `(contract, key)`, or null for zero.
   * Hex args arrive lowercase without 0x. Use for mocked token balances / NFT owner slots.
   */
  storage?: (contractHex: string, keyHex: string) => string | null;
  /** boing_faucetRequest behaviour (default: ok, 10 BOING). */
  faucet?: 'ok' | 'cooldown' | 'empty';
  /** `boing_getValidators` result (called each time, so it can depend on submitted txs). Omit: Method not found. */
  validators?: () => unknown;
  /** `boing_getAccountTransactions` result for (params). Omit: Method not found (older node). */
  accountTransactions?: (params: unknown[]) => unknown;
  /** Override `boing_getAccount` result. */
  account?: () => unknown;
  /** Generic hook checked first: return a result (anything but `undefined`) to answer `method`. */
  rpc?: (method: string, params: unknown[]) => unknown;
  /**
   * `chain_id` advertised by `boing_health` (default 6913, the Boing testnet). Pass `null` to omit it, like an older
   * node or a local dev chain, so the wallet's "node did not report a chain id" warning is exercised.
   */
  chainId?: number | null;
  /** Extra fields merged into the `boing_health` result (e.g. `min_wallet_version`). */
  healthExtra?: Record<string, unknown>;
  /** Receives the URL of every request that was blocked because it left localhost without being mocked. */
  blocked?: string[];
  /** Set false to let unmocked external requests through (default: they are aborted, so specs stay hermetic). */
  hermetic?: boolean;
}

/** Hosts that are always allowed (the locally served wallet / test dApp). */
function isLocalHost(url: URL): boolean {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

/** Signed tx hex → payload discriminant (u32 LE after nonce u64 + sender 32 bytes). */
function payloadVariantOfSignedHex(hex: string): number {
  const h = hex.replace(/^0x/i, '');
  const off = (8 + 32) * 2;
  const b = h.slice(off, off + 8);
  if (b.length < 8) return -1;
  return parseInt(b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2), 16);
}

const BATCH_DECODE_ERROR = 'Invalid transaction: invalid value: integer `9`, expected variant index 0 <= i < 9';

export async function installBoingNetworkMocks(context: BrowserContext, opts: BoingMockOptions = {}): Promise<void> {
  let submitCount = 0;
  // Registered first, so every later (more specific) route wins and only truly unmocked traffic reaches this guard.
  if (opts.hermetic !== false) {
    await context.route(
      (url: URL) => (url.protocol === 'http:' || url.protocol === 'https:') && !isLocalHost(url),
      async (route) => {
        opts.blocked?.push(route.request().url());
        await route.abort('blockedbyclient');
      }
    );
  }
  // Third-party assets the app pulls in: stubbed so nothing depends on (or leaks to) the public internet.
  await context.route(
    (url: URL) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
    async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: '/* e2e: fonts stubbed */' });
    }
  );
  // boing.observer NFT owner index: answers like an observer whose indexer is not live yet (the wallet degrades gracefully).
  await context.route(
    (url: URL) => url.hostname === 'boing.observer' && url.pathname.startsWith('/api/'),
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: 'NFT owner indexer is not configured yet' }),
      });
    }
  );
  await context.route(
    (url: URL) => url.hostname === 'boing.network' && url.pathname.startsWith('/api/networks'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true, meta: {}, networks: [] }),
      });
    }
  );

  await context.route((url: URL) => shouldMockJsonRpcUrl(url), async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }

    let payload: { method?: string; id?: number | string; params?: unknown[] };
    try {
      payload = request.postDataJSON() as typeof payload;
    } catch {
      await route.fallback();
      return;
    }

    const { method, id } = payload;

    if (opts.rpc && method) {
      const r = opts.rpc(method, payload.params ?? []);
      if (r !== undefined) {
        await fulfillJsonRpc(route, jsonRpcResult(id, r));
        return;
      }
    }

    switch (method) {
      case 'boing_getAccount':
        await fulfillJsonRpc(route, jsonRpcResult(id, opts.account?.() ?? { balance: '1000000', nonce: '0', stake: '0' }));
        return;
      case 'boing_getValidators':
        if (!opts.validators) break;
        await fulfillJsonRpc(route, jsonRpcResult(id, opts.validators()));
        return;
      case 'boing_getAccountTransactions':
        if (!opts.accountTransactions) break;
        await fulfillJsonRpc(route, jsonRpcResult(id, opts.accountTransactions(payload.params ?? [])));
        return;
      case 'boing_getBalance':
        await fulfillJsonRpc(route, jsonRpcResult(id, '1000000'));
        return;
      case 'boing_chainHeight':
        await fulfillJsonRpc(route, jsonRpcResult(id, 1));
        return;
      case 'boing_health': {
        const chainId = opts.chainId === undefined ? 6913 : opts.chainId;
        await fulfillJsonRpc(
          route,
          jsonRpcResult(id, {
            ok: true,
            head_height: 1,
            ...(chainId == null ? {} : { chain_id: chainId, tx_signing: { v2_supported: true, domain: 'BOING_TX_V2', chain_id: chainId } }),
            ...(opts.batchSupport
              ? { rpc_surface: { tx_payload_batch: true, tx_batch_max_calls: 16, tx_batch_max_calldata_bytes: 65536 } }
              : {}),
            ...(opts.healthExtra ?? {}),
          })
        );
        return;
      }
      case 'boing_simulateTransaction': {
        const hex = String((payload.params ?? [])[0] ?? '');
        if (opts.rejectBatchDecode && payloadVariantOfSignedHex(hex) === 9) {
          await fulfillJsonRpc(route, jsonRpcError(id, -32602, BATCH_DECODE_ERROR));
          return;
        }
        await fulfillJsonRpc(
          route,
          jsonRpcResult(id, opts.simulateGasUsed != null ? { success: true, gas_used: opts.simulateGasUsed } : { success: true })
        );
        return;
      }
      case 'boing_simulateContractCall':
        await fulfillJsonRpc(route, jsonRpcResult(id, { success: true, gas_used: '0', return_data: '0x' }));
        return;
      case 'boing_submitTransaction': {
        submitCount += 1;
        const hex = String((payload.params ?? [])[0] ?? '');
        if (opts.rejectBatchDecode && payloadVariantOfSignedHex(hex) === 9) {
          await fulfillJsonRpc(route, jsonRpcError(id, -32602, BATCH_DECODE_ERROR));
          return;
        }
        opts.submitted?.push(hex);
        if (opts.failSubmitAt === submitCount) {
          await fulfillJsonRpc(route, jsonRpcError(id, -32000, 'E2E mock: insufficient balance for fee'));
          return;
        }
        await fulfillJsonRpc(route, jsonRpcResult(id, '0x' + submitCount.toString(16).padStart(64, '0')));
        return;
      }
      case 'boing_getContractStorage': {
        const [c, k] = ((payload.params ?? []) as unknown[]).map((x) => String(x ?? '').replace(/^0x/i, '').toLowerCase());
        const word = opts.storage?.(c ?? '', k ?? '') ?? null;
        await fulfillJsonRpc(route, jsonRpcResult(id, { value: '0x' + (word ?? '0'.repeat(64)).padStart(64, '0') }));
        return;
      }
      case 'boing_getBlockByHeight':
        await fulfillJsonRpc(route, jsonRpcResult(id, null));
        return;
      case 'boing_faucetRequest':
        if (opts.faucet === 'cooldown') {
          await fulfillJsonRpc(route, JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32016, message: 'Faucet cooldown: try again in 42 seconds.' } }));
        } else if (opts.faucet === 'empty') {
          await fulfillJsonRpc(route, JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Faucet balance too low.' } }));
        } else {
          await fulfillJsonRpc(route, jsonRpcResult(id, { ok: true, amount: 10, tip_height: 84, connected_peers: 0, message: 'Check your wallet; tx is in the mempool.' }));
        }
        return;
      case 'boing_listDexPools':
        await fulfillJsonRpc(route, jsonRpcResult(id, { pools: [], nextCursor: null }));
        return;
      case 'boing_listDexTokens':
        await fulfillJsonRpc(route, jsonRpcResult(id, { tokens: opts.dexTokens ?? [], nextCursor: null }));
        return;
      case 'boing_getDexToken':
        await fulfillJsonRpc(route, jsonRpcResult(id, null));
        return;
      default:
        break;
    }
    await fulfillJsonRpc(route, jsonRpcError(id, -32601, 'Method not found (E2E mock)'));
  });
}
