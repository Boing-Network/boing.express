# Boing Express — Launch Readiness for Incentivized Testnet & Mainnet

This document tracks readiness of the **boing.express** wallet for the Boing Network incentivized testnet and mainnet launch. It also clarifies the relationship with VibeMiner and Boing’s PoS model.

---

## 1. Current State Summary

### What boing.express Does Today (All Real, No Simulation)

| Feature | Status | Notes |
|--------|--------|------|
| Create wallet | ✅ | Ed25519, password-protected |
| Import wallet | ✅ | 64-hex private key |
| Send BOING | ✅ | Transfer payload, BLAKE3+Ed25519 signing |
| Receive / view balance | ✅ | `boing_getAccount` or `boing_getBalance` |
| Testnet faucet | ✅ | `boing_faucetRequest` + link to boing.network/faucet |
| Network switch | ✅ | Testnet vs Mainnet |
| Chain height | ✅ | `boing_chainHeight` (optional) |
| Transaction simulation | ✅ | `boing_simulateTransaction` before submit |
| Explorer link | ✅ | View tx at boing.observer (testnet) or boing.network |
| QA Pillar (ContractDeploy) | ✅ | Client-side validation (32 KiB, Boing opcodes) + boing_qaCheck RPC; purpose category; rule_ids per QA-PASS-GUIDE |
| Web app | ✅ | Deployed at boing.express |
| Browser extension | ✅ | Chrome + Firefox (Manifest V3) |

### RPC Endpoints

- **Testnet:** `https://testnet-rpc.boing.network`
- **Mainnet:** `https://rpc.boing.network`

The wallet talks directly to these endpoints. When the Boing testnet has public RPC nodes running, the wallet will work without code changes.

---

## 2. VibeMiner vs boing.express

| | VibeMiner | boing.express |
|---|-----------|---------------|
| **Purpose** | One-click mining/validating (run boing-node, stake) | Non-custodial wallet (create, send, receive BOING) |
| **“No nodes on Boing Network”** | VibeMiner needs bootnodes to join the public testnet. Until bootnodes are live, users run local multi-node or single-node. | Wallet needs RPC nodes. Balance/send/faucet work as soon as `testnet-rpc.boing.network` responds. |
| **Relationship** | Separate app. Boing is PoS — “mining” = running a validator, staking BOING. | Wallet can hold keys and sign Bond/Unbond for staking; VibeMiner or other tools run the node. |
| **Testnet readiness** | Depends on Boing Network bootnodes and node deployment. | Depends on Boing Network RPC availability. |

**Bottom line:** The “no nodes” message in VibeMiner refers to **P2P bootnodes** for joining the network. The **wallet** depends on **RPC endpoints**, which may be provided separately. Both need the Boing Network to have infrastructure live for the incentivized testnet.

---

## 3. Gaps for Incentivized Testnet Launch

### High Priority (Must-Have for Testnet)

| Gap | Effort | Notes |
|-----|--------|-------|
| **Chrome Web Store listing** | 1–2 hrs | ✅ In review. See [extension/CHROME_WEB_STORE.md](../extension/CHROME_WEB_STORE.md). |
| **Staking UI (Bond / Unbond)** | Medium | ✅ Implemented. Bond and Unbond forms in Dashboard and extension; stake display from `boing_getAccount`. |
| **Backup / export reminder** | Low | ✅ Implemented. Backup step after wallet creation shows private key with copy button before continuing. |
| **RPC availability handling** | ✅ Done | Timeout, clear errors (“Network unavailable”, “RPC not responding”). |
| **Faucet rate limit UX** | ✅ Done | -32016 mapped to “Rate limit exceeded. Please try again later.” |

### Medium Priority (Nice-to-Have for Testnet)

| Gap | Effort | Notes |
|-----|--------|------|
| **Transaction history** | Medium | ✅ Implemented. Recent txs stored locally; links to explorer `/tx/{hash}`. |
| **Stake display** | Low | ✅ Already shown in Staking section from `boing_getAccount`. |
| **Onboarding checklist** | Low | Implemented. “Create wallet → Get testnet BOING → Send a tx” Implemented; dismissible. |
| **Local RPC override** | Low | ✅ Implemented. Collapsible "RPC override (dev)" section; e.g. `http://localhost:8545`. |

### Lower Priority (Mainnet / Post-Launch)

| Gap | Effort | Notes |
|-----|--------|------|
| **dApp provider (EIP-1193 / WalletConnect)** | High | Let dApps connect to the wallet. Content script + provider injection. |
| **Advanced staking** | Medium | Validator selection, delegation (if Boing supports it). |
| **Address book / contacts** | Low | Save and label frequent addresses. |

---

## 4. Checklist for Testnet Launch

### Infrastructure (Boing Network)

- [ ] Public testnet RPC at `https://testnet-rpc.boing.network` responding
- [ ] Faucet enabled and rate-limited
- [ ] Bootnodes live (for VibeMiner / node operators)
- [ ] Explorer available for balance/tx lookups (e.g. `boing.observer/tx/{hash}`)

### Wallet (boing.express)

- [ ] Web app deployed and reachable at boing.express
- [ ] Extension built and ready for Chrome Web Store
- [ ] Chrome Web Store listing complete (screenshots, copy, privacy) — in review
- [ ] Support page and docs mention incentivized testnet
- [x] Staking UI (Bond/Unbond) implemented for PoS participation
- [x] Backup reminder for new wallets

### User Onboarding

- [x] In-app onboarding checklist (create wallet → get testnet BOING → send tx)
- [ ] Docs: create wallet → switch to testnet → faucet → send tx
- [ ] Support links: boing.network/network/testnet, faucet, RUNBOOK

---

## 5. Mainnet Readiness

For mainnet, in addition to testnet items:

- [ ] Mainnet RPC at `https://rpc.boing.network`
- [ ] No faucet on mainnet (already hidden in wallet)
- [ ] Security review of signing and storage
- [ ] Clear warning when sending on mainnet (real BOING)

---

## 6. Suggested Order of Work

1. **Immediate:** Chrome Web Store listing — in review.
2. **Done:** Bond/Unbond staking UI implemented.
3. **Done:** Backup reminder after wallet creation.
4. **Testnet live:** Monitor RPC, faucet, explorer; update Support page with status links.
5. **Post-testnet:** Transaction history (if explorer API exists) and dApp provider for ecosystem growth.

---

## 7. References

- [Boing Network — Join Testnet](https://boing.network/network/testnet)
- [Boing Network — Faucet](https://boing.network/network/faucet)
- [DEVELOPMENT.md](DEVELOPMENT.md) — Boing integration checklist, GitHub vars
- [extension/CHROME_WEB_STORE.md](../extension/CHROME_WEB_STORE.md) — Extension submission
