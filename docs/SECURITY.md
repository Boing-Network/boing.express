# Security model and user-facing protections

- **Keys:** generated and used only in the browser or extension. The vault is encrypted with AES-GCM using a key derived
  by PBKDF2 (310,000 iterations). Private keys are never logged or sent anywhere. The backup is the 32-byte Ed25519
  private key as hex (accounts created as "Private key"; the wallet asks you to retype its last 6 characters) or, for
  accounts created with a recovery phrase (the default), the 24-word BIP-39 phrase. See the next bullet.
- **Recovery phrase:** new wallets default to a 24-word BIP-39 phrase (import accepts 12 or 24 words), derived with SLIP-0010
  Ed25519 at `m/44'/1112492366'/<account>'/0'/0'` with an empty passphrase. The phrase is shown once at creation (you must
  confirm three words) and can be shown again only after re-entering the wallet password; it is held in memory only,
  hidden by default, cleared after 30 seconds or when you leave the tab, and has no copy button. The vault stores only
  the entropy, encrypted with your wallet password (AES-GCM, PBKDF2 310,000). Accounts created before phrases existed are
  not changed and keep their private-key backup. Details: [RECOVERY_PHRASE_DESIGN.md](RECOVERY_PHRASE_DESIGN.md).
- **Auto-lock:** the extension locks after 15 minutes of inactivity by default (choices: never, 5, 15, 30, 60 minutes;
  Settings in the popup). The deadline is checked when the key is next needed, so no extra `alarms` permission is
  required. The web app has its own "Lock after" setting.
- **Web app session sealing:** the unlocked key is never written to `sessionStorage` in plaintext. After unlock the key
  pair is sealed with AES-256-GCM under a fresh, non-extractable WebCrypto key. That key is kept as an opaque handle in
  IndexedDB (one per tab), and only the ciphertext goes to `sessionStorage`. A storage dump, devtools or a synced
  profile shows ciphertext and cannot export the key. The session ends on Lock, logout, tab close, after the idle
  auto-lock (activity is recorded so the setting also holds across refreshes) or after 12 hours at most. If WebCrypto or
  IndexedDB is unavailable the session is not persisted at all (you re-enter the password); there is no plaintext
  fallback. A legacy plaintext session from an older version is deleted and re-sealed once on first load.
- **Message sender validation:** privileged background messages (unlock, sign, approve, settings) are accepted only
  from extension pages. Content scripts may only forward `BOING_PROVIDER_REQUEST`, and the dApp origin is taken from the
  browser-provided sender, never from the page payload.
- **Explicit connect approval:** `boing_requestAccounts` opens a "Connect to this site?" prompt. Requests are
  de-duplicated per origin so a page cannot spam prompts.
- **Origin warnings:** approval prompts show a banner for suspicious origins (non-HTTPS, raw IP addresses, localhost development apps, look-alike international characters, URLs with embedded credentials). See `src/security/originRisk.ts`.
- **Plain-language approvals:** every approval shows who is asking, what will move, the fee and the network, with no
  simulated data that could mislead.
- **PutBlob publish sessions (0.1.22+):** `boing_requestPutBlobSession` is the only multi-tx approval exception — PutBlob-only, bound to origin + active account, with count/byte/TTL caps; cleared on lock, account switch, or worker restart. Other tx types still need a click each time. See [PUT-BLOB-PUBLISH-SESSION.md](PUT-BLOB-PUBLISH-SESSION.md).
- **Wrong-network protection:** the wallet refuses to broadcast if the node's chain id differs from the selected
  network (see NETWORK_SETUP.md).
- **Manifest and CSP:** minimal permissions (no broad host access), extension CSP
  `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The web app ships a
  strict CSP and hardening headers in `public/_headers`.

## Known limitations

- Script running in the wallet's own origin (an XSS bug) can still ask the browser to use the session key while the
  web app is unlocked, exactly as it could use an in-memory key. Auto-lock, the 12-hour session ceiling and the strict
  CSP limit that window; they do not remove it. The extension keeps its key in the service worker, not in page storage.
- A raw-key account cannot be given a recovery phrase (a phrase produces a key; it cannot be computed from an existing
  key). To get one, add a new account with "Recovery phrase" and move funds. The recovery-phrase code has not had an
  independent review yet (the algorithms are standard BIP-39 and SLIP-0010 and are tested against their official vectors).
- Anyone who sees the words controls the account. The wallet cannot recover a lost phrase or password.