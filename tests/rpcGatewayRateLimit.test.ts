import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../workers/rpc-gateway/src/env';
import {
  rateLimitResponseIfExceeded,
  resetRateLimitStateForTests,
} from '../workers/rpc-gateway/src/rateLimit';

function req(ip = '203.0.113.7'): Request {
  return new Request('https://gw.test/v1/rpc', { method: 'POST', headers: { 'cf-connecting-ip': ip } });
}

function fakeKv(opts: { putThrows?: boolean; getThrows?: boolean } = {}) {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (k: string) => {
      if (opts.getThrows) throw new Error('KV GET failed: simulated');
      return store.get(k) ?? null;
    }),
    put: vi.fn(async (k: string, v: string) => {
      if (opts.putThrows) throw new Error('KV put() limit exceeded for the day.');
      store.set(k, v);
    }),
  };
  return kv as unknown as KVNamespace & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
}

function env(extra: Partial<Env> = {}): Env {
  return { BOING_UPSTREAM_RPC_URL: 'https://example.invalid', GATEWAY_RATE_LIMIT_PER_MINUTE: '3', ...extra };
}

describe('rpc gateway rate limiter', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetRateLimitStateForTests();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('is disabled when the limit is 0 or unset', async () => {
    expect(await rateLimitResponseIfExceeded(req(), env({ GATEWAY_RATE_LIMIT_PER_MINUTE: '0' }))).toBeNull();
    expect(await rateLimitResponseIfExceeded(req(), env({ GATEWAY_RATE_LIMIT_PER_MINUTE: undefined }))).toBeNull();
  });

  it('uses KV normally and returns 429 past the limit', async () => {
    const kv = fakeKv();
    const e = env({ RATE_LIMIT_KV: kv });
    for (let i = 0; i < 3; i++) expect(await rateLimitResponseIfExceeded(req(), e)).toBeNull();
    const res = await rateLimitResponseIfExceeded(req(), e);
    expect(res?.status).toBe(429);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not throw when kv.put throws (daily quota): falls back to the soft limiter and still limits', async () => {
    const kv = fakeKv({ putThrows: true });
    const e = env({ RATE_LIMIT_KV: kv });
    for (let i = 0; i < 3; i++) expect(await rateLimitResponseIfExceeded(req(), e)).toBeNull();
    const res = await rateLimitResponseIfExceeded(req(), e);
    expect(res?.status).toBe(429);
  });

  it('does not throw when kv.get throws', async () => {
    const e = env({ RATE_LIMIT_KV: fakeKv({ getThrows: true }) });
    expect(await rateLimitResponseIfExceeded(req(), e)).toBeNull();
  });

  it('warns once per isolate, without secrets, and skips KV during the cooldown', async () => {
    const kv = fakeKv({ putThrows: true });
    const e = env({ RATE_LIMIT_KV: kv, GATEWAY_RATE_LIMIT_PER_MINUTE: '1000' });
    for (let i = 0; i < 5; i++) await rateLimitResponseIfExceeded(req(), e);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain('KV unavailable');
    expect(text).not.toContain('203.0.113.7');
    // one failed attempt only; later requests go straight to the soft limiter
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('retries KV after the cooldown', async () => {
    vi.useFakeTimers();
    try {
      const kv = fakeKv({ putThrows: true });
      const e = env({ RATE_LIMIT_KV: kv, GATEWAY_RATE_LIMIT_PER_MINUTE: '1000' });
      await rateLimitResponseIfExceeded(req(), e);
      vi.advanceTimersByTime(5 * 60_000 + 1000);
      await rateLimitResponseIfExceeded(req(), e);
      expect(kv.get).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps separate soft buckets per client when KV is down', async () => {
    const e = env({ RATE_LIMIT_KV: fakeKv({ putThrows: true }), GATEWAY_RATE_LIMIT_PER_MINUTE: '1' });
    expect(await rateLimitResponseIfExceeded(req('198.51.100.1'), e)).toBeNull();
    expect((await rateLimitResponseIfExceeded(req('198.51.100.1'), e))?.status).toBe(429);
    expect(await rateLimitResponseIfExceeded(req('198.51.100.2'), e)).toBeNull();
  });
});
