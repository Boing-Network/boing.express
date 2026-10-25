# Recovery phrase design (proposal, NOT implemented)

**Status:** design proposal for review. Nothing here ships in Boing Express today. Do not implement or release a
seed standard until the open questions at the end are answered by the Boing core team and the format has had an
independent cryptographic review. Wallets that ship an unreviewed phrase format create backups that other software
cannot restore, so a wrong choice is expensive to undo.

## Why

Today the only backup is the raw 32-byte Ed25519 private key as 64 hex characters (see [SECURITY.md](SECURITY.md)).
That is easy to mistype, easy to photograph by accident, and gives no error detection. A short word phrase with a
checksum is easier to write on paper and catches typos. It must not add new trust assumptions or new dependencies.

## Constraints

- **Boing-native.** The account id is the raw 32-byte Ed25519 public key. Signing is Ed25519 over BLAKE3 digests
  (see [WALLET_CONNECTION_AND_API.md](WALLET_CONNECTION_AND_API.md)). There is no BIP-32/SLIP-10 path, no coin type and
  no secp256k1 anywhere in the protocol, so Ethereum or Bitcoin style derivation paths do not apply.
- **No new runtime dependencies.** `@noble/hashes` (BLAKE3, SHA-512) and `@noble/ed25519` are already bundled. WebCrypto
  covers randomness. The only new asset would be a word list (data, not code).
- **Backwards compatible.** Every existing wallet must be able to show a phrase for the key it already has, and every
  raw-key import must keep working.
- **Offline, deterministic, testable.** A pure function with golden vectors that the Rust CLI and the TypeScript SDK
  can both reproduce.

## Recommended design

### 1. The phrase encodes the 32-byte seed directly

An Ed25519 private key in Boing is already a uniformly random 32-byte seed (`ed.utils.randomPrivateKey()`). The phrase is
a reversible encoding of that seed:

```
seed      = 32 bytes (the existing private key)
check     = first byte of BLAKE3("BOING_PHRASE_V1" || seed)          // 8 bits
bits      = seed (256 bits) || check (8 bits)                         // 264 bits
words[i]  = wordlist[ bits[11*i .. 11*i+11] ],  i = 0..23             // 24 words, 11 bits each
```

Restoring is the inverse: decode 24 words, verify the checksum byte, and the 32 bytes are the private key. No
stretching function is involved, because the seed already has 256 bits of entropy. A slow KDF here would only add
a compatibility hazard.

Consequences:

- Existing wallets get a phrase for free. Their account id does not change, and raw-hex import and phrase import
  yield the same account.
- Nothing is derived, so there is nothing to get subtly wrong between implementations beyond the word list and the
  checksum byte.
- The domain tag `BOING_PHRASE_V1` keeps the checksum from being confused with any other BLAKE3 use in the stack.

### 2. Additional accounts (optional, phase 2)

The wallet already supports several accounts (`importAnotherAccount`), each with an independent random key. To let one
phrase restore many accounts, derive children from the phrase seed with BLAKE3's built-in KDF mode:

```
account_seed(0) = seed                                         // keeps phrase == first account
account_seed(i) = BLAKE3.derive_key(
                    context = "boing-express 2026 account seed v1",
                    input   = seed || u32_le(i) )              // i >= 1, 32-byte output
```

Properties: one-way, domain-separated, no dependence on SHA-512 HMAC chains, and one primitive that the node already
uses. The cost is that it is a new construction, so it must wait for review (open question 3). Until then, extra
accounts keep their own raw-key backups and the UI says so.

### 3. Word list

Recommended: the 2048-word BIP-39 English list, taken verbatim as a data file. Reasons: widely audited, the first four
letters of every word are unique, and it has had far more public scrutiny than a new list would (its licence and word properties should still be re-checked as part of review). We reuse
only the list, not the BIP-39 mnemonic-to-seed algorithm (PBKDF2-HMAC-SHA512), which this design deliberately does not
use. The alternative, a Boing-specific list, buys branding at the cost of a new artefact to audit and to localise.

Using the BIP-39 list has one real risk: users and other wallets may assume a Boing phrase is a BIP-39 mnemonic and
paste it into software that derives different keys. Mitigations: a distinct prefix in the UI ("Boing recovery phrase,
only works in Boing wallets"), a checksum that is not the BIP-39 checksum (so BIP-39 tools reject it as invalid in
~255/256 cases), and a warning on restore.

### 4. Optional passphrase (not recommended for v1)

A BIP-39 style "25th word" would change the derived key. It is easy to forget and impossible to recover. If
added later, apply it as `seed' = BLAKE3.derive_key("boing-express 2026 phrase passphrase v1", seed || utf8(pass))`.
Leave it out of v1.

## Handling rules for any implementation

- Generate with `crypto.getRandomValues` only. Never show the phrase on a screen that is being recorded and never
  write it to `localStorage`, `sessionStorage`, logs or analytics. Keep it only in memory while the reveal screen is open,
  and clear the buffers afterwards.
- Reveal flow: require the wallet password, show once, require retyping 3 random words (the current key flow
  retypes the last 6 hex characters), and disable copy on the reveal screen by default.
- The vault stays encrypted exactly as today (AES-GCM, PBKDF2 310,000 iterations). The phrase is a backup, not a
  second unlock method.
- Normalise on input: trim, lower-case, collapse whitespace, accept the 4-letter unique prefixes, reject on checksum
  mismatch with a plain "one of the words is wrong" message that does not say which.

## Test plan (before shipping)

- Golden vectors generated by the Rust node tooling and checked in `tests/` of both repositories: seed, phrase, account id.
- Round trip over 10,000 random seeds, plus all-zero and all-0xFF seeds.
- Every single-word substitution and every adjacent transposition must be rejected by the checksum or, at minimum,
  the rate of undetected errors must be measured and documented (an 8-bit check misses about 1 in 256 random
  errors; see open question 2).
- Import of the same seed as hex and as a phrase must produce an identical vault entry and account id.

## Open questions for the Boing core team

1. **Ownership of the standard.** Should the phrase format live in `boing-sdk` / the Rust workspace (so the CLI,
   Boing Express and any third-party wallet share one definition), with Boing Express as a consumer?
2. **Checksum strength.** An 8-bit checksum is the BIP-39 level for 24 words. Do we want a stronger one (for
   example a 16-bit check, which needs 24 words + a 25th check word or a different bit packing)?
3. **Child account derivation.** Is `BLAKE3.derive_key` with the context above acceptable, or should it follow
   SLIP-10 hardened Ed25519 so that hardware wallets can interoperate later? SLIP-10 would add HMAC-SHA512 chains and a
   path convention (a coin type for Boing would need to be registered).
4. **Word list.** Reuse the BIP-39 English list (recommended) or ship a Boing-specific one? Which languages at launch?
5. **Passphrase.** Is the optional passphrase wanted at all, given the recovery risk?
6. **Mainnet vs testnet.** The same phrase must restore the same account on both networks (the account id does not
   depend on the chain id). Confirm no per-network separation is wanted.
7. **Security review.** Who reviews the construction, and are golden vectors required in both repos before a release?
8. **Compatibility messaging.** Are we comfortable that a Boing phrase uses BIP-39 words but is not a BIP-39 mnemonic?

## What would change in this repository once approved

- `src/crypto/recoveryPhrase.ts` (pure functions, golden-vector tests) and a `wordlist.ts` data file.
- A "Recovery phrase" reveal screen next to the current private-key backup in Dashboard settings, and a
  "Restore from phrase" option in import.
- Extension popup parity (vanilla DOM) and the matching help text. SECURITY.md would drop the "no mnemonic phrase"
  limitation.