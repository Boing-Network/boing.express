import { createNetworks } from './index';
import {
  applyBoingMetaToAdapters,
  resolveTestnetRpcWithMeta,
  type BoingNetworksMeta,
} from './boingMeta';
import type { NetworkAdapter } from './types';

export function buildNetworksCatalog(args: {
  envTestnetRpc: string;
  testnetRpcPinnedByEnv: boolean;
  envMainnetRpc: string;
  meta: BoingNetworksMeta | null | undefined;
}): NetworkAdapter[] {
  const testnetRpc = resolveTestnetRpcWithMeta(
    args.envTestnetRpc,
    args.testnetRpcPinnedByEnv,
    args.meta
  );
  const base = createNetworks(testnetRpc, args.envMainnetRpc);
  return applyBoingMetaToAdapters(base, args.meta);
}
