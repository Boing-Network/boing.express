# Boing Express — Development & Operations

This document combines integration details, GitHub/CI setup, and SEO/deployment notes for the Boing Express project.

---

## Design system

Boing Express uses the **Boing Design System** variant **Aqua Personal** (personal, secure, approachable, trustworthy). Design tokens, typography, and component patterns are documented in **[docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)**. When adding or changing UI, use the tokens and section/button patterns from `src/index.css` and refer to DESIGN_SYSTEM.md for consistency with the rest of the Boing ecosystem.

---

## 1. Boing Network integration & Chrome Web Store checklist

Source of truth: **boing-network** repo — `docs/RPC-API-SPEC.md`, `crates/boing-primitives` (types, signature.rs).

### Part 1: Boing Network integration

#### RPC and data

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

#### Address and keys

| Item | Status | Notes |
|------|--------|--------|
| **Address format** | ✅ | 64-char hex (32-byte AccountId), with or without 0x. Copy button; display in UI. |
| **Key handling** | ✅ | Ed25519 keypair; private key never sent to server. Extension: encrypted blob in `chrome.storage.local`. Web: encrypted in localStorage. Password-derived key (PBKDF2 + AES-GCM). |

#### Signing and bincode

| Item | Status | Notes |
|------|--------|--------|
| **Bincode layout** | ✅ | `src/boing/bincode.ts`: Transaction, Payload (Transfer/Bond/Unbond), AccessList match boing-primitives (field order, u64/u128 LE). |
| **Signable message** | ✅ | `src/boing/signing.ts`: BLAKE3(nonce_le + sender_32 + bincode(payload) + bincode(access_list)); Ed25519(signable_message). SignedTransaction = { tx, signature }; submit hex(bincode(SignedTransaction)). |

### Part 2: Chrome extension (Manifest V3)

| Item | Status | Notes |
|------|--------|--------|
| **Manifest V3** | ✅ | `manifest.json`: `"manifest_version": 3`. |
| **Required fields** | ✅ | name, version, description; clear and accurate. |
| **Icons** | ✅ | 16, 48, 128 from package (`extension/icons/`), generated from favicon SVG. |
| **Service worker** | N/A | Extension is popup-only; no background script. |
| **No remote code** | ✅ | No eval(); only packaged code; remote data (RPC, config) allowed. |
| **Storage** | ✅ | `chrome.storage.local` for wallet blob and selected network. |
| **Minimal permissions** | ✅ | `storage`, `tabs`. Host permissions only for RPC and boing.network. |
| **CSP** | ✅ | No relaxation of CSP for unsafe-inline or remote script. |

### Part 3: Chrome Web Store listing

| Item | Status | Notes |
|------|--------|--------|
| **Short description** | Dashboard | One line, e.g. "Boing Express — the wallet for Boing Network". |
| **Detailed description** | Dashboard |  |
| **Screenshots** | Dashboard | At least one; multiple flows recommended. |
| **Category** | Dashboard | e.g. Productivity or Finance; match single purpose. |
| **Single purpose** | Dashboard | See [extension/PERMISSIONS_AND_PRIVACY.md](../extension/PERMISSIONS_AND_PRIVACY.md). |
| **Privacy policy** | ✅ | https://boing.express/privacy. |
| **Data usage** | Dashboard | Paste from [extension/PERMISSIONS_AND_PRIVACY.md](../extension/PERMISSIONS_AND_PRIVACY.md); matches policy. |
| **Support** | ✅ | https://boing.express/support — docs, FAQ, testnet, contact. |
| **Test instructions** | Dashboard | If requested: e.g. select Testnet, use faucet, send a tx. No real mainnet keys. |

For ready-to-paste store copy and screenshot instructions, see [extension/CHROME_WEB_STORE.md](../extension/CHROME_WEB_STORE.md).

### RPC methods used

| Method | Params | Use |
|--------|--------|-----|
| boing_getAccount | [hex_account_id] | Balance, nonce (and optionally stake) as decimal strings; preferred when available. |
| boing_getBalance | [hex_account_id] | Balance when getAccount not available. |
| boing_getNonce | [hex_account_id] | Nonce when getAccount not available. |
| boing_submitTransaction | [hex_signed_tx] | Submit signed Transfer. |
| boing_simulateTransaction | [hex_signed_tx] | Pre-flight before submit. |
| boing_faucetRequest | [hex_account_id] | Testnet only. |
| boing_chainHeight | [] | Optional: block height in UI. |

**Reference:** boing-network `docs/RPC-API-SPEC.md`, `crates/boing-primitives`, `src/boing/rpc.ts`, `src/boing/signing.ts`, `src/boing/bincode.ts`, `src/networks/boingAdapter.ts`.

---

## 2. GitHub repository variables (and secrets)

Use these in **GitHub repo → Settings → Secrets and variables → Actions**.

### Required secrets (already set)

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages — Edit** |

### Optional repository variables (for build)

Add these under **Variables** if you want to override RPC endpoints in the GitHub Actions build:

| Variable | Value | Description |
|----------|--------|-------------|
| `VITE_BOING_TESTNET_RPC` | `https://testnet-rpc.boing.network` | Boing testnet JSON-RPC URL. When testnet is live, confirm the official URL from [Boing Network status](https://boing.network/network/status) or [RPC API docs](https://boing.network/docs/rpc-api). |
| `VITE_BOING_MAINNET_RPC` | `https://rpc.boing.network` | Boing mainnet JSON-RPC URL. Confirm from Boing docs when mainnet is live. |

If these variables are **not** set, the app uses the same defaults at build time. Setting them in GitHub is useful if Boing provides different public RPC URLs later.

### Summary — copy-paste for GitHub Variables

- **Name:** `VITE_BOING_TESTNET_RPC` → **Value:** `https://testnet-rpc.boing.network`
- **Name:** `VITE_BOING_MAINNET_RPC` → **Value:** `https://rpc.boing.network`

---

## 3. SEO for Boing Express

### Implemented

- **Meta tags:** Title, description, keywords, author, robots, canonical URL
- **Open Graph:** og:type, og:url, og:title, og:description, og:image, og:site_name, og:locale (for Facebook, LinkedIn, Discord, etc.)
- **Twitter Card:** summary_large_image with title, description, image, image alt
- **Structured data:** JSON-LD `WebSite` schema for rich results
- **robots.txt:** Allow all, Sitemap URL
- **sitemap.xml:** Main routes (/, /wallet, /docs, doc subpages) with priority and changefreq
- **Theme color:** theme-color and msapplication-TileColor for browser UI (#0A0E1A — Boing Deep Navy)
- **Icons:** favicon.svg and apple-touch-icon use primary teal (#00E5CC) to match Boing Network brand

### Brand consistency (aqua/teal)

- **Favicon:** SVG uses stroke `#00E5CC` (primary accent) so the tab/bookmark icon matches the Boing Network brand.
- **og-image:** When you add `public/og-image.png` (1200×630), use the same aqua/teal accent so link previews match the brand.

### Maintenance

- **Update sitemap lastmod:** When you make significant content changes, update the `<lastmod>` dates in `public/sitemap.xml` (or automate via a build step).
- **Per-route meta (optional):** For unique titles/descriptions per route (e.g. /docs/security), add something like `react-helmet-async` and set meta in each page component. The current setup uses a single set of meta in `index.html`, which is fine for a small site.
- **Submit to search engines:**
  - [Google Search Console](https://search.google.com/search-console): add property `https://boing.express`, submit sitemap URL.
  - [Bing Webmaster Tools](https://www.bing.com/webmasters): add site, submit sitemap.
  - Optional: [IndexNow](https://www.indexnow.org/) for faster indexing.
- **Analytics (optional):** Add Google Analytics, Plausible, or similar and link from the same docs if you use them.
