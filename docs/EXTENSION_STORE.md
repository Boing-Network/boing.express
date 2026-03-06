# Chrome Web Store — Extension Submission

This document combines **permissions & privacy** (for the store form), **loading the extension locally**, and the **Chrome Web Store checklist & listing copy**. Use it to prepare and submit the Boing Express extension.

---

## Test locally (no store review)

You can run and test the extension **without submitting to the Chrome Web Store**:

1. **Build** the extension (writes `popup.js` into the `extension/` folder):
   ```bash
   pnpm run build:extension
   ```
2. Open **Chrome** and go to `chrome://extensions`.
3. Turn **Developer mode** on (toggle top-right).
4. Click **Load unpacked** and select the repo's **`extension`** folder (the one that contains `manifest.json`, `popup.html`, `popup.js`, `icons/`, `fonts/`).
5. The extension appears in your toolbar. Use it like the published version.

**After code changes:** run `pnpm run build:extension` again, then on `chrome://extensions` click the **reload** (circular arrow) icon on the Boing Express card. No zip, no store upload, no review.

### Load unpacked — select the right folder

**IMPORTANT:** You must select the **`extension`** folder itself, not the project root.

- **WRONG:** `...\boing.express` ← project root (no manifest here)
- **RIGHT:** `...\boing.express\extension` ← this folder has manifest.json

Steps: Navigate to your project, **open** the `extension` folder (double-click) so you see `manifest.json`, `popup.html`, `popup.js`, `popup.css`, `icons`, `fonts`, etc. With those files visible, click **Select Folder**. The path at the top of the dialog should end with `\boing.express\extension`. If you select `boing.express` and click Select Folder without opening `extension` first, Chrome will report manifest missing.

### If Chrome says "manifest file is missing"

- You must select the **folder that contains `manifest.json`**, not a parent or subfolder. The path should end with `...\boing.express\extension` (Windows) or `.../boing.express/extension` (Mac/Linux).
- In that folder you should see at the top level: `manifest.json`, `popup.html`, `popup.js`, `popup.css`, and the `icons/` and `fonts/` folders. If you only see empty-looking folders, you may be in the wrong directory or the repo state is incomplete.
- From the project root, run:
  ```bash
  pnpm run build:extension
  dir extension
  ```
  (or `ls extension` on Mac/Linux). You should see `manifest.json`, `popup.html`, `popup.js`, `popup.css`. If those files are missing, run `git checkout -- extension/` then `pnpm run build:extension` again, and try Load unpacked on the `extension` folder.

### Cloud-synced folders (OneDrive, Desktop sync, etc.)

If Chrome still shows only 4 empty folders (assets, fonts, icons, images) and not manifest.json/popup.html, the picker may not see all files in cloud-synced locations.

**Workaround — copy extension to a local folder, then load that:**

1. Run both:
   ```bash
   pnpm run build:extension
   pnpm run prepare:extension
   ```
   Or one command: `pnpm run build:extension:load`
2. The prepare script copies from the project's `extension/` folder to `%LOCALAPPDATA%\boing-extension` (Windows) and prints the path. It also opens that folder in Explorer.
3. In Chrome, **Load unpacked** and select that folder (e.g. paste `%LOCALAPPDATA%\boing-extension` in the picker or via Run).

After every code change, run `pnpm run build:extension` then `pnpm run prepare:extension` again, and reload the extension in chrome://extensions.

**Verify on disk:** If Explorer also shows only empty fonts/icons, open Command Prompt or PowerShell and run `dir "%LOCALAPPDATA%\boing-extension"`. If that shows manifest.json, popup.html, popup.js, popup.css (and files inside icons/ and fonts/), the files are on disk and the issue is Explorer/Chrome showing a cached view. Try: close Explorer, run prepare:extension again, use the Explorer window that opens and in Chrome pick that folder; or open via Run (Win+R): `%LOCALAPPDATA%\boing-extension`. If `dir` also shows only empty folders, copy the extension folder manually to e.g. `C:\boing-extension` and load that.

---

## Part 1: Permissions & privacy

### Single purpose

> Boing Express is the wallet for Boing Network: create or import a wallet, view address and balance, send and stake BOING, use the testnet faucet, and connect dApps via window.boing. Non-custodial; keys stay on device.

**Short variant (if character limit):**

> Crypto wallet for Boing Network — create/import wallet, send BOING, stake, testnet faucet. Connect dApps. Keys stay on device.

### Permission justification

| Permission | Justification |
|------------|---------------|
| **storage** | Save encrypted wallet data and selected network in `chrome.storage.local`. |
| **Host permissions** | RPC (testnet-rpc.boing.network and the official public mainnet RPC when published) for balance/send; boing.network for faucet link only. |

### Data usage (store disclosure)

> This extension does not collect personal data. Encrypted wallet data (including key material) is stored only on the user's device in chrome.storage.local. The extension sends requests to Boing Network RPC endpoints to display balance and send transactions; those providers may log requests per their own policies. No keys, passwords, or personal data are sent to the developer. See our privacy policy: https://boing.express/privacy

**Privacy policy URL:** https://boing.express/privacy

---

## Part 2: Chrome Web Store checklist

### Must-have before publishing

1. **Icons** ✓ — Run `pnpm run build:extension` to generate 16, 48, 128 px from favicon.svg.
2. **Privacy policy** ✓ — https://boing.express/privacy
3. **Store listing:** Short and detailed description, screenshots (required), category, single purpose.

### Ready-to-paste listing copy

**Short description (132 chars max):**

```
Boing Express — the wallet for Boing Network. Send and receive BOING, non-custodial, testnet faucet.
```

**Detailed description:**

```
Boing Express is the wallet for Boing Network — non-custodial; your keys never leave your device.

What you can do:
• Create a new wallet or import an existing one with a 64-character hex private key
• View your address (64-char hex, Ed25519) and copy it for receiving BOING
• See your balance for the selected network (Testnet or Mainnet)
• Send BOING to any valid address; enter amounts in BOING (e.g. 1 or 0.5)
• Stake (Bond/Unbond) on the network; manage your stake from the extension
• On Testnet: request testnet BOING from the built-in faucet or open the Boing Network faucet page with your address pre-filled
• Switch between Boing Testnet and Mainnet; your selection is saved
• Connect dApps: the extension injects window.boing so sites can offer "Connect wallet"; manage connected sites in the popup

Security & privacy:
• Private keys are generated and stored only on your device, encrypted with your password (AES-GCM). They are never sent to any server.
• The extension only talks to Boing Network RPC endpoints (for balance, nonce, and sending transactions) and to boing.network (faucet link). No analytics; no off-device data collection.

Requirements:
• Boing Network RPC must be available (testnet or mainnet). If the network is not yet live, you can still create/import a wallet and view your address; balance and send will work once the network is up.

For more: https://boing.express and https://boing.express/docs
```

**Category:** Finance (or Productivity).

### Screenshots

- **Size:** 1280×800 px or 640×400 px. Use `docs/screenshot-helper.html` to capture Welcome, Unlock, Dashboard screens.
- **Required:** At least 1; up to 5.

### Test instructions (for reviewers)

1. Install extension, open popup, create wallet (password min 8 chars).
2. Select Boing Testnet; use faucet if RPC is live.
3. Test send with 64-hex address and amount.
4. Lock/unlock with password.

---

## Part 3: References

- [DEVELOPMENT.md](DEVELOPMENT.md) — Boing integration, Chrome Web Store section
- [Privacy policy](https://boing.express/privacy)
