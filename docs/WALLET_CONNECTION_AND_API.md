# Boing Express Wallet Connection & API

This document describes the wallet connection and sign-in features implemented in **boing.express**, the **Boing Wallet API** (provider spec), and what **boing.network** needs to implement for “Connect wallet” and secure sign-in.

---

## Part 1 — Boing Wallet API (provider)

The **Boing-native** wallet provider API is used by Boing Express and intended for any Boing-compatible wallet (browser extension, mobile app, etc.). It does not depend on Ethereum or external RPC method names.

### Provider object

- **Injected as:** `window.boing` (or discovered via EIP-6963 as Boing Express).
- **Shape:** `request({ method, params })` returns a Promise; optional `on(event, listener)` / `removeListener(event, listener)` for events.

### Methods (primary API)

All methods are called via:

```ts
const result = await window.boing.request({ method: '<method>', params: [...] });
```

| Method | Params | Returns | Description |
|--------|--------|--------|--------------|
| **boing_requestAccounts** | `[]` | `string[]` | Connects the current origin to the wallet and returns the current account address (32-byte hex with `0x`). Fails if no wallet exists. |
| **boing_accounts** | `[]` | `string[]` | Returns the current account if the site is already connected; otherwise `[]`. No side effects. |
| **boing_signMessage** | `[message, address?]` | `string` | Signs **BLAKE3(UTF-8 message)** with the account’s **Ed25519** key (Boing convention; matches portal and tx signing). **Message:** pass a **plain UTF-8 string** (e.g. the portal’s nonce-backed multiline message) or 0x-prefixed hex of UTF-8 bytes. Returns a 64-byte Ed25519 signature as 128 hex chars (with or without `0x`). Optional second param: address to sign with (default: current account). Requires site connected and wallet unlocked. |
| **boing_chainId** | `[]` | `string` | Returns the current chain id: `0x1b01` (testnet) or `0x1b02` (mainnet). |
| **boing_switchChain** | `[{ chainId }]` or `[chainId]` | `null` | Switches the wallet’s active network. Supported: `0x1b01`, `0x1b02`. Throws if chain is unsupported. |
| **boing_signTransaction** | `[txObject]` | `string` | Signs a native Boing transaction JSON and returns `0x` + hex(bincode `SignedTransaction`). User must approve in the extension. Requires the origin to be connected and the wallet unlocked. |
| **boing_sendTransaction** | `[txObject]` | `string` | Same as sign, then RPC `boing_simulateTransaction` when available, then `boing_submitTransaction`. Returns tx hash string. |
| **boing_simulateTransaction** | `[hexSignedTx]` | `object` | Forwards to node RPC (no signing). Params: hex from `boing_signTransaction`. Connected origin required. Result shape per [RPC-API-SPEC.md `boing_simulateTransaction`](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md) (includes `suggested_access_list`, `access_list_covers_suggestion`). |

### Native transaction JSON (`boing_signTransaction` / `boing_sendTransaction`)

- **`type`:** `transfer` \| `bond` \| `unbond` \| `contract_call` \| `contract_deploy_purpose` \| `contract_deploy_meta` (not legacy `contract_deploy`).
- **`contract_call`:** `contract` (32-byte AccountId hex), `calldata` (hex bytes), and explicit **`access_list`**: `{ read: string[], write: string[] }` with the same 64-hex-character account ids (optional `0x`). Alias: **`accessList`**. Omitting `access_list` yields an empty list (backward compatible); production dApps and **boing-sdk** should pass the list the node expects for scheduling (see network **HANDOFF-DEPENDENT-PROJECTS** / **RPC-API-SPEC**).
- **`from`:** optional; if set, must match the active account.
- **`nonce`:** optional decimal string; if omitted, the wallet fetches the next nonce from RPC.

### Provider surface for SDK alignment

- **`supportsBoingNativeRpc`:** `true` on `window.boing` (Boing Express). Use with **boing-sdk** `providerSupportsBoingNativeRpc` / **`connectInjectedBoingWallet`** patterns.
- **Errors:** Node failures from submit/simulate are exposed as `data.boingCode === 'BOING_NODE_JSONRPC'` with `data.rpc: { code, message, data }` so clients match [BOING-RPC-ERROR-CODES-FOR-DAPPS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-RPC-ERROR-CODES-FOR-DAPPS.md). Simulation failure (`BOING_SIMULATION_FAILED`) may include `suggested_access_list` and `access_list_covers_suggestion` for retry flows.

### dApp helpers in this repo (SDK parity)

`src/boing/injectedWallet.ts` mirrors **boing-sdk** `walletProvider.ts` (`connectInjectedBoingWallet`, `providerSupportsBoingNativeRpc`, `requestAccounts`, `readChainIdHex`, `boingSendTransaction`, …) and extends **`mapInjectedProviderErrorToUiMessage`** with Boing Express `data.boingCode` and nested node RPC. Prefer depending on **boing-sdk** when possible; copy or import from this file when you want the same strings without the full SDK.

### Account format

- **Address:** 32-byte account id as 64 hex characters, with optional `0x` prefix (e.g. `0x7f3a2b1c4d5e6f7890abcdef...`).

### Message signing (boing_signMessage / personal_sign)

- **Input:** The message is the **exact UTF-8** string to sign. The wallet accepts:
- **Plain UTF-8 string** (recommended for portal), for example:
  ```txt
  Sign in to Boing Portal
  Origin: https://boing.network
  Timestamp: 2026-03-06T12:00:00.000Z
  Nonce: <server nonce>
  ```
  The wallet encodes the exact text to UTF-8 bytes and signs those bytes. **No extra libraries needed on the network side.**
  - **0x-prefixed hex:** if the string looks like hex, the wallet decodes it to bytes and signs those bytes.
- **Signing:** The wallet hashes the message with **BLAKE3** and signs the 32-byte hash with the account’s **Ed25519** private key (same as Boing transaction signing). **No Keccak256, no secp256k1** — portal verifies Ed25519 over BLAKE3(message).
- **Output:** 64-byte Ed25519 signature as **128 hex characters**, with or without `0x` prefix (Boing Express returns with `0x`).

### Chain IDs

- **Boing Testnet:** `0x1b01` (6913)
- **Boing Mainnet:** `0x1b02` (6914)

### Compatibility aliases (optional)

Wallets may support these aliases so existing dApp code or libraries that use Ethereum-style names still work. Boing-first dApps should use the Boing method names above.

| Alias | Maps to |
|-------|--------|
| eth_requestAccounts | boing_requestAccounts |
| eth_accounts | boing_accounts |
| personal_sign | boing_signMessage |
| eth_chainId | boing_chainId |
| wallet_switchEthereumChain | boing_switchChain |

---

## Part 2 — What Was Implemented in boing.express

### Provider injection

- The extension injects a provider at **`window.boing`** so any website can detect and use the wallet.
- A **content script** runs at `document_start` on `http://*/*` and `https://*/*`, and injects **inpage.js** (runs in the page context).
- The provider is also announced via **EIP-6963** so “Connect wallet” modals that support multi-wallet discovery can list Boing Express.

### Connect / disconnect

- **Connect:** When a site calls `boing_requestAccounts`, the extension adds the page’s **origin** to a stored “connected sites” list and returns the current account. Only those origins can later call `boing_accounts`, `boing_signMessage`, transaction methods, or `boing_simulateTransaction`.
- **Disconnect:** In the extension popup, **Wallet** tab → **Connected sites** lists each origin with a **Disconnect** button. Removing a site revokes access until the user connects again from that origin.

### Security and UX

- **Origin tracking:** Connected sites are stored in `chrome.storage.local`; only those origins get accounts and can request signing.
- **Unlock required for signing:** Signing uses a key held in memory only after the user unlocks in the extension popup. After **Lock**, `boing_signMessage` and transaction methods fail until the user unlocks again. **`boing_simulateTransaction`** does not use the private key but still requires a **connected** origin.
- **Account format:** 32-byte Boing account ids are exposed as 64 hex characters with optional `0x` prefix (e.g. `0x7f3a2b1c...`).
- **Chain IDs:** Testnet `0x1b01` (6913), Mainnet `0x1b02` (6914).

### Files added/updated (boing.express)

- **extension/background.ts** — Service worker: connected-sites storage, in-memory unlock, handler for all provider methods (Boing + aliases).
- **extension/content.ts** — Content script: injects inpage.js, bridges postMessage ↔ background.
- **extension/inpage.ts** — Injected script: sets `window.boing`, forwards `request()` to content script.
- **extension/config.ts** — Chain ID constants.
- **src/crypto/keys.ts** — `signMessage(message: Uint8Array, privateKey)` for Ed25519 message signing.
- **extension/popup.ts** + **popup.html** + **popup.css** — Unlock/lock messaging to background; “Connected sites” UI with Disconnect.
- **extension/manifest.json** — `background.service_worker`, `content_scripts`, `web_accessible_resources` for inpage.js.
- **vite.extension.config.ts** + **vite.extension.inpage.config.ts** — Build popup, background, content, inpage.

---

## Part 3 — What boing.network Needs to Implement

### Frontend: Detect provider and “Connect wallet”

- **Detect wallet:** Check for `window.boing` (and optionally EIP-6963 for multiple wallets). If present, show “Connect wallet” or “Connect Boing Express”.
- **Connect flow:**
  1. Call `await window.boing.request({ method: 'boing_requestAccounts', params: [] })`.
  2. On success, you receive `[address]` (32-byte hex with `0x`). Store or use this for the session.
  3. On error (e.g. no wallet, user cancelled), show a clear message (e.g. “Install Boing Express” or “Connect was denied”).

Example:

```js
if (typeof window.boing !== 'undefined') {
  try {
    const accounts = await window.boing.request({ method: 'boing_requestAccounts', params: [] });
    if (accounts && accounts.length > 0) {
      const address = accounts[0]; // 32-byte hex, 0x prefix
      // e.g. set state, show "Connected: 0x…abc"
    } else {
      // user declined or no account
    }
  } catch (e) {
    // e.g. "No wallet. Create or import a wallet in Boing Express."
    console.error(e.message);
  }
} else {
  // Show "Install Boing Express" or hide Connect wallet
}
```

### Frontend: Sign-in for authentication

Do **not** treat “I have the address” as proof of control. Always verify with a **signature**.

**Boing wallet behavior (boing.express):** `boing_signMessage` / `personal_sign` takes the **exact UTF-8 message string**, signs it with the account’s **Ed25519** key (Boing account ID = public key), and returns the **64-byte Ed25519 signature as hex** (128 hex chars, with or without 0x). **No Keccak256 hash, no secp256k1** — so the portal can verify with Ed25519 only, without any extra libraries on the network side.

- **Current portal flow:**
  1. User connects and you obtain `address` from `boing_requestAccounts` or `boing_accounts`.
  2. Frontend calls `GET /api/portal/auth/nonce?origin=${encodeURIComponent(window.location.origin)}`.
  3. Frontend builds the nonce-backed multiline message from the returned nonce plus the current timestamp.
  4. Frontend calls `boing_signMessage` with the **plain UTF-8 string** (recommended) or with 0x-prefixed hex of UTF-8 bytes.
  5. Frontend sends `{ account_id_hex, message, signature }` to `POST /api/portal/auth/sign-in`.
  6. Backend verifies Ed25519 plus nonce validity, origin match, expiry, and one-time use before creating a session.

**Example — pass the UTF-8 string directly (no hex encoding needed):**

```js
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
  params: [message, address],  // plain string; wallet signs UTF-8 bytes with Ed25519
});
// POST to backend: { account_id_hex: address, message, signature }
```

**Example — alternative with hex (if you prefer):**

```js
function utf8ToHex(s) {
  const bytes = new TextEncoder().encode(s);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
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
  params: [utf8ToHex(message), address],
});
// POST to backend: { account_id_hex: address, message, signature }
```

### Backend: Verify signature and create session

- **Current portal endpoint:** `POST /api/portal/auth/sign-in`  
  Body: `{ account_id_hex, message, signature }`. The `message` is the exact UTF-8 string the user signed, using the nonce-backed multiline format above.
- **Verification (Ed25519 only; no Keccak256, no secp256k1):**
  - Decode `account_id_hex` to 32-byte public key (64 hex chars, optional 0x).
  - Decode `signature` to 64-byte Ed25519 signature (128 hex chars, optional 0x).
  - Encode `message` as UTF-8 bytes (same as signed by the wallet).
  - Verify Ed25519: `signature` is valid for those message bytes under the given public key.
- If valid and the account is registered (developer / user / node_operator), create a session (JWT or session cookie) and return success. Otherwise return 401 or 400.

The portal’s legacy “address-only” flow (e.g. `GET /api/portal/me?account_id_hex=...`) does not prove control. The nonce-backed wallet sign-in flow is now the preferred contract and should be treated as the primary secure path.

### Optional: Chain and network

- If the portal cares about testnet vs mainnet, call `boing_chainId` and optionally prompt the user to switch with `boing_switchChain` if you need a specific network.
- Address format is the same on both (32-byte hex); only chain id and RPC differ.

---

## Summary table

| Topic | boing.express (done) | boing.network (to do) |
|-------|---------------------|----------------------|
| **Provider** | Injects `window.boing`, Boing methods + optional eth aliases + `supportsBoingNativeRpc` | Detect `window.boing`, call `boing_requestAccounts` for Connect |
| **Connect** | Adds origin to connected list, returns address | Show “Connect wallet”, call API, store address for session |
| **Sign-in / auth** | `boing_signMessage` returns Ed25519 signature | Fetch backend nonce, build nonce-backed multiline message, get signature, send to backend; backend verifies Ed25519 and creates session |
| **Native txs** | `boing_signTransaction`, `boing_sendTransaction`, `boing_simulateTransaction`; `access_list` on tx JSON | dApps use **boing-sdk** + wallet per [HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md) |
| **Disconnect** | User removes site in extension “Connected sites” | Optional: “Disconnect” in UI clears local session; next visit must call `boing_requestAccounts` again |
| **Spec** | This document | Adopt same method names for portal and any other Boing dApps |

---

## References

- **Original design note (wallet connection and sign-in):** From the boing.network project — this implementation follows that design (provider API, 32-byte addresses, message signing for auth, no “address only” trust).
- If the boing.network team wants to add **address + password** sign-in (no wallet) as well, that would be a separate backend feature: store hashed password per account, sign-in with address + password, compare hash. The wallet connection described here is independent and handles “Connect wallet” + sign-in with signature.
