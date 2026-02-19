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

### Deploy from CLI

```bash
pnpm build
npx wrangler pages deploy dist --project-name=boing-wallet
```

Create the Pages project in the Cloudflare dashboard first so `project-name` matches.

## Boing Network details

- **Address**: 32-byte AccountId = Ed25519 public key, shown as 64-character hex (with or without `0x`).
- **Signing**: Signable message = BLAKE3(nonce_LE \|\| sender \|\| bincode(payload) \|\| bincode(access_list)); signature = Ed25519(signable_message). Submitted as `hex(bincode(SignedTransaction))` via `boing_submitTransaction`.
- **RPC**: JSON-RPC 2.0. Key methods: `boing_submitTransaction`, `boing_chainHeight`, `boing_getBlockByHeight`, `boing_simulateTransaction`, `boing_faucetRequest` (testnet). See `boing-network` repo `docs/RPC-API-SPEC.md`.
- **Balance**: The app calls `boing_getBalance([hex_account_id])` if the RPC supports it. If not implemented, the UI shows `0` and you need a small indexer or state RPC (document your approach in the RPC spec).

## Project structure

```
src/
  boing/           # Boing types, bincode encoding, signing, RPC client
  crypto/          # Ed25519 key generation
  networks/        # Network adapter interface + Boing adapter
  storage/         # Encrypted wallet persistence
  context/         # React wallet context
  screens/         # Welcome (create/import/unlock), Dashboard (address, balance, send, faucet)
```

## Adding another chain

1. Implement `NetworkAdapter` in `src/networks/` (e.g. `evmAdapter.ts`).
2. Register the adapter and config (RPC URL, chain id) in `src/networks/index.ts`.
3. The UI network selector will list it; no wallet core changes required.

## License

MIT
