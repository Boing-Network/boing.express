import { describe, expect, it } from 'vitest';
import {
  applyBoingMetaToAdapters,
  normalizeHttpsUrl,
  parseBoingNetworksApiBody,
  resolveTestnetRpcWithMeta,
} from '../src/networks/boingMeta';
import { createBoingAdapter } from '../src/networks/boingAdapter';
import { BOING_TESTNET_CHAIN_ID_HEX } from '../src/networks/chainIds';

describe('boingMeta', () => {
  it('normalizeHttpsUrl strips trailing slash', () => {
    expect(normalizeHttpsUrl('https://testnet-rpc.boing.network/')).toBe('https://testnet-rpc.boing.network');
    expect(normalizeHttpsUrl('not a url')).toBe('');
  });

  it('parseBoingNetworksApiBody accepts ok responses', () => {
    expect(parseBoingNetworksApiBody({ ok: false })).toBeNull();
    expect(
      parseBoingNetworksApiBody({
        ok: true,
        meta: { public_testnet_rpc_url: 'https://x.example/rpc/' },
      })?.public_testnet_rpc_url
    ).toBe('https://x.example/rpc/');
  });

  it('resolveTestnetRpcWithMeta respects env pin', () => {
    expect(
      resolveTestnetRpcWithMeta('https://pinned.example', true, {
        public_testnet_rpc_url: 'https://meta.example',
      })
    ).toBe('https://pinned.example');
    expect(
      resolveTestnetRpcWithMeta('https://default.example', false, {
        public_testnet_rpc_url: 'https://meta.example',
      })
    ).toBe('https://meta.example');
  });

  it('applyBoingMetaToAdapters updates explorer and faucet from ecosystem', () => {
    const base = createBoingAdapter({
      id: 'boing-testnet',
      name: 'T',
      rpcUrl: 'https://testnet-rpc.boing.network',
      chainId: BOING_TESTNET_CHAIN_ID_HEX,
      isTestnet: true,
      explorerUrl: 'https://boing.observer',
      faucetUrl: 'https://boing.network/faucet',
    });
    const [next] = applyBoingMetaToAdapters([base], {
      ecosystem: {
        explorer_url: 'https://explorer.example/',
        website_url: 'https://site.example',
      },
    });
    expect(next.config.explorerUrl).toBe('https://explorer.example');
    expect(next.config.faucetUrl).toBe('https://site.example/faucet');
  });
});
