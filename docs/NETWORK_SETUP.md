# Network setup and verification

Boing Express talks to one JSON-RPC endpoint per network. This page explains where those endpoints come from, how to
override them, and how the wallet checks at runtime that a node really is the network you selected.

## Where network config comes from

| Layer | What it does |
|-------|--------------|
| Build-time defaults | `VITE_BOING_TESTNET_RPC` (default `https://testnet-rpc.boing.network`) and optional `VITE_BOING_MAINNET_RPC`. Read in `src/networks/rpcConfig.ts` and `extension/config.ts`. |
| Runtime catalog | `GET https://boing.network/api/networks` (`src/networks/boingMeta.ts`) supplies RPC URL, chain id and explorer links. It is merged over the build defaults and cached. |
| Chain ids | Testnet `6913` (`0x1b01`), mainnet `6914` (`0x1b02`). Defined once in `src/networks/chainIds.ts` / `extension/config.ts`. |

Mainnet stays hidden until `VITE_BOING_MAINNET_RPC` (or the runtime catalog) provides a URL that differs from the testnet URL.

### Changing an endpoint

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_BOING_TESTNET_RPC=https://your-node.example` (and optionally `VITE_BOING_MAINNET_RPC`).
3. Rebuild (`pnpm build` or `pnpm run build:extension`). Values are baked into the bundle.
4. For the extension, make sure the host is reachable: the generated manifest only requests the hosts it needs
   (`scripts/generate-extension-manifest.js`).

## Runtime verification (node compatibility check)

Before showing balances and before every broadcast, the wallet calls `boing_health` and compares the answer with the
network you selected (`src/boing/nodeCompat.ts`):

| Check | Result |
|-------|--------|
| `chain_id` differs from the selected network | **Error.** A red banner is shown and `submitTransaction` refuses to broadcast. Fix the RPC URL or switch networks. |
| `tx_signing.v2_supported` is false | **Error.** The node would reject chain-bound signatures. |
| Node did not report a chain id | Warning. Continue only if you trust the node. |
| `client_version` older than `MIN_SUPPORTED_NODE_VERSION` (`0.1.0`) | Warning. Some features may not work. |
| `boing_health` unreachable | Warning ("balances may be out of date"). Transactions are still attempted. |

Results are cached per RPC URL (60 s when healthy, 5 s after a failed probe) so the check adds no visible latency. The check runs in both the
extension popup and the web app (`data-testid="node-compat-banner"`).

### Signing chain id

Transactions are signed with the V2 domain `"BOING_TX_V2" || chain_id_le8 || ...`. The chain id is taken from the
node's `boing_health.tx_signing.chain_id`; if the probe fails, the selected network's configured chain id is used
instead of silently falling back to legacy (chain-less) signatures. A non-zero priority tip switches to the
`BOING_TX_PRIORITY` domain and appends the tip as a trailing little-endian `u128`.

## Keeping in sync with boing.network

- Source of truth: `boing.network/docs/RPC-API-SPEC.md` and the Rust crates (`boing-primitives`).
- `tests/sdkParity.test.ts` compares the wallet's own bincode encoder and signer byte-for-byte with
  `@boing-network/boing-sdk` (transfer, contract call with value, batch, `PutBlob`, tip). Bump the SDK, run `pnpm test`;
  a failure means the wire format moved and the wallet encoder must follow.
- `tests/txSigningV2.test.ts` holds the Rust golden vector for the V2 signing hash.
- `src/boing/nodeCompat.test.ts` embeds a trimmed copy of a real testnet `boing_health` response; refresh it when `boing_health` gains fields.