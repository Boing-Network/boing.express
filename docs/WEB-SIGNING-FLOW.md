# Web signing flow (boing.express/connect)

Lets Boing dApps (boing.finance, boing.observer, third parties) use the boing.express **web wallet**
when no extension provider (`window.boing`) is present: mobile browsers, Safari, Firefox.
The extension stays the primary path. Clients fall back to this flow only when `window.boing` is missing.

Code: `src/boing/webSigning.ts` (protocol, pure), `src/boing/messageSigning.ts`, `src/screens/WebSign.tsx` (UI),
`public/_headers`. Client: `boing-sdk/src/boingWebWallet.ts` (`createBoingWebWalletProvider`).

## Security invariants

1. **No key leaves boing.express.** Responses only carry an account address, a signature, signed
   transaction hex, or a tx hash.
2. **No silent signing.** Every request, including connect, needs an explicit Approve or Reject click on `/connect`.
   Closing the window or clicking Reject returns `4001 BOING_USER_REJECTED`.
3. **Connection is separate from signing.** `boing_requestAccounts` records the origin in
   `localStorage.boing_web_connected_sites`. Sign methods from an origin that isn't connected (or that is
   connected to a different account) are refused with `BOING_ORIGIN_NOT_CONNECTED`.
4. **Origin binding.** The requesting origin is shown prominently. First-party apps (`WEB_KNOWN_APPS`) are labelled;
   any other origin gets a warning. The origin is echoed in every response, and the response is delivered only to
   that origin (see transports).
5. **Replay protection.** Each request has a random `id` (128 bits or more, hex) plus `issuedAt` and `expiresAt`
   (lifetime of 10 minutes or less, 60 s clock skew). The wallet records handled ids in
   `localStorage.boing_web_seen_requests` until they expire and refuses repeats (`BOING_WEB_REPLAY`). The dApp
   accepts a response only if `id`, `origin` and `chainId` match its single pending request, then drops the pending request.
6. **Chain binding.** `request.chainId` must equal the wallet's selected network (`0x1b01` testnet,
   `0x1b02` mainnet), otherwise `4901 BOING_WEB_CHAIN_MISMATCH`. The response echoes `chainId`.
7. **Clickjacking/CSRF.** `/*` is served with `Content-Security-Policy: frame-ancestors 'none'` and
   `X-Frame-Options: DENY`, and `/connect` also gets `Cache-Control: no-store`. A JS frame-buster refuses to render inside a frame.
   No state change happens on page load. Every action needs a user click on the wallet's own page.
   We do **not** set `Cross-Origin-Opener-Policy: same-origin`, because it would sever `window.opener` and break popup mode.
8. **Decoded review.** Transactions are decoded with the same code as the extension
   (`transactionFromDappJson` → `buildTransactionApprovalDetail`). The `from` field must match the active account,
   and existing guards apply. In particular the reference-token **self-transfer guard** (`SELF_TRANSFER_REFUSED`) and the
   `contract_deploy` purpose rules.
9. **Message/transaction domain separation.** Message signatures are `Ed25519(BLAKE3(msg))` and transaction
   signatures are `Ed25519(BLAKE3(nonce‖sender‖payload‖access_list))`. A message whose bytes 8..40 equal the
   signer's account id has the layout of a transaction preimage and is refused (`looksLikeTransactionPreimage`).
   The same guard was added to the extension's `boing_signMessage`.

## Request

```json
{
  "v": 1,
  "type": "boing_web_request",
  "id": "<32-64 lowercase hex, random>",
  "method": "boing_requestAccounts | boing_signMessage | boing_signTransaction | boing_sendTransaction",
  "params": [ /* 0 or 1 element, same shapes as the extension provider */ ],
  "origin": "https://app.example",
  "returnUrl": "https://app.example/path?x=1",
  "chainId": "0x1b01",
  "issuedAt": 1760000000000,
  "expiresAt": 1760000300000
}
```

Validation (`validateWebRequest`) rules:
- `origin` is an exact origin: `https:`, or `http:` only for localhost/127.0.0.1.
- `returnUrl` is on the same origin, with no fragment and no credentials.
- `params` has at most one element.
- Payload is 64 KB or less.

## Response

```json
{ "v": 1, "type": "boing_web_response", "id": "...", "origin": "https://app.example", "chainId": "0x1b01",
  "result": ["0x<account>"] }
```
or `"error": { "code": 4001, "message": "...", "data": { "boingCode": "BOING_USER_REJECTED" } }`.

Results by method:

| method | result |
|---|---|
| `boing_requestAccounts` | `["0x<64 hex>"]` |
| `boing_signMessage` | `0x` signature (128 hex) |
| `boing_signTransaction` | `0x` signed transaction hex |
| `boing_sendTransaction` | tx hash (simulate, then submit via the wallet's RPC) |

## Transports

### Popup (preferred)

1. In the click handler, the dApp calls `window.open('https://boing.express/connect?mode=popup')` synchronously,
   so popup blockers allow it.
2. The wallet posts `{type:'boing_web_ready', v:1}` to `window.opener`. This message carries no data, so targetOrigin `*` is fine.
3. The dApp checks `event.source === popup` and `event.origin === walletOrigin`. It then posts the request with
   `targetOrigin = walletOrigin`.
4. The wallet accepts only messages whose `event.source === window.opener`. It requires
   `event.origin === request.origin`, so **the origin is authenticated by the browser**.
5. The wallet sends the response with `window.opener.postMessage(response, request.origin)`. The exact targetOrigin means
   it is dropped if the opener navigated elsewhere. The wallet then closes itself.
6. The dApp treats the popup closing without a response as `4001`.

The unlocked key lives in per-tab `sessionStorage`, so the popup asks for the wallet password each time it opens.

### Redirect (fallback, e.g. when popups are blocked or in in-app browsers)

1. The dApp stores the pending request in `sessionStorage.boing_web_pending`, then navigates to
   `https://boing.express/connect#req=<base64url(JSON request)>`. The request goes in the fragment, which is never sent to servers.
2. The wallet removes the fragment from history. If `document.referrer` is present its origin must equal
   `request.origin`. The UI notes that the result returns only to that address.
3. The wallet responds with `location.replace(returnUrl + '#boing_web_response=<base64url(JSON response)>')`.
   The response goes in the **fragment**, never the query string, so it is not sent to servers or logged.
4. On load the dApp calls `consumeBoingWebRedirectResponse()`. It matches id/origin/chain against the pending request,
   deletes the pending request, and strips the fragment.

The origin is declared by the page, not verified by the browser, in redirect mode. Safety comes from the
response only being delivered to a `returnUrl` on that same origin. A malicious page can claim another origin, but the
result is sent to that other origin rather than to the attacker. The user also sees the claimed origin before approving.

## Error codes

| boingCode | code | meaning |
|---|---|---|
| `BOING_USER_REJECTED` | 4001 | Reject clicked / window closed |
| `BOING_ORIGIN_NOT_CONNECTED` | 4100 | sign before connect |
| `BOING_WEB_CHAIN_MISMATCH` | 4901 | chain id differs from wallet network |
| `BOING_WEB_EXPIRED` / `BOING_WEB_REPLAY` | 4100 | stale or reused request (replays are not answered) |
| `BOING_WEB_ORIGIN_MISMATCH` / `BOING_WEB_BAD_ORIGIN` / `BOING_WEB_BAD_RETURN_URL` | none | not answered (no trusted target) |
| `BOING_WEB_UNSUPPORTED_METHOD` | 4200 | |
| `BOING_INVALID_TX` / `BOING_SIGN_FAILED` / `BOING_SUBMIT_FAILED` | 4100 / -32603 | |

## Tests

- `tests/webSigning.test.ts`: validation, expiry and skew, replay, origin and referrer mismatch, chain mismatch,
  return URL rules, fragment encoding, and the message preimage guard.
- `tests/e2e-web/web-signing.spec.ts` (`pnpm test:e2e:web`): a test dApp page covers sign-before-connect refused,
  connect, reject (4001), signing a transfer, the self-transfer guard, the frame-buster, and the no-opener case.

## Known limitations

- `boing_switchChain` is not a web method. The user switches network in the wallet, and the provider binds the chain on the client.
- No session-level "remember approval". Every signature needs a click, by design.
- Redirect mode reloads the dApp. Apps must call `consumeBoingWebRedirectResponse()` on load to pick up the result.
  finance and observer use popup mode.
