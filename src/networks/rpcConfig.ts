import { BUILTIN_NETWORKS } from './chainDefaults.generated';

/** Generated default (boing.network chain-metadata.json); VITE_BOING_TESTNET_RPC still overrides it. */
const DEFAULT_TESTNET_RPC = BUILTIN_NETWORKS.testnet.defaultRpcUrl;

function normalizeRpcUrl(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function resolveTestnetRpcUrl(value: string | null | undefined): string {
  return normalizeRpcUrl(value) || DEFAULT_TESTNET_RPC;
}

export function resolveMainnetRpcUrl(value: string | null | undefined): string {
  return normalizeRpcUrl(value);
}

export function toExtensionHostPermission(rpcUrl: string): string | null {
  const normalized = normalizeRpcUrl(rpcUrl);
  if (!normalized) return null;

  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  return `${parsed.origin}/*`;
}

export { DEFAULT_TESTNET_RPC };
