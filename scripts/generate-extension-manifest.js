import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const manifestBasePath = path.join(root, 'extension', 'manifest.base.json');
const manifestPath = path.join(root, 'extension', 'manifest.json');
const DEFAULT_TESTNET_RPC = 'https://testnet-rpc.boing.network';
const env = loadEnv(process.env.MODE || 'production', root, '');

function normalizeRpcUrl(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function resolveTestnetRpcUrl(value) {
  return normalizeRpcUrl(value) || DEFAULT_TESTNET_RPC;
}

function resolveMainnetRpcUrl(value) {
  return normalizeRpcUrl(value);
}

function toExtensionHostPermission(rpcUrl) {
  const normalized = normalizeRpcUrl(rpcUrl);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  return `${parsed.origin}/*`;
}

const manifest = JSON.parse(readFileSync(manifestBasePath, 'utf8'));
const testnetRpc = resolveTestnetRpcUrl(env.VITE_BOING_TESTNET_RPC || DEFAULT_TESTNET_RPC);
const mainnetRpc = resolveMainnetRpcUrl(env.VITE_BOING_MAINNET_RPC);

const hostPermissions = [
  toExtensionHostPermission(testnetRpc),
  toExtensionHostPermission(mainnetRpc),
  'https://boing.network/*',
].filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

manifest.host_permissions = hostPermissions;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log('Generated extension manifest with host permissions:', hostPermissions.join(', '));
