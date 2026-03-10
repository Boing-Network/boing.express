# Boing Express — Handoff & Sync

Single reference for the **boing.express** wallet: handoff to **boing.network**, sync contract with the portal, and sync review changelog.

---

# Part 1 — Handoff for boing.network

*For the boing.network agent/team: what the wallet does, what APIs the portal can call, and what the backend must verify.*

## 1. Current Wallet Capabilities

| Area | Current behavior |
|------|------------------|
| **Wallet creation** | New Ed25519 keypair generated locally in extension popup. |
| **Wallet import** | 32-byte private key as 64 hex chars. |
| **Storage** | Private key encrypted in `chrome.storage.local`; plaintext only in memory when unlocked. |
| **Unlock / lock** | Signing only when unlocked. |
| **Address** | Boing account id = Ed25519 public key, 64 hex chars with `0x`. |
| **Network** | Testnet / Mainnet switch in popup. |
| **Balance / Send / Stake / Unbond** | Via popup; faucet on testnet. |
| **dApp connection** | `window.boing` provider; `boing_requestAccounts`, `boing_signMessage`, etc. |
| **Message signing** | Ed25519; per-request approval window. |
| **Provider events** | `accountsChanged`, `chainChanged`, `disconnect`. |
| **Errors** | Stable numeric codes + `data.boingCode` (e.g. `BOING_NO_WALLET`, `BOING_WALLET_LOCKED`). |

## 2. Account, Key, and Signature (for portal verification)

- **Account id:** 32-byte Ed25519 public key, 64 hex chars, usually `0x` prefix.
- **Signature:** Ed25519, 64 bytes, 128 hex chars. Wallet signs **exact UTF-8 message** (no Keccak256/secp256k1).

Backend should: (1) parse `account_id_hex` as Ed25519 public key, (2) parse `signature` as 64-byte Ed25519, (3) UTF-8 encode `message`, (4) verify Ed25519.

## 3. Provider API

- `boing_requestAccounts` / `boing_accounts` / `boing_signMessage` / `boing_chainId` / `boing_switchChain`
- Aliases: `eth_requestAccounts`, `personal_sign`, `eth_chainId`, `wallet_switchEthereumChain`
- Portal should prefer `boing_*` methods.

## 4. Sign-In Flow (what portal implements)

1. Connect: `boing_requestAccounts`
2. Chain: `boing_chainId` (testnet `0x1b01`), optionally `boing_switchChain`
3. Nonce: `GET /api/portal/auth/nonce?origin=...`
4. Message: multiline UTF-8 with Origin, Timestamp, Nonce
5. Sign: `boing_signMessage([message, address])`
6. Verify: `POST /api/portal/auth/sign-in` with `{ account_id_hex, message, signature }`

## 5. Not Yet Exposed to dApps

- No `boing_signTransaction` / `boing_submitTransaction` / `boing_simulateTransaction` on the provider (popup has send/stake/unbond only).

---

# Part 2 — Sync Handoff (what boing.network implements)

*For the boing.express agent/team: portal contract and cross-app links.*

## Portal today

- Wallet connect on `/testnet/sign-in`
- Boing-native methods preferred; alias fallback when needed
- Backend Ed25519 verification; nonce-backed sign-in; testnet chain `0x1b01`

Endpoints: `GET /api/portal/auth/nonce`, `POST /api/portal/auth/sign-in`.

## Cross-app link contract

- Explorer: `https://boing.observer`; account deep link: `https://boing.observer/account/<address>`
- Faucet: `https://boing.network/network/faucet`
- Transaction-detail links: provisional until boing.observer has stable tx route

## Wallet improvements already done

- Per-signature approval prompt; `accountsChanged` / `chainChanged` / `disconnect`; stable provider errors and `data.boingCode`

## Highest-value next steps

- Public dApp transaction API (`boing_signTransaction`, `boing_submitTransaction`, `boing_simulateTransaction`); multi-account support; formal Boing Wallet API spec.

---

# Part 3 — Sync review (2026-03-06)

## Fixed in this repo

- Canonical explorer links → `https://boing.observer`; account deep links → `/account/<address>`.
- Removed unsafe tx-detail explorer links until boing.observer has stable route.
- Faucet restricted to testnet in web wallet and adapter.
- Docs updated for portal nonce-backed sign-in (`GET/POST` auth endpoints, multiline message).
- Mainnet treated as configurable until official public mainnet metadata.
- QA references → canonical `QUALITY-ASSURANCE-NETWORK.md`; wallet QA RPC wrapper supports current RPC shape (`descriptionHash`, asset metadata, `doc_url`).
- Sync handoff note added for cross-app link contract.

## Files updated in this sync pass

- `src/networks/index.ts`, `src/networks/boingAdapter.ts`, `src/screens/Dashboard.tsx`, `src/boing/rpc.ts`, `src/boing/qa.ts`, `src/screens/docs/docContent.tsx`, `src/screens/Privacy.tsx`
- `README.md`, `docs/DEVELOPMENT.md`, `docs/WALLET_CONNECTION_AND_API.md`, `docs/EXTENSION_STORE.md`
- `extension/config.ts`, `extension/manifest.base.json`, `extension/popup.ts`, `extension/popup.html`
- `scripts/generate-extension-manifest.js`, `vite.extension.config.ts`

---

For full API and implementation details see [WALLET_CONNECTION_AND_API.md](WALLET_CONNECTION_AND_API.md) and [BOING_NETWORK_WALLET_IMPLEMENTATION_CHECKLIST.md](BOING_NETWORK_WALLET_IMPLEMENTATION_CHECKLIST.md).
