/**
 * EIP-155–style chain IDs exposed to dApps (Boing Express `boing_chainId` / `eth_chainId`).
 * Align with docs/THREE-CODEBASE-ALIGNMENT.md §3. Not embedded in Boing block headers on L1.
 */
export const BOING_TESTNET_CHAIN_ID_HEX = '0x1b01' as const;
export const BOING_TESTNET_CHAIN_ID_DECIMAL = 6913;

export const BOING_MAINNET_CHAIN_ID_HEX = '0x1b02' as const;
export const BOING_MAINNET_CHAIN_ID_DECIMAL = 6914;

export function chainIdHexToDecimal(hex: string): string {
  const raw = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return '?';
  return BigInt('0x' + raw).toString(10);
}
