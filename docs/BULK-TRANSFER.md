# Bulk transfers in Boing Express

The Transfer tab's **Bulk** mode sends BOING, reference fungible tokens and reference NFTs to many
recipients. Rows can mix assets. The same code (`src/components/BulkTransferPanel.tsx`,
`src/boing/bulkTransfer.ts`) runs in the web wallet and the extension popup. The extension picks it up
in its next release.

## Two ways a bulk send goes out

| | **Atomic batch** (preferred) | **Sequential fallback** |
|---|---|---|
| When | The node advertises `boing_health.rpc_surface.tx_payload_batch: true` **and** there are 1–16 rows | Older node (no flag, or it cannot decode a batch), or more than 16 rows |
| Transactions | **One** (`TransactionPayload::Batch`, variant 9), one signature, one nonce | One per row, consecutive nonces |
| Approval | One "Sign & send batch" | One "Sign & send all" (signs each row in turn) |
| Failure | **All-or-nothing**: if any step fails on-chain, every step is reverted and balances are unchanged (the nonce is still used) | Stops at the first failed row; earlier rows stay sent, later rows are not sent; no retries |
| Fee | One estimate for the whole batch (simulated with `boing_simulateTransaction`, else ≈ 21 000 + 7 000 gas per step; 21 000 gas = 1 BOING) | Normal fee per tx |
| Tx history | **One** "Batch" entry; expand it to see every step | One entry per row |

The batch limit of **16 steps** is the protocol cap (`MAX_BATCH_CALLS`). The node can advertise a lower
`tx_batch_max_calls`; the wallet uses the smaller value. See boing.network
`docs/NATIVE-BATCH-TRANSACTIONS.md` for the protocol side.

**Detecting support.** At Review the wallet calls `boing_health`. If the flag is missing it uses the
sequential path. If the flag is present but the node still rejects the batch with a bincode
"variant index" error (during the review simulation or at submit), the wallet marks batches unsupported for
the session and returns to Review in sequential mode. Nothing was sent in that case, and the user approves
again.

## Rows

Each row has a recipient and an asset picker:

- **BOING** or a **token** (from the Wallet tab's token list: watchlist + DEX directory) → enter an amount.
- **An NFT you hold** → no amount; the row sends exactly that one token id. The NFT list is the same
  source as the Wallet tab's NFTs: the local NFT watchlist (filled by discovery / the owner index), with
  on-chain ownership checked via the owner storage slot. Only items you currently own are offered.

NFT steps are `transfer_nft(to, token_id)` contract calls on the collection (selector `0x04`). Token steps
are the reference token `transfer(to, amount)` call. BOING steps are native transfers.

## Validation (before anything is signed)

- Recipient must be 64 hex characters (0x optional). Sending to your own address is refused (for every
  asset).
- BOING / token rows: positive amounts with no more decimals than the asset allows (nothing is silently
  truncated); the same recipient twice for the same asset is an error (merge the rows); the per-asset total
  must not exceed that asset's balance. In batch mode the BOING total plus the estimated fee must also fit.
- NFT rows: you must hold the NFT; the same NFT may appear only once; an amount other than empty / `1` is
  an error.
- At most 100 rows (more than 16 always uses the sequential path).

## CSV import

Paste one row per line. Separators: comma, semicolon, tab or spaces. Blank lines and `#` comments are
skipped; a first line such as `address,amount,asset` is treated as a header.

```
# address, amount            → uses the "Asset for new rows" picker
0x7f3a…c21,100
# address, amount, asset     → asset = BOING, a token symbol (case-insensitive) or token contract hex
0x91bc…0de,25.5,TKN
0x91bc…0de,3,BOING
# NFT: no amount             → nft:<collection hex>:<token id>
0x5c0d…a11,nft:0xcdcd…cdcd:7
0x5c0d…a11,,nft:cdcd…cdcd:0x00…2a
```

The token id is a sequential decimal id (`7`) or a 64-hex token id word. Unknown assets and ambiguous
symbols are reported per line and those lines are not imported.

## What "submitted" means

"Submitted" means the node accepted the transaction into its mempool. It does not mean it is in a block.
For a batch, the all-or-nothing outcome is decided when the block executes it. Check the receipt on the
explorer.

## Limits and follow-ups

- Tx history is per browser/device (local storage).
- Fees are not counted in the sequential-mode balance check.
- More than 16 rows could be split into several atomic batches; today they fall back to sequential.
