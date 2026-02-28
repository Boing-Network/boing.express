/**
 * Local RPC URL overrides for dev/testing (e.g. localhost:8545).
 */

const STORAGE_KEY = 'boing-express-rpc-override';

export function getRpcOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setRpcOverride(networkId: string, url: string): void {
  try {
    const overrides = getRpcOverrides();
    if (url.trim()) {
      overrides[networkId] = url.trim();
    } else {
      delete overrides[networkId];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore
  }
}

export function getRpcOverride(networkId: string): string | undefined {
  return getRpcOverrides()[networkId];
}
