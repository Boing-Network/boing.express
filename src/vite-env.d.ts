/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOING_TESTNET_RPC: string;
  readonly VITE_BOING_MAINNET_RPC: string;
  /** Set only in extension bundle: "true" when VITE_BOING_TESTNET_RPC was set at build time. */
  readonly VITE_BOING_TESTNET_RPC_EXPLICIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
