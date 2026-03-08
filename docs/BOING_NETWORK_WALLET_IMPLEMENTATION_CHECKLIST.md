# Boing Network Wallet Implementation Checklist

This file is a short, implementation-focused handoff for the `boing.express` agent/team.

Use this document when the goal is to implement the remaining wallet work needed for the best `boing.network` portal and dApp experience.

## Goal

Make `boing.express` a first-class Boing wallet for:

- portal sign-in
- Boing-native dApp connection
- safe message signing
- future transaction signing/submission from dApps

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

Expose transaction operations through the provider, not just through the popup UI.

Recommended methods:

- `boing_signTransaction`
- `boing_submitTransaction`
- `boing_simulateTransaction`

Expected direction:

- dApp prepares transaction payload
- wallet shows approval UI
- wallet signs with Ed25519
- wallet optionally submits to the selected RPC

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

1. Add transaction provider methods
2. Add multi-account support
3. Consider connection approval flow
4. Consider richer event coverage and account selection UX

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

If only one wallet improvement gets done next, make it:

- **public dApp transaction methods**

If two more get done after that, make them:

- **multi-account support**
- **transaction approval UX for dApps**
