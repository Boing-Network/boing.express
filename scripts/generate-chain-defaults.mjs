/**
 * Generates the wallet's built-in network defaults from the vendored boing.network chain metadata.
 *
 *   node scripts/generate-chain-defaults.mjs           write src/networks/chainDefaults.generated.ts
 *   node scripts/generate-chain-defaults.mjs --check   exit 1 if the committed generated file is stale
 *
 * Input:  tests/fixtures/chain-metadata.json (vendored copy of boing.network docs/chain-metadata.json; refresh with
 *         `pnpm fixtures:sync`, which also re-runs this generator).
 * Output: src/networks/chainDefaults.generated.ts (committed, so builds and CI need no sibling checkout).
 * Never edit the generated file by hand. Output is deterministic and LF-only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const METADATA_PATH = join(root, 'tests', 'fixtures', 'chain-metadata.json');
export const OUTPUT_PATH = join(root, 'src', 'networks', 'chainDefaults.generated.ts');
const SUPPORTED_SCHEMA = 1;

const norm = (s) => s.replace(/\r\n/g, '\n');
const str = (v, what) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`chain-metadata.json: ${what} must be a non-empty string`);
  return v;
};
const optStr = (v) => (typeof v === 'string' && v.trim() ? v : null);

function networkOf(meta, key) {
  const n = (meta.networks ?? []).find((x) => x && x.key === key);
  if (!n) throw new Error(`chain-metadata.json has no "${key}" network`);
  const chainId = n.chain_id;
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`chain-metadata.json: ${key}.chain_id must be a positive integer`);
  const hex = str(n.chain_id_hex, `${key}.chain_id_hex`);
  if (BigInt(hex) !== BigInt(chainId)) throw new Error(`chain-metadata.json: ${key}.chain_id_hex ${hex} does not match chain_id ${chainId}`);
  const rpcUrls = Array.isArray(n.rpc_urls) ? n.rpc_urls.filter((u) => typeof u === 'string' && u.trim()) : [];
  return {
    status: str(n.status, `${key}.status`),
    chainId,
    chainIdHex: hex.toLowerCase(),
    name: str(n.chain_name, `${key}.chain_name`),
    // First public RPC; '' while the network has none yet (mainnet is then not offered by default).
    defaultRpcUrl: rpcUrls[0] ?? '',
    explorerUrl: str(n.explorer_url, `${key}.explorer_url`),
    faucetUrl: optStr(n.faucet_url),
    walletUrl: optStr(n.wallet_url),
    isTestnet: n.is_testnet === true,
  };
}

/** Pure: metadata object -> generated TypeScript source (LF). */
export function renderChainDefaults(meta) {
  if ((meta.schema_version ?? 1) !== SUPPORTED_SCHEMA) {
    throw new Error(`chain-metadata.json schema_version ${meta.schema_version} is not supported (expected ${SUPPORTED_SCHEMA}); update scripts/generate-chain-defaults.mjs`);
  }
  const nc = meta.native_currency ?? {};
  const decimals = nc.decimals;
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error('chain-metadata.json: native_currency.decimals must be a non-negative integer');
  const sg = meta.signing ?? {};
  const out = {
    schemaVersion: SUPPORTED_SCHEMA,
    nativeCurrency: {
      name: str(nc.name, 'native_currency.name'),
      symbol: str(nc.symbol, 'native_currency.symbol'),
      decimals,
      baseUnitsPerBoing: str(nc.base_units_per_boing, 'native_currency.base_units_per_boing'),
    },
    signingDomains: {
      tx: str(sg.tx_signing_domain, 'signing.tx_signing_domain'),
      priorityTip: str(sg.priority_tip_signing_domain, 'signing.priority_tip_signing_domain'),
    },
    networks: { testnet: networkOf(meta, 'testnet'), mainnet: networkOf(meta, 'mainnet') },
  };
  // Serialise as TypeScript: unquoted keys, single-quoted strings (escaped), no trailing commas.
  const j = (v) =>
    JSON.stringify(v, null, 2)
      .replace(/^(\s*)"(\w+)":/gm, '$1$2:')
      .replace(/"((?:[^"\\]|\\.)*)"/g, (_, s) => "'" + s.replace(/\\"/g, '"').replace(/'/g, "\\'") + "'");
  return `/* eslint-disable */
// GENERATED FILE - DO NOT EDIT.
// Source: tests/fixtures/chain-metadata.json (vendored from boing.network docs/chain-metadata.json).
// Regenerate with \`pnpm fixtures:sync\` (or \`node scripts/generate-chain-defaults.mjs\`); \`tests/chainMetadataDrift.test.ts\` fails when this file is stale.

export interface BuiltinNetworkDefaults {
  /** boing.network lifecycle status, e.g. \`live\` or \`planned\`. */
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

export const CHAIN_METADATA_SCHEMA_VERSION = ${out.schemaVersion};

export const NATIVE_CURRENCY = ${j(out.nativeCurrency)} as const;

export const SIGNING_DOMAINS = ${j(out.signingDomains)} as const;

export const BUILTIN_NETWORKS: { testnet: BuiltinNetworkDefaults; mainnet: BuiltinNetworkDefaults } = ${j(out.networks)};
`;
}

export function generate() {
  if (!existsSync(METADATA_PATH)) throw new Error(`missing ${METADATA_PATH}; run \`pnpm fixtures:sync\``);
  return renderChainDefaults(JSON.parse(readFileSync(METADATA_PATH, 'utf8')));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check');
  const want = generate();
  const have = existsSync(OUTPUT_PATH) ? norm(readFileSync(OUTPUT_PATH, 'utf8')) : null;
  if (check) {
    if (have !== want) {
      console.error('DRIFT: src/networks/chainDefaults.generated.ts is stale. Run: node scripts/generate-chain-defaults.mjs');
      process.exit(1);
    }
    console.log('ok: src/networks/chainDefaults.generated.ts');
  } else {
    writeFileSync(OUTPUT_PATH, want);
    console.log(`${have === want ? 'unchanged' : 'updated'}: src/networks/chainDefaults.generated.ts`);
  }
}