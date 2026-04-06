# Ecosystem alignment (Boing Network)

**boing.express** stays in sync with the node, SDK, portal, and explorer via the **boing.network** documentation.

| Document | Purpose |
|----------|---------|
| [THREE-CODEBASE-ALIGNMENT.md](https://github.com/Boing-Network/boing.network/blob/main/docs/THREE-CODEBASE-ALIGNMENT.md) | Single source of truth for URLs (`boing.network`, `boing.observer`, `boing.express`), public RPC URLs, env var names per app, chain IDs. |
| [HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md) | What ships in the network monorepo vs recommended work in Express, Observer, and partner dApps. |
| [BOING-RPC-ERROR-CODES-FOR-DAPPS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-RPC-ERROR-CODES-FOR-DAPPS.md) | JSON-RPC codes; wallet should preserve node `code`/`data` when forwarding submit/simulate errors. |
| [PRE-VIBEMINER-NODE-COMMANDS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/PRE-VIBEMINER-NODE-COMMANDS.md) | RPC smoke commands (`preflight-rpc`, SDK verify, etc.). |

**This repo:** RPC defaults and explorer links are implemented in `src/networks/`, `extension/config.ts`, and `docs/DEVELOPMENT.md`. Wallet ↔ dApp API: `docs/WALLET_CONNECTION_AND_API.md` and `docs/HANDOFF.md`.

**Tutorial tooling** such as `print-native-dex-routes.mjs` lives under `examples/native-boing-tutorial` in **Boing-Network/boing.network**, not in this repository.

When `boing_getNetworkInfo`, canonical pool/factory env names, or SDK exports change, coordinate updates across repos per the handoff §6 (change coordination).
