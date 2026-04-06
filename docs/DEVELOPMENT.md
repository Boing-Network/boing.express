# Boing Express — Development & Operations

This document combines integration details, GitHub/CI setup, and SEO/deployment notes for the Boing Express project.

---

## Design system

Boing Express uses the **Boing Design System** variant **Aqua Personal** (personal, secure, approachable, trustworthy). Design tokens, typography, and component patterns are documented in **[docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)**. When adding or changing UI, use the tokens and section/button patterns from `src/index.css` and refer to DESIGN_SYSTEM.md for consistency with the rest of the Boing ecosystem.

### Automated tests

- **Unit / integration:** `pnpm test` (Vitest).
- **Extension smoke (opt-in):** `pnpm exec playwright install chromium` once, then `EXTENSION_E2E=1 pnpm run test:e2e`. This builds the extension, serves `tests/e2e/static`, loads the unpacked `extension/` folder in Playwright’s Chromium (headed), and checks `window.boing`, `supportsBoingNativeRpc`, `boing_chainId`, and event listener APIs (`on` / `removeListener` for multi-account style subscriptions). Skipped unless `EXTENSION_E2E=1`.
- **Extension popup + multi-account (opt-in):** `EXTENSION_E2E_FULL=1 pnpm run test:e2e:multi` — loads the unpacked extension, opens `popup.html`, asserts `wallet-landing-create` / `wallet-landing-import`, and runs a **full flow** (create wallet → dashboard → **Add** → second keypair → backup → two `<option>`s on `wallet-account-switch`). Playwright stubs Boing `GET /api/networks` and JSON-RPC (`tests/e2e/helpers/boingRouteMocks.ts`) so the run does not depend on live network latency.
- **E2E env alignment:** `playwright.config.ts` loads repo **`.env`** then **`.env.local`** (same `VITE_BOING_TESTNET_RPC` / `VITE_BOING_MAINNET_RPC` keys as Vite) so JSON-RPC mocks target the **same hostnames** as the built extension without exporting vars in the shell. `.env.local` overrides `.env` for those keys.
- **Extra RPC mock hosts:** Comma-separated **`EXTENSION_E2E_RPC_MOCK_HOSTS`** (hostnames or full `http(s)://` URLs) adds more JSON-RPC interception targets—for example a staging hostname that is not matched by the built-in `*.boing.network` heuristics.
- **Headless (opt-in, limited):** **`EXTENSION_E2E_HEADLESS=1`** runs Chromium headless. **Manifest V3 extensions often do not register a service worker in headless mode**, so these tests may time out waiting for the extension ID. For CI without a display, prefer **headed Chromium on a virtual framebuffer** (e.g. Linux: `xvfb-run -a pnpm run test:e2e:multi`) and leave headless off unless your Chromium build supports extensions headless.
- **Stable selectors:** The **web app** (`/wallet`) uses `data-testid` on `Welcome.tsx` / `Dashboard.tsx`. The **Chrome extension popup** uses the same `wallet-*` test ids on `extension/popup.html` (vanilla UI, not React) so Playwright can target either surface.
- **Golden profile (optional):** To reuse one manual “already funded” profile instead of scripted onboarding, copy a Chrome user-data folder that already has the extension loaded and wallet state, point Playwright’s `launchPersistentContext` at that path, and skip create steps — document your own path; we do not commit profile zips.

---

## 1. Boing Network integration & Chrome Web Store checklist

Source of truth: **boing-network** repo — `docs/RPC-API-SPEC.md`, `docs/TECHNICAL-SPECIFICATION.md`, `docs/QUALITY-ASSURANCE-NETWORK.md`, `crates/boing-primitives`.

### Part 1: Boing Network integration

#### RPC and data

| Item | Status | Notes |
|------|--------|--------|
| **Balance** | ✅ | `boing_getBalance([hex_account_id])` or `boing_getAccount([hex_account_id])`. Adapter prefers `getAccount` (balance + nonce in one call); falls back to `getBalance`. Decimal strings for u128. |
| **Nonce** | ✅ | From `boing_getAccount` when available; else `boing_getNonce`. Fetched when building the next transaction, not cached across sessions. |
| **Send** | ✅ | Transfer payload, correct nonce/sender/to/amount, empty access_list. BLAKE3 signable hash + Ed25519 per boing-primitives. Submit `hex(bincode(SignedTransaction))` via `boing_submitTransaction`. |
| **Simulate before send** | ✅ | `boing_simulateTransaction([hex_signed_tx])` called before submit. If simulation fails (e.g. insufficient balance), error shown and tx not submitted. If node returns "Method not found", submit proceeds. |
| **Faucet (testnet)** | ✅ | "Get testnet BOING" calls `boing_faucetRequest([hex_account_id])`. Rate limit (-32016) and "method not found" (-32601 → "Faucet is not enabled") mapped to clear messages. Link to `https://boing.network/faucet` with `?address=` pre-filled. |
| **Network switch** | ✅ | User chooses Boing Testnet vs Mainnet. Selection persisted (extension: `chrome.storage.local`; web: context). Correct RPC URL per network; default Testnet. |
| **Chain height** | ✅ | Optional: `boing_chainHeight` used; web dashboard shows "Block #N". Adapter exposes `getChainHeight()`. |
| **Errors** | ✅ | RPC codes -32600, -32601, -32602, -32000, -32016, -32050..-32057 (QA pool / operator) mapped in `rpc.ts` (`rpcErrorToMessage`). Forwarded node errors preserve `code`/`data` on `RpcClientError` for **boing-sdk** `BoingRpcError`. |

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
| **Manifest V3** | ✅ | Generated `manifest.json` (from `manifest.base.json`) uses `"manifest_version": 3`. |
| **Required fields** | ✅ | name, version, description; clear and accurate. |
| **Icons** | ✅ | 16, 48, 128 from package (`extension/icons/`), generated from favicon SVG. |
| **Service worker** | ✅ | background.js — wallet connection (window.boing), connected sites, provider handlers. |
| **No remote code** | ✅ | No eval(); only packaged code; remote data (RPC, config) allowed. |
| **Storage** | ✅ | `chrome.storage.local` for wallet blob and selected network. |
| **Minimal permissions** | ✅ | `storage` only. Generated host permissions include testnet RPC, boing.network, and mainnet only when a mainnet RPC is configured at build time. |
| **CSP** | ✅ | No relaxation of CSP for unsafe-inline or remote script. |

### Part 3: Chrome Web Store listing

| Item | Status | Notes |
|------|--------|--------|
| **Short description** | Dashboard | One line, e.g. "Boing Express — the wallet for Boing Network". |
| **Detailed description** | Dashboard |  |
| **Screenshots** | Dashboard | At least one; multiple flows recommended. |
| **Category** | Dashboard | e.g. Productivity or Finance; match single purpose. |
| **Single purpose** | Dashboard | See [EXTENSION_STORE.md](EXTENSION_STORE.md). |
| **Privacy policy** | ✅ | https://boing.express/privacy. |
| **Data usage** | Dashboard | Paste from [EXTENSION_STORE.md](EXTENSION_STORE.md); matches policy. |
| **Support** | ✅ | https://boing.express/support — docs, FAQ, testnet, contact. |
| **Test instructions** | Dashboard | If requested: e.g. select Testnet, use faucet, send a tx. No real mainnet keys. |

For ready-to-paste store copy and screenshot instructions, see [EXTENSION_STORE.md](EXTENSION_STORE.md).

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
| `VITE_BOING_TESTNET_RPC` | `https://testnet-rpc.boing.network` | Boing testnet JSON-RPC URL. Confirm the official URL from the Boing testnet docs or status pages. |
| `VITE_BOING_MAINNET_RPC` | Optional | Boing mainnet JSON-RPC URL. Mainnet is disabled unless this is explicitly set at build time. |

If these variables are **not** set, the app defaults to the official testnet RPC and keeps mainnet disabled. Setting them in GitHub is useful if Boing provides different public RPC URLs later.

### Summary — copy-paste for GitHub Variables

- **Name:** `VITE_BOING_TESTNET_RPC` → **Value:** `https://testnet-rpc.boing.network`
- **Name:** `VITE_BOING_MAINNET_RPC` → **Value:** official public mainnet RPC when published (leave unset until then)

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

---

## 4. Launch readiness (merged from LAUNCH_READINESS.md)

Tracks readiness for Boing Network incentivized testnet and mainnet.

### Current state

| Feature | Status |
|---------|--------|
| Create/import wallet | ✅ |
| Send BOING, view balance | ✅ |
| Testnet faucet, network switch | ✅ |
| Staking (Bond/Unbond) | ✅ |
| Transaction history, backup reminder | ✅ |
| Web app + browser extension | ✅ |

**RPC endpoints:** Testnet `https://testnet-rpc.boing.network`; Mainnet should be treated as configurable until the official public endpoint is published.

### VibeMiner vs boing.express

- **VibeMiner:** One-click mining/validating (run node, stake). Depends on P2P bootnodes.
- **boing.express:** Non-custodial wallet. Depends on RPC endpoints. Both need Boing Network infrastructure live for incentivized testnet.

### Testnet checklist

- [ ] Public testnet RPC responding
- [ ] Faucet enabled
- [ ] Extension built, Chrome Web Store listing complete (see [EXTENSION_STORE.md](EXTENSION_STORE.md))
- [x] Staking UI, backup reminder, onboarding checklist

### Mainnet

- [ ] Official public mainnet RPC published in `boing.network`
- [ ] Security review; clear mainnet send warning

---

## 5. Alignment with Boing Network specs

This section summarizes how boing.express aligns with the six reference documents in the boing-network repository.

### Reference documents

| Document | Purpose |
|----------|---------|
| [SIX-PILLARS-READINESS.md](https://github.com/chiku524/boing-network/blob/main/docs/SIX-PILLARS-READINESS.md) | Six pillars assessment |
| [TECHNICAL-SPECIFICATION.md](https://github.com/chiku524/boing-network/blob/main/docs/TECHNICAL-SPECIFICATION.md) | Cryptography, data formats, VM, RPC |
| [QUALITY-ASSURANCE-NETWORK.md](https://github.com/boing-network/boing.network/blob/main/docs/QUALITY-ASSURANCE-NETWORK.md) | QA policy, deployer guidance, and canonical malice definition |
| [RUNBOOK.md](https://github.com/chiku524/boing-network/blob/main/docs/RUNBOOK.md) | Node ops, RPC, incident response |
| [SECURITY-STANDARDS.md](https://github.com/chiku524/boing-network/blob/main/docs/SECURITY-STANDARDS.md) | Security requirements, contacts |

### Alignment summary

**Pillar 1: Security (SIX-PILLARS, SECURITY-STANDARDS)** — Ed25519 signatures ✓ (`@noble/ed25519`); BLAKE3 hashing ✓ (`@noble/hashes/blake3`); keys never sent to server ✓; password-derived encryption ✓ (PBKDF2 + AES-GCM).

**Pillars 2–4: Scalability, Decentralization, Authenticity** — Apply primarily to the network and node layer. The wallet uses the RPC interface and does not implement consensus, P2P, or VM execution.

**Pillar 5: Transparency** — Open docs ✓ (/docs, /privacy, /support); QA rejection details ✓ (rule_id, message in RPC errors); canonical QA reference ✓.

**Pillar 6: True Quality Assurance** — Max bytecode 32 KiB ✓; Boing VM opcodes ✓; PUSH encoding ✓; Rule IDs ✓; boing_qaCheck RPC ✓; purpose categories ✓; error codes -32050, -32051 ✓.

**Data structures** — AccountId 32 bytes/64 hex ✓; Transaction, Payload, Signable message, SignedTransaction per TECHNICAL-SPECIFICATION ✓ (signing.ts, bincode.ts).

**RPC methods** — boing_submitTransaction, boing_chainHeight, boing_getBalance, boing_getAccount, boing_getNonce, boing_simulateTransaction, boing_faucetRequest, boing_qaCheck ✓.

**Incident response** — Wallet directs users to RUNBOOK and SECURITY-STANDARDS for incident response and security contacts.

### Gaps (out of scope or deferred)

- Optional RPCs (e.g. `boing_qaMetrics`) not used by the wallet UI.
- Blocklist / bytecode policy: enforced server-side via `boing_qaCheck` and mempool QA; the wallet surfaces RPC errors with codes preserved for `BoingRpcError` parsing.

### Cross-repo coordination & verification

Normative URLs, env vars, and consumer backlogs for **boing.express**, **boing.observer**, and partner dApps:

- **[THREE-CODEBASE-ALIGNMENT.md](https://github.com/Boing-Network/boing.network/blob/main/docs/THREE-CODEBASE-ALIGNMENT.md)** — canonical URLs, RPC env names (`VITE_BOING_TESTNET_RPC` here), chain IDs `0x1b01` / `0x1b02`.
- **[HANDOFF-DEPENDENT-PROJECTS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF-DEPENDENT-PROJECTS.md)** — P0/P1/P2 checklist per codebase; Express items include `contract_call` + `access_list`, simulation UX, error parity with [BOING-RPC-ERROR-CODES-FOR-DAPPS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-RPC-ERROR-CODES-FOR-DAPPS.md).

**Smoke / tutorial (run from a `boing.network` clone):**

```bash
cd boing-sdk && npm ci && npm run build && npm test
cd ../examples/native-boing-tutorial && npm ci
# Off-chain native DEX route dump (see tutorial §7c3 for env):
BOING_RPC_URL=https://testnet-rpc.boing.network \
  TOKEN_IN=0x… TOKEN_OUT=0x… AMOUNT_IN=1000000 \
  node scripts/print-native-dex-routes.mjs
```

Operator copy/paste checks: [PRE-VIBEMINER-NODE-COMMANDS.md](https://github.com/Boing-Network/boing.network/blob/main/docs/PRE-VIBEMINER-NODE-COMMANDS.md) (`preflight-rpc`, `check-testnet-rpc`).

Local index: [docs/CODEBASE-ALIGNMENT.md](CODEBASE-ALIGNMENT.md).
