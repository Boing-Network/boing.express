# Boing Express Wallet Handoff For boing.network

This document is the current-state handoff for the `boing.express` browser-extension wallet. It is intended for the `boing.network` agent/team so they can understand:

- what the wallet already does
- what APIs the portal/dApps can call today
- what the backend must verify for secure sign-in
- what is not implemented yet and may require work on either side

This is the best single file to send to the `boing.network` project.

---

## 1. Current Wallet Capabilities

The extension currently supports these user-facing wallet features:

| Area | Current behavior |
|------|------------------|
| **Wallet creation** | User can create a new wallet in the extension popup. A new Ed25519 keypair is generated locally. |
| **Wallet import** | User can import a wallet using a 32-byte private key as 64 hex chars. |
| **Encrypted local storage** | The private key is encrypted with the user password and stored in `chrome.storage.local`. The plaintext private key is not stored. |
| **Backup flow** | After wallet creation, the private key is shown once so the user can copy and back it up. |
| **Unlock / lock** | User unlocks with password. While unlocked, the background service worker can sign messages for connected sites. Lock clears the in-memory signing key. |
| **Address display** | Wallet shows the Boing account id/address derived from the Ed25519 public key. |
| **Network selection** | User can switch between Boing testnet and Boing mainnet in the popup. |
| **Balance view** | Wallet fetches and displays current BOING balance from the selected network RPC. |
| **Send BOING** | Wallet can build, sign, and submit transfer transactions from the popup UI. |
| **Stake / Unbond** | Wallet can build, sign, and submit bond/unbond transactions where the selected network supports them. |
| **Faucet** | On testnet, wallet can request tokens from faucet and open the faucet page. |
| **Connected sites list** | Wallet stores which origins are connected and shows them in the popup with a Disconnect button. |
| **Website / dApp connection** | Websites can connect to the wallet through the injected `window.boing` provider. |
| **Message signing for auth** | Websites can request message signing for login/auth flows using Ed25519 signatures. |
| **Per-signature approval** | Every `boing_signMessage` request now opens an approval window showing origin, chain, address, and the exact message before signing. |
| **Provider events** | The provider now emits `accountsChanged`, `chainChanged`, and `disconnect` so dApps can stay in sync. |
| **Stable provider errors** | Provider failures now include stable numeric error codes plus `data.boingCode` values for dApp handling. |

---

## 2. Account, Key, and Signature Model

This is important for `boing.network` backend verification.

- **Account id / address:** Boing uses a 32-byte Ed25519 public key as the account id.
- **Displayed format:** 64 hex characters, usually with `0x` prefix.
- **Private key:** 32 bytes.
- **Signature algorithm:** Ed25519.
- **Signature size:** 64 bytes, returned as 128 hex chars. `boing.express` currently returns signatures with `0x` prefix.
- **No EVM signing path:** The wallet does **not** use `keccak256`, `secp256k1`, or Ethereum-style signing for Boing auth.

For portal sign-in, the backend should:

1. Parse `account_id_hex` as the Ed25519 public key.
2. Parse `signature` as the 64-byte Ed25519 signature.
3. Encode the original message string as UTF-8 bytes.
4. Verify the Ed25519 signature against those exact bytes.

---

## 3. Wallet Provider API Available Today

The extension injects a provider at `window.boing`.

Basic shape:

```ts
const result = await window.boing.request({
  method: '<method>',
  params: [...],
});
```

Primary Boing-native methods:

| Method | Params | Returns | Notes |
|------|--------|---------|------|
| `boing_requestAccounts` | `[]` | `string[]` | Connects the current origin and returns the active account. |
| `boing_accounts` | `[]` | `string[]` | Returns the account only if the origin is already connected. |
| `boing_signMessage` | `[message, address?]` | `string` | Signs the exact UTF-8 message with Ed25519. |
| `boing_chainId` | `[]` | `string` | Returns `0x1b01` for testnet or `0x1b02` for mainnet. |
| `boing_switchChain` | `[{ chainId }]` or `[chainId]` | `null` | Switches active network if supported. |

Compatibility aliases also exist:

| Alias | Maps to |
|------|---------|
| `eth_requestAccounts` | `boing_requestAccounts` |
| `eth_accounts` | `boing_accounts` |
| `personal_sign` | `boing_signMessage` |
| `eth_chainId` | `boing_chainId` |
| `wallet_switchEthereumChain` | `boing_switchChain` |

`boing.network` should prefer the `boing_*` names.

---

## 4. How Connection Works

When a site calls:

```js
await window.boing.request({ method: 'boing_requestAccounts', params: [] });
```

the wallet:

1. checks that a wallet exists
2. records the site origin in the connected-sites list
3. returns the active account as `0x` + 64 hex chars

When a site later calls:

```js
await window.boing.request({ method: 'boing_accounts', params: [] });
```

the wallet returns:

- `[address]` if the origin is already connected
- `[]` if it is not connected

Disconnect behavior:

- The user can remove an origin from the popup’s **Connected sites** list.
- After disconnect, that origin will get `[]` from `boing_accounts`.
- To regain access, the site must call `boing_requestAccounts` again.

---

## 5. How Message Signing Works

This is the most important part for portal login.

### Current behavior

`boing_signMessage` signs the **exact UTF-8 message** using the unlocked account’s Ed25519 private key.

Accepted input formats:

- **Plain UTF-8 string**  
  Example:
  `Sign in to Boing Portal`
  `Origin: https://boing.network`
  `Timestamp: 2026-03-06T12:00:00.000Z`
  `Nonce: <server nonce>`

- **0x-prefixed hex string**  
  If the first argument looks like valid hex, the wallet decodes it to bytes and signs those bytes.

Recommended `boing.network` usage:

- pass the plain UTF-8 message directly
- do not hex-encode unless you specifically want that path

Example:

```js
const address = (await window.boing.request({
  method: 'boing_requestAccounts',
  params: [],
}))[0];

const nonceResponse = await fetch(
  `/api/portal/auth/nonce?origin=${encodeURIComponent(window.location.origin)}`
).then((res) => res.json());

const message =
  `Sign in to Boing Portal\n` +
  `Origin: ${window.location.origin}\n` +
  `Timestamp: ${new Date().toISOString()}\n` +
  `Nonce: ${nonceResponse.nonce}`;

const signature = await window.boing.request({
  method: 'boing_signMessage',
  params: [message, address],
});

// POST { account_id_hex: address, message, signature } to backend
```

### Signing restrictions

The wallet only signs if:

- the site origin is already connected
- the wallet exists
- the requested address matches the active wallet account
- the wallet is currently unlocked in the extension

If the wallet is locked, the sign request fails until the user unlocks it.

Every sign request now also requires explicit user approval in a Boing Express approval window that shows:

- requesting origin
- current chain id
- active address
- full message text
- Approve / Reject controls

---

## 6. What boing.network Should Implement

### Frontend

The portal or dApp should:

1. detect `window.boing`
2. call `boing_requestAccounts` on connect
3. store/use the returned address
4. fetch a backend nonce and create the nonce-backed multiline sign-in message
5. call `boing_signMessage`
6. POST `{ account_id_hex, message, signature }` to the backend

```txt
Sign in to Boing Portal
Origin: https://boing.network
Timestamp: 2025-03-06T12:00:00.000Z
Nonce: <server-generated nonce>
```

### Backend

The backend should add a sign-in endpoint such as:

```txt
POST /api/portal/auth/sign-in
```

Request body:

```json
{
  "account_id_hex": "0x...",
  "message": "Sign in to Boing Portal\nOrigin: https://boing.network\nTimestamp: 2026-03-06T12:00:00.000Z\nNonce: <server nonce>",
  "signature": "0x..."
}
```

Verification steps:

1. parse `account_id_hex` as the Ed25519 public key
2. parse `signature` as the 64-byte Ed25519 signature
3. UTF-8 encode `message`
4. verify Ed25519 signature
5. confirm the account is registered/allowed
6. create a session or JWT

### Chain/network handling

If the portal cares about network:

- call `boing_chainId`
- optionally call `boing_switchChain`

Current supported chain ids:

- `0x1b01` = Boing Testnet
- `0x1b02` = Boing Mainnet

---

## 7. Security Model That boing.network Should Know

What the wallet currently enforces:

- private key ciphertext is stored locally in `chrome.storage.local`
- private key plaintext is only available in memory after unlock
- signing is blocked while locked
- only connected origins can access accounts or request signatures
- account/address mismatch during signing is rejected
- every sign request requires a fresh approval prompt before the signature is produced
- provider events notify dApps when accounts, chain, or connection state changes

Provider errors now include stable numeric codes and `data.boingCode`. Important current values include:

- `BOING_NO_WALLET`
- `BOING_WALLET_LOCKED`
- `BOING_ORIGIN_NOT_CONNECTED`
- `BOING_USER_REJECTED_SIGNING`
- `BOING_UNSUPPORTED_METHOD`
- `BOING_UNSUPPORTED_CHAIN`
- `BOING_ADDRESS_MISMATCH`

---

## 8. What Is Not Yet Exposed To dApps

The provider currently supports **connection and message signing**. It does **not** yet expose a full dApp transaction API.

Not currently available through `window.boing`:

- transaction submission methods for dApps
- contract call methods
- transaction simulation methods
- multi-account selection

The popup itself can already:

- send transfers
- bond
- unbond
- request faucet funds

But those flows are currently **extension UI features**, not public provider methods for dApps.

If `boing.network` wants dApps to submit transactions through the wallet later, a next Boing Wallet API phase should define methods such as:

- `boing_signTransaction`
- `boing_submitTransaction`
- `boing_simulateTransaction`
- event support for `accountsChanged` / `chainChanged`

---

## 9. Recommended Questions For boing.network

These are the main decisions the `boing.network` agent/team should keep refining next:

1. When should address-only sign-in be fully removed or hidden in favor of nonce-backed wallet auth?
2. Should the wallet add a public transaction API for dApps beyond sign-in and message signing?
3. Should the Boing Wallet API become an official Boing-wide spec for all Boing wallets and dApps?
4. Which provider error codes/messages should become part of the long-term official Boing wallet spec?
5. How should account-aware explorer and wallet flows interoperate once `boing.observer` adds more deep-linkable surfaces?

---

## 10. Short Summary

`boing.express` already supports:

- wallet creation/import
- encrypted local storage
- unlock/lock
- balance/send/stake/faucet in the popup
- site connection via `window.boing`
- secure Ed25519 message signing for auth
- connected-site management

`boing.network` mainly needs to implement:

- frontend connect button using `boing_requestAccounts`
- sign-in flow using `boing_signMessage`
- backend Ed25519 verification and session creation

The most important technical contract is:

- the wallet signs the **exact UTF-8 message string** with **Ed25519**
- the returned signature is **64 bytes as hex**
- the account id is the **Ed25519 public key**

