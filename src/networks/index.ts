/**
 * Supported networks registry. Add new chain adapters here.
 */

import type { NetworkAdapter } from './types';
import { createBoingAdapter } from './boingAdapter';

const defaultTestnetRpc = 'https://testnet-rpc.boing.network';
const defaultMainnetRpc = 'https://rpc.boing.network';

/** Build network list from RPC URLs (for app: use env; for extension: pass URLs). */
export function createNetworks(
  testnetRpc: string = defaultTestnetRpc,
  mainnetRpc: string = defaultMainnetRpc
): NetworkAdapter[] {
  return [
    createBoingAdapter({
      id: 'boing-testnet',
      name: 'Boing Testnet',
      rpcUrl: testnetRpc,
      isTestnet: true,
      faucetUrl: 'https://boing.network/network/faucet',
      explorerUrl: 'https://boing.network',
    }),
    createBoingAdapter({
      id: 'boing-mainnet',
      name: 'Boing Mainnet',
      rpcUrl: mainnetRpc,
      isTestnet: false,
      explorerUrl: 'https://boing.network',
    }),
  ];
}

const testnetRpc = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOING_TESTNET_RPC
  ? import.meta.env.VITE_BOING_TESTNET_RPC
  : defaultTestnetRpc;
const mainnetRpc = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOING_MAINNET_RPC
  ? import.meta.env.VITE_BOING_MAINNET_RPC
  : defaultMainnetRpc;

export const NETWORKS: NetworkAdapter[] = createNetworks(testnetRpc, mainnetRpc);

export const DEFAULT_NETWORK_ID = 'boing-testnet';

export function getNetwork(id: string, networks: NetworkAdapter[] = NETWORKS): NetworkAdapter | undefined {
  return networks.find((n) => n.config.id === id);
}

export function getDefaultNetwork(networks: NetworkAdapter[] = NETWORKS): NetworkAdapter {
  const n = getNetwork(DEFAULT_NETWORK_ID, networks);
  return n ?? networks[0];
}
