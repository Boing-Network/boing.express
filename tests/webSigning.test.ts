import { describe, expect, it } from 'vitest';
import {
  WebRequestError,
  buildWebResponse,
  createConnectedSitesStore,
  createStorageReplayStore,
  decodeB64UrlJson,
  encodeB64UrlJson,
  isAllowedReturnUrl,
  normalizeWebOrigin,
  parseRequestFromHash,
  redirectResponseUrl,
  validateWebRequest,
  WEB_MAX_TTL_MS,
  type ValidateContext,
} from '../src/boing/webSigning';
import { looksLikeTransactionPreimage, messageToBytes } from '../src/boing/messageSigning';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const NOW = 1_800_000_000_000;
const ORIGIN = 'https://boing.finance';
function req(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: 'boing_web_request',
    id: 'a'.repeat(32),
    method: 'boing_signMessage',
    params: ['hello'],
    origin: ORIGIN,
    returnUrl: `${ORIGIN}/swap`,
    chainId: '0x1b01',
    issuedAt: NOW - 1000,
    expiresAt: NOW + 60_000,
    ...over,
  };
}
function ctx(over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    now: NOW,
    transport: 'popup',
    eventOrigin: ORIGIN,
    walletChainId: '0x1b01',
    seen: createStorageReplayStore(memStorage(), () => NOW),
    ...over,
  };
}
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof WebRequestError ? e.boingCode : `other:${String(e)}`;
  }
  return 'none';
}

describe('validateWebRequest', () => {
  it('accepts a well-formed popup request', () => {
    const v = validateWebRequest(req(), ctx());
    expect(v.origin).toBe(ORIGIN);
    expect(v.method).toBe('boing_signMessage');
  });
  it('rejects bad shape / version / method / id', () => {
    expect(code(() => validateWebRequest(null, ctx()))).toBe('BOING_WEB_BAD_REQUEST');
    expect(code(() => validateWebRequest(req({ v: 2 }), ctx()))).toBe('BOING_WEB_BAD_REQUEST');
    expect(code(() => validateWebRequest(req({ method: 'boing_exportKey' }), ctx()))).toBe('BOING_WEB_UNSUPPORTED_METHOD');
    expect(code(() => validateWebRequest(req({ id: 'short' }), ctx()))).toBe('BOING_WEB_BAD_REQUEST');
    expect(code(() => validateWebRequest(req({ params: 'x' }), ctx()))).toBe('BOING_WEB_BAD_REQUEST');
  });
  it('binds origin: popup event.origin must match', () => {
    expect(code(() => validateWebRequest(req(), ctx({ eventOrigin: 'https://evil.example' })))).toBe('BOING_WEB_ORIGIN_MISMATCH');
    expect(code(() => validateWebRequest(req(), ctx({ eventOrigin: undefined })))).toBe('BOING_WEB_ORIGIN_MISMATCH');
  });
  it('binds origin: redirect referrer must match when present', () => {
    expect(code(() => validateWebRequest(req(), ctx({ transport: 'redirect', eventOrigin: undefined, referrerOrigin: 'https://evil.example' })))).toBe('BOING_WEB_ORIGIN_MISMATCH');
    expect(validateWebRequest(req(), ctx({ transport: 'redirect', eventOrigin: undefined, referrerOrigin: null })).origin).toBe(ORIGIN);
  });
  it('rejects non-https origins and foreign return URLs', () => {
    expect(code(() => validateWebRequest(req({ origin: 'http://boing.finance' }), ctx({ eventOrigin: 'http://boing.finance' })))).toBe('BOING_WEB_BAD_ORIGIN');
    expect(code(() => validateWebRequest(req({ returnUrl: 'https://evil.example/x' }), ctx()))).toBe('BOING_WEB_BAD_RETURN_URL');
    expect(code(() => validateWebRequest(req({ returnUrl: `${ORIGIN}/x#frag` }), ctx()))).toBe('BOING_WEB_BAD_RETURN_URL');
  });
  it('enforces expiry, max TTL and clock skew', () => {
    expect(code(() => validateWebRequest(req({ expiresAt: NOW - 1 }), ctx()))).toBe('BOING_WEB_EXPIRED');
    expect(code(() => validateWebRequest(req({ issuedAt: NOW + 120_000, expiresAt: NOW + 180_000 }), ctx()))).toBe('BOING_WEB_EXPIRED');
    expect(code(() => validateWebRequest(req({ issuedAt: NOW, expiresAt: NOW + WEB_MAX_TTL_MS + 1 }), ctx()))).toBe('BOING_WEB_BAD_REQUEST');
  });
  it('detects replays', () => {
    const c = ctx();
    const v = validateWebRequest(req(), c);
    c.seen.add(v.id, v.expiresAt);
    const err = (() => {
      try {
        validateWebRequest(req(), c);
      } catch (e) {
        return e as WebRequestError;
      }
    })();
    expect(err?.boingCode).toBe('BOING_WEB_REPLAY');
  });
  it('prunes expired replay ids', () => {
    const s = memStorage();
    let t = NOW;
    const store = createStorageReplayStore(s, () => t);
    store.add('a'.repeat(32), NOW + 1000);
    expect(store.has('a'.repeat(32))).toBe(true);
    t = NOW + 1000 + 61_000;
    expect(store.has('a'.repeat(32))).toBe(false);
  });
  it('binds chain id', () => {
    expect(code(() => validateWebRequest(req({ chainId: '0x1b02' }), ctx()))).toBe('BOING_WEB_CHAIN_MISMATCH');
  });
  it('marks late errors respondable but early origin errors not', () => {
    try {
      validateWebRequest(req({ chainId: '0x1b02' }), ctx());
    } catch (e) {
      expect((e as WebRequestError).respondable).toBe(true);
    }
    try {
      validateWebRequest(req(), ctx({ eventOrigin: 'https://evil.example' }));
    } catch (e) {
      expect((e as WebRequestError).respondable).toBe(false);
    }
  });
});

describe('origin helpers', () => {
  it('normalizes origins strictly', () => {
    expect(normalizeWebOrigin('https://boing.finance')).toBe('https://boing.finance');
    expect(normalizeWebOrigin('https://boing.finance/')).toBeNull();
    expect(normalizeWebOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeWebOrigin('http://127.0.0.1:3333')).toBe('http://127.0.0.1:3333');
    expect(normalizeWebOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeWebOrigin('null')).toBeNull();
  });
  it('checks return URLs', () => {
    expect(isAllowedReturnUrl('https://boing.finance/a?b=1', ORIGIN)).toBe(true);
    expect(isAllowedReturnUrl('https://boing.finance.evil.example/', ORIGIN)).toBe(false);
    expect(isAllowedReturnUrl('https://u:p@boing.finance/', ORIGIN)).toBe(false);
  });
});

describe('transport encoding', () => {
  it('round-trips base64url JSON and puts responses in the fragment', () => {
    const r = req({ params: ['ünïcödé ✓'] });
    expect(decodeB64UrlJson(encodeB64UrlJson(r))).toEqual(r);
    expect(parseRequestFromHash(`#req=${encodeB64UrlJson(r)}`)).toEqual(r);
    expect(parseRequestFromHash('#other=1')).toBeNull();
    const resp = buildWebResponse({ id: r.id as string, origin: ORIGIN, chainId: '0x1b01' }, { result: ['0xabc'] });
    const url = redirectResponseUrl(`${ORIGIN}/swap?x=1`, resp);
    expect(url.startsWith(`${ORIGIN}/swap?x=1#boing_web_response=`)).toBe(true);
    expect(new URL(url).search).toBe('?x=1');
  });
});

describe('connected sites', () => {
  it('stores and removes origins', () => {
    const s = createConnectedSitesStore(memStorage());
    expect(s.get(ORIGIN)).toBeNull();
    s.set(ORIGIN, { account: '0x' + '1'.repeat(64), chainId: '0x1b01', connectedAt: 1 });
    expect(s.get(ORIGIN)?.account).toBe('0x' + '1'.repeat(64));
    s.remove(ORIGIN);
    expect(s.get(ORIGIN)).toBeNull();
  });
});

describe('message preimage guard', () => {
  const sender = new Uint8Array(32).fill(7);
  it('refuses tx-shaped messages for the signer', () => {
    const preimage = new Uint8Array(8 + 32 + 10);
    preimage.set(sender, 8);
    expect(looksLikeTransactionPreimage(preimage, sender)).toBe(true);
    const hex = '0x' + Array.from(preimage, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(looksLikeTransactionPreimage(messageToBytes(hex), sender)).toBe(true);
  });
  it('allows normal messages', () => {
    expect(looksLikeTransactionPreimage(messageToBytes('Sign in to boing.finance'), sender)).toBe(false);
    expect(looksLikeTransactionPreimage(new Uint8Array(100), sender)).toBe(false);
  });
});
