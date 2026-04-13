export interface Env {
  /** Full URL of Boing JSON-RPC (e.g. https://testnet-rpc.boing.network). Secret in production. */
  BOING_UPSTREAM_RPC_URL: string;
  /** If set, require `Authorization: Bearer <key>` or `X-Boing-Gateway-Key: <key>`. */
  GATEWAY_API_KEY?: string;
  /** Comma-separated method names; overrides default read-only allowlist. */
  GATEWAY_METHOD_ALLOWLIST?: string;
  /** CORS `Access-Control-Allow-Origin` value (default `*`). */
  GATEWAY_CORS_ORIGIN?: string;
  /**
   * When > 0, successful upstream JSON-RPC responses (HTTP 200) may be cached for this many seconds.
   * Cache key ignores JSON-RPC `id` fields so the same logical query hits the same entry.
   */
  GATEWAY_CACHE_TTL_SECONDS?: string;
  /**
   * When > 0, max JSON-RPC POSTs per client identity per minute. Identity = hash(API key material) when
   * present, else hash(client IP). Uses `RATE_LIMIT_KV` when bound, otherwise a per-isolate soft limit.
   */
  GATEWAY_RATE_LIMIT_PER_MINUTE?: string;
  /** Optional KV namespace for distributed rate limiting (see wrangler.toml comments). */
  RATE_LIMIT_KV?: KVNamespace;
}
