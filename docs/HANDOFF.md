# Boing Express — Handoff & Sync

Single reference for the **boing.express** wallet: handoff to **boing.network**, sync contract with the portal, and sync review changelog.

**Cross-repo backlog (node, SDK, Express, Observer, partners):** [Boing Network — HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md) and [THREE-CODEBASE-ALIGNMENT.md](https://github.com/Boing-Network/boing.network/blob/main/docs/THREE-CODEBASE-ALIGNMENT.md) on `Boing-Network/boing.network` (e.g. commit `fbf3112` and later).

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
| **dApp connection** | `window.boing` provider; `boing_requestAccounts`, `boing_signMessage`, `boing_signTransaction`, `boing_sendTransaction`, etc. |
| **Message signing** | Ed25519; per-request approval window. |
| **Provider events** | `accountsChanged`, `chainChanged`, `disconnect`. |
| **Errors** | Stable numeric codes + `data.boingCode` (e.g. `BOING_NO_WALLET`, `BOING_WALLET_LOCKED`). |

## 2. Account, Key, and Signature (for portal verification)

- **Account id:** 32-byte Ed25519 public key, 64 hex chars, usually `0x` prefix.
- **Signature:** Ed25519, 64 bytes, 128 hex chars. Wallet signs **exact UTF-8 message** (no Keccak256/secp256k1).

Backend should: (1) parse `account_id_hex` as Ed25519 public key, (2) parse `signature` as 64-byte Ed25519, (3) UTF-8 encode `message`, (4) verify Ed25519.

## 3. Provider API

- `boing_requestAccounts` / `boing_accounts` / `boing_signMessage` / `boing_signTransaction` / `boing_sendTransaction` / `boing_chainId` / `boing_switchChain`
- `boing_sendTransaction` signs, then calls RPC `boing_simulateTransaction` when available, then `boing_submitTransaction`. **`boing_simulateTransaction([hexSignedTx])`** is also exposed on the provider (connected origin; forwards to the wallet’s selected RPC).
- **`boing_simulateContractCall([contractHex, calldataHex, senderHex?, atBlock?])`** — unsigned `contract_call` dry-run per [RPC-API-SPEC.md](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md); connected origin required; matches **boing-sdk** `BoingClient.simulateContractCall`. Details: **[BOING-EXPRESS-WALLET.md](BOING-EXPRESS-WALLET.md)**.
- Aliases: `eth_requestAccounts`, `personal_sign`, `eth_chainId`, `wallet_switchEthereumChain`
- Portal should prefer `boing_*` methods.

## 4. Sign-In Flow (what portal implements)

1. Connect: `boing_requestAccounts`
2. Chain: `boing_chainId` (testnet `0x1b01`), optionally `boing_switchChain`
3. Nonce: `GET /api/portal/auth/nonce?origin=...`
4. Message: multiline UTF-8 with Origin, Timestamp, Nonce
5. Sign: `boing_signMessage([message, address])`
6. Verify: `POST /api/portal/auth/sign-in` with `{ account_id_hex, message, signature }`

## 5. Gaps / follow-ups vs network handoff

- **Done in extension:** `boing_signTransaction` / `boing_sendTransaction` / **`boing_simulateTransaction`**; `contract_call` with explicit **`access_list`** (`access_list` or `accessList`); simulation failure includes **`suggested_access_list`** / **`access_list_covers_suggestion`** in `error.data` when the node returns them; **`supportsBoingNativeRpc: true`** on `window.boing` for SDK detection.
- **Done / updated:** `src/boing/injectedWallet.ts` — **`connectInjectedBoingWallet`** + extended **`mapInjectedProviderErrorToUiMessage`**; multi-account vault (extension + web); extension **Advanced: native transaction JSON**; account switch locks session and notifies dApps (`BOING_ACTIVE_ACCOUNT_CHANGED` / `BOING_ACCOUNT_SWITCHED`).
- **Still optional / backlog:** richer pre-sign approval UI (show simulation hints before sign), published npm package for helpers, formal wallet API spec PDF. Track priorities in [HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md).

### Verification (from a `boing.network` clone)

Cross-repo checks and tutorial tooling live in **Boing-Network/boing.network**. Examples:

```bash
cd boing-sdk && npm ci && npm run build && npm test
cd ../examples/native-boing-tutorial && npm ci
BOING_RPC_URL=https://testnet-rpc.boing.network \
  TOKEN_IN=0x… TOKEN_OUT=0x… AMOUNT_IN=1000000 \
  node scripts/print-native-dex-routes.mjs
```

See [PRE-VIBEMINER-NODE-COMMANDS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/PRE-VIBEMINER-NODE-COMMANDS.md) for **`preflight-rpc`** / **`check-testnet-rpc`** smoke.

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
- Faucet: `https://boing.network/faucet`
- Transaction-detail links: provisional until boing.observer has stable tx route

## Wallet improvements already done

- Per-signature approval prompt; `accountsChanged` / `chainChanged` / `disconnect`; stable provider errors and `data.boingCode`

## Highest-value next steps

- Multi-account support; formal Boing Wallet API spec; deeper alignment with SDK error strings and **`connectInjectedBoingWallet`**-style flows per upstream handoff.

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
