/** Strip JSON-RPC `id` so identical logical requests share a cache entry. */
export function stripJsonRpcIds(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map((item) => stripOne(item));
  }
  return stripOne(body);
}

function stripOne(entry: unknown): unknown {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const o = entry as Record<string, unknown>;
  if (!('method' in o)) {
    return entry;
  }
  const { id: _ignored, ...rest } = o;
  return rest;
}

export function cacheKeySourceString(body: unknown): string {
  return JSON.stringify(stripJsonRpcIds(body));
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Synthetic GET request used only as a Cache API key for POST /v1/rpc bodies. */
export async function cacheRequestForRpcBody(workerOrigin: string, body: unknown): Promise<Request> {
  const digest = await sha256Hex(cacheKeySourceString(body));
  const base = workerOrigin.replace(/\/$/, '');
  return new Request(`${base}/__internal/rpc-cache/${digest}`, { method: 'GET' });
}
