# Boing Network Sync Handoff

This file is intended for the `boing.express` agent/team. It summarizes what `boing.network` now implements, the exact wallet contract expected by the portal, and the next wallet-side improvements that would most improve UX and security.

## What `boing.network` Now Implements

The network-side portal has been updated to match the current Boing Express provider model more closely.

### Implemented on `boing.network`

- Wallet connect on `/testnet/sign-in`
- Preference for Boing-native provider methods:
  - `boing_requestAccounts`
  - `boing_signMessage`
  - `boing_chainId`
  - `boing_switchChain`
- Alias fallback only when a Boing-native method is unsupported:
  - `eth_requestAccounts`
  - `personal_sign`
  - `eth_chainId`
  - `wallet_switchEthereumChain`
- Backend Ed25519 verification using Node built-in `crypto`
- Nonce-backed sign-in flow to reduce replay risk
- Testnet chain enforcement on portal sign-in (`0x1b01`)

### New network endpoints

- `GET /api/portal/auth/nonce?origin=https://boing.network`
- `POST /api/portal/auth/sign-in`

## Exact Sign-In Contract

### 1. Connect

The portal now prefers:

```js
const accounts = await window.boing.request({
  method: 'boing_requestAccounts',
  params: [],
});
```

Expected result:

- `["0x" + 64 hex chars]`

### 2. Chain

The portal checks:

```js
await window.boing.request({ method: 'boing_chainId', params: [] });
```

Expected chain ids:

- `0x1b01` = Boing Testnet
- `0x1b02` = Boing Mainnet

For the testnet portal, the site may call:

```js
await window.boing.request({
  method: 'boing_switchChain',
  params: [{ chainId: '0x1b01' }],
});
```

### 3. Sign-In Message

The portal now asks the wallet to sign this exact UTF-8 string:

```txt
Sign in to Boing Portal
Origin: https://boing.network
Timestamp: 2026-03-06T12:00:00.000Z
Nonce: <server nonce>
```

Important:

- The wallet should sign the exact UTF-8 bytes of that message.
- No Keccak256.
- No secp256k1.
- No Ethereum message prefixing.
- Raw Ed25519 only.

### 4. Signing call

The portal prefers:

```js
const signature = await window.boing.request({
  method: 'boing_signMessage',
  params: [message, address],
});
```

Expected result:

- 64-byte Ed25519 signature
- hex encoded
- with or without `0x` prefix

### 5. Backend verification

`boing.network` verifies:

1. `account_id_hex` as the 32-byte Ed25519 public key
2. `message` as exact UTF-8 bytes
3. `signature` as a 64-byte Ed25519 signature
4. nonce validity, origin match, expiry, and one-time use

If all checks pass and the account is registered, the portal creates a local session.

## What the Wallet Should Continue to Support

The current portal assumes these Boing Express behaviors remain true:

- `window.boing` is injected and available to dApps
- `boing_requestAccounts` connects the current origin
- `boing_accounts` returns the current address for already connected origins
- `boing_signMessage` signs exact UTF-8 bytes with Ed25519
- `boing_chainId` returns `0x1b01` or `0x1b02`
- `boing_switchChain` accepts either `[{ chainId }]` or `[chainId]`
- signing fails if the wallet is locked
- signing fails if the origin is not connected
- signing fails if the requested address does not match the active account

## Cross-App Link Contract

The wallet should stay aligned with the current public explorer and website surfaces:

- Canonical explorer base URL: `https://boing.observer`
- Canonical account deep link: `https://boing.observer/account/<address>`
- Canonical public faucet page: `https://boing.network/network/faucet`

Transaction-detail deep links should be treated as provisional until `boing.observer` publishes a stable tx-detail route contract.

## Wallet Improvements Now Implemented

These sync items are now implemented on the wallet side:

### 1. Per-signature approval prompt

Every `boing_signMessage` request now opens an approval window that shows:

- requesting origin
- current chain
- active address
- full message preview
- explicit approve / reject actions

### 2. Event support for dApps

The provider now emits:

- `accountsChanged`
- `chainChanged`
- `disconnect`

### 3. Better locked-wallet UX

Locked-wallet failures now return stable provider errors that the portal can surface directly.

### 4. Stable provider error semantics

Provider failures now include stable numeric error codes plus `data.boingCode` values such as:

- `BOING_NO_WALLET`
- `BOING_WALLET_LOCKED`
- `BOING_ORIGIN_NOT_CONNECTED`
- `BOING_USER_REJECTED_SIGNING`
- `BOING_UNSUPPORTED_METHOD`
- `BOING_UNSUPPORTED_CHAIN`
- `BOING_ADDRESS_MISMATCH`

## Highest-Value Wallet Improvements Remaining

These are the most important wallet-side improvements for overall user experience and safety.

### 1. Public dApp transaction API

The extension popup already supports send / stake / unbond, but the provider does not yet expose a full dApp transaction path.

Recommended next methods:

- `boing_signTransaction`
- `boing_submitTransaction`
- `boing_simulateTransaction`

### 2. Multi-account support

Even if Boing Express stays single-account for now, future support for:

- account selection
- account switching events
- clear active-account display

would make dApp integrations more robust.

## Recommended Error Semantics

For a better dApp UX, wallet errors should stay consistent and distinguishable:

- wallet not installed
- wallet locked
- no wallet exists yet
- user rejected connection
- user rejected signing
- unsupported method
- unsupported chain
- address mismatch
- origin not connected

The wallet now returns stable message text plus `data.boingCode`; the next step would be formalizing those values in an official Boing wallet spec.

## Recommended Long-Term Boing Wallet Spec

The current wallet/provider behavior is already a good starting point for an official Boing Wallet API spec.

A strong next version would formalize:

- provider method names
- argument and response formats
- error codes/messages
- events
- transaction signing/submission methods
- chain metadata
- connection and approval UX expectations

## Short Summary

`boing.network` now expects Boing Express to behave as a Boing-native wallet first, with Ethereum-style aliases only as compatibility helpers.

The most important current contract is:

- connect with `boing_requestAccounts`
- sign exact UTF-8 text with `boing_signMessage`
- use Ed25519 only
- expose Boing testnet/mainnet chain ids
- support the nonce-backed sign-in message format

The most important next wallet improvement is:

- add public dApp transaction methods with approval UX
