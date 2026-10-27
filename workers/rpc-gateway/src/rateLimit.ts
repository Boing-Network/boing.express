import type { Env } from './env';
import { sha256Hex } from './cacheRpc';

/** Best-effort per-isolate sliding window when KV is not bound. */
const softBuckets = new Map<string, { count: number; windowEnd: number }>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function extractClientKeyMaterial(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const auth = request.headers.get('Authorization')?.trim();
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const headerKey = request.headers.get('X-Boing-Gateway-Key')?.trim();
  const key = bearer || headerKey;
  if (key) return `key:${key}`;
  return `ip:${ip}`;
}

async function identityTag(request: Request): Promise<string> {
  return sha256Hex(extractClientKeyMaterial(request));
}

function pruneSoftBuckets(): void {
  if (softBuckets.size < 4000) return;
  const now = Date.now();
  for (const [k, v] of softBuckets) {
    if (v.windowEnd < now) softBuckets.delete(k);
    if (softBuckets.size < 3000) break;
  }
}

export function checkSoftRateLimit(bucketKey: string, limit: number): boolean {
  pruneSoftBuckets();
  const now = Date.now();
  const windowMs = 60_000;
  const row = softBuckets.get(bucketKey);
  if (!row || now >= row.windowEnd) {
    softBuckets.set(bucketKey, { count: 1, windowEnd: now + windowMs });
    return true;
  }
  if (row.count >= limit) {
    return false;
  }
  row.count += 1;
  return true;
}

/** After a KV failure (quota, outage), skip KV for this long and use the soft limiter instead. */
const KV_COOLDOWN_MS = 5 * 60_000;
let kvDisabledUntil = 0;
let kvWarned = false;

function noteKvFailure(err: unknown): void {
  kvDisabledUntil = Date.now() + KV_COOLDOWN_MS;
  if (!kvWarned) {
    kvWarned = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`rate-limit: KV unavailable, using in-isolate limiter (${msg.slice(0, 160)})`);
  }
}

/** Test helper: reset module state. */
export function resetRateLimitStateForTests(): void {
  softBuckets.clear();
  kvDisabledUntil = 0;
  kvWarned = false;
}

/** Throws when KV fails; the caller falls back to the soft limiter. */
async function checkKvRateLimit(kv: KVNamespace, bucketKey: string, limit: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${minute}:${bucketKey}`;
  const raw = await kv.get(key);
  const n = raw != null && raw !== '' ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) {
    await kv.put(key, '1', { expirationTtl: 120 });
    return true;
  }
  if (n >= limit) {
    return false;
  }
  await kv.put(key, String(n + 1), { expirationTtl: 120 });
  return true;
}

/** True when the request is within the limit. Never throws: KV errors fall back to the soft limiter. */
async function withinLimit(env: Env, id: string, limit: number): Promise<boolean> {
  if (env.RATE_LIMIT_KV && Date.now() >= kvDisabledUntil) {
    try {
      return await checkKvRateLimit(env.RATE_LIMIT_KV, id, limit);
    } catch (err) {
      noteKvFailure(err);
    }
  }
  return checkSoftRateLimit(id, limit);
}

/**
 * @returns JSON Response when rate limited, or null when allowed.
 */
export async function rateLimitResponseIfExceeded(request: Request, env: Env): Promise<Response | null> {
  const limit = parsePositiveInt(env.GATEWAY_RATE_LIMIT_PER_MINUTE, 0);
  if (limit <= 0) return null;

  let ok = true;
  try {
    const id = await identityTag(request);
    ok = await withinLimit(env, id, limit);
  } catch (err) {
    // Fail open: a limiter fault must never turn into a Worker exception (HTTP 500 / error 1101).
    noteKvFailure(err);
    return null;
  }
  if (ok) return null;

  const body = JSON.stringify({
    error: 'rate_limited',
    message: 'Too many requests. Retry after one minute or align with boing_health.rpc_surface limits.',
  });
  return new Response(body, {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': '60',
    },
  });
}
