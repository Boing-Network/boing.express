# Single purpose, permissions & data usage

This document provides the exact wording for Chrome Web Store (and similar) submission: **single purpose**, **permission justification**, and **data usage** disclosure. Keep it in sync with the extension behavior and the public [Privacy Policy](https://boing.express/privacy).

---

## Single purpose

The extension must have a **single purpose** that is narrow and easy to understand.

**Single purpose (use in store listing — Privacy practices / Single purpose):**

> Boing Express is the wallet for Boing Network: create or import a wallet, view address and balance, send BOING, and use the testnet faucet. Non-custodial; keys stay on device.

**Short variant (if character limit):**

> Crypto wallet for Boing Network — create/import wallet, send BOING, testnet faucet. Keys stay on device.

---

## Permission justification

Only the following permissions are requested. Each is required for the single purpose above.

| Permission | Type | Justification |
|------------|------|---------------|
| **storage** | API permission | Required to save encrypted wallet data and selected network (Testnet/Mainnet) in `chrome.storage.local`. Without it, the user could not persist their wallet or preferences across sessions. |
| **tabs** | API permission | Required only to open a single external URL in a new tab: the Boing Network faucet page with the user’s address pre-filled (`chrome.tabs.create`). The extension does not read or modify tab content, history, or any other site. |
| **https://testnet-rpc.boing.network/\*** | Host | Required to fetch balance, nonce, and submit/simulate transactions on Boing Testnet. |
| **https://rpc.boing.network/\*** | Host | Required to fetch balance, nonce, and submit/simulate transactions on Boing Mainnet. |
| **https://boing.network/\*** | Host | Required to open the official faucet page (and only that page) in a new tab with the user’s address; no other boing.network paths are used. |

**Removed / not requested:** No other permissions (e.g. no `activeTab`, no broad host patterns, no history, no bookmarks). Requesting only what is needed avoids store rejection and keeps user trust.

---

## Data usage (store disclosure)

The content of this section may be displayed on the item detail page. By publishing, you certify that these disclosures reflect your privacy policy.

**Does the extension collect or share user data?**

- **No.** The extension does not collect or share personal data with the developer.

**Data usage (paste into store form / Privacy tab):**

> This extension does not collect personal data. Encrypted wallet data (including key material) is stored only on the user’s device in chrome.storage.local. The extension sends requests to Boing Network RPC endpoints (testnet-rpc.boing.network, rpc.boing.network) to display balance and send transactions; those providers may log requests per their own policies. No keys, passwords, or personal data are sent to the developer. See our privacy policy: https://boing.express/privacy

**One-line summary for “Data usage” field (if needed):**

> No user data collected. Wallet data stays on device; RPC requests go only to Boing Network; no data sent to developer.

---

## Privacy policy

- **URL:** https://boing.express/privacy  
- The extension must have a privacy policy if it collects user data. Boing Express **does not collect** user data; the policy states that clearly and explains what is stored locally and how RPC is used, so the store requirement is satisfied and users can verify our practices.

Keep the live privacy policy and this document aligned with any future permission or behavior changes.
