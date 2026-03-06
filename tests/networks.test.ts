import { describe, expect, it } from 'vitest';
import { createNetworks } from '../src/networks';

describe('createNetworks', () => {
  it('keeps mainnet disabled when no mainnet RPC is configured', () => {
    const networks = createNetworks('https://testnet-rpc.boing.network', '');

    expect(networks.map((network) => network.config.id)).toEqual(['boing-testnet']);
  });

  it('includes mainnet only when a valid mainnet RPC is configured', () => {
    const networks = createNetworks('https://testnet-rpc.boing.network', ' https://mainnet-rpc.boing.network/ ');

    expect(networks.map((network) => network.config.id)).toEqual(['boing-testnet', 'boing-mainnet']);
    expect(networks[1]?.config.rpcUrl).toBe('https://mainnet-rpc.boing.network');
  });
});
