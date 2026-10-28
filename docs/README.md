# Boing Express documentation

Boing Express is a non-custodial, Boing-native wallet (web app and browser extension). It is part of [Boing Network](https://boing.network). Status: public testnet. Mainnet is not live. Independent audits are not complete.

Start from the [root README](../README.md) for what the wallet does and how to run it.

## I want to...

| Goal | Read |
|------|------|
| Connect a dApp to `window.boing` | [WALLET_CONNECTION_AND_API.md](WALLET_CONNECTION_AND_API.md) |
| Understand what the provider forwards to the node (RPC forwarding reference) | [BOING-EXPRESS-WALLET.md](BOING-EXPRESS-WALLET.md) |
| Build, run and release the wallet | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Run the tests | [TESTING.md](TESTING.md) |
| Point the wallet at a different RPC, or understand the node check | [NETWORK_SETUP.md](NETWORK_SETUP.md) |
| Run the optional HTTPS RPC gateway Worker | [RPC_GATEWAY.md](RPC_GATEWAY.md) |
| Review the security model | [SECURITY.md](SECURITY.md) |
| Publish the extension | [EXTENSION_STORE.md](EXTENSION_STORE.md) |
| Style the UI | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [ASSETS_AND_FONTS.md](ASSETS_AND_FONTS.md) |

## All documents

| Doc | Purpose |
|-----|---------|
| [ASSETS_AND_FONTS.md](ASSETS_AND_FONTS.md) | Brand assets, logos, fonts |
| [BOING-EXPRESS-WALLET.md](BOING-EXPRESS-WALLET.md) | Provider / RPC-forwarding reference. The canonical product spec of the same name is in [boing.network](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-EXPRESS-WALLET.md) |
| [BOING_NETWORK_WALLET_IMPLEMENTATION_CHECKLIST.md](BOING_NETWORK_WALLET_IMPLEMENTATION_CHECKLIST.md) | Wallet implementation checklist against the network specs |
| [BULK-TRANSFER.md](BULK-TRANSFER.md) | Bulk mode in the Transfer tab |
| [CODEBASE-ALIGNMENT.md](CODEBASE-ALIGNMENT.md) | Local summary of cross-repo URLs and specs |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI tokens, following BRAND.md |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Environment, CI, store checklist, alignment with network specs |
| [EXTENSION_STORE.md](EXTENSION_STORE.md) | Store listing copy and screenshots |
| [HANDOFF.md](HANDOFF.md) | Portal / protocol handoff and backlog |
| [NETWORK_SETUP.md](NETWORK_SETUP.md) | Network configuration and runtime verification |
| [PUT-BLOB-PUBLISH-SESSION.md](PUT-BLOB-PUBLISH-SESSION.md) | `boing_requestPutBlobSession` publish sessions |
| [RECOVERY_PHRASE_DESIGN.md](RECOVERY_PHRASE_DESIGN.md) | Recovery phrase: decision and implementation |
| [RPC_GATEWAY.md](RPC_GATEWAY.md) | Optional HTTPS JSON-RPC Worker |
| [SCRIPTS_HERO_EXTRACT.md](SCRIPTS_HERO_EXTRACT.md) | Hero object extraction (design asset script) |
| [SECURITY.md](SECURITY.md) | Security model, auto-lock, CSP |
| [TESTING.md](TESTING.md) | Unit, web and extension e2e tests |
| [WALLET_CONNECTION_AND_API.md](WALLET_CONNECTION_AND_API.md) | `window.boing` provider API |
| [WEB-SIGNING-FLOW.md](WEB-SIGNING-FLOW.md) | Web signing flow (`boing.express/connect`) for dApps |

Also in this folder: `boing-theme-reference.css` and `screenshot-helper.html` (helper files, not docs).

## Upstream (boing.network)

- [BRAND.md](https://github.com/Boing-Network/boing.network/blob/main/BRAND.md): naming, tone, shared tokens
- [RPC-API-SPEC.md](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md): JSON-RPC reference
- [BOING-LINKED-NFT-TOKEN.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-LINKED-NFT-TOKEN.md): on-chain NFT-to-token link registry
- [BOING-BUILDER-ATTESTATION.md](https://github.com/Boing-Network/boing.network/blob/main/docs/BOING-BUILDER-ATTESTATION.md): on-chain builder attestation registry
