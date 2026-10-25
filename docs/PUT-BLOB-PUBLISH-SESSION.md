# PutBlob publish session (`boing_requestPutBlobSession`)

**Extension 0.1.22+** · feature flag `putBlobSession` on `boing_getCapabilities` / `provider.features`.

## Why

Native atomic batches (`TransactionPayload::Batch`) only allow transfers and contract calls
(max 16 steps, 64 KiB calldata). **PutBlob cannot go in a batch**, and stuffing thousands of
images into one tx is impossible anyway.

For NFT collection media on L1, dApps need **one wallet approval** covering many subsequent
`put_blob` `boing_sendTransaction` / `boing_signTransaction` calls.

## API

```js
const caps = await window.boing.request({ method: 'boing_getCapabilities' });
if (!caps.features?.includes('putBlobSession')) {
  // Fall back to per-file approval (older Express).
}

const session = await window.boing.request({
  method: 'boing_requestPutBlobSession',
  params: [{
    maxBlobs: 8888,
    maxTotalBytes: 50 * 1024 * 1024 * 1024, // optional, default 50 GiB
    maxBytesPerBlob: 4 * 1024 * 1024,        // optional, wallet-safe ceiling
    ttlMs: 2 * 60 * 60 * 1000,               // optional, default 2h, max 24h
  }],
});
// User approves once in the popup.

// Then each put_blob send skips the approval UI while the session has remaining quota:
await window.boing.request({ method: 'boing_sendTransaction', params: [putBlobTxObject] });

await window.boing.request({ method: 'boing_getPutBlobSession' }); // progress / remaining
await window.boing.request({ method: 'boing_endPutBlobSession' }); // optional early end
```

## Security bounds

| Bound | Rule |
|-------|------|
| Scope | **PutBlob only** — other tx types still prompt |
| Origin | Bound to the connected site that requested the session |
| Account | Bound to the active address at approval time |
| Count / bytes | Hard caps from the approved request |
| Lifetime | TTL; cleared on wallet lock, account switch, or worker restart |

## Limits

- `maxBlobs` ≤ 10 000
- `maxBytesPerBlob` ≤ 4 MiB (wallet postMessage / PutBlob practical ceiling)
- Default `maxTotalBytes` = 50 GiB when omitted
