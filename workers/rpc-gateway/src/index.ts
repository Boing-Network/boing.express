/// <reference types="@cloudflare/workers-types" />

import { denyReasonForPayload, parseAllowlist } from './allowlist';
import { cacheRequestForRpcBody } from './cacheRpc';
import type { Env } from './env';
import { OPENAPI_GATEWAY_SPEC } from './openapi';
import { rateLimitResponseIfExceeded } from './rateLimit';

export type { Env } from './env';

const MAX_BODY_BYTES = 512 * 1024;

function parseCacheTtlSeconds(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 0;
}

function corsHeaders(env: Env): HeadersInit {
  const allowOrigin = env.GATEWAY_CORS_ORIGIN?.trim() || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === '*' ? '*' : allowOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Boing-Gateway-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function mergeCors(base: Headers, env: Env): void {
  const cors = corsHeaders(env);
  for (const [k, v] of Object.entries(cors)) {
    base.set(k, v);
  }
}

function checkApiKey(request: Request, env: Env): Response | null {
  const key = env.GATEWAY_API_KEY?.trim();
  if (!key) return null;

  const auth = request.headers.get('Authorization')?.trim();
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const headerKey = request.headers.get('X-Boing-Gateway-Key')?.trim();

  if (bearer === key || headerKey === key) return null;

  const body = JSON.stringify({
    error: 'unauthorized',
    message: 'Valid Authorization Bearer or X-Boing-Gateway-Key required.',
  });
  return new Response(body, {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      const h = new Headers();
      mergeCors(h, env);
      return new Response(null, { status: 204, headers: h });
    }

    if (url.pathname === '/openapi.json' && request.method === 'GET') {
      const h = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      mergeCors(h, env);
      return new Response(JSON.stringify(OPENAPI_GATEWAY_SPEC), { headers: h });
    }

    if ((url.pathname === '/' || url.pathname === '/live') && request.method === 'GET') {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      const payload =
        url.pathname === '/live'
          ? { ok: true, service: 'boing-express-rpc-gateway' }
          : {
              service: 'boing-express-rpc-gateway',
              docs: 'POST /v1/rpc with Boing JSON-RPC body; GET /openapi.json',
              rpc: '/v1/rpc',
              openapi: '/openapi.json',
            };
      return new Response(JSON.stringify(payload), { headers: h });
    }

    if (url.pathname !== '/v1/rpc' || request.method !== 'POST') {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(JSON.stringify({ error: 'not_found', path: url.pathname }), {
        status: 404,
        headers: h,
      });
    }

    const authFail = checkApiKey(request, env);
    if (authFail) {
      mergeCors(authFail.headers, env);
      return authFail;
    }

    const upstream = env.BOING_UPSTREAM_RPC_URL?.trim();
    if (!upstream) {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(
        JSON.stringify({ error: 'misconfigured', message: 'BOING_UPSTREAM_RPC_URL is not set.' }),
        { status: 500, headers: h }
      );
    }

    const len = request.headers.get('Content-Length');
    if (len != null && /^\d+$/.test(len) && Number.parseInt(len, 10) > MAX_BODY_BYTES) {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: h });
    }

    let parsed: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
        mergeCors(h, env);
        return new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: h });
      }
      parsed = JSON.parse(text) as unknown;
    } catch {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: h });
    }

    const allowed = parseAllowlist(env.GATEWAY_METHOD_ALLOWLIST);
    const deny = denyReasonForPayload(parsed, allowed);
    if (deny) {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(JSON.stringify({ error: 'forbidden', reason: deny }), { status: 403, headers: h });
    }

    const rl = await rateLimitResponseIfExceeded(request, env);
    if (rl) {
      mergeCors(rl.headers, env);
      return rl;
    }

    const cacheTtl = parseCacheTtlSeconds(env.GATEWAY_CACHE_TTL_SECONDS);
    const cacheReq = cacheTtl > 0 ? await cacheRequestForRpcBody(url.origin, parsed) : null;
    if (cacheReq) {
      const cached = await caches.default.match(cacheReq);
      if (cached) {
        const h = new Headers(cached.headers);
        h.set('X-Gateway-Cache', 'HIT');
        mergeCors(h, env);
        return new Response(cached.body, { status: cached.status, headers: h });
      }
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(parsed),
      });
    } catch {
      const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      mergeCors(h, env);
      return new Response(JSON.stringify({ error: 'upstream_unreachable' }), { status: 502, headers: h });
    }

    const text = await upstreamRes.text();
    const outHeaders = new Headers();
    const ct = upstreamRes.headers.get('Content-Type');
    outHeaders.set('Content-Type', ct && ct.includes('json') ? ct : 'application/json; charset=utf-8');
    outHeaders.set('X-Gateway-Cache', 'MISS');
    mergeCors(outHeaders, env);

    if (cacheTtl > 0 && cacheReq && upstreamRes.status === 200) {
      const toCacheHeaders = new Headers(outHeaders);
      toCacheHeaders.set('Cache-Control', `public, max-age=${cacheTtl}`);
      toCacheHeaders.delete('X-Gateway-Cache');
      const cacheable = new Response(text, { status: upstreamRes.status, headers: toCacheHeaders });
      ctx.waitUntil(caches.default.put(cacheReq, cacheable));
    }

    return new Response(text, { status: upstreamRes.status, headers: outHeaders });
  },
};
