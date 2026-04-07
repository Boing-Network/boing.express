/**
 * Boing Express provider — runs in the page context (injected by content script).
 * Exposes window.boing for dApps. Prefer Boing-native methods (no dependency on Ethereum naming):
 *
 *   boing_requestAccounts  — connect and get current account
 *   boing_accounts        — get account if site already connected
 *   boing_signMessage        — sign hex message (e.g. for auth)
 *   boing_signTransaction    — sign native Boing tx; params: [txObject]; returns 0x + hex(bincode SignedTransaction). Deploy: contract_deploy_purpose / contract_deploy_meta include bincode create2_salt (Option 32 bytes); pass create2_salt as 64 hex chars for CREATE2, or omit for nonce-derived address. contract_deploy_meta defaults purpose_category to "token" when asset_name or asset_symbol is set. contract_call: use 32-byte `contract`, `calldata`, and explicit `access_list` { read, write } (hex AccountIds) per boing-sdk / RPC-API-SPEC.
 *   boing_sendTransaction    — sign + simulate + submit; params: [txObject]; returns tx hash string (mempool QA still runs on deploy). On simulation failure, error.data may include suggested_access_list + access_list_covers_suggestion for retry.
 *   boing_simulateTransaction — params: [hexSignedTx]; forwards to node RPC (no extra signing). Connected origin required.
 *   boing_chainId           — current chain (0x1b01 testnet, 0x1b02 mainnet)
 *   boing_switchChain       — switch network
 *
 * Aliases eth_requestAccounts, eth_accounts, personal_sign, eth_chainId, wallet_switchEthereumChain
 * are supported for compatibility but are not required for Boing development.
 */

const BOING_PROVIDER_SOURCE = 'boing-inpage';
const BOING_CONTENT_SOURCE = 'boing-content';

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

type SerializedProviderError = {
  code?: number;
  message?: string;
  data?: unknown;
};

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

function createProviderError(error: unknown): Error & { code?: number; data?: unknown } {
  if (error && typeof error === 'object') {
    const serialized = error as SerializedProviderError;
    const wrapped = new Error(serialized.message ?? 'Boing Express request failed') as Error & {
      code?: number;
      data?: unknown;
    };
    wrapped.code = serialized.code;
    wrapped.data = serialized.data;
    return wrapped;
  }
  return new Error(typeof error === 'string' ? error : 'Boing Express request failed');
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
    /** True for Boing Express — aligns with boing-sdk `providerSupportsBoingNativeRpc` / connectInjectedBoingWallet. */
    supportsBoingNativeRpc: true,

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
const eip6963Info = Object.freeze({
  uuid: 'boing-express-6963',
  name: 'Boing Express',
  icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
  rdns: 'express.boing',
});

function announceEip6963Provider(): void {
  const event = new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info: eip6963Info, provider }),
  });
  window.dispatchEvent(event);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !event.data || event.data.source !== BOING_CONTENT_SOURCE) return;
  const { type, id, result, error, event: eventName, payload } = event.data;
  if (type === 'response' && id != null) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error != null) {
      p.reject(createProviderError(error));
    } else {
      p.resolve(result);
    }
    return;
  }

  if (type === 'event' && typeof eventName === 'string') {
    const emitter = provider as { emit: (event: string, ...args: unknown[]) => void };
    if (eventName === 'accountsChanged') {
      emitter.emit(eventName, Array.isArray(payload?.accounts) ? payload.accounts : []);
      return;
    }
    if (eventName === 'chainChanged') {
      emitter.emit(eventName, typeof payload?.chainId === 'string' ? payload.chainId : undefined);
      return;
    }
    if (eventName === 'disconnect') {
      emitter.emit(eventName, payload);
      return;
    }
    emitter.emit(eventName, payload);
  }
});

// Expose on window for dApps. Use a symbol-like key to avoid clashes; dApps can detect window.boing.
(globalThis as unknown as { boing?: unknown }).boing = provider;

// EIP-6963: announce provider so dApps can discover multiple wallets (optional but improves compatibility)
try {
  window.addEventListener('eip6963:requestProvider', announceEip6963Provider);
  announceEip6963Provider();
} catch (_) {}
