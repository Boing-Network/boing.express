# Chrome Web Store — Listing Checklist & Enhancements

## Is the extension ready to list?

**Almost.** The extension is functionally ready (Manifest V3, permissions, popup, icons referenced). Before submitting, complete the items below.

---

## Must-have before publishing

### 1. **Icons (16, 48, 128 px)** ✓

The build script `scripts/generate-extension-icons.js` uses **sharp** to render `extension/favicon.svg` to PNG at 16×16, 48×48, and 128×128 (Boing accent color). Run `pnpm run build:extension` to regenerate them. Icons are written to `extension/icons/`.

### 2. **Privacy policy** ✓

A **Privacy Policy** is available at **https://boing.express/privacy**. It explains that keys and passwords stay on-device, what is stored locally, RPC communication, and extension permissions. In the [Chrome Web Store Developer Dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), use this URL in the **Privacy** tab and ensure the privacy fields match the policy (e.g. “No user data collected off-device”).

### 3. **Store listing assets**

In the Chrome Web Store dashboard you must provide:

- **Short and detailed description** (no keyword spam; accurate and clear).
- **Screenshots** (required). Capture the popup: welcome screen, unlock, dashboard (address, balance, send, faucet).
- **Promo / marquee image** if you want a featured look (see [asset dimensions](https://developer.chrome.com/docs/webstore/publish/)).
- **Category** (e.g. Productivity or Finance).
- **Single purpose** description (one clear sentence describing what the extension does).

---

## Already in good shape

- **Manifest V3** with `storage` and `tabs` permissions and scoped `host_permissions` for Boing RPC and boing.network.
- **Name, description, homepage_url** in manifest.
- **Single codebase**; logic is inside the extension package (no remote code).
- **Firefox** `browser_specific_settings.gecko` is ignored by Chrome and is fine to leave in for a multi-browser build.

---

## Suggested UX enhancements (implemented or optional)

| Enhancement | Status | Notes |
|------------|--------|--------|
| **Refresh balance when switching network** | Done | Network dropdown now updates balance and symbol for the selected network. |
| **Show faucet only on testnet** | Done | Faucet section is hidden on Mainnet to avoid confusion. |
| **Loading states** | Optional | Add a short “Sending…” / “Loading…” state for send and balance fetch to improve perceived responsiveness. |
| **Address format hint** | Optional | Placeholder already allows “0x…” or 64 hex; you could add a one-line hint under the Send “To” field. |
| **Keyboard & a11y** | Optional | Forms already submit on Enter; consider `aria-label` on icon-only or critical buttons for screen readers. |
| **Re-focus after send** | Optional | After a successful send, optionally focus the amount field or a “Send again” action. |

---

## When the Boing Network is live

The wallet is ready to use as soon as the RPC endpoints respond:

- **Testnet:** `https://testnet-rpc.boing.network` — balance, send, faucet will work.
- **Mainnet:** `https://rpc.boing.network` — balance and send will work.

No code changes are required. If the RPC is down or returns an error, users see clear messages (e.g. “Network unavailable or RPC not responding”, “RPC endpoint not available”). Amounts are entered in **BOING** (e.g. `1` or `0.5`), not in smallest units.

## After publishing

- Bump **version** in `extension/manifest.json` for each store update (Chrome expects a higher version per upload).
- Keep **privacy fields** and the public **privacy policy** in sync with the extension’s behavior.
- If you add new permissions later, Chrome may show an “additional permissions” prompt to existing users.
