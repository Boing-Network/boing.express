# Boing Wallet: Integration & Chrome Web Store Checklist

Source of truth: **boing-network** repo — `docs/RPC-API-SPEC.md`, `crates/boing-primitives` (types, signature.rs).

---

## Part 1: Boing Network integration

### RPC and data

| Item | Status | Notes |
|------|--------|--------|
| **Balance** | ✅ | `boing_getBalance([hex_account_id])` or `boing_getAccount([hex_account_id])`. Adapter prefers `getAccount` (balance + nonce in one call); falls back to `getBalance`. Decimal strings for u128. |
| **Nonce** | ✅ | From `boing_getAccount` when available; else `boing_getNonce`. Fetched when building the next transaction, not cached across sessions. |
| **Send** | ✅ | Transfer payload, correct nonce/sender/to/amount, empty access_list. BLAKE3 signable hash + Ed25519 per boing-primitives. Submit `hex(bincode(SignedTransaction))` via `boing_submitTransaction`. |
| **Simulate before send** | ✅ | `boing_simulateTransaction([hex_signed_tx])` called before submit. If simulation fails (e.g. insufficient balance), error shown and tx not submitted. If node returns "Method not found", submit proceeds. |
| **Faucet (testnet)** | ✅ | "Get testnet BOING" calls `boing_faucetRequest([hex_account_id])`. Rate limit (-32016) and "method not found" (-32601 → "Faucet is not enabled") mapped to clear messages. Link to boing.network/network/faucet with address pre-filled. |
| **Network switch** | ✅ | User chooses Boing Testnet vs Mainnet. Selection persisted (extension: `chrome.storage.local`; web: context). Correct RPC URL per network; default Testnet. |
| **Chain height** | ✅ | Optional: `boing_chainHeight` used; web dashboard shows "Block #N". Adapter exposes `getChainHeight()`. |
| **Errors** | ✅ | RPC codes -32600, -32601, -32602, -32000, -32016 mapped to user-friendly messages in `rpc.ts` (`rpcErrorToMessage`). |

### Address and keys

| Item | Status | Notes |
|------|--------|--------|
| **Address format** | ✅ | 64-char hex (32-byte AccountId), with or without 0x. Copy button; display in UI. |
| **Key handling** | ✅ | Ed25519 keypair; private key never sent to server. Extension: encrypted blob in `chrome.storage.local`. Web: encrypted in localStorage. Password-derived key (PBKDF2 + AES-GCM). |

### Signing and bincode

| Item | Status | Notes |
|------|--------|--------|
| **Bincode layout** | ✅ | `src/boing/bincode.ts`: Transaction, Payload (Transfer/Bond/Unbond), AccessList match boing-primitives (field order, u64/u128 LE). |
| **Signable message** | ✅ | `src/boing/signing.ts`: BLAKE3(nonce_le + sender_32 + bincode(payload) + bincode(access_list)); Ed25519(signable_message). SignedTransaction = { tx, signature }; submit hex(bincode(SignedTransaction)). |

---

## Part 2: Chrome extension (Manifest V3)

### Manifest

| Item | Status | Notes |
|------|--------|--------|
| **Manifest V3** | ✅ | `manifest.json`: `"manifest_version": 3`. |
| **Required fields** | ✅ | name, version, description; clear and accurate. |
| **Icons** | ✅ | 16, 48, 128 from package (`extension/icons/`), generated from favicon SVG. |

### Background / service worker

| Item | Status | Notes |
|------|--------|--------|
| **Service worker** | N/A | Extension is popup-only; no background script. No DOM/window in SW. |
| **No remote code** | ✅ | No eval(); no execution of logic from remote URLs. Only packaged code; remote data (RPC, config) allowed. |
| **Storage** | ✅ | `chrome.storage.local` for wallet blob and selected network. Extension uses `walletStore.extension.ts`; web uses `walletStore.ts` (localStorage). |

### Permissions and host access

| Item | Status | Notes |
|------|--------|--------|
| **Minimal permissions** | ✅ | `storage`, `tabs`. Host permissions only for RPC and boing.network: `https://testnet-rpc.boing.network/*`, `https://rpc.boing.network/*`, `https://boing.network/*`. |
| **Declare in manifest** | ✅ | All listed in `manifest.json`. Document in Store Listing why each is used. |

### Content and security

| Item | Status | Notes |
|------|--------|--------|
| **Content scripts** | N/A | No injection into web pages. |
| **CSP** | ✅ | No relaxation of CSP for unsafe-inline or remote script. |

---

## Part 3: Chrome Web Store listing

| Item | Status | Notes |
|------|--------|--------|
| **Short description** | Dashboard | One line, e.g. "Boing Wallet – send and receive BOING on Boing Network". |
| **Detailed description** | Dashboard | What the wallet does: Boing support, create/import, balance, send, testnet faucet, network selector. |
| **Screenshots** | Dashboard | At least one; multiple flows recommended. |
| **Category** | Dashboard | e.g. Productivity or Finance; match single purpose. |
| **Single purpose** | Dashboard | e.g. "Crypto wallet for Boing Network". |
| **Privacy policy** | ✅ | https://boing.express/privacy. |
| **Data usage** | Dashboard | Declare no personal data to developer servers; RPC may see requests per their policy. |
| **Visibility / Regions** | Dashboard | Set in Distribution tab. |
| **Test instructions** | Dashboard | If requested: e.g. select Testnet, use faucet, send a tx. No real mainnet keys. |

---

## Part 4: Pre-submission

| Item | Status | Notes |
|------|--------|--------|
| **Production bundle** | ✅ | `pnpm run build`, `pnpm run build:extension`; no dev-only code or test keys in package. |
| **No debug endpoints** | ✅ | No placeholder RPC URLs that shouldn’t ship; config uses production RPC URLs. |
| **Test on clean profile** | Manual | Install unpacked, create/import, balance, send testnet, faucet; no console errors. |
| **Zip package** | Manual | Extension dir only (manifest, scripts, assets); no node_modules. |
| **Dashboard tabs** | Manual | Store listing, Privacy, Distribution (and Test instructions if needed) filled and consistent. |

---

## RPC methods used

| Method | Params | Use |
|--------|--------|-----|
| boing_getAccount | [hex_account_id] | Balance, nonce (and optionally stake) as decimal strings; preferred when available. |
| boing_getBalance | [hex_account_id] | Balance when getAccount not available. |
| boing_getNonce | [hex_account_id] | Nonce when getAccount not available. |
| boing_submitTransaction | [hex_signed_tx] | Submit signed Transfer. |
| boing_simulateTransaction | [hex_signed_tx] | Pre-flight before submit. |
| boing_faucetRequest | [hex_account_id] | Testnet only. |
| boing_chainHeight | [] | Optional: block height in UI. |

---

## Reference

- **RPC spec:** boing-network `docs/RPC-API-SPEC.md`
- **Types / bincode:** boing-network `crates/boing-primitives`
- **Signing:** `crates/boing-primitives/src/signature.rs`
- **This app:** `src/boing/rpc.ts`, `src/boing/signing.ts`, `src/boing/bincode.ts`, `src/networks/boingAdapter.ts`
