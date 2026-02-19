/**
 * Supported networks registry. Add new chain adapters here.
 */

import type { NetworkAdapter } from './types';
import { createBoingAdapter } from './boingAdapter';

const testnetRpc = import.meta.env.VITE_BOING_TESTNET_RPC ?? 'https://testnet-rpc.boing.network';
const mainnetRpc = import.meta.env.VITE_BOING_MAINNET_RPC ?? 'https://rpc.boing.network';

export const NETWORKS: NetworkAdapter[] = [
  createBoingAdapter({
    id: 'boing-testnet',
    name: 'Boing Testnet',
    rpcUrl: testnetRpc,
    isTestnet: true,
    faucetUrl: 'https://boing.network/network/faucet',
  }),
  createBoingAdapter({
    id: 'boing-mainnet',
    name: 'Boing Mainnet',
    rpcUrl: mainnetRpc,
    isTestnet: false,
    explorerUrl: 'https://boing.network',
  }),
];

export const DEFAULT_NETWORK_ID = 'boing-testnet';

export function getNetwork(id: string): NetworkAdapter | undefined {
  return NETWORKS.find((n) => n.config.id === id);
}

export function getDefaultNetwork(): NetworkAdapter {
  const n = getNetwork(DEFAULT_NETWORK_ID);
  return n ?? NETWORKS[0];
}
