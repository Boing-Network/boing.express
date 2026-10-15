# Bulk transfers in Boing Express

## What ships now (sequential, not atomic)

The Transfer tab's **Bulk** mode (web wallet and extension popup) sends one asset (BOING or a reference
fungible token) to many recipients.

**Why sequential.** `TransactionPayload` in `boing-primitives` has no batch variant. Its variants are
`Transfer`, `ContractCall`, `ContractDeploy*`, `Bond`, `Unbond`, `ClaimUnbond` and `QaPoolVote`. There is
also no multi-recipient selector in the reference token or NFT templates. A bulk send is therefore N
independent signed transactions.

**Flow.**

1. **Input.** Rows can be entered by hand or pasted as CSV (`address,amount`; comma, semicolon, tab or
   space; header, blank and `#` lines are skipped).
2. **Validation** (`src/boing/bulkTransfer.ts`, shared by both UIs):
   - The address must be 64 hex characters.
   - Sending to your own address is refused. This matters most for v1 reference tokens, where a
     self-transfer doubles the balance.
   - A duplicate recipient is an error; merge the rows instead.
   - Amounts must be positive and use no more decimals than the asset allows (nothing is silently
     truncated).
   - The total must not exceed the spendable balance.
   - At most 100 rows.
3. **Review.** A review screen lists every row and the total. Nothing is signed before
   "Sign & send all".
4. **Run** (`runSequentialBulkTransfer`):
   - Reads the nonce once, then signs row *i* with `startNonce + i`. The nonce only advances after the
     node accepts the submit, so a failure never leaves a gap.
   - Each submit goes through the adapter's normal simulate-then-submit path.
   - **Stops at the first failure** (signing error, simulation failure, RPC error). Later rows are
     marked *Not sent*. There are **no retries**.
   - "Stop after current" cancels between rows.
   - The final report lists which rows were submitted (with tx hashes), the failure and its error, and
     the rows not sent. It can be copied.
5. **History.** Submitted rows are recorded in local tx history (Tx tab).

**Limits to know.**

- *Submitted* means the node accepted the tx into its mempool, not that it is in a block. A tx can
  still drop later (for example if the fee policy changes). Check the explorer for final status.
- Closing the popup or tab during a run stops it. Rows already submitted stay submitted.
- Fees are paid per transaction. The balance check covers the transfer amounts only.

## Proposal (not built): native atomic batch transfer

**Goal:** one signed transaction that pays many recipients and succeeds or fails as a whole.

There are two options.

### Option A: new payload variant `TransferBatch` (protocol change)

```text
TransferBatch { transfers: Vec<(AccountId, u128)> }   // appended as the next enum index
```

- **Execution.** Check `sum(amount) <= balance` with overflow checks, debit once, credit each
  recipient, and bump the nonce once. Either everything applies or nothing does.
- **Access list.** Write `{sender} ∪ recipients`, which lets the parallel scheduler keep working.
- **Limits.** Cap the number of entries (for example 256). Gas is a base cost plus a per-recipient cost.
- **Wallet side.** The bincode encoder, the signing preview ("N recipients, total X") and dApp
  `boing_sendTransaction` support.
- **Cost.** This changes the consensus/VM transaction format, so it needs a coordinated node upgrade,
  a version gate, and changes to boing-sdk, the explorer and the indexers. It is out of scope for a
  wallet change and needs explicit protocol sign-off.

### Option B: batch-transfer contract template (no protocol change)

- **The contract.** A reference "batch sender" contract whose `batch_transfer(token, [(to, amount)…])`
  calls the token's `transfer_from(sender, to, amount)` for each row. Those calls happen inside one
  `ContractCall`, so a revert anywhere reverts all of them. This assumes the VM supports nested
  contract calls with all-or-nothing rollback; verify that before building. For native BOING, the contract would need a
  native-value transfer opcode, which the VM currently lacks, so B covers tokens only.
- **Requirements.** v2 tokens, because the user must first `approve` the batch contract for the total.
  v1 tokens have no `transfer_from`.
- **Access list.** It must include the token contract plus the storage slots it touches.
- **Wallet UX.** Two transactions (approve, then batch), or one if the allowance is already enough.
  The review screen stays the same.
- **Deployment.** It goes through the QA pillar like any other template.

**Recommendation.** Ship Option B first for v2 tokens: it has no consensus change and reuses
`transfer_from`. Keep the sequential runner as the fallback for native BOING and v1 tokens. Consider
Option A only if native BOING batch payouts become a common need.
