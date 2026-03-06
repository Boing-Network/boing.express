# Boing Express Sync Review — 2026-03-06

This note records the Boing Network synchronization pass performed in `boing.express`.

## Fixed in this repo

- Updated canonical explorer links to target `https://boing.observer`.
- Updated wallet account deep links to use `/account/<address>` instead of `/address/<address>`.
- Removed unsafe transaction-detail explorer links from the web wallet and extension source until `boing.observer` publishes a stable tx-detail route contract.
- Restricted direct faucet actions to testnet behavior in the web wallet by hiding the faucet section on non-testnet networks.
- Made the Boing adapter expose `faucetRequest` only for testnet configs.
- Updated wallet docs to reflect the current portal nonce-backed sign-in flow:
  - `GET /api/portal/auth/nonce`
  - `POST /api/portal/auth/sign-in`
  - nonce-backed multiline sign-in message
- Reworded wallet docs so mainnet is treated as configurable/provisional until official public mainnet metadata is published in `boing.network`.
- Updated QA references from legacy standalone docs to the canonical `QUALITY-ASSURANCE-NETWORK.md` document.
- Extended the wallet QA RPC wrapper to support the richer current RPC shape, including `descriptionHash`, optional asset metadata, and `doc_url`.
- Added a wallet-side sync handoff note for cross-app link contracts and public surface expectations.

## Still documented, not fully changed yet

- The wallet still carries a provisional default mainnet RPC in source/config so existing chain-selection and provider behavior continue to work. This should be revisited once `boing.network` publishes the official public mainnet endpoint.
- The wallet provider still supports both testnet and mainnet chain IDs (`0x1b01`, `0x1b02`). This review did not narrow provider chain support, only the user-facing copy and explorer/faucet behavior.
- The extension build artifacts were not regenerated as part of this sync pass. Source files were updated; rebuild the extension bundle when you want the packaged `extension/*.js` outputs refreshed.

## Files updated in this sync pass

- `src/networks/index.ts`
- `src/networks/boingAdapter.ts`
- `src/screens/Dashboard.tsx`
- `src/boing/rpc.ts`
- `src/boing/qa.ts`
- `src/screens/docs/docContent.tsx`
- `src/screens/Privacy.tsx`
- `README.md`
- `docs/DEVELOPMENT.md`
- `docs/WALLET_CONNECTION_AND_API.md`
- `docs/BOING_NETWORK_AGENT_HANDOFF.md`
- `docs/BOING_NETWORK_SYNC_HANDOFF.md`
- `docs/EXTENSION_STORE.md`
- `extension/config.ts`
- `extension/popup.ts`
- `extension/popup.html`
- `vite.extension.config.ts`
