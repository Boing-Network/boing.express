# Security model and user-facing protections

- **Keys:** generated and used only in the browser or extension. The vault is encrypted with AES-GCM using a key derived
  by PBKDF2 (310,000 iterations). Private keys are never logged or sent anywhere. The backup is the 32-byte Ed25519
  private key as hex; the wallet asks you to retype its last 6 characters before you can continue.
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
- **Wrong-network protection:** the wallet refuses to broadcast if the node's chain id differs from the selected
  network (see NETWORK_SETUP.md).
- **Manifest and CSP:** minimal permissions (no broad host access), extension CSP
  `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The web app ships a
  strict CSP and hardening headers in `public/_headers`.

## Known limitations

- Script running in the wallet's own origin (an XSS bug) can still ask the browser to use the session key while the
  web app is unlocked, exactly as it could use an in-memory key. Auto-lock, the 12-hour session ceiling and the strict
  CSP limit that window; they do not remove it. The extension keeps its key in the service worker, not in page storage.
- There is no mnemonic phrase yet; the backup is the raw private key. A proposal (not implemented, awaiting review) is in
  [RECOVERY_PHRASE_DESIGN.md](RECOVERY_PHRASE_DESIGN.md).