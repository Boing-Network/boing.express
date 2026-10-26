# Testing

| Command | What it covers |
|---------|----------------|
| `pnpm exec tsc -b` | Type check of `src` |
| `pnpm run typecheck:ext` | Type check of the extension entry points (`background`, `popup`, `approval`; `tsconfig.extension.json`, uses `@types/chrome`). Runs in CI. |
| `pnpm fixtures:check` / `pnpm fixtures:sync` | Verify / refresh the vendored boing.network fixtures (golden signing vectors, `chain-metadata.json`) in `tests/fixtures/`; `sync` also regenerates `src/networks/chainDefaults.generated.ts`, `check` also verifies it |
| `pnpm generate:chain-defaults` | Regenerates `src/networks/chainDefaults.generated.ts` from the vendored `chain-metadata.json` (also runs on `pnpm build` and `build:extension`) |
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

## Hermetic e2e (no real network)

Every spec that uses `installBoingNetworkMocks` (web `tests/e2e-web` and extension `tests/e2e`) is hermetic: a guard route is registered first and **aborts any http(s) request that leaves localhost without a mock**. Playwright runs later routes first and `route.fallback()` hands unmatched requests to earlier ones, so mocks win and everything else hits the guard. Google Fonts and the boing.observer NFT API are stubbed.

Options on `installBoingNetworkMocks(context, opts)` (`tests/e2e/helpers/boingRouteMocks.ts`):

| Option | Meaning |
|--------|---------|
| `blocked: string[]` | Receives every URL the guard blocked. Assert it is `[]` in a spec to prove nothing leaked. |
| `hermetic: false` | Turn the guard off (default is on). |
| `chainId` | Chain id advertised by the mocked `boing_health` (default 6913, testnet). `null` omits `chain_id` / `tx_signing` entirely, which exercises the "node did not report a chain id" warning; `6914` exercises the wrong-network error. |
| `healthExtra` | Extra fields merged into the `boing_health` answer (for example `client_hints: { min_wallet_version: '9.9.9' }`; the default mock already reports the documented `client_hints` and `tx_signing.priority_tips_supported`). |
| `rpc` | Per-method hook returning a result to override a mocked RPC method. |

`tests/e2e/extension-a11y-compat.spec.ts` covers the node-compat banner (no chain id, matching chain, wrong chain), popup tab keyboard navigation and the approval-page origin-risk banner, plus the dismissible update-available note (`healthExtra` with a newer `recommended_wallet_version`). `tests/e2e-web/wallet-update-note.spec.ts` covers the same note in the web wallet.

## What the unit tests guard

- **Wire format:** `sdkParity.test.ts`, `txSigningV2.test.ts`, `txSigningGolden.test.ts` (boing.network golden vectors), `bulkBatch.test.ts`.
- **Network identity:** `chainMetadataDrift.test.ts` (built-in config and the committed generated defaults vs `docs/chain-metadata.json`, generator validation), `networkInfo.test.ts` (documented `client_hints` / `tx_signing` shapes, `fetchTipSupport`), `walletVersionGate.test.ts` (semver gate, recommended-update advisory), `updateNote.test.ts` (per-version dismissal, popup banner rendering), `walletReleaseVersion.test.ts`.
- **Node errors:** `src/boing/errorMessages.test.ts` maps node error strings and JSON-RPC codes to plain language.
- **Node compatibility:** `src/boing/nodeCompat.test.ts` uses a fixture of a real testnet `boing_health` response.
- **Accessibility and UI states:** `tests/a11yContrast.test.ts` (WCAG AA 4.5:1 for muted, secondary, danger and success text on every dark surface, read from the CSS tokens so a palette change that fails AA fails the build), `tests/a11yMarkup.test.tsx` (tab keyboard model `nextTabId`; SendConfirm focus target, live fee row, busy confirm button, alert errors), `tests/originRiskBanner.test.ts` (approval-page banner: hidden, caution, danger, textContent-only), `tests/autoLockUi.test.ts` (popup auto-lock select and idle rule), `tests/sessionStore.test.ts` (web session sealing). Component tests render with `react-dom/server`; DOM helpers take a document-like parameter and run against `tests/fakeDom.ts` (no jsdom).
- **Security helpers:** `src/security/*.test.ts` (sender validation, auto-lock, origin risk, backup confirmation) and
  `tests/securityConfig.test.ts` (manifest permissions and CSP must stay minimal).