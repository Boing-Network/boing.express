import type { BrowserContext } from '@playwright/test';

/**
 * Resolves the unpacked extension id from an active MV3 service worker URL.
 */
export async function getChromeExtensionId(context: BrowserContext): Promise<string> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const w of context.serviceWorkers()) {
      const m = /^chrome-extension:\/\/([^/]+)\//.exec(w.url());
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for a chrome-extension:// service worker');
}
