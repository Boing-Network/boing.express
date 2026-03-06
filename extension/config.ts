import { resolveMainnetRpcUrl, resolveTestnetRpcUrl } from '../src/networks/rpcConfig';

/** RPC URLs for extension (injected at build time via Vite define). */
export const BOING_TESTNET_RPC = resolveTestnetRpcUrl(import.meta.env.VITE_BOING_TESTNET_RPC);
export const BOING_MAINNET_RPC = resolveMainnetRpcUrl(import.meta.env.VITE_BOING_MAINNET_RPC);

export const BOING_TESTNET_NETWORK_ID = 'boing-testnet';
export const BOING_MAINNET_NETWORK_ID = 'boing-mainnet';

export function isBoingMainnetConfigured(): boolean {
  return BOING_MAINNET_RPC.length > 0;
}

export function normalizeBoingNetworkId(networkId: string | null | undefined): string {
  if (networkId === BOING_MAINNET_NETWORK_ID && isBoingMainnetConfigured()) {
    return BOING_MAINNET_NETWORK_ID;
  }
  return BOING_TESTNET_NETWORK_ID;
}

/** EIP-155–style chain IDs for wallet connection (dApps use these). */
export const BOING_TESTNET_CHAIN_ID = '0x1b01';   // 6913
export const BOING_MAINNET_CHAIN_ID = '0x1b02';   // 6914
