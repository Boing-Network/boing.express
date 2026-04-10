# Boing Express — injected wallet & RPC forwarding

This document is the **handoff target** referenced from **boing.network** (RPC specs, SDK). It describes what **`window.boing`** does in **Boing Express** and how dApps should call **unsigned simulation** vs **signed** paths.

---

## Provider surface (`window.boing.request`)

| Method | Forwards to | Notes |
|--------|-------------|--------|
| `boing_requestAccounts` | — | Connects origin; requires unlock. |
| `boing_accounts` | — | No RPC. |
| `boing_signMessage` | — | Local signing after approval. |
| `boing_chainId` / `boing_switchChain` | — | Network selection in extension storage. |
| `boing_signTransaction` | — | Local sign → hex `SignedTransaction`. |
| `boing_sendTransaction` | `boing_simulateTransaction` (optional) → `boing_submitTransaction` | Signs first; uses wallet-selected RPC URL. |
| `boing_simulateTransaction` | **`boing_simulateTransaction`** | Params: `[hexSignedTx]`. **Connected origin** required. No signing. |
| **`boing_simulateContractCall`** | **`boing_simulateContractCall`** | Params: `[contractHex, calldataHex, senderHex?, atBlock?]`. **Connected origin** required. **Unsigned** dry-run of a `contract_call` (see [RPC-API-SPEC.md — `boing_simulateContractCall`](https://github.com/Boing-Network/boing.network/blob/main/docs/RPC-API-SPEC.md)). |

### `boing_simulateContractCall` (Boing Express behavior)

- **Spec (boing.network):** dry-run `contract_call` without a signed transaction. Align with **`BoingClient.simulateContractCall`** in **boing-sdk**.
- **Security:** Same bar as `boing_simulateTransaction`: the page must be **connected** (`boing_requestAccounts`). No approval popup (read-only RPC).
- **Sender default:** If the dApp passes only `[contractHex, calldataHex]` and the wallet has an active account address in storage, Boing Express **appends that account** as the **third** JSON-RPC parameter so simulations match the connected user. To force a different sender, pass **`senderHex`** explicitly. To pass **`atBlock`**, use four arguments; **`at_block`** must be a non-negative integer (number or decimal string).
- **Alternatives:** dApps may call the same JSON-RPC **directly over HTTPS** to a public RPC URL if **CORS** and deployment policy allow. Otherwise use the provider so the call uses the **wallet’s selected network** (testnet/mainnet) and the same URL as submit/simulate.

### `boing_simulateTransaction` vs `boing_simulateContractCall`

| | `boing_simulateTransaction` | `boing_simulateContractCall` |
|--|-----------------------------|------------------------------|
| Input | Hex-encoded **signed** `SignedTransaction` | **Contract** id + **calldata** (+ optional sender / block) |
| Use case | Preflight a tx you already built and signed | Quote / dry-run **without** building or signing a full tx |

---

## Related docs in this repo

- **[WALLET_CONNECTION_AND_API.md](WALLET_CONNECTION_AND_API.md)** — full provider API table and transaction JSON shapes.
- **[HANDOFF.md](HANDOFF.md)** — short integration checklist for portals and dependents.

---

## Change coordination

When **boing.network** adds or changes JSON-RPC methods that dApps expect through **Boing Express**, update:

1. `extension/background.ts` — `BOING_METHODS` + `handleProviderRequest` branch (or document “use HTTP RPC only”).
2. `src/boing/rpc.ts` — thin `rpcCall` wrappers when shared with the web app.
3. This file and **WALLET_CONNECTION_AND_API.md**.
