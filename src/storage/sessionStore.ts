/**
 * Session-scoped wallet state for the web app.
 * Persists unlocked key material in sessionStorage so that refresh/navigation
 * within the same tab does not require password again. Cleared when tab closes.
 */

const SESSION_KEY = 'boing_session';

export interface SessionPayload {
  publicKeyBase64: string;
  privateKeyBase64: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function saveSession(publicKey: Uint8Array, privateKey: Uint8Array): void {
  const payload: SessionPayload = {
    publicKeyBase64: bytesToBase64(publicKey),
    privateKeyBase64: bytesToBase64(privateKey),
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage full or unavailable
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getSession(): { publicKey: Uint8Array; privateKey: Uint8Array } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as SessionPayload;
    if (
      typeof payload.publicKeyBase64 !== 'string' ||
      typeof payload.privateKeyBase64 !== 'string'
    ) {
      return null;
    }
    const publicKey = base64ToBytes(payload.publicKeyBase64);
    const privateKey = base64ToBytes(payload.privateKeyBase64);
    if (publicKey.length !== 32 || privateKey.length !== 32) return null;
    return { publicKey, privateKey };
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  return getSession() !== null;
}
