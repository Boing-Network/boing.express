/**
 * EIP-155–style chain IDs exposed to dApps (Boing Express `boing_chainId` / `eth_chainId`).
 * Align with docs/THREE-CODEBASE-ALIGNMENT.md §3. Not embedded in Boing block headers on L1.
 */
import { BUILTIN_NETWORKS } from './chainDefaults.generated';

/** Generated from boing.network chain-metadata.json (see scripts/generate-chain-defaults.mjs); do not hard-code here. */
export const BOING_TESTNET_CHAIN_ID_HEX = BUILTIN_NETWORKS.testnet.chainIdHex;
export const BOING_TESTNET_CHAIN_ID_DECIMAL = BUILTIN_NETWORKS.testnet.chainId;

export const BOING_MAINNET_CHAIN_ID_HEX = BUILTIN_NETWORKS.mainnet.chainIdHex;
export const BOING_MAINNET_CHAIN_ID_DECIMAL = BUILTIN_NETWORKS.mainnet.chainId;

export function chainIdHexToDecimal(hex: string): string {
  const raw = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return '?';
  return BigInt('0x' + raw).toString(10);
}
