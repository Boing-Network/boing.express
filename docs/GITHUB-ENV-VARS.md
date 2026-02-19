# GitHub repository variables (and secrets)

Use these in **GitHub repo → Settings → Secrets and variables → Actions**.

## Required secrets (already set)

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages — Edit** |

## Optional repository variables (for build)

Add these under **Variables** if you want to override RPC endpoints in the GitHub Actions build:

| Variable | Value | Description |
|----------|--------|-------------|
| `VITE_BOING_TESTNET_RPC` | `https://testnet-rpc.boing.network` | Boing testnet JSON-RPC URL. When testnet is live, confirm the official URL from [Boing Network status](https://boing.network/network/status) or [RPC API docs](https://boing.network/docs/rpc-api). |
| `VITE_BOING_MAINNET_RPC` | `https://rpc.boing.network` | Boing mainnet JSON-RPC URL. Confirm from Boing docs when mainnet is live. |

If these variables are **not** set, the app uses the same defaults at build time (`https://testnet-rpc.boing.network` and `https://rpc.boing.network`). Setting them in GitHub is useful if Boing provides different public RPC URLs later.

## Summary — copy-paste for GitHub Variables

- **Name:** `VITE_BOING_TESTNET_RPC` → **Value:** `https://testnet-rpc.boing.network`
- **Name:** `VITE_BOING_MAINNET_RPC` → **Value:** `https://rpc.boing.network`
