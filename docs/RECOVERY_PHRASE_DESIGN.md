# Recovery phrase: decision and implementation

**Status:** decided and implemented in Boing Express (web app and extension popup). The earlier proposal in this file
(a Boing-specific BLAKE3 encoding of the seed) was **replaced** by the standard below, because a standard phrase can be
restored by any wallet or tool that implements the same public specs, with no Boing-only code. Accounts created with a
phrase use it; accounts created before this change keep their raw private-key backup and are **not** touched.

## Decision

| Choice | Value |
| --- | --- |
| Phrase standard | BIP-39, English word list (2048 words, taken verbatim as data in `src/crypto/bip39Wordlist.ts`) |
| New wallets | **24 words** (256 bits of entropy + 8-bit checksum) |
| Import | accepts **12 or 24 words** (any other length is rejected with a plain message) |
| Seed | BIP-39: PBKDF2-HMAC-SHA512, 2048 iterations, salt `"mnemonic" + passphrase`. The passphrase ("25th word") is **always empty**: it is not offered, because it is easy to forget and cannot be recovered |
| Key derivation | SLIP-0010 for Ed25519 (HMAC-SHA512 with key `"ed25519 seed"`, **hardened-only** children) |
| Path | `m/44'/1112492366'/<account>'/0'/0'` (account index starts at 0; Boing Express uses account 0 for the first phrase account) |
| Coin type | `0x424F494E` = ASCII "BOIN" = **1112492366**. SLIP-0044 has no Boing entry, so this is a wallet-defined value below 2^31. It is frozen. If Boing registers an official SLIP-0044 number later, it can be added as a second path to try on restore without breaking existing phrases |
| Chain id in the path? | **No.** Testnet (6913) and mainnet (6914) must restore the same account from the same phrase (the account id does not depend on the chain id) |
| Runtime dependencies | none new: `@noble/hashes` (SHA-256, SHA-512, HMAC, PBKDF2) and `@noble/ed25519` only |

The 32-byte key at the end of the path is the Ed25519 private seed. The Boing address is `0x` + the 64 hex characters of
its public key, exactly as for raw-key accounts. Signing is unchanged (Ed25519 over BLAKE3 digests).

Why SLIP-0010 hardened Ed25519: Ed25519 has no safe non-hardened child derivation, and SLIP-0010 is the common
convention hardware wallets and libraries already implement. Why 24 words for new wallets: it matches the entropy of the
32-byte key the wallet already used (256 bits), and 12-word phrases from other tools can still be imported.

## What users see

- **Create:** "Recovery phrase" is the recommended and pre-selected option; "Private key (advanced)" is still offered. The
  24 words are shown once. The wallet asks the user to confirm three random word positions, and a checkbox, before
  continuing. There is no copy button on purpose (clipboard managers and sync).
- **Import:** "Recovery phrase (12 or 24 words)" is the default; "Private key" still works exactly as before. Words are
  trimmed, lower-cased and whitespace-collapsed. A wrong word or a bad checksum shows "One of the words is not right.
  Check the spelling and the order." (it does not say which word). A wrong length shows "A recovery phrase has 12 or 24
  words."
- **View later:** Settings -> "Recovery phrase" asks for the wallet password every time, shows the words hidden by
  default, and hides them again after 30 seconds, when the user leaves the tab, or on Done.
- **Raw-key accounts:** Settings explains that the account was set up with a private key and has no recovery phrase (its
  private key is its backup) and tells the user to add a new account with "Recovery phrase". The key cannot be turned into
  a phrase: a BIP-39 phrase produces a key, it cannot be computed from an arbitrary existing key.

## Storage

The vault stays AES-GCM with a PBKDF2-SHA256 (310,000 iterations) password key, unchanged. For a phrase account the vault
entry gets an optional `recovery` field `{ v: 1, words: 12 | 24, account, encrypted }`, where `encrypted` is the BIP-39
**entropy** encrypted with the wallet password. The words are never written to `localStorage`, `sessionStorage`, logs or
analytics, and are only held in memory while a backup or reveal screen is open (cleared on finish). Older wallets ignore
the optional field and entries without it behave as before.

## Verification

- `tests/fixtures/bip39-vectors.json`: the official BIP-39 English vectors (12 and 24 words).
- `tests/fixtures/slip10-ed25519-vectors.json`: the official SLIP-0010 Ed25519 test vectors 1 and 2. These are all the official Ed25519 vectors: the spec has no Ed25519 vectors 3-5 (its extra vectors are nist256p1-only retry cases), so none are fabricated here.
- `tests/fixtures/recovery-phrase-goldens.json`: Boing goldens (phrase -> path -> private key -> address).
- `tests/recoveryPhrase.test.ts`, `tests/phraseVault.test.ts`: round trips, single-word substitutions and adjacent
  swaps rejected, length rules, vault encryption, import restores the same address, raw-key accounts untouched.
- E2E: `tests/e2e-web/wallet-recovery-phrase.spec.ts` and `tests/e2e/extension-recovery-phrase.spec.ts` (create, prove three
  words, reveal after password, restore from the words in a fresh profile to the same address).

## Interoperability notes for other implementers

1. Normalise the phrase (NFKD, lower-case, single spaces), validate the BIP-39 checksum.
2. `seed = PBKDF2-HMAC-SHA512(password = phrase, salt = "mnemonic", iterations = 2048, dkLen = 64)`.
3. SLIP-0010 master: `I = HMAC-SHA512("ed25519 seed", seed)`; key = `I[0..32]`, chain code = `I[32..64]`.
4. For each path element `i` (all hardened): `I = HMAC-SHA512(chain code, 0x00 || key || ser32(i | 0x80000000))`.
5. The final key is the Ed25519 private seed; the address is the public key.

A tool that uses a different path (for example `m/44'/501'/0'/0'`) will derive a **different** account from the same
words. That is not a loss of funds: enter the Boing path above to see the Boing account.

## Still open (not blocking)

- Register a Boing coin type in SLIP-0044 (the wallet-defined value above keeps working either way).
- Move the phrase definition into `boing-sdk` / the Rust workspace so the CLI and third-party wallets share it.
- Independent cryptographic review of the implementation (the algorithms are standard; the review is of this code).
- Other word-list languages (English only for now).
