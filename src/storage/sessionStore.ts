/**
 * Session-scoped wallet state for the web app.
 *
 * Lets a refresh/navigation in the same tab skip the password prompt WITHOUT leaving the raw private key readable in
 * sessionStorage. The unlocked key is sealed with AES-256-GCM under a fresh, NON-EXTRACTABLE WebCrypto key. That key
 * lives only in IndexedDB as an opaque CryptoKey handle (scripts can use it but can never read its bytes), and only
 * ciphertext goes to sessionStorage. So a storage dump, devtools "Application" tab, synced profile or crash report
 * shows ciphertext, and the sealing key cannot be exported with it.
 *
 * Honest limit: script running in this origin (XSS) can still ask the browser to decrypt while the session is live,
 * exactly as it could read the in-memory key. The mitigations are the idle auto-lock (`lockAfterMinutes`), an absolute
 * session lifetime (`MAX_SESSION_MS`), and clearing everything on lock/logout/tab close. We never fall back to
 * plaintext: if WebCrypto or IndexedDB is unavailable the session is simply not persisted (the user re-enters the password).
 *
 * Migration: a legacy v1 session (`privateKeyBase64` in sessionStorage) is re-sealed once and the plaintext is removed
 * before anything else happens; if re-sealing is impossible the plaintext is deleted and the user unlocks again.
 */

const SESSION_KEY = 'boing_session';
const ENVELOPE_VERSION = 2;
const AAD = new TextEncoder().encode('boing-express/web-session/v2');

/** Hard ceiling on one unlocked session, whatever the auto-lock setting (12 hours). */
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
/** `lastActiveAt` is rewritten at most this often. */
const TOUCH_INTERVAL_MS = 15_000;

interface SessionEnvelope {
  v: 2;
  /** base64 AES-GCM nonce */
  iv: string;
  /** base64 ciphertext of publicKey(32) || privateKey(32), with the GCM tag */
  ct: string;
  createdAt: number;
  lastActiveAt: number;
}

/** Where the non-extractable sealing key is kept (IndexedDB in browsers; injectable for tests). */
export interface SessionKeyStore {
  get(id: string): Promise<CryptoKey | null>;
  put(id: string, key: CryptoKey): Promise<void>;
  delete(id: string): Promise<void>;
}

const DB_NAME = 'boing_session_keys';
const STORE = 'keys';
/** sessionStorage slot for this tab's sealing-key id (IndexedDB is shared by every tab of the origin, sessionStorage is not). */
const KID_KEY = 'boing_session_kid';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

const indexedDbKeyStore: SessionKeyStore = {
  async get(id) {
    const v = await idbRun<unknown>('readonly', (s) => s.get(id));
    const k = (v as { key?: unknown } | undefined)?.key;
    return typeof CryptoKey !== 'undefined' && k instanceof CryptoKey ? k : null;
  },
  async put(id, key) {
    await idbRun('readwrite', (s) => s.put({ key, at: Date.now() }, id));
    // Sealing keys of tabs that were closed without locking are useless (their ciphertext is gone); drop old ones.
    void pruneStaleKeys().catch(() => {});
  },
  async delete(id) {
    await idbRun('readwrite', (s) => s.delete(id));
  },
};

async function pruneStaleKeys(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const at = (cur.value as { at?: number } | undefined)?.at;
        if (typeof at !== 'number' || Date.now() - at > MAX_SESSION_MS) cur.delete();
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function readKid(): string | null {
  try {
    return sessionStorage.getItem(KID_KEY);
  } catch {
    return null;
  }
}

let keyStore: SessionKeyStore = indexedDbKeyStore;

/** Test hook: swap the key store (pass null to restore IndexedDB). */
export function setSessionKeyStoreForTests(store: SessionKeyStore | null): void {
  keyStore = store ?? indexedDbKeyStore;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readRaw(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function removeRaw(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Seal and persist the unlocked key pair. Resolves false (and stores nothing) when sealing is not possible. */
export async function saveSession(publicKey: Uint8Array, privateKey: Uint8Array, now: number = Date.now()): Promise<boolean> {
  if (publicKey.length !== 32 || privateKey.length !== 32) return false;
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new Uint8Array(64);
    plain.set(publicKey, 0);
    plain.set(privateKey, 32);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plain));
    plain.fill(0);
    const kid = readKid() ?? bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    await keyStore.put(kid, key);
    sessionStorage.setItem(KID_KEY, kid);
    const env: SessionEnvelope = { v: ENVELOPE_VERSION, iv: bytesToBase64(iv), ct: bytesToBase64(ct), createdAt: now, lastActiveAt: now };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(env));
    return true;
  } catch {
    clearSession();
    return false;
  }
}

/** Forget the session: ciphertext first, then the sealing key. */
export function clearSession(): void {
  const kid = readKid();
  removeRaw();
  try {
    sessionStorage.removeItem(KID_KEY);
  } catch {
    // ignore
  }
  if (kid) void keyStore.delete(kid).catch(() => {});
}

export interface SessionPolicy {
  /** Idle auto-lock in minutes; 0 / undefined = no idle limit (the absolute lifetime still applies). */
  lockAfterMinutes?: number;
  now?: number;
}

/** Pure: has this session outlived the absolute limit or the idle auto-lock? */
export function isSessionExpired(env: Pick<SessionEnvelope, 'createdAt' | 'lastActiveAt'>, policy: SessionPolicy = {}): boolean {
  const now = policy.now ?? Date.now();
  if (!Number.isFinite(env.createdAt) || !Number.isFinite(env.lastActiveAt)) return true;
  if (now - env.createdAt > MAX_SESSION_MS) return true;
  if (now < env.lastActiveAt - 60_000) return true; // clock went backwards: don't trust it
  const idle = policy.lockAfterMinutes ?? 0;
  return idle > 0 && now - env.lastActiveAt > idle * 60_000;
}

function parseEnvelope(raw: string): SessionEnvelope | null {
  try {
    const o = JSON.parse(raw) as Partial<SessionEnvelope>;
    if (o && o.v === ENVELOPE_VERSION && typeof o.iv === 'string' && typeof o.ct === 'string' && typeof o.createdAt === 'number' && typeof o.lastActiveAt === 'number') {
      return o as SessionEnvelope;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Legacy v1 plaintext session (`{publicKeyBase64, privateKeyBase64}`), or null. */
function parseLegacy(raw: string): { publicKey: Uint8Array; privateKey: Uint8Array } | null {
  try {
    const o = JSON.parse(raw) as { publicKeyBase64?: unknown; privateKeyBase64?: unknown };
    if (typeof o.publicKeyBase64 !== 'string' || typeof o.privateKeyBase64 !== 'string') return null;
    const publicKey = base64ToBytes(o.publicKeyBase64);
    const privateKey = base64ToBytes(o.privateKeyBase64);
    return publicKey.length === 32 && privateKey.length === 32 ? { publicKey, privateKey } : null;
  } catch {
    return null;
  }
}

/** Restore the unlocked key pair, or null (locked). Migrates and wipes any legacy plaintext session first. */
export function getSession(policy: SessionPolicy = {}): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array } | null> {
  // Concurrent callers (React StrictMode double effects) share one restore so a legacy migration is never split.
  if (restoring) return restoring;
  const p = restoreSession(policy).finally(() => {
    if (restoring === p) restoring = null;
  });
  restoring = p;
  return p;
}

type Restored = { publicKey: Uint8Array; privateKey: Uint8Array } | null;
let restoring: Promise<Restored> | null = null;

async function restoreSession(policy: SessionPolicy): Promise<Restored> {
  const raw = readRaw();
  if (!raw) return null;

  if (raw.includes('privateKeyBase64')) {
    // Remove plaintext before anything else; then re-seal once so this tab keeps its unlock.
    removeRaw();
    const legacy = parseLegacy(raw);
    if (!legacy) return null;
    return (await saveSession(legacy.publicKey, legacy.privateKey, policy.now)) ? legacy : null;
  }

  const env = parseEnvelope(raw);
  if (!env || isSessionExpired(env, policy)) {
    clearSession();
    return null;
  }
  try {
    const kid = readKid();
    const key = kid ? await keyStore.get(kid) : null;
    if (!key) {
      clearSession();
      return null;
    }
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(env.iv), additionalData: AAD }, key, base64ToBytes(env.ct))
    );
    if (plain.length !== 64) {
      clearSession();
      return null;
    }
    const publicKey = plain.slice(0, 32);
    const privateKey = plain.slice(32);
    plain.fill(0);
    return { publicKey, privateKey };
  } catch {
    clearSession();
    return null;
  }
}

let lastTouch = 0;

/** Record user activity so the idle auto-lock also holds across refreshes. Cheap: rewrites at most every 15 s. */
export function touchSession(now: number = Date.now()): void {
  if (now - lastTouch < TOUCH_INTERVAL_MS) return;
  const raw = readRaw();
  const env = raw ? parseEnvelope(raw) : null;
  if (!env) return;
  lastTouch = now;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...env, lastActiveAt: now }));
  } catch {
    // ignore
  }
}

/** Test hook. */
export function resetTouchThrottleForTests(): void {
  lastTouch = 0;
}