/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOING_TESTNET_RPC: string;
  readonly VITE_BOING_MAINNET_RPC: string;
  /** Set only in extension bundle: "true" when VITE_BOING_TESTNET_RPC was set at build time. */
  readonly VITE_BOING_TESTNET_RPC_EXPLICIT?: string;
  /**
   * Optional linked NFT↔fungible registry AccountId override.
   * Testnet defaults to the canonical public registry when unset.
   */
  readonly VITE_BOING_LINKED_NFT_TOKEN_REGISTRY?: string;
  /**
   * Optional JSON array of fungible candidates for Wallet discovery:
   * `[{ "id": "0x…64 hex", "symbol"?: string, "name"?: string, "decimals"?: number }]`.
   */
  readonly VITE_BOING_TOKEN_CANDIDATES_JSON?: string;
  /** Set to `0` / `off` / `false` to skip the bounded fungible deploy scan on Wallet refresh. */
  readonly VITE_BOING_FUNGIBLE_DEPLOY_SCAN?: string;
  /** Override deploy-scan window (blocks); default 128, max 512. */
  readonly VITE_BOING_FUNGIBLE_DEPLOY_SCAN_BLOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
