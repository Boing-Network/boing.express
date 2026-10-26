/**
 * Supported networks registry. Add new chain adapters here.
 */

import type { NetworkAdapter } from './types';
import { createBoingAdapter } from './boingAdapter';
import {
  BOING_MAINNET_CHAIN_ID_HEX,
  BOING_TESTNET_CHAIN_ID_HEX,
} from './chainIds';
import { BUILTIN_NETWORKS } from './chainDefaults.generated';
import { DEFAULT_TESTNET_RPC, resolveMainnetRpcUrl, resolveTestnetRpcUrl } from './rpcConfig';

const TESTNET = BUILTIN_NETWORKS.testnet;
const MAINNET = BUILTIN_NETWORKS.mainnet;

const defaultTestnetRpc = DEFAULT_TESTNET_RPC;
/** Empty until boing.network publishes a public mainnet RPC in chain-metadata.json (then mainnet is offered by default). */
const defaultMainnetRpc = MAINNET.defaultRpcUrl;

/** Build network list from RPC URLs (for app: use env; for extension: pass URLs). */
export function createNetworks(
  testnetRpc: string = defaultTestnetRpc,
  mainnetRpc: string = defaultMainnetRpc
): NetworkAdapter[] {
  const networks: NetworkAdapter[] = [
    createBoingAdapter({
      id: 'boing-testnet',
      name: TESTNET.name,
      rpcUrl: resolveTestnetRpcUrl(testnetRpc),
      chainId: BOING_TESTNET_CHAIN_ID_HEX,
      isTestnet: TESTNET.isTestnet,
      faucetUrl: TESTNET.faucetUrl ?? undefined,
      explorerUrl: TESTNET.explorerUrl,
    }),
  ];

  const configuredMainnetRpc = resolveMainnetRpcUrl(mainnetRpc);
  if (configuredMainnetRpc) {
    networks.push(createBoingAdapter({
      id: 'boing-mainnet',
      name: MAINNET.name,
      rpcUrl: configuredMainnetRpc,
      chainId: BOING_MAINNET_CHAIN_ID_HEX,
      isTestnet: MAINNET.isTestnet,
      faucetUrl: MAINNET.faucetUrl ?? undefined,
      explorerUrl: MAINNET.explorerUrl,
    }));
  }

  return networks;
}

const testnetRpc = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOING_TESTNET_RPC
  ? resolveTestnetRpcUrl(import.meta.env.VITE_BOING_TESTNET_RPC)
  : defaultTestnetRpc;
const mainnetRpc = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BOING_MAINNET_RPC
  ? resolveMainnetRpcUrl(import.meta.env.VITE_BOING_MAINNET_RPC)
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
