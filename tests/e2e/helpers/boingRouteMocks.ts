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
export async function installBoingNetworkMocks(context: BrowserContext): Promise<void> {
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
      await route.continue();
      return;
    }

    let payload: { method?: string; id?: number | string; params?: unknown[] };
    try {
      payload = request.postDataJSON() as typeof payload;
    } catch {
      await route.continue();
      return;
    }

    const { method, id } = payload;

    switch (method) {
      case 'boing_getAccount':
        await fulfillJsonRpc(route, jsonRpcResult(id, { balance: '1000000', nonce: '0', stake: '0' }));
        return;
      case 'boing_getBalance':
        await fulfillJsonRpc(route, jsonRpcResult(id, '1000000'));
        return;
      case 'boing_getNonce':
        await fulfillJsonRpc(route, jsonRpcResult(id, '0'));
        return;
      case 'boing_chainHeight':
        await fulfillJsonRpc(route, jsonRpcResult(id, 1));
        return;
      case 'boing_simulateTransaction':
        await fulfillJsonRpc(route, jsonRpcResult(id, { success: true }));
        return;
      case 'boing_submitTransaction':
        await fulfillJsonRpc(route, jsonRpcResult(id, '0x' + 'ab'.repeat(32)));
        return;
      case 'boing_faucetRequest':
        await fulfillJsonRpc(route, jsonRpcResult(id, { success: true }));
        return;
      default:
        await fulfillJsonRpc(route, jsonRpcError(id, -32601, 'Method not found (E2E mock)'));
        return;
    }
  });
}
