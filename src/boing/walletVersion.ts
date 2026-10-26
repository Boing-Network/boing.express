/**
 * The running wallet's own version, injected at build time (`__WALLET_VERSION__`, from the extension manifest release version).
 * Undefined in unit tests / unknown builds: callers must treat "unknown" as "do not warn".
 */
declare const __WALLET_VERSION__: string | undefined;

export function walletVersion(): string | null {
  try {
    return typeof __WALLET_VERSION__ === 'string' && /\d+\.\d+\.\d+/.test(__WALLET_VERSION__) ? __WALLET_VERSION__ : null;
  } catch {
    return null;
  }
}