import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNetworks } from '../src/networks';
import {
  BOING_MAINNET_CHAIN_ID_DECIMAL,
  BOING_MAINNET_CHAIN_ID_HEX,
  BOING_TESTNET_CHAIN_ID_DECIMAL,
  BOING_TESTNET_CHAIN_ID_HEX,
} from '../src/networks/chainIds';
import { DEFAULT_TESTNET_RPC } from '../src/networks/rpcConfig';
import { BOING_BASE_DECIMALS } from '../src/boing/nativeUnit';
import { PRIORITY_TIP_DOMAIN } from '../src/boing/networkInfo';

/**
 * Drift guard against boing.network's `docs/chain-metadata.json` (vendored copy in tests/fixtures; refresh with
 * `pnpm fixtures:sync`, verify with `pnpm fixtures:check`). If boing.network changes an identity value (chain id, name,
 * public RPC, explorer, faucet, native currency, signing domains) this fails until the wallet's built-in defaults follow.
 */
interface Meta {
  schema_version?: number;
  native_currency: { name: string; symbol: string; decimals: number; base_units_per_boing: string };
  signing: { tx_signing_domain: string; priority_tip_signing_domain: string };
  networks: Array<{
    key: 'testnet' | 'mainnet';
    status: string;
    chain_id: number;
    chain_id_hex: string;
    chain_name: string;
    rpc_urls: string[];
    explorer_url: string;
    faucet_url: string | null;
    is_testnet: boolean;
  }>;
}
const meta = JSON.parse(readFileSync(new URL('./fixtures/chain-metadata.json', import.meta.url), 'utf8')) as Meta;
const net = (key: 'testnet' | 'mainnet') => {
  const n = meta.networks.find((x) => x.key === key);
  if (!n) throw new Error(`chain-metadata.json has no ${key} network`);
  return n;
};
const MAINNET_TEST_RPC = 'https://mainnet-rpc.example.test';

describe('built-in network config matches boing.network docs/chain-metadata.json', () => {
  it('uses a schema version this wallet understands', () => {
    expect(meta.schema_version ?? 1).toBe(1);
  });

  it('testnet: id, hex, name, RPC, explorer, faucet, flag', () => {
    const t = net('testnet');
    const w = createNetworks().find((n) => n.config.id === 'boing-testnet');
    expect(w).toBeDefined();
    expect(BOING_TESTNET_CHAIN_ID_DECIMAL).toBe(t.chain_id);
    expect(BOING_TESTNET_CHAIN_ID_HEX).toBe(t.chain_id_hex);
    expect(Number(BigInt(t.chain_id_hex))).toBe(t.chain_id);
    expect(w!.config.chainId).toBe(t.chain_id_hex);
    expect(w!.config.name).toBe(t.chain_name);
    expect(w!.config.isTestnet).toBe(t.is_testnet);
    expect(w!.config.rpcUrl).toBe(t.rpc_urls[0]);
    expect(DEFAULT_TESTNET_RPC).toBe(t.rpc_urls[0]);
    expect(w!.config.explorerUrl).toBe(t.explorer_url);
    expect(w!.config.faucetUrl).toBe(t.faucet_url);
  });

  it('mainnet: id, hex, name, explorer, flag, and no faucet', () => {
    const m = net('mainnet');
    const w = createNetworks(undefined, MAINNET_TEST_RPC).find((n) => n.config.id === 'boing-mainnet');
    expect(w).toBeDefined();
    expect(BOING_MAINNET_CHAIN_ID_DECIMAL).toBe(m.chain_id);
    expect(BOING_MAINNET_CHAIN_ID_HEX).toBe(m.chain_id_hex);
    expect(Number(BigInt(m.chain_id_hex))).toBe(m.chain_id);
    expect(w!.config.chainId).toBe(m.chain_id_hex);
    expect(w!.config.name).toBe(m.chain_name);
    expect(w!.config.isTestnet).toBe(m.is_testnet);
    expect(w!.config.explorerUrl).toBe(m.explorer_url);
    expect(w!.config.faucetUrl ?? null).toBe(m.faucet_url);
  });

  it('mainnet is only offered once an RPC is configured while the metadata lists none', () => {
    const m = net('mainnet');
    if (m.rpc_urls.length === 0) {
      expect(createNetworks().some((n) => n.config.id === 'boing-mainnet')).toBe(false);
    } else {
      // Mainnet got a public RPC: the wallet must now ship it as a default (update src/networks/index.ts).
      expect(createNetworks().find((n) => n.config.id === 'boing-mainnet')?.config.rpcUrl).toBe(m.rpc_urls[0]);
    }
  });

  it('chain ids are distinct and testnet is flagged as such', () => {
    expect(net('testnet').chain_id).not.toBe(net('mainnet').chain_id);
    expect(net('testnet').is_testnet).toBe(true);
    expect(net('mainnet').is_testnet).toBe(false);
  });

  it('native currency: BOING, 18 decimals, 10^18 base units', () => {
    expect(meta.native_currency.symbol).toBe('BOING');
    expect(meta.native_currency.name).toBe('Boing');
    expect(BOING_BASE_DECIMALS).toBe(meta.native_currency.decimals);
    expect(10n ** BigInt(BOING_BASE_DECIMALS)).toBe(BigInt(meta.native_currency.base_units_per_boing));
  });

  it('signing domains', () => {
    expect(meta.signing.priority_tip_signing_domain).toBe(PRIORITY_TIP_DOMAIN);
    expect(meta.signing.tx_signing_domain).toBe('BOING_TX_V2');
  });
});