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
| **boing_signMessage** | `[messageHex, address?]` | `string` | Signs the message (0x-prefixed hex). Optional second param is the account to sign with (default: current account). Returns 0x + 128-char hex (Ed25519). Requires site to be connected and wallet unlocked. |
| **boing_chainId** | `[]` | `string` | Returns the current chain id: `0x1b01` (testnet) or `0x1b02` (mainnet). |
| **boing_switchChain** | `[{ chainId }]` or `[chainId]` | `null` | Switches the wallet’s active network. Supported: `0x1b01`, `0x1b02`. Throws if chain is unsupported. |

### Account format

- **Address:** 32-byte account id as 64 hex characters, with optional `0x` prefix (e.g. `0x7f3a2b1c4d5e6f7890abcdef...`).

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

- **Connect:** When a site calls `boing_requestAccounts`, the extension adds the page’s **origin** to a stored “connected sites” list and returns the current account. Only those origins can later call `boing_accounts` or `boing_signMessage`.
- **Disconnect:** In the extension popup, **Wallet** tab → **Connected sites** lists each origin with a **Disconnect** button. Removing a site revokes access until the user connects again from that origin.

### Security and UX

- **Origin tracking:** Connected sites are stored in `chrome.storage.local`; only those origins get accounts and can request signing.
- **Unlock required for signing:** Signing uses a key held in memory only after the user unlocks in the extension popup. After **Lock**, `boing_signMessage` fails until the user unlocks again.
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

- **Flow:**
  1. User has connected (you have `address` from `boing_requestAccounts` or `boing_accounts`).
  2. Build a sign-in message, e.g. `Sign in to Boing Portal at ${origin} at ${timestamp}` (or similar; include origin and a nonce/timestamp).
  3. Encode the message as **0x-prefixed hex** (UTF-8 bytes → hex).
  4. Call `await window.boing.request({ method: 'boing_signMessage', params: [messageHex, address] })`.
  5. Send `{ account_id_hex, message, signature }` to your backend.
  6. Backend recovers the signer from `message` + `signature` (Ed25519), checks it matches `account_id_hex`, and if the account is registered, creates a session (e.g. JWT or cookie).

Example (message to hex and sign):

```js
function utf8ToHex(s) {
  const bytes = new TextEncoder().encode(s);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const message = `Sign in to Boing Portal at ${window.location.origin} at ${Date.now()}`;
const messageHex = utf8ToHex(message);
const signature = await window.boing.request({
  method: 'boing_signMessage',
  params: [messageHex, address],
});
// POST to your backend: { account_id_hex: address, message, signature }
```

### Backend: Verify signature and create session

- **New endpoint (e.g. `POST /api/portal/auth/sign-in`):**  
  Body: `{ account_id_hex, message, signature }`.
- **Verification:**
  - Decode `account_id_hex` to 32-byte public key (64 hex chars, optional 0x).
  - Decode `signature` to 64-byte Ed25519 signature (128 hex chars, optional 0x).
  - Verify Ed25519: `signature` is valid for `message` (UTF-8 or raw bytes as used on frontend) under the given public key.
- If valid and the account is registered (developer / user / node_operator), create a session (JWT or session cookie) and return success. Otherwise return 401 or 400.

The portal’s existing “address-only” flow (e.g. `GET /api/portal/me?account_id_hex=...`) does not prove control; the new sign-in flow should replace or supplement it for production/mainnet so that only someone who holds the private key can sign in.

### Optional: Chain and network

- If the portal cares about testnet vs mainnet, call `boing_chainId` and optionally prompt the user to switch with `boing_switchChain` if you need a specific network.
- Address format is the same on both (32-byte hex); only chain id and RPC differ.

---

## Summary table

| Topic | boing.express (done) | boing.network (to do) |
|-------|---------------------|----------------------|
| **Provider** | Injects `window.boing`, Boing methods + optional eth aliases | Detect `window.boing`, call `boing_requestAccounts` for Connect |
| **Connect** | Adds origin to connected list, returns address | Show “Connect wallet”, call API, store address for session |
| **Sign-in / auth** | `boing_signMessage` returns Ed25519 signature | Build message (origin + nonce), get signature, send to backend; backend verifies Ed25519 and creates session |
| **Disconnect** | User removes site in extension “Connected sites” | Optional: “Disconnect” in UI clears local session; next visit must call `boing_requestAccounts` again |
| **Spec** | This document | Adopt same method names for portal and any other Boing dApps |

---

## References

- **Original design note (wallet connection and sign-in):** From the boing.network project — this implementation follows that design (provider API, 32-byte addresses, message signing for auth, no “address only” trust).
- If the boing.network team wants to add **address + password** sign-in (no wallet) as well, that would be a separate backend feature: store hashed password per account, sign-in with address + password, compare hash. The wallet connection described here is independent and handles “Connect wallet” + sign-in with signature.
