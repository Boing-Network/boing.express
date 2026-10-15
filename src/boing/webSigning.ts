/**
 * Web signing flow (boing.express/connect): lets dApps on mobile / non-Chrome browsers use the web
 * wallet when no `window.boing` extension provider exists. See docs/WEB-SIGNING-FLOW.md.
 *
 * This module is pure (no DOM, no keys): request validation, replay store, response building and
 * fragment encoding. The screen (src/screens/WebSign.tsx) does approval UI and signing.
 */

export const WEB_SIGNING_VERSION = 1 as const;
export const WEB_REQUEST_TYPE = 'boing_web_request';
export const WEB_RESPONSE_TYPE = 'boing_web_response';
export const WEB_READY_TYPE = 'boing_web_ready';
/** Fragment key used for redirect-mode requests (`/connect#req=...`). */
export const WEB_REQUEST_FRAGMENT_KEY = 'req';
/** Fragment key the wallet appends to the dApp's return URL (`#boing_web_response=...`). */
export const WEB_RESPONSE_FRAGMENT_KEY = 'boing_web_response';

export const WEB_METHODS = [
  'boing_requestAccounts',
  'boing_signMessage',
  'boing_signTransaction',
  'boing_sendTransaction',
] as const;
export type WebMethod = (typeof WEB_METHODS)[number];

/** Max request lifetime (expiresAt - issuedAt). */
export const WEB_MAX_TTL_MS = 10 * 60_000;
/** Tolerated clock skew between dApp and wallet. */
export const WEB_CLOCK_SKEW_MS = 60_000;
/** Max serialized request size accepted. */
export const WEB_MAX_REQUEST_BYTES = 64 * 1024;

/** First-party apps shown as "Boing app" in the approval UI. Other origins are allowed but flagged. */
export const WEB_KNOWN_APPS: Readonly<Record<string, string>> = {
  'https://boing.finance': 'boing.finance',
  'https://www.boing.finance': 'boing.finance',
  'https://boing.observer': 'Boing Observer',
  'https://www.boing.observer': 'Boing Observer',
  'https://boing.network': 'boing.network',
};

export interface WebSigningRequest {
  v: 1;
  type: typeof WEB_REQUEST_TYPE;
  id: string;
  method: WebMethod;
  params: unknown[];
  origin: string;
  returnUrl: string;
  chainId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WebSigningError {
  code: number;
  message: string;
  data: { boingCode: string };
}

export interface WebSigningResponse {
  v: 1;
  type: typeof WEB_RESPONSE_TYPE;
  id: string;
  origin: string;
  chainId: string;
  result?: unknown;
  error?: WebSigningError;
}

export class WebRequestError extends Error {
  constructor(
    readonly boingCode: string,
    message: string,
    readonly code = 4100,
    /** Request fields we trust enough to address an error response (origin already verified). */
    readonly respondable = false
  ) {
    super(message);
    this.name = 'WebRequestError';
  }
}

export function webError(boingCode: string, message: string, code = 4100): WebSigningError {
  return { code, message, data: { boingCode } };
}

export const USER_REJECTED_ERROR = webError('BOING_USER_REJECTED', 'User rejected the request.', 4001);

/**
 * Normalizes an origin string. Only `https:` origins are accepted, plus `http:` for loopback
 * development hosts. Returns null for anything else (paths, credentials, opaque origins).
 */
export function normalizeWebOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.origin !== value) return null; // reject paths, trailing slashes, userinfo, etc.
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) {
    return u.origin;
  }
  return null;
}

/** Return URL must be absolute, same origin as the request origin, and fragment-free. */
export function isAllowedReturnUrl(returnUrl: unknown, origin: string): returnUrl is string {
  if (typeof returnUrl !== 'string') return false;
  let u: URL;
  try {
    u = new URL(returnUrl);
  } catch {
    return false;
  }
  return u.origin === origin && !returnUrl.includes('#') && !u.username && !u.password;
}

export interface ReplayStore {
  has(id: string): boolean;
  add(id: string, expiresAt: number): void;
}

export interface ValidateContext {
  now: number;
  transport: 'popup' | 'redirect';
  /** popup: `MessageEvent.origin` (browser-authenticated). */
  eventOrigin?: string;
  /** redirect: `document.referrer` origin when the browser sent one. */
  referrerOrigin?: string | null;
  /** Chain id of the wallet's selected network, e.g. `0x1b01`. */
  walletChainId: string;
  seen: ReplayStore;
}

const ID_RE = /^[0-9a-f]{32,64}$/;
const CHAIN_RE = /^0x[0-9a-f]{1,16}$/;

/**
 * Validates an incoming request. Throws {@link WebRequestError}. `respondable` on the error is true
 * once the origin is verified, so the caller may send an error response back to that origin.
 */
export function validateWebRequest(raw: unknown, ctx: ValidateContext): WebSigningRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WebRequestError('BOING_WEB_BAD_REQUEST', 'Request must be a JSON object.');
  }
  const r = raw as Record<string, unknown>;
  if (r.type !== WEB_REQUEST_TYPE || r.v !== WEB_SIGNING_VERSION) {
    throw new WebRequestError('BOING_WEB_BAD_REQUEST', 'Unsupported request type or version.');
  }
  const origin = normalizeWebOrigin(r.origin);
  if (!origin) {
    throw new WebRequestError('BOING_WEB_BAD_ORIGIN', 'Request origin must be an https origin (or http://localhost).');
  }
  // Origin binding.
  if (ctx.transport === 'popup') {
    if (ctx.eventOrigin !== origin) {
      throw new WebRequestError('BOING_WEB_ORIGIN_MISMATCH', 'Request origin does not match the page that sent it.');
    }
  } else if (ctx.referrerOrigin && ctx.referrerOrigin !== origin) {
    throw new WebRequestError('BOING_WEB_ORIGIN_MISMATCH', 'Request origin does not match the referring page.');
  }
  if (!isAllowedReturnUrl(r.returnUrl, origin)) {
    throw new WebRequestError('BOING_WEB_BAD_RETURN_URL', 'returnUrl must be a fragment-free URL on the requesting origin.');
  }
  // From here on the response can be addressed to `origin` (popup: verified; redirect: returnUrl on origin).
  const fail = (code: string, msg: string, n = 4100): never => {
    throw new WebRequestError(code, msg, n, true);
  };
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) fail('BOING_WEB_BAD_REQUEST', 'id must be 32-64 lowercase hex chars.');
  if (typeof r.method !== 'string' || !(WEB_METHODS as readonly string[]).includes(r.method)) {
    fail('BOING_WEB_UNSUPPORTED_METHOD', `Unsupported method: ${String(r.method)}`, 4200);
  }
  if (!Array.isArray(r.params) || r.params.length > 1) fail('BOING_WEB_BAD_REQUEST', 'params must be an array with at most one element.');
  const chainId = typeof r.chainId === 'string' ? r.chainId.toLowerCase() : '';
  if (!CHAIN_RE.test(chainId)) fail('BOING_WEB_BAD_REQUEST', 'chainId must be a hex chain id like 0x1b01.');
  const issuedAt = r.issuedAt;
  const expiresAt = r.expiresAt;
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number' || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    fail('BOING_WEB_BAD_REQUEST', 'issuedAt / expiresAt must be millisecond timestamps.');
  }
  const iat = issuedAt as number;
  const exp = expiresAt as number;
  if (exp <= iat || exp - iat > WEB_MAX_TTL_MS) fail('BOING_WEB_BAD_REQUEST', 'Request lifetime must be positive and at most 10 minutes.');
  if (iat > ctx.now + WEB_CLOCK_SKEW_MS) fail('BOING_WEB_EXPIRED', 'Request is not valid yet (check the device clock).');
  if (ctx.now > exp) fail('BOING_WEB_EXPIRED', 'Request expired. Start again from the app.');
  if (ctx.seen.has(r.id as string)) fail('BOING_WEB_REPLAY', 'This request was already handled.');
  if (chainId !== ctx.walletChainId.toLowerCase()) {
    fail('BOING_WEB_CHAIN_MISMATCH', `The app asked for chain ${chainId} but Boing Express is on ${ctx.walletChainId}. Switch network in the wallet, then retry from the app.`, 4901);
  }
  return {
    v: 1,
    type: WEB_REQUEST_TYPE,
    id: r.id as string,
    method: r.method as WebMethod,
    params: r.params as unknown[],
    origin,
    returnUrl: r.returnUrl as string,
    chainId,
    issuedAt: iat,
    expiresAt: exp,
  };
}

/** Partially trusted request fields to address an error response when validation failed late. */
export function respondTarget(raw: unknown): { id: string; origin: string; returnUrl: string; chainId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const origin = normalizeWebOrigin(r.origin);
  if (!origin || !isAllowedReturnUrl(r.returnUrl, origin)) return null;
  return {
    id: typeof r.id === 'string' ? r.id.slice(0, 64) : '',
    origin,
    returnUrl: r.returnUrl as string,
    chainId: typeof r.chainId === 'string' ? r.chainId.slice(0, 18).toLowerCase() : '',
  };
}

export function buildWebResponse(
  req: { id: string; origin: string; chainId: string },
  outcome: { result: unknown } | { error: WebSigningError }
): WebSigningResponse {
  const base = { v: 1 as const, type: WEB_RESPONSE_TYPE as typeof WEB_RESPONSE_TYPE, id: req.id, origin: req.origin, chainId: req.chainId };
  return 'error' in outcome ? { ...base, error: outcome.error } : { ...base, result: outcome.result };
}

function bytesToB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64UrlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
export function encodeB64UrlJson(v: unknown): string {
  return bytesToB64Url(new TextEncoder().encode(JSON.stringify(v)));
}
export function decodeB64UrlJson(s: string): unknown {
  if (s.length > (WEB_MAX_REQUEST_BYTES * 4) / 3 + 8) throw new WebRequestError('BOING_WEB_BAD_REQUEST', 'Request too large.');
  return JSON.parse(new TextDecoder().decode(b64UrlToBytes(s)));
}

/** Reads a redirect-mode request from `location.hash` (`#req=<base64url JSON>`). */
export function parseRequestFromHash(hash: string): unknown | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const v = new URLSearchParams(h).get(WEB_REQUEST_FRAGMENT_KEY);
  if (!v) return null;
  try {
    return decodeB64UrlJson(v);
  } catch {
    throw new WebRequestError('BOING_WEB_BAD_REQUEST', 'Could not decode the request.');
  }
}

/** Redirect-mode response target: the declared return URL with the response in the fragment (never the query). */
export function redirectResponseUrl(returnUrl: string, resp: WebSigningResponse): string {
  return `${returnUrl}#${WEB_RESPONSE_FRAGMENT_KEY}=${encodeB64UrlJson(resp)}`;
}

const SEEN_KEY = 'boing_web_seen_requests';
/** Replay store in localStorage: ids are kept until they expire (+ skew), then pruned. */
export function createStorageReplayStore(storage: Pick<Storage, 'getItem' | 'setItem'>, now: () => number): ReplayStore {
  const read = (): Record<string, number> => {
    try {
      const o = JSON.parse(storage.getItem(SEEN_KEY) || '{}') as Record<string, number>;
      const t = now();
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && v + WEB_CLOCK_SKEW_MS > t) out[k] = v;
      return out;
    } catch {
      return {};
    }
  };
  return {
    has: (id) => Object.prototype.hasOwnProperty.call(read(), id),
    add: (id, expiresAt) => {
      const o = read();
      o[id] = expiresAt;
      try {
        storage.setItem(SEEN_KEY, JSON.stringify(o));
      } catch {
        /* storage full: request still single-use within this page */
      }
    },
  };
}

const CONNECTED_KEY = 'boing_web_connected_sites';
export interface WebConnectedSite {
  account: string;
  chainId: string;
  connectedAt: number;
}
/** Origins the user approved in a separate connect step (signing requires this). */
export function createConnectedSitesStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const read = (): Record<string, WebConnectedSite> => {
    try {
      return JSON.parse(storage.getItem(CONNECTED_KEY) || '{}') as Record<string, WebConnectedSite>;
    } catch {
      return {};
    }
  };
  return {
    get: (origin: string): WebConnectedSite | null => read()[origin] ?? null,
    set: (origin: string, site: WebConnectedSite) => {
      const o = read();
      o[origin] = site;
      storage.setItem(CONNECTED_KEY, JSON.stringify(o));
    },
    remove: (origin: string) => {
      const o = read();
      delete o[origin];
      storage.setItem(CONNECTED_KEY, JSON.stringify(o));
    },
    list: () => read(),
  };
}
