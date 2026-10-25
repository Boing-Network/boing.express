/**
 * Explorer (boing.observer) deep links. The base URL is per network (`NetworkConfig.explorerUrl`, which the
 * boing.network `ecosystem.explorer_url` meta can override) and falls back to the node's own
 * `end_user.explorer_url`. The observer needs `?network=` to pick the chain it renders.
 */
import { cleanHttpUrl, fetchNetworkInfoMeta } from './networkInfo';

export const DEFAULT_EXPLORER_URL = 'https://boing.observer';

const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;

function hex64(v: string): string | null {
  const t = v.trim();
  return HEX64.test(t) ? `0x${t.replace(/^0x/i, '').toLowerCase()}` : null;
}

/** Configured base, else the node's, else null (no explorer for this network). */
export function resolveExplorerBase(configured?: string | null, fromNode?: string | null): string | null {
  return cleanHttpUrl(configured) ?? cleanHttpUrl(fromNode) ?? null;
}

/** `<base>/tx/<id>?network=testnet|mainnet`, or null when the id is not a 32-byte hex. */
export function explorerTxUrl(base: string | null | undefined, txId: string, isTestnet: boolean): string | null {
  const b = cleanHttpUrl(base);
  const id = hex64(txId);
  if (!b || !id) return null;
  return `${b}/tx/${id}?network=${isTestnet ? 'testnet' : 'mainnet'}`;
}

/** `<base>/account/<addr>?network=testnet|mainnet`, or null when the address is not a 32-byte hex. */
export function explorerAccountUrl(base: string | null | undefined, address: string, isTestnet: boolean): string | null {
  const b = cleanHttpUrl(base);
  const a = hex64(address);
  if (!b || !a) return null;
  return `${b}/account/${a}?network=${isTestnet ? 'testnet' : 'mainnet'}`;
}
/** Explorer base for a network: the wallet's configured one (ecosystem meta can override), else the node's own `end_user.explorer_url`. */
export async function explorerBaseFor(config: { explorerUrl?: string; rpcUrl: string }): Promise<string | null> {
  const configured = resolveExplorerBase(config.explorerUrl, null);
  if (configured) return configured;
  return resolveExplorerBase(null, (await fetchNetworkInfoMeta(config.rpcUrl)).explorerUrl);
}