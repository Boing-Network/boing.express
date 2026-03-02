# Chrome Web Store — Extension Submission

This document combines **permissions & privacy** (for the store form) and the **Chrome Web Store checklist & listing copy**. Use it to prepare and submit the Boing Express extension.

---

## Part 1: Permissions & privacy

### Single purpose

> Boing Express is the wallet for Boing Network: create or import a wallet, view address and balance, send BOING, and use the testnet faucet. Non-custodial; keys stay on device.

**Short variant (if character limit):**

> Crypto wallet for Boing Network — create/import wallet, send BOING, testnet faucet. Keys stay on device.

### Permission justification

| Permission | Justification |
|------------|---------------|
| **storage** | Save encrypted wallet data and selected network in `chrome.storage.local`. |
| **Host permissions** | RPC (testnet-rpc.boing.network, rpc.boing.network) for balance/send; boing.network for faucet link only. |

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
• On Testnet: request testnet BOING from the built-in faucet or open the Boing Network faucet page with your address pre-filled
• Switch between Boing Testnet and Mainnet; your selection is saved

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

- [DEVELOPMENT.md](../docs/DEVELOPMENT.md) — Boing integration, Chrome Web Store section
- [Privacy policy](https://boing.express/privacy)
