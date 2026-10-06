/**
 * Persist last NFT discovery tip height so reloads scan incrementally.
 */

const STORAGE_KEY = 'boing-express-nft-scan-cursor';

type ChromeStorageLocal = {
  get: (
    keys: string | string[],
    callback?: (items: Record<string, unknown>) => void
  ) => void | Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>;
};

function chromeStorageLocal(): ChromeStorageLocal | null {
  try {
    const g = globalThis as unknown as {
      chrome?: { storage?: { local?: ChromeStorageLocal } };
    };
    return g.chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

function key(ownerHex: string, networkId: string): string {
  return `${STORAGE_KEY}:${ownerHex.replace(/^0x/i, '').toLowerCase()}:${networkId}`;
}

function storageGet(k: string): Promise<string | null> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.get(k, (bag) => {
        const v = bag?.[k];
        resolve(typeof v === 'string' ? v : null);
      });
    });
  }
  try {
    return Promise.resolve(localStorage.getItem(k));
  } catch {
    return Promise.resolve(null);
  }
}

function storageSet(k: string, value: string): Promise<void> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.set({ [k]: value }, () => resolve());
    });
  }
  try {
    localStorage.setItem(k, value);
  } catch {
    // ignore
  }
  return Promise.resolve();
}

export async function getNftScanCursor(
  ownerHex: string,
  networkId: string
): Promise<number | null> {
  const raw = await storageGet(key(ownerHex, networkId));
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function setNftScanCursor(
  ownerHex: string,
  networkId: string,
  height: number
): Promise<void> {
  if (!Number.isFinite(height) || height < 0) return;
  await storageSet(key(ownerHex, networkId), String(Math.floor(height)));
}
