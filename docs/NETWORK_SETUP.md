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
| Network asks for a newer wallet (`client_hints.min_wallet_version`) than the running one | Warning (`wallet_too_old`). Never blocks. An unknown wallet or network version never warns. |
| Wallet is above the minimum but below `client_hints.recommended_wallet_version` | Info note (`wallet_update_available`) in the banner. Advisory only: it does not make the banner an error and never blocks. It has a **Dismiss** button that hides it for that recommended version (stored in `localStorage` as `boing_update_note_dismissed_version`); a newer recommendation shows it again. Minimum-version warnings and errors cannot be dismissed. |
| `boing_health` unreachable | Warning ("balances may be out of date"). Transactions are still attempted. |

### Client hints and capability flags (documented shapes)

Both `boing_health` and `boing_getNetworkInfo` return (boing.network `docs/RPC-API-SPEC.md`):

```json
{ "client_hints": { "min_wallet_version": "0.1.18", "recommended_wallet_version": "0.1.22", "recommended_sdk": "0.5.38", "sdk_npm_package": "@boing-network/boing-sdk", "note": "..." },
  "tx_signing": { "v2_supported": true, "domain": "BOING_TX_V2", "priority_tips_supported": true, "priority_tip_domain": "BOING_TX_PRIORITY" } }
```

- The wallet reads exactly these paths (`parseNetworkInfo` in `src/boing/networkInfo.ts`); the earlier guesses (top-level `min_wallet_version`, `wallet.*`, `client_requirements`) are gone. Versions are compared as semver (`compareSemver`: leading `v` accepted, pre-release sorts below its release); a hint that is not semver is ignored.
- Hints are advisory and never enforced by the node, so they never block. `boing_health` already carries them, so `boing_getNetworkInfo` is only asked as a fallback when health has no hints.
- The running wallet version is the **extension manifest version** (`extension/manifest.base.json`), injected as `__WALLET_VERSION__` by both Vite configs (`package.json` stays `0.1.0` and is not the release number; `tests/walletReleaseVersion.test.ts` guards this).
- `recommended_sdk` is informational for dApp developers; the wallet reads and keeps it but shows nothing.

Results are cached per RPC URL (60 s when healthy, 5 s after a failed probe) so the check adds no visible latency. The check runs in both the
extension popup and the web app (`data-testid="node-compat-banner"`).

### Signing chain id

Transactions are signed with the V2 domain `"BOING_TX_V2" || chain_id_le8 || ...`. The chain id is taken from the
node's `boing_health.tx_signing.chain_id`; if the probe fails, the selected network's configured chain id is used
instead of silently falling back to legacy (chain-less) signatures. A non-zero priority tip switches to the
`BOING_TX_PRIORITY` domain and appends the tip as a trailing little-endian `u128`.

## Fees and priority tips

- The base fee is the chain's micro-fee (about 21 000 gas, see `boing_getNetworkFeePolicy`). The Send review shows the **simulated** fee (`boing_simulateTransaction`) before you confirm; "Estimating..." is announced to screen readers while it loads.
- **Speed chooser** (`FeeChooser`, `src/boing/feeTips.ts`): Slow = 0 tip (default), Normal = 1 x the SDK micro tip, Fast = 10 x, Custom = typed BOING, capped at 1 BOING so a typo cannot burn funds.
- Tips are hidden when the node says no: `boing_getNetworkFeePolicy.optional_priority_tips: false`, `boing_health.tx_signing.priority_tips_supported: false`, or a `tx_signing.priority_tip_domain` other than `BOING_TX_PRIORITY` (the domain this wallet signs). They are also hidden on ledgers with fewer than 18 decimals (tips are 18-decimal base-unit amounts). Unknown or missing values (old node, RPC error) are treated as "tips allowed"; only an explicit no hides the chooser (`fetchTipSupport` / `planTip`).
- A non-zero tip is signed with the `BOING_TX_PRIORITY` domain (see "Signing chain id"). Dapp-set tips are honored as-is.
- Submit failures (`stale_nonce`, `insufficient_fee`, `pool_full`, ...) are mapped to plain-language messages in `src/boing/submitRejection.ts` (wording and vocabulary kept aligned with boing.observer's `describeRpcRejection`: zero-tip, priority tip, QA pool; `tests/submitRejection.test.ts` checks parity); `stale_nonce` is retried exactly once with a refreshed nonce (`src/boing/submitRetry.ts`).

## Explorer links

Transaction and account links go to boing.observer: `<base>/tx/<64-hex id>?network=testnet|mainnet` and `<base>/account/<64-hex address>?network=testnet|mainnet` (`src/boing/explorerLinks.ts`). The base is the network's `explorerUrl` (the `ecosystem.explorer_url` network meta can override it), else the node's `end_user.explorer_url` from `boing_getNetworkInfo`. With no base there is no link rather than a guessed one. Ids that are not 32-byte hex never produce a link.

## Keeping in sync with boing.network

- Source of truth: `boing.network/docs/RPC-API-SPEC.md` and the Rust crates (`boing-primitives`).
- `tests/sdkParity.test.ts` compares the wallet's own bincode encoder and signer byte-for-byte with
  `@boing-network/boing-sdk` (transfer, contract call with value, batch, `PutBlob`, tip). Bump the SDK, run `pnpm test`;
  a failure means the wire format moved and the wallet encoder must follow.
- `tests/txSigningV2.test.ts` holds the Rust golden vector for the V2 signing hash.
- `tests/txSigningGolden.test.ts` consumes boing.network's `docs/fixtures/tx-signing-golden-vectors.json` (V2, tipped, mainnet, u128-max tip): domain, payload/access-list encoding, digest, signature and signed-transaction bytes must all match.
- `tests/chainMetadataDrift.test.ts` compares the built-in testnet/mainnet config (chain id and hex, name, public RPC, explorer, faucet, testnet flag), the native currency (BOING, 18 decimals) and the signing domains with boing.network's `docs/chain-metadata.json`. If boing.network changes any of them, this test fails until `src/networks` follows.
- Both fixtures are **vendored** in `tests/fixtures/` so CI is hermetic. After boing.network changes them run `pnpm fixtures:sync` (copies from `../boing.network` or `BOING_NETWORK_DIR`) and commit; `pnpm fixtures:check` reports drift in both and is a no-op when the sibling repo is absent. Both commands warn when the upstream file has uncommitted changes, because the copy or comparison then includes unreleased content: commit upstream first. Sync also regenerates the defaults below.
- **Generated defaults.** The built-in network defaults (chain ids and hex, names, native currency, default RPC, explorer, faucet and wallet URLs, testnet flag, signing domains) are generated from the vendored `chain-metadata.json` by `scripts/generate-chain-defaults.mjs` into the committed file `src/networks/chainDefaults.generated.ts`. Do not edit that file by hand. It is regenerated by `pnpm generate:chain-defaults`, `pnpm fixtures:sync`, `pnpm build` (prebuild) and `pnpm run build:extension`; `node scripts/generate-chain-defaults.mjs --check` fails if it is stale, and `chainMetadataDrift.test.ts` verifies it too. `src/networks`, `src/boing/signing.ts`, `nativeUnit.ts` and `networkInfo.ts` read their constants from it, so user-visible behaviour is unchanged. A mainnet entry with no public RPC yet stays hidden, and appears automatically once the metadata lists one.
- `src/boing/nodeCompat.test.ts` embeds a trimmed copy of a real testnet `boing_health` response; refresh it when `boing_health` gains fields.