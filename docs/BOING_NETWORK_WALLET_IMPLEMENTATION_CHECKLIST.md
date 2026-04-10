# Boing Network Wallet Implementation Checklist

This file is a short, implementation-focused handoff for the `boing.express` agent/team.

Use this document when the goal is to implement the remaining wallet work needed for the best `boing.network` portal and dApp experience.

## Goal

Make `boing.express` a first-class Boing wallet for:

- portal sign-in
- Boing-native dApp connection
- safe message signing
- native transaction signing/submission from dApps (`boing_signTransaction` / `boing_sendTransaction` / `boing_simulateTransaction`)

## Current Network Expectations

`boing.network` now expects the wallet to support this flow:

1. Site detects `window.boing`
2. Site calls `boing_requestAccounts`
3. Site optionally checks `boing_chainId`
4. Site may call `boing_switchChain` to `0x1b01` on the testnet portal
5. Site fetches a backend nonce from `/api/portal/auth/nonce`
6. Site builds this exact message:

```txt
Sign in to Boing Portal
Origin: https://boing.network
Timestamp: 2026-03-06T12:00:00.000Z
Nonce: <server nonce>
```

7. Site calls `boing_signMessage(message, address)`
8. Site POSTs `{ account_id_hex, message, signature }` to `/api/portal/auth/sign-in`

The wallet must sign the **exact UTF-8 bytes** of the message using **Ed25519**.

## Required Wallet Behaviors

These should already work and must remain stable:

- inject `window.boing`
- support `boing_requestAccounts`
- support `boing_accounts`
- support `boing_signMessage`
- support `boing_chainId`
- support `boing_switchChain`
- support `boing_signTransaction`, `boing_sendTransaction`, `boing_simulateTransaction`, **`boing_simulateContractCall`** (extension provider; unsigned contract-call dry-run per RPC-API-SPEC — see **docs/BOING-EXPRESS-WALLET.md**)
- expose `supportsBoingNativeRpc: true` for **boing-sdk** detection
- parse explicit **`access_list` / `accessList`** on dApp transaction JSON (32-byte Boing accounts)
- allow compatibility aliases:
  - `eth_requestAccounts`
  - `eth_accounts`
  - `personal_sign`
  - `eth_chainId`
  - `wallet_switchEthereumChain`
- return Boing addresses as `0x` + 64 hex chars
- return Ed25519 signatures as 64-byte hex
- reject signing if:
  - wallet is locked
  - origin is not connected
  - requested account does not match active account

## Priority 1: Implemented

### 1. Per-signature approval prompt

Status: implemented.

Add a fresh approval step for each `boing_signMessage` request.

The current approval window shows:

- requesting origin
- current chain id
- active address
- full message text
- explicit Approve and Reject actions

This is now part of the wallet flow for every sign request.

### 2. Stable wallet errors

Status: implemented with stable message text and provider error data.

Return stable, predictable error messages or codes for:

- wallet locked
- no wallet created/imported
- origin not connected
- user rejected connection
- user rejected signing
- unsupported method
- unsupported chain
- address mismatch

The wallet now returns structured provider errors with stable numeric codes plus `data.boingCode`.

### 3. Provider events

Status: implemented.

Supported provider listeners:

- `accountsChanged`
- `chainChanged`

Also supported:

- `disconnect`

These should fire when the user changes account, locks the wallet, disconnects a site, or changes networks.

### 4. Better unlock UX

Status: implemented.

When a site requests signing and the wallet is locked, the wallet now returns a stable locked-wallet error that dApps can surface directly.

- clear locked-wallet error text
- stable `boingCode`
- no ambiguous generic failure

### 5. Session-based lock and unlock

Status: implemented.

- **Web app:** Unlock once per session; session persists in `sessionStorage` across page refresh/navigation within the same tab. Optional inactivity timeout (5 / 15 / 30 min or Never) with configurable setting in Dashboard. "Lock" button clears session and requires password again.
- **Extension:** Unlock once; session survives popup close/reopen within the same browser session via `chrome.storage.session`. When locked, `boing_requestAccounts` and `boing_accounts` return a clear "Wallet is locked" error or `[]`; dApp requests do not get account data until the user unlocks Boing Express.

## Priority 2: Next Phase

### 6. Public dApp transaction API

Status: **implemented** (extension `window.boing`).

- `boing_signTransaction` / `boing_sendTransaction` with Boing-native tx JSON (including `contract_call` + `access_list`).
- `boing_simulateTransaction([hex])` forwards to RPC for pre-flight / `suggested_access_list` flows.
- `boing_simulateContractCall([contract, calldata, …])` forwards to RPC for **unsigned** simulate (SDK parity).
- Submit uses RPC `boing_submitTransaction` (there is no separate `boing_submitTransaction` provider method).
- On simulation failure during send, provider error `data` may include `suggested_access_list` and `access_list_covers_suggestion` per [RPC-API-SPEC.md](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md).

Optional polish: richer approval UI for contract calls, tighter copy parity with **boing-sdk** `mapInjectedProviderErrorToUiMessage`.

### 7. Multi-account support

Add support for:

- multiple imported/created accounts
- active account selection
- account switching events

This is not blocking the current portal flow, but will matter quickly as dApp usage grows.

## Implementation Notes

### Message signing rules

`boing_signMessage` must:

- accept a plain UTF-8 string
- optionally accept `0x`-prefixed hex bytes
- sign the exact bytes presented
- not apply Ethereum message prefixing
- not hash with Keccak256
- not use secp256k1
- use raw Ed25519

### Chain rules

Supported chain ids:

- `0x1b01` = Boing Testnet
- `0x1b02` = Boing Mainnet

`boing_switchChain` should:

- accept `[{ chainId }]` or `[chainId]`
- switch active network when supported
- return a clear error when chain is unsupported

### Connection rules

`boing_requestAccounts` should:

- connect the current origin
- return the active account
- work only when a wallet exists

`boing_accounts` should:

- return `[address]` only when the origin is connected
- return `[]` otherwise

## Suggested Agent Task Order

1. Multi-account support and account-switch events
2. Error-copy parity with **boing-sdk** / **BOING-RPC-ERROR-CODES-FOR-DAPPS**
3. Optional connection approval UX (first connect prompt)
4. Richer event coverage and transaction approval summaries

## Acceptance Checklist

The wallet work is in good shape when:

- portal sign-in works with the nonce-backed message format
- every sign request requires explicit approval
- origin and message are clearly shown before approval
- locked-wallet failures are obvious and recoverable
- provider events update dApps correctly
- method and chain errors are consistent
- Boing-native methods are treated as primary

## Short Summary

Next highest-impact items:

- **multi-account support**
- **transaction approval UX** (clearer contract_call / access_list display)
- **error string parity** with **boing-sdk** for dApp integrators

Cross-repo checklist: [HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md), [THREE-CODEBASE-ALIGNMENT.md](https://github.com/Boing-Network/boing.network/blob/main/docs/THREE-CODEBASE-ALIGNMENT.md).
