import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SESSION_MS,
  clearSession,
  getSession,
  isSessionExpired,
  resetTouchThrottleForTests,
  saveSession,
  setSessionKeyStoreForTests,
  touchSession,
  type SessionKeyStore,
} from '../src/storage/sessionStore';

function fakeSessionStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => [...m.values()].join('\n'),
  };
}

function memoryKeyStore() {
  const keys = new Map<string, CryptoKey>();
  const s: SessionKeyStore = {
    get: async (id) => keys.get(id) ?? null,
    put: async (id, k) => void keys.set(id, k),
    delete: async (id) => void keys.delete(id),
  };
  return { s, keys, peek: () => [...keys.values()][0] ?? null };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const pub = new Uint8Array(32).map((_, i) => i + 1);
const priv = new Uint8Array(32).map((_, i) => 200 - i);

let ss: ReturnType<typeof fakeSessionStorage>;
let ks: ReturnType<typeof memoryKeyStore>;

beforeEach(() => {
  ss = fakeSessionStorage();
  ks = memoryKeyStore();
  vi.stubGlobal('sessionStorage', ss);
  setSessionKeyStoreForTests(ks.s);
  resetTouchThrottleForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionKeyStoreForTests(null);
});

describe('sealed web session', () => {
  it('round-trips the key pair and never stores the private key in plaintext', async () => {
    expect(await saveSession(pub, priv)).toBe(true);
    const stored = ss.dump();
    expect(stored).not.toContain('privateKeyBase64');
    expect(stored).not.toContain(Buffer.from(priv).toString('base64'));
    expect(stored).not.toContain(hex(priv));
    const got = await getSession();
    expect(got && hex(got.publicKey)).toBe(hex(pub));
    expect(got && hex(got.privateKey)).toBe(hex(priv));
  });

  it('uses a non-extractable AES-GCM key', async () => {
    await saveSession(pub, priv);
    const k = ks.peek()!;
    expect(k.extractable).toBe(false);
    expect(k.algorithm.name).toBe('AES-GCM');
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });

  it('is locked once the sealing key is gone or the ciphertext is tampered with', async () => {
    await saveSession(pub, priv);
    ks.keys.clear();
    expect(await getSession()).toBeNull();
    expect(ss.dump()).toBe('');

    await saveSession(pub, priv);
    const env = JSON.parse(ss.getItem('boing_session')!);
    env.ct = env.ct.slice(0, -4) + 'AAAA';
    ss.setItem('boing_session', JSON.stringify(env));
    expect(await getSession()).toBeNull();
    expect(ss.dump()).toBe('');
  });

  it('clearSession removes both the ciphertext and the sealing key', async () => {
    await saveSession(pub, priv);
    clearSession();
    await Promise.resolve();
    expect(ss.dump()).toBe('');
    expect(ks.peek()).toBeNull();
    expect(await getSession()).toBeNull();
  });

  it('keeps one sealing key per tab so a second tab cannot lock out the first', async () => {
    await saveSession(pub, priv);
    const tabA = ss.dump();
    const keyA = ss.getItem('boing_session_kid');
    // second tab: its own sessionStorage, same (shared) key store
    const ssB = fakeSessionStorage();
    vi.stubGlobal('sessionStorage', ssB);
    await saveSession(pub, priv);
    expect(ssB.getItem('boing_session_kid')).not.toBe(keyA);
    expect(ks.keys.size).toBe(2);
    vi.stubGlobal('sessionStorage', ss);
    expect(tabA).toBe(ss.dump());
    expect(await getSession()).not.toBeNull();
    clearSession();
    expect(ks.keys.size).toBe(1);
  });

  it('persists nothing (no plaintext fallback) when sealing fails', async () => {
    setSessionKeyStoreForTests({ get: async () => null, put: async () => Promise.reject(new Error('no idb')), delete: async () => {} });
    expect(await saveSession(pub, priv)).toBe(false);
    expect(ss.dump()).toBe('');
  });

  it('rejects wrong-sized keys', async () => {
    expect(await saveSession(new Uint8Array(31), priv)).toBe(false);
    expect(ss.dump()).toBe('');
  });
});

describe('expiry and auto-lock', () => {
  it('expires after the idle auto-lock window and after the absolute lifetime', () => {
    const env = { createdAt: 1_000_000, lastActiveAt: 1_000_000 };
    expect(isSessionExpired(env, { now: 1_000_000 + 4 * 60_000, lockAfterMinutes: 5 })).toBe(false);
    expect(isSessionExpired(env, { now: 1_000_000 + 6 * 60_000, lockAfterMinutes: 5 })).toBe(true);
    expect(isSessionExpired(env, { now: 1_000_000 + 6 * 60_000, lockAfterMinutes: 0 })).toBe(false);
    expect(isSessionExpired(env, { now: 1_000_000 + MAX_SESSION_MS + 1, lockAfterMinutes: 0 })).toBe(true);
    expect(isSessionExpired({ createdAt: NaN, lastActiveAt: 1 }, {})).toBe(true);
  });

  it('getSession honours the idle window and wipes an expired session', async () => {
    const t0 = Date.now();
    await saveSession(pub, priv, t0 - 10 * 60_000);
    expect(await getSession({ lockAfterMinutes: 5, now: t0 })).toBeNull();
    expect(ss.dump()).toBe('');
  });

  it('touchSession keeps an active session alive across the idle window', async () => {
    const t0 = Date.now();
    await saveSession(pub, priv, t0 - 10 * 60_000);
    touchSession(t0 - 60_000);
    expect(await getSession({ lockAfterMinutes: 5, now: t0 })).not.toBeNull();
  });
});

describe('legacy plaintext migration', () => {
  const legacy = JSON.stringify({ publicKeyBase64: Buffer.from(pub).toString('base64'), privateKeyBase64: Buffer.from(priv).toString('base64') });

  it('re-seals a v1 session once and removes the plaintext', async () => {
    ss.setItem('boing_session', legacy);
    const got = await getSession();
    expect(got && hex(got.privateKey)).toBe(hex(priv));
    expect(ss.dump()).not.toContain('privateKeyBase64');
    expect(ss.dump()).not.toContain(Buffer.from(priv).toString('base64'));
    const again = await getSession();
    expect(again && hex(again.privateKey)).toBe(hex(priv));
  });

  it('deletes the plaintext and locks when re-sealing is impossible', async () => {
    setSessionKeyStoreForTests({ get: async () => null, put: async () => Promise.reject(new Error('no idb')), delete: async () => {} });
    ss.setItem('boing_session', legacy);
    expect(await getSession()).toBeNull();
    expect(ss.dump()).toBe('');
  });

  it('deletes a malformed legacy session', async () => {
    ss.setItem('boing_session', '{"privateKeyBase64":"AA=="}');
    expect(await getSession()).toBeNull();
    expect(ss.dump()).toBe('');
  });
});