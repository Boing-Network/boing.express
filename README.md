# Boing Wallet (Boing Express)

Non-custodial crypto wallet for **Boing Network**, built for [boing.express](https://boing.express). Keys are generated and stored only in the browser; the app is deployable to **Cloudflare Pages** with optional Workers for API routes.

## Features

- **Boing Network**: Ed25519 addresses (32-byte AccountId, 64-char hex), send/receive BOING, testnet faucet
- **Signing**: BLAKE3 signable hash + Ed25519 signatures; bincode layout matches `boing-primitives`
- **Multi-chain ready**: Pluggable network adapter interface; Boing is the first, others can be added via config and a new adapter
- **Security**: Client-only key generation (Web Crypto–compatible), password-encrypted storage (AES-GCM), keys never sent to any server

## Tech stack

- **React 18** + **TypeScript** + **Vite** (static build → `dist/`)
- **@noble/ed25519** and **@noble/hashes** (BLAKE3) for crypto
- **Cloudflare Pages** for hosting; optional **Cloudflare Workers** for RPC proxy/rate limiting

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. Build for production:

```bash
pnpm build
```

Output is in `dist/`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_BOING_TESTNET_RPC` | Boing testnet JSON-RPC URL (default: `https://testnet-rpc.boing.network`) |
| `VITE_BOING_MAINNET_RPC` | Boing mainnet JSON-RPC URL (default: `https://rpc.boing.network`) |

Set these in Cloudflare Pages **Build** → **Environment variables** (or in `.env` for local dev). They are baked in at build time via Vite.

## Cloudflare setup (boing.express)

- [ ] **Create a Cloudflare Pages project** linked to this repo (GitHub/GitLab).
- [ ] **Build**: Build command: `pnpm build` (or `npm run build`). Build output directory: `dist`. Install command: `pnpm install` (or `npm install`).
- [ ] **Custom domain**: In **Pages** → **Your project** → **Custom domains**, add **boing.express**. Point your domain’s DNS to Cloudflare (nameservers or CNAME to the Pages URL).
- [ ] **Env vars**: In Pages → **Settings** → **Environment variables**, add `VITE_BOING_TESTNET_RPC` and `VITE_BOING_MAINNET_RPC` for Production (and Preview if you want).
- [ ] **(Optional) Workers**: To run API routes (e.g. RPC proxy, rate limiting) under `boing.express/api/*`, create a Worker and bind it to that route in the dashboard. The wallet app itself does not require a Worker.

### GitHub Actions (auto-deploy)

The repo includes a workflow that deploys to Cloudflare Pages on every push to `main`. **Required GitHub repo secrets:**

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages — Edit** (or **Account — Cloudflare Pages — Edit**) |

After you add the custom domain to the **boing-wallet** Pages project, the site will be available at **https://boing.express** and each push to `main` will trigger a new deployment.

Optional: set repo **variables** so the GitHub build uses the correct RPC endpoints:

| Variable | Value |
|----------|--------|
| `VITE_BOING_TESTNET_RPC` | `https://testnet-rpc.boing.network` |
| `VITE_BOING_MAINNET_RPC` | `https://rpc.boing.network` |

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#2-github-repository-variables-and-secrets-and-secrets) for details.

### Deploy from CLI

```bash
pnpm build
npx wrangler pages deploy dist --project-name=boing-wallet
```

Create the Pages project in the Cloudflare dashboard first so `project-name` matches.

## Boing Network details

- **Address**: 32-byte AccountId = Ed25519 public key, shown as 64-character hex (with or without `0x`).
- **Signing**: Signable message = BLAKE3(nonce_LE \|\| sender \|\| bincode(payload) \|\| bincode(access_list)); signature = Ed25519(signable_message). Submitted as `hex(bincode(SignedTransaction))` via `boing_submitTransaction`.
- **RPC**: JSON-RPC 2.0. Prefers `boing_getAccount` for balance+nonce; falls back to `boing_getBalance`/`boing_getNonce`. Submit via `boing_submitTransaction`; optional `boing_simulateTransaction` before submit. See `boing-network` repo `docs/RPC-API-SPEC.md`. Full integration and Chrome Web Store checklist: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#1-boing-network-integration--chrome-web-store-checklist).

## Project structure

```
src/               # Shared wallet core (used by web app and extension)
  boing/           # Boing types, bincode encoding, signing, RPC client
  crypto/          # Ed25519 key generation
  networks/        # Network adapter interface + Boing adapter
  storage/         # Encrypted wallet persistence
  context/         # React wallet context (web only)
  screens/         # Welcome & Dashboard (web only)
extension/         # Browser extension (Chrome + Firefox)
  manifest.json    # Manifest V3; browser_specific_settings for Firefox
  popup.html, popup.css, popup.ts → popup.js
  config.ts        # RPC URLs for extension
  icons/           # 16, 48, 128 PNG (generated by scripts/generate-extension-icons.js)
docs/              # DEVELOPMENT.md, LAUNCH_READINESS.md, integration, GitHub env, SEO
```

## Adding another chain

1. Implement `NetworkAdapter` in `src/networks/` (e.g. `evmAdapter.ts`).
2. Register the adapter and config (RPC URL, chain id) in `src/networks/index.ts`.
3. The UI network selector will list it; no wallet core changes required.

## What’s in this repo

- **Website (boing.express)**: The Boing Wallet **web app** — deployed to Cloudflare Pages at your custom domain. Create/import wallet, view address, balance, send BOING, testnet faucet. Theme matches [Boing Network](https://boing.network/) (dark UI, amber accent).
- **Browser extension**: A **Chrome and Firefox** extension in `extension/` that reuses the same wallet core. One codebase (Manifest V3); same features: create/import/unlock, address, balance, send, faucet. Same Boing Network theme.

### Building and loading the extension

```bash
pnpm run build:extension
```

Then in **Chrome**: open `chrome://extensions`, enable “Developer mode”, “Load unpacked”, and select the `extension` folder.  
In **Firefox**: open `about:debugging` → “This Firefox” → “Load Temporary Add-on” and select `extension/manifest.json`.

For **Chrome Web Store** submission (icons, privacy policy, listing assets), see [extension/CHROME_WEB_STORE.md](extension/CHROME_WEB_STORE.md).

## License

MIT
