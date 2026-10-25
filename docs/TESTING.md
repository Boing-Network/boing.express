# Testing

| Command | What it covers |
|---------|----------------|
| `pnpm exec tsc -b` | Type check (app, extension, tests) |
| `pnpm test` | Vitest unit tests: signing, bincode, SDK parity, node compat, error messages, security helpers, RPC gateway allowlist |
| `pnpm build` | Type check + production web build to `dist/` |
| `pnpm run build:extension` | Builds the MV3 extension into `extension/` (background, popup, approval page, content script, inpage provider) |
| `pnpm test:e2e:web` | Builds the web app and runs Playwright against it (`tests/e2e-web`) |
| `EXTENSION_E2E=1 EXTENSION_E2E_FULL=1 pnpm test:e2e` | Loads the unpacked extension in headed Chromium and runs the popup, dApp approval and multi-account flows (`tests/e2e`) |

First time only: `pnpm exec playwright install chromium`.

## Extension end-to-end notes

- Chromium must run **headed** (MV3 service workers do not register headless). On Linux CI use `xvfb-run -a`.
- JSON-RPC and `/api/networks` are mocked (`tests/e2e/helpers/boingRouteMocks.ts`), so runs do not need network access.
- Helpers in `tests/e2e/helpers/popup.ts`:
  - `confirmBackupInPopup(popup)` reads the shown key, types its last 6 characters and ticks the acknowledgement.
  - `connectDapp(context, dapp)` approves the explicit "Connect to this site?" prompt.
- `EXTENSION_E2E_RPC_MOCK_HOSTS` adds extra hostnames to mock.

## What the unit tests guard

- **Wire format:** `sdkParity.test.ts`, `txSigningV2.test.ts`, `bulkBatch.test.ts`.
- **Node errors:** `src/boing/errorMessages.test.ts` maps node error strings and JSON-RPC codes to plain language.
- **Node compatibility:** `src/boing/nodeCompat.test.ts` uses a fixture of a real testnet `boing_health` response.
- **Security helpers:** `src/security/*.test.ts` (sender validation, auto-lock, origin risk, backup confirmation) and
  `tests/securityConfig.test.ts` (manifest permissions and CSP must stay minimal).