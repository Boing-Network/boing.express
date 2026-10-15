/**
 * Private-key export ("Reveal private key") for the wallet UI.
 *
 * Guardrails:
 * - Requires the wallet password every time (re-decrypts the active vault entry; the
 *   unlocked session key is NOT used).
 * - Decrypted key lives only in memory; nothing here logs or persists it.
 * - Callers must hide/clear it after REVEAL_AUTO_HIDE_MS (see createRevealSession).
 * - Not reachable from the dApp provider or content scripts: this module is only
 *   imported by the wallet's own UI.
 */
import { accountIdToHex } from '../boing/types';
import { privateKeyToHex } from '../crypto/keys';

export const REVEAL_AUTO_HIDE_MS = 30_000;

export type RevealDeps = {
  /** Decrypt the active account with the password; returns [publicKey, privateKey]. */
  unlock: (password: string) => Promise<[Uint8Array, Uint8Array]>;
  /** Active account address hex (no 0x) the decrypted key must match. */
  expectedAddressHex: string | null;
};

export class RevealError extends Error {}

/** Re-verifies the password and returns the active account's private key as hex. */
export async function revealActivePrivateKeyHex(password: string, deps: RevealDeps): Promise<string> {
  if (!password) throw new RevealError('Enter your wallet password.');
  let pub: Uint8Array;
  let priv: Uint8Array;
  try {
    [pub, priv] = await deps.unlock(password);
  } catch {
    throw new RevealError('Incorrect password.');
  }
  try {
    const addr = accountIdToHex(pub).replace(/^0x/i, '').toLowerCase();
    const want = (deps.expectedAddressHex ?? '').replace(/^0x/i, '').toLowerCase();
    if (!want || addr !== want) {
      throw new RevealError('Decrypted key does not match the active account.');
    }
    return privateKeyToHex(priv);
  } finally {
    priv.fill(0);
  }
}

export type RevealState = { keyHex: string | null; visible: boolean };

/**
 * Holds a revealed key in memory, hidden by default, and clears it after `timeoutMs`
 * (and on `clear()`, e.g. unmount / lock).
 */
export function createRevealSession(onChange: (s: RevealState) => void, timeoutMs = REVEAL_AUTO_HIDE_MS) {
  let state: RevealState = { keyHex: null, visible: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => onChange({ ...state });
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    state = { keyHex: null, visible: false };
    emit();
  };
  return {
    set(keyHex: string) {
      if (timer) clearTimeout(timer);
      state = { keyHex, visible: false };
      timer = setTimeout(clear, timeoutMs);
      emit();
    },
    toggleVisible() {
      if (!state.keyHex) return;
      state = { ...state, visible: !state.visible };
      emit();
    },
    clear,
    getState: (): RevealState => ({ ...state }),
  };
}