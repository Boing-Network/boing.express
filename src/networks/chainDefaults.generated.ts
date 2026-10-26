/* eslint-disable */
// GENERATED FILE - DO NOT EDIT.
// Source: tests/fixtures/chain-metadata.json (vendored from boing.network docs/chain-metadata.json).
// Regenerate with `pnpm fixtures:sync` (or `node scripts/generate-chain-defaults.mjs`); `tests/chainMetadataDrift.test.ts` fails when this file is stale.

export interface BuiltinNetworkDefaults {
  /** boing.network lifecycle status, e.g. `live` or `planned`. */
  status: string;
  chainId: number;
  chainIdHex: string;
  name: string;
  /** First public RPC from the metadata; empty while the network has none (mainnet is then not offered by default). */
  defaultRpcUrl: string;
  explorerUrl: string;
  faucetUrl: string | null;
  walletUrl: string | null;
  isTestnet: boolean;
}

export const CHAIN_METADATA_SCHEMA_VERSION = 1;

export const NATIVE_CURRENCY = {
  name: 'Boing',
  symbol: 'BOING',
  decimals: 18,
  baseUnitsPerBoing: '1000000000000000000'
} as const;

export const SIGNING_DOMAINS = {
  tx: 'BOING_TX_V2',
  priorityTip: 'BOING_TX_PRIORITY'
} as const;

export const BUILTIN_NETWORKS: { testnet: BuiltinNetworkDefaults; mainnet: BuiltinNetworkDefaults } = {
  testnet: {
    status: 'live',
    chainId: 6913,
    chainIdHex: '0x1b01',
    name: 'Boing Testnet',
    defaultRpcUrl: 'https://testnet-rpc.boing.network',
    explorerUrl: 'https://boing.observer',
    faucetUrl: 'https://boing.network/faucet',
    walletUrl: 'https://boing.express',
    isTestnet: true
  },
  mainnet: {
    status: 'planned',
    chainId: 6914,
    chainIdHex: '0x1b02',
    name: 'Boing Mainnet',
    defaultRpcUrl: '',
    explorerUrl: 'https://boing.observer',
    faucetUrl: null,
    walletUrl: 'https://boing.express',
    isTestnet: false
  }
};
