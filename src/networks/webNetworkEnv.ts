import { resolveMainnetRpcUrl, resolveTestnetRpcUrl } from './rpcConfig';

/** True when VITE_BOING_TESTNET_RPC is set at build/runtime — discovery must not override RPC. */
export function isWebTestnetRpcPinnedByEnv(): boolean {
  return (
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env?.VITE_BOING_TESTNET_RPC === 'string' &&
    import.meta.env.VITE_BOING_TESTNET_RPC.trim().length > 0
  );
}

export function getWebEnvTestnetRpc(): string {
  return resolveTestnetRpcUrl(import.meta.env.VITE_BOING_TESTNET_RPC);
}

export function getWebEnvMainnetRpc(): string {
  return resolveMainnetRpcUrl(import.meta.env.VITE_BOING_MAINNET_RPC);
}
