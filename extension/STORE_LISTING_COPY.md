# Chrome Web Store — Ready-to-Paste Listing Copy

Use this copy in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Replace placeholders if needed.

---

## Short description (132 characters max)

Use in: **Store listing** → **Short description**

```
Boing Wallet — send and receive BOING on Boing Network. Non-custodial, create/import wallet, testnet faucet.
```
*(120 characters)*

**Alternative (shorter):**
```
Send and receive BOING on Boing Network. Non-custodial wallet, testnet faucet, mainnet ready.
```
*(97 characters)*

---

## Detailed description

Use in: **Store listing** → **Detailed description**

```
Boing Wallet is a non-custodial crypto wallet for Boing Network. Your keys never leave your device.

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

---

## Single purpose

Use in: **Privacy practices** → **Single purpose**

```
Crypto wallet for Boing Network: create or import a wallet, view address and balance, send BOING, and use the testnet faucet. Non-custodial; keys stay on device.
```

---

## Category

Use in: **Store listing** → **Category**

Choose: **Finance** (or **Productivity** if Finance doesn’t fit your positioning).

---

## Privacy policy URL

Use in: **Privacy practices** → **Privacy policy**

```
https://boing.express/privacy
```

---

## Data usage (Privacy tab)

Declare in the dashboard so it matches your policy:

- **Does your extension collect or share user data?**  
  Select the option that states you do **not** collect or share personal data with the developer (or equivalent).
- **Data usage:**  
  Encrypted wallet data is stored only on the user’s device (chrome.storage.local). The extension sends requests to Boing Network RPC endpoints (e.g. for balance and transactions); those providers may log requests per their own policies. No keys, passwords, or personal data are sent to the developer.

---

## Test instructions (for reviewers)

Use in: **Distribution** → **Test instructions** (if the form asks how to test the extension)

```
1. Install the extension and open the popup (click the Boing Wallet icon).
2. Click "Create wallet", enter a password (min 8 characters) and confirm, then click "Create wallet". You will see the dashboard with your address and balance.
3. Select "Boing Testnet" in the network dropdown (default). If the testnet RPC is live: click "Request testnet BOING" to use the faucet; balance may update after a short delay.
4. To test send: enter a recipient address (64 hex characters) and an amount in BOING (e.g. 0.1), then click "Send". If the network is not running, you will see a clear error (e.g. "Network unavailable").
5. Use "Lock" to lock the wallet; unlock with the same password.

Note: We do not provide mainnet keys or valuable assets. Testnet is for testing only.
```

---

## Screenshots

**Required.** Capture at least 1; 2–5 recommended. Suggested captures:

| # | What to capture | Suggested size |
|---|-----------------|----------------|
| 1 | Welcome screen: "Create wallet" / "Import wallet" and tagline | 1280×800 or 640×400 |
| 2 | Unlock screen: password field and "Unlock" (address hint visible) | 1280×800 or 640×400 |
| 3 | Dashboard: address, balance, Send form, network selector, Lock | 1280×800 or 640×400 |
| 4 | (Optional) Testnet faucet section visible | 1280×800 or 640×400 |
| 5 | (Optional) Success state: e.g. "Copied" or send success message | 1280×800 or 640×400 |

**How to capture:** Open the extension popup (right-click icon → Boing Wallet, or click the icon). Use a screenshot tool or browser dev tools; the popup is 380×560 px, so capture the whole popup centered on a neutral background, or capture the browser window with the popup open. Chrome’s recommended screenshot dimensions are in the [asset guidelines](https://developer.chrome.com/docs/webstore/publish/#screenshots).

---

## Promotional images (optional)

- **Small tile:** 440×280 px  
- **Marquee:** 1400×560 px  

Use Boing branding (logo, colors) and short tagline (e.g. “Non-custodial wallet for Boing Network”).

---

## Before you submit

- [ ] Short description (132 chars) and detailed description pasted
- [ ] Category and single purpose set
- [ ] Privacy policy URL: https://boing.express/privacy
- [ ] Data usage / privacy declarations filled and consistent with the policy
- [ ] At least one screenshot uploaded
- [ ] Test instructions added if the dashboard asks for them
- [ ] Extension packaged as ZIP (only the `extension` folder: manifest.json, popup.html, popup.js, popup.css, config.ts, icons/, no node_modules)
- [ ] Version in manifest.json bumped if you’ve published before
