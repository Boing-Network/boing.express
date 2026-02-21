# Chrome Web Store — Checklist & Listing Copy

Use this doc to prepare and submit the Boing Express extension to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Replace placeholders if needed.

---

## Part 1: Is the extension ready to list?

**Almost.** The extension is functionally ready (Manifest V3, permissions, popup, icons referenced). Before submitting, complete the items below.

### Must-have before publishing

#### 1. Icons (16, 48, 128 px) ✓

The build script `scripts/generate-extension-icons.js` uses **sharp** to render `extension/favicon.svg` to PNG at 16×16, 48×48, and 128×128 (Boing accent color). Run `pnpm run build:extension` to regenerate them. Icons are written to `extension/icons/`.

#### 2. Privacy policy ✓

A **Privacy Policy** is available at **https://boing.express/privacy**. It explains that keys and passwords stay on-device, what is stored locally, RPC communication, and extension permissions. In the Chrome Web Store Developer Dashboard **Privacy** tab, use this URL and ensure the privacy fields match the policy (e.g. “No user data collected off-device”).

#### 3. Store listing assets

In the dashboard you must provide:

- **Short and detailed description** (no keyword spam; accurate and clear).
- **Screenshots** (required). Capture the popup: welcome screen, unlock, dashboard (address, balance, send, faucet).
- **Promo / marquee image** if you want a featured look (see [asset dimensions](https://developer.chrome.com/docs/webstore/publish/)).
- **Category** (e.g. Productivity or Finance).
- **Single purpose** description (one clear sentence describing what the extension does).

**Ready-to-paste copy** for all of the above is in **Part 2** below.

### Already in good shape

- **Manifest V3** with `storage` and `tabs` permissions and scoped `host_permissions` for Boing RPC and boing.network.
- **Name, description, homepage_url** in manifest.
- **Single codebase**; logic is inside the extension package (no remote code).
- **Firefox** `browser_specific_settings.gecko` is ignored by Chrome and is fine to leave in for a multi-browser build.

### Suggested UX enhancements (implemented or optional)

| Enhancement | Status | Notes |
|------------|--------|--------|
| **Refresh balance when switching network** | Done | Network dropdown now updates balance and symbol for the selected network. |
| **Show faucet only on testnet** | Done | Faucet section is hidden on Mainnet to avoid confusion. |
| **Loading states** | Optional | Add a short “Sending…” / “Loading…” state for send and balance fetch to improve perceived responsiveness. |
| **Address format hint** | Optional | Placeholder already allows “0x…” or 64 hex; you could add a one-line hint under the Send “To” field. |
| **Keyboard & a11y** | Optional | Forms already submit on Enter; consider `aria-label` on icon-only or critical buttons for screen readers. |
| **Re-focus after send** | Optional | After a successful send, optionally focus the amount field or a “Send again” action. |

### When the Boing Network is live

The wallet is ready to use as soon as the RPC endpoints respond:

- **Testnet:** `https://testnet-rpc.boing.network` — balance, send, faucet will work.
- **Mainnet:** `https://rpc.boing.network` — balance and send will work.

No code changes are required. If the RPC is down or returns an error, users see clear messages (e.g. “Network unavailable or RPC not responding”, “RPC endpoint not available”). Amounts are entered in **BOING** (e.g. `1` or `0.5`), not in smallest units.

### After publishing

- Bump **version** in `extension/manifest.json` for each store update (Chrome expects a higher version per upload).
- Keep **privacy fields** and the public **privacy policy** in sync with the extension’s behavior.
- If you add new permissions later, Chrome may show an “additional permissions” prompt to existing users.

---

## Part 2: Ready-to-paste listing copy

### Short description (132 characters max)

Use in: **Store listing** → **Short description**

```
Boing Express — the wallet for Boing Network. Send and receive BOING, non-custodial, testnet faucet.
```
*(98 characters)*

**Alternative:**
```
Boing Express: create/import wallet, send BOING, testnet faucet. The wallet for Boing Network.
```
*(97 characters)*

### Detailed description

Use in: **Store listing** → **Detailed description**

```
Boing Express is the wallet for Boing Network — non-custodial; your keys never leave your device.

What you can do:
• Create a new wallet or import an existing one with a 64-character hex private key
• View your address (64-char hex, Ed25519) and copy it for receiving BOING
• See your balance for the selected network (Testnet or Mainnet)
• Send BOING to any valid address; enter amounts in BOING (e.g. 1 or 0.5)
• On Testnet: request testnet BOING from the built-in faucet or open the Boing Network faucet page with your address pre-filled
• Switch between Boing Testnet and Mainnet; your selection is saved

Security & privacy:
• Private keys are generated and stored only on your device, encrypted with your password (AES-GCM). They are never sent to any server.
• The extension only talks to Boing Network RPC endpoints (for balance, nonce, and sending transactions) and to boing.network (faucet link). No analytics; no off-device data collection.

Requirements:
• Boing Network RPC must be available (testnet or mainnet). If the network is not yet live, you can still create/import a wallet and view your address; balance and send will work once the network is up.

For more: https://boing.express and https://boing.express/docs
```

### Single purpose

Use in: **Privacy practices** → **Single purpose**

```
Boing Express is the wallet for Boing Network: create or import a wallet, view address and balance, send BOING, and use the testnet faucet. Non-custodial; keys stay on device.
```

### Category

Use in: **Store listing** → **Category**

Choose: **Finance** (or **Productivity** if Finance doesn’t fit your positioning).

### Privacy policy URL

Use in: **Privacy practices** → **Privacy policy**

```
https://boing.express/privacy
```

### Data usage (Privacy tab)

Declare in the dashboard so it matches your policy:

- **Does your extension collect or share user data?**  
  Select the option that states you do **not** collect or share personal data with the developer (or equivalent).
- **Data usage:**  
  Encrypted wallet data is stored only on the user’s device (chrome.storage.local). The extension sends requests to Boing Network RPC endpoints (e.g. for balance and transactions); those providers may log requests per their own policies. No keys, passwords, or personal data are sent to the developer.

### Test instructions (for reviewers)

Use in: **Distribution** → **Test instructions** (if the form asks how to test the extension)

```
1. Install the extension and open the popup (click the Boing Express icon).
2. Click "Create wallet", enter a password (min 8 characters) and confirm, then click "Create wallet". You will see the dashboard with your address and balance.
3. Select "Boing Testnet" in the network dropdown (default). If the testnet RPC is live: click "Request testnet BOING" to use the faucet; balance may update after a short delay.
4. To test send: enter a recipient address (64 hex characters) and an amount in BOING (e.g. 0.1), then click "Send". If the network is not running, you will see a clear error (e.g. "Network unavailable").
5. Use "Lock" to lock the wallet; unlock with the same password.

Note: We do not provide mainnet keys or valuable assets. Testnet is for testing only.
```

### Graphic assets (Store listing)

Use in: **Store listing** → **Graphic assets**

| Asset | Spec | Notes |
|-------|------|--------|
| **Store icon** | From package | Already in extension (16, 48, 128 px). Used as the listing icon. |
| **Global promo video** | YouTube video URL | Optional. Link to a short demo (e.g. create wallet, send BOING). |
| **Screenshots** | Up to 5 | **1280×800 px** or **640×400 px**. **JPEG or 24-bit PNG.** Required (at least 1). |
| **Small promo tile** | **440×280** | Canvas size. JPEG or 24-bit PNG. Optional. |
| **Marquee promo tile** | **1400×560** | Canvas size. JPEG or 24-bit PNG. Optional. |

Use Boing Express branding (logo, “the wallet for Boing Network”) and Boing colors (cyan/teal) for promo tiles.

### Screenshots (how to capture)

**Required:** at least 1; up to 5. **Size: 1280×800 px or 640×400 px. Format: JPEG or 24-bit PNG.** Two ways to get them:

#### Option A: Screenshot-helper page (no extension needed)

1. Open **`docs/screenshot-helper.html`** in Chrome (double-click the file or drag it into the browser; or run `pnpm dev` and go to `http://localhost:5173/docs/screenshot-helper.html`).
2. Use the buttons **1. Welcome**, **2. Unlock**, **3. Dashboard** to switch which screen is shown.
3. Resize the browser window to **1280×800** (or 640×400) for store-recommended size.
4. Take a screenshot of the wallet area (the scaled popup in the center). On Windows: **Win+Shift+S** (Snipping Tool) or **Win+PrtScn**. Crop to the wallet UI if needed.

The helper page uses the same styling as the real extension and shows mock content for the dashboard.

#### Option B: Screenshot the real extension

1. Load the extension: Chrome → **Extensions** → **Manage** → **Load unpacked** → select the **`extension`** folder.
2. Click the Boing Express icon to open the popup.
3. Create or unlock a wallet so you can see the dashboard.
4. Take a screenshot of the popup (or the whole browser window with the popup open). The popup is small (380×560 px), so you may want to zoom the browser (Ctrl/Cmd + plus) so the popup is larger, then capture.

#### Suggested captures

| # | What to capture | Suggested size |
|---|-----------------|----------------|
| 1 | Welcome screen: "Create wallet" / "Import wallet" and tagline | 1280×800 or 640×400 |
| 2 | Unlock screen: password field and "Unlock" (address hint visible) | 1280×800 or 640×400 |
| 3 | Dashboard: address, balance, Send form, network selector, Lock | 1280×800 or 640×400 |
| 4 | (Optional) Testnet faucet section visible | 1280×800 or 640×400 |

Chrome’s [asset guidelines](https://developer.chrome.com/docs/webstore/publish/#screenshots) have the latest size and format rules.

### Before you submit

- [ ] Short description (132 chars) and detailed description pasted
- [ ] Category and single purpose set
- [ ] Privacy policy URL: https://boing.express/privacy
- [ ] Data usage / privacy declarations filled and consistent with the policy
- [ ] At least one screenshot uploaded
- [ ] Test instructions added if the dashboard asks for them
- [ ] Extension packaged as ZIP (only the `extension` folder: manifest.json, popup.html, popup.js, popup.css, config.ts, icons/, no node_modules)
- [ ] Version in manifest.json bumped if you’ve published before
