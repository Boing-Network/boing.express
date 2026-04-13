/**
 * Default JSON-RPC methods allowed through the Boing Express RPC gateway.
 * Operators can override with env GATEWAY_METHOD_ALLOWLIST (comma-separated).
 * Intentionally excludes state-changing methods (e.g. submit) unless widened explicitly.
 */
export const DEFAULT_GATEWAY_METHOD_ALLOWLIST = [
  'boing_health',
  'boing_listDexPools',
  'boing_listDexTokens',
  'boing_getDexToken',
  'boing_getNetworkInfo',
  'boing_chainHeight',
  'boing_getSyncState',
  'boing_rpcSupportedMethods',
  'boing_getRpcMethodCatalog',
  'boing_getRpcOpenApi',
] as const;

export function parseAllowlist(raw: string | undefined): Set<string> {
  const trimmed = raw?.trim();
  if (trimmed) {
    return new Set(
      trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return new Set(DEFAULT_GATEWAY_METHOD_ALLOWLIST);
}

/** Extract `method` from a single JSON-RPC request object. */
function methodFromEntry(entry: unknown): string | null {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const m = (entry as { method?: unknown }).method;
  return typeof m === 'string' && m.length > 0 ? m : null;
}

/**
 * Collect all JSON-RPC `method` strings from a parsed body.
 * Supports single object or batch array (JSON-RPC batch).
 */
export function collectMethodsFromPayload(body: unknown): string[] {
  if (Array.isArray(body)) {
    const out: string[] = [];
    for (const item of body) {
      const m = methodFromEntry(item);
      if (m) out.push(m);
    }
    return out;
  }
  const one = methodFromEntry(body);
  return one ? [one] : [];
}

/** Human-readable reason if the payload must be rejected before upstream, or null if OK. */
export function denyReasonForPayload(body: unknown, allowed: Set<string>): string | null {
  const methods = collectMethodsFromPayload(body);
  if (methods.length === 0) {
    return 'invalid_jsonrpc_body';
  }
  for (const m of methods) {
    if (!allowed.has(m)) {
      return `method_not_allowed:${m}`;
    }
  }
  return null;
}
