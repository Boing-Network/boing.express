# Security model and user-facing protections

- **Keys:** generated and used only in the browser or extension. The vault is encrypted with AES-GCM using a key derived
  by PBKDF2 (310,000 iterations). Private keys are never logged or sent anywhere. The backup is the 32-byte Ed25519
  private key as hex; the wallet asks you to retype its last 6 characters before you can continue.
- **Auto-lock:** the extension locks after 15 minutes of inactivity by default (choices: never, 5, 15, 30, 60 minutes;
  Settings in the popup). The deadline is checked when the key is next needed, so no extra `alarms` permission is
  required. The web app has its own "Lock after" setting.
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

- The web app keeps the unlocked key in `sessionStorage` until it auto-locks or the tab closes.
- There is no mnemonic phrase; the backup is the raw private key.