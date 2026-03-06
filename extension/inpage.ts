/**
 * Boing Express EIP-1193 provider — runs in the page context (injected by content script).
 * Exposes window.boing for dApps to connect and request accounts/signing.
 * Communicates with the content script via postMessage.
 */

const BOING_PROVIDER_SOURCE = 'boing-inpage';
const BOING_CONTENT_SOURCE = 'boing-content';

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function sendToExtension(method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.postMessage(
      {
        source: BOING_PROVIDER_SOURCE,
        type: 'request',
        id,
        method,
        params,
      },
      '*'
    );
    // Timeout so we don't leave pending forever if content script is gone
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Boing Express: request timed out'));
      }
    }, 60000);
  });
}

function createProvider(): unknown {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    message: [],
    connect: [],
    disconnect: [],
    chainChanged: [],
    accountsChanged: [],
  };

  const provider = {
    isBoing: true,
    isBoingExpress: true,

    request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      const method = args?.method;
      const params = Array.isArray(args?.params) ? args.params : [];
      return sendToExtension(method, params);
    },

    on(event: string, listener: (...args: unknown[]) => void): void {
      if (listeners[event]) listeners[event].push(listener);
    },

    removeListener(event: string, listener: (...args: unknown[]) => void): void {
      if (listeners[event]) {
        const i = listeners[event].indexOf(listener);
        if (i !== -1) listeners[event].splice(i, 1);
      }
    },

    emit(event: string, ...args: unknown[]): void {
      (listeners[event] || []).slice().forEach((fn) => {
        try {
          fn(...args);
        } catch (_) {}
      });
    },
  };

  return provider;
}

const provider = createProvider();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !event.data || event.data.source !== BOING_CONTENT_SOURCE) return;
  const { type, id, result, error } = event.data;
  if (type !== 'response' || id == null) return;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error != null) {
    p.reject(new Error(String(error)));
  } else {
    p.resolve(result);
  }
});

// Expose on window for dApps. Use a symbol-like key to avoid clashes; dApps can detect window.boing.
(globalThis as unknown as { boing?: unknown }).boing = provider;

// EIP-6963: announce provider so dApps can discover multiple wallets (optional but improves compatibility)
try {
  const info = {
    uuid: 'boing-express-6963',
    name: 'Boing Express',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    rdns: 'express.boing',
  };
  const event = new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info, provider }),
  });
  window.dispatchEvent(event);
} catch (_) {}
