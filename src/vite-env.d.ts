/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOING_TESTNET_RPC: string;
  readonly VITE_BOING_MAINNET_RPC: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
