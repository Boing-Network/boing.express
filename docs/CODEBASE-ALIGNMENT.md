# Ecosystem alignment (Boing Network)

**boing.express** stays in sync with the node, SDK, portal, and explorer via the **boing.network** documentation.

| Document | Purpose |
|----------|---------|
| [THREE-CODEBASE-ALIGNMENT.md](https://github.com/Boing-Network/boing.network/blob/main/docs/THREE-CODEBASE-ALIGNMENT.md) | Single source of truth for URLs (`boing.network`, `boing.observer`, `boing.express`), public RPC URLs, env var names per app, chain IDs. |
| [HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md) | What ships in the network monorepo vs recommended work in Express, Observer, and partner dApps. |
| [BOING-RPC-ERROR-CODES-FOR-DAPPS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-RPC-ERROR-CODES-FOR-DAPPS.md) | JSON-RPC codes; wallet should preserve node `code`/`data` when forwarding submit/simulate errors. |
| [PRE-VIBEMINER-NODE-COMMANDS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/PRE-VIBEMINER-NODE-COMMANDS.md) | RPC smoke commands (`preflight-rpc`, SDK verify, etc.). |
| [HANDOFF_NATIVE_DEX_DIRECTORY_R2_AND_CHAIN.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF_NATIVE_DEX_DIRECTORY_R2_AND_CHAIN.md) | Native DEX indexer Worker: D1 directory API (`/v1/directory/*`), optional receipt/history routes, LP/NFT helpers, deploy URL pattern. |
| [PROTOCOL_NATIVE_DEX_RPC_AND_INDEXING_ROADMAP.md](https://github.com/Boing-Network/boing.network/blob/main/docs/PROTOCOL_NATIVE_DEX_RPC_AND_INDEXING_ROADMAP.md) | RPC vs indexing roadmap; snapshot semantics for directory/history. |
| [HANDOFF_Boing_Network_Global_Token_Discovery.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF_Boing_Network_Global_Token_Discovery.md) | L1 **`boing_listDexPools`** / **`boing_listDexTokens`** / **`boing_getDexToken`** semantics; factory and decimals env. |
| [RPC-API-SPEC.md](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md) (DEX discovery section) | Request/result fields, **`light`**, **`includeDiagnostics`**, token filters. |

**This repo:** RPC defaults and explorer links are implemented in `src/networks/`, `extension/config.ts`, and `docs/DEVELOPMENT.md`. Wallet ↔ dApp API: `docs/WALLET_CONNECTION_AND_API.md` and `docs/HANDOFF.md`. **Optional HTTP JSON-RPC gateway** (OpenAPI + allowlist): **`workers/rpc-gateway/`**, documented in **`docs/RPC_GATEWAY.md`**. **Native DEX directory / canonical testnet addresses:** the wallet does not embed pool/router hex; **boing-sdk** is a **devDependency** pinned to a **boing.network** monorepo commit (`path:/boing-sdk`) for parity with upstream CI — see **HANDOFF.md → Part 5**.

**Tutorial tooling** such as `print-native-dex-routes.mjs` lives under `examples/native-boing-tutorial` in **Boing-Network/boing.network**, not in this repository.

When `boing_getNetworkInfo`, canonical pool/factory env names, or SDK exports change, coordinate updates across repos per the handoff §6 (change coordination). **Public RPC:** node operators should keep **`BOING_CANONICAL_NATIVE_DEX_FACTORY`** and the three **`BOING_DEX_*`** knobs in sync with **`tools/boing-node-public-testnet.env.example`** on **boing.network** (this repo’s **`.env.example`** mirrors that block for discoverability).
