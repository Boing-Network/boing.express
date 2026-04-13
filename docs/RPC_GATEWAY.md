# Boing Express — HTTP JSON-RPC gateway (Cloudflare Worker)

This repository ships **two** integration surfaces:

1. **Browser wallet** — injected `window.boing`, extension, and web app (unchanged).
2. **Optional HTTP gateway** — `workers/rpc-gateway/`, a **Cloudflare Worker** that proxies **allowlisted** Boing JSON-RPC to an upstream node, exposes **`GET /openapi.json`**, and supports **optional API keys**.

The gateway is for **partners, BFFs, and scripts** that want stable HTTPS access without parsing bincode or hammering the node from every browser tab. It does **not** replace the wallet; deploy it on its **own** hostname or route (for example `https://rpc-gateway.boing.express`).

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Service metadata and links. |
| `GET` | `/live` | Liveness JSON (`{ ok: true, service }`). |
| `GET` | `/openapi.json` | OpenAPI **3.1** document for partner tooling. |
| `POST` | `/v1/rpc` | JSON-RPC body (single object or **batch** array); forwarded to **`BOING_UPSTREAM_RPC_URL`** if every `method` is allowlisted. |
| `OPTIONS` | `*` | CORS preflight. |

---

## Configuration

| Variable | Where | Description |
|----------|--------|-------------|
| **`BOING_UPSTREAM_RPC_URL`** | Secret (`wrangler secret put …`) or `.dev.vars` | Full URL of the Boing JSON-RPC endpoint (for example `https://testnet-rpc.boing.network`). |
| **`GATEWAY_API_KEY`** | Optional secret | If set, clients must send **`Authorization: Bearer <key>`** or **`X-Boing-Gateway-Key: <key>`**. API access is **not** a statement about token safety; discovery remains directory data only. **End-user session auth** (cookie sessions, portal JWTs, etc.) is not implemented in this Worker; put that in your own BFF and have the BFF call the gateway or the node with a server-held key. |
| **`GATEWAY_METHOD_ALLOWLIST`** | Optional `wrangler.toml` `[vars]` or dashboard var | Comma-separated Boing method names. If omitted, a **default read-only** set is used (includes **`boing_listDexPools`**, **`boing_listDexTokens`**, **`boing_getDexToken`**, **`boing_health`**, **`boing_getNetworkInfo`**, catalog helpers, etc.). **Does not** include **`boing_submitTransaction`** unless you add it explicitly. |
| **`GATEWAY_CORS_ORIGIN`** | Optional var (default `*`) | Value for `Access-Control-Allow-Origin`. |
| **`GATEWAY_CACHE_TTL_SECONDS`** | `wrangler.toml` `[vars]` or dashboard | **Repo default `15`:** successful upstream **HTTP 200** responses from **`POST /v1/rpc`** are cached (Cache API) for up to this many seconds (capped at **3600**). Cache keys **ignore JSON-RPC `id`**. Set **`0`** to disable or lower near tip for fresher reserves. |
| **`GATEWAY_RATE_LIMIT_PER_MINUTE`** | `wrangler.toml` `[vars]` or dashboard | **Repo default `300`:** caps requests per **client identity** per minute. Identity = hash of **API key material** when clients send a Bearer / `X-Boing-Gateway-Key` value, otherwise hash of **`CF-Connecting-IP`**. With **`RATE_LIMIT_KV`** bound (see `wrangler.toml`), counts are **distributed**; set **`0`** to disable. |

Local development: copy **`workers/rpc-gateway/.dev.vars.example`** to **`workers/rpc-gateway/.dev.vars`** (gitignored).

---

## What values do the Wrangler **secrets** use?

These are **your** infrastructure choices; the repo does not ship fixed production values.

### `BOING_UPSTREAM_RPC_URL` (required in production)

Set this to the **full HTTPS URL** of a Boing node JSON-RPC endpoint (the same kind of URL the wallet uses for `POST` + JSON body).

Examples:

| Environment | Example value |
|-------------|----------------|
| Boing public testnet | `https://testnet-rpc.boing.network` |
| Your own node | `https://rpc.example.com` (must speak Boing JSON-RPC) |

Set once per Worker environment:

```bash
cd workers/rpc-gateway   # optional; or use --config from repo root
wrangler secret put BOING_UPSTREAM_RPC_URL
# paste the URL when prompted, e.g. https://testnet-rpc.boing.network
```

For local dev, put the same key in **`.dev.vars`** (not a “secret” file in CI, but the same variable name).

### `GATEWAY_API_KEY` (optional)

- **Purpose:** Restrict who may call **`POST /v1/rpc`** at the HTTP layer. **Does not** mean tokens or contracts are “approved”; it is only access control for your gateway.
- **Omit:** Do **not** create this secret (or remove it in the dashboard) if the gateway should be **public** — you still rely on **method allowlisting** and (optionally) **Cloudflare WAF** / rate limits.
- **Set:** Use a **long random** string you generate (not a word from the dictionary). Examples of how to generate one:

```bash
openssl rand -hex 32
```

or any password manager “random password” (32+ characters). Paste that **entire string** as the secret value when running:

```bash
wrangler secret put GATEWAY_API_KEY
```

Clients must then send **`Authorization: Bearer <paste-same-string>`** or **`X-Boing-Gateway-Key: <paste-same-string>`**.

---

## Default allowlist (read-only)

The gateway defaults to methods that are typically safe to expose on a partner-facing URL. Widen **`GATEWAY_METHOD_ALLOWLIST`** only when you understand abuse and cost (RPC quota, rate limits on the upstream).

Included by default: **`boing_health`**, **`boing_listDexPools`**, **`boing_listDexTokens`**, **`boing_getDexToken`**, **`boing_getNetworkInfo`**, **`boing_chainHeight`**, **`boing_getSyncState`**, **`boing_rpcSupportedMethods`**, **`boing_getRpcMethodCatalog`**, **`boing_getRpcOpenApi`**.

---

## Caching and rate limits

- **Built-in:** Set **`GATEWAY_CACHE_TTL_SECONDS`** and **`GATEWAY_RATE_LIMIT_PER_MINUTE`** in **`wrangler.toml`** `[vars]` or in the Cloudflare dashboard. Cached RPC responses include **`X-Gateway-Cache: HIT` | `MISS`**. The cache key is derived from the JSON-RPC body **after stripping `id` fields**; **`params`** still distinguish `factory`, `cursor`, `limit`, `light`, filters, etc.
- **Distributed rate limits:** **`workers/rpc-gateway/wrangler.toml`** binds **`RATE_LIMIT_KV`** to the **`BOING_EXPRESS_GATEWAY_RL`** namespace. Forks / other Cloudflare accounts must create their own namespace and replace the **`id`** (or remove the binding and set **`GATEWAY_RATE_LIMIT_PER_MINUTE`** to **`0`**).
- **Upstream limits:** Call **`boing_health`** and use **`rpc_surface`** when sizing clients. Prefer **cursor pagination** with moderate **`limit`** instead of tight loops at **`limit=500`**.

---

## Scripts (repo root)

```bash
pnpm run gateway:dev    # wrangler dev in workers/rpc-gateway (needs .dev.vars)
pnpm run gateway:deploy # wrangler deploy (secrets must be set in the target account)
```

---

## GitHub Actions

Workflow **[`.github/workflows/deploy-gateway.yml`](../.github/workflows/deploy-gateway.yml)** runs on pushes to **`main`** that touch **`workers/rpc-gateway/**`**, and on **workflow_dispatch**. It uses the same **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`** secrets as the Pages deploy workflow. Worker **secrets** (`BOING_UPSTREAM_RPC_URL`, optional `GATEWAY_API_KEY`) are **not** set by CI; configure them once in the Cloudflare dashboard (or via `wrangler secret put`).

Optional: override **`GATEWAY_CACHE_TTL_SECONDS`** / **`GATEWAY_RATE_LIMIT_PER_MINUTE`** per environment using Wrangler **[vars]** in the dashboard or `wrangler.toml`.

---

## Relationship to Cloudflare Pages

**Pages** continues to host the static wallet (`pnpm build` → `dist/`). The gateway is a **separate Worker** (`wrangler.toml` under **`workers/rpc-gateway/`**). Attach a **workers.dev** hostname or a **custom domain** route to this Worker in the Cloudflare dashboard.

The legacy **`wrangler.toml`** at the repository root ( **`boing-wallet-api`** / `worker.js` ) is unrelated to this gateway; prefer **`workers/rpc-gateway/`** for new RPC HTTP deployments.

---

## Specs and SDK

- Node contract: **Boing Network** [`docs/RPC-API-SPEC.md`](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md).
- DEX discovery handoff: [`docs/HANDOFF_Boing_Network_Global_Token_Discovery.md`](https://github.com/Boing-Network/boing.network/blob/main/docs/HANDOFF_Boing_Network_Global_Token_Discovery.md).
- Typed client: **boing-sdk** `BoingClient.listDexPoolsPage`, `listDexTokensPage`, `getDexToken` — point the SDK’s RPC URL at **`https://<your-gateway>/v1/rpc`** when using the gateway from server or trusted clients.

Wallet-specific forwarding remains documented in **[BOING-EXPRESS-WALLET.md](BOING-EXPRESS-WALLET.md)**.
