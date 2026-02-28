import React from 'react';
import { Link } from 'react-router-dom';

type Doc = { title: string; content: React.ReactNode };

export const DOCS: Record<string, Doc> = {
  'getting-started': {
    title: 'Getting started',
    content: (
      <>
        <p>
          Boing Wallet is a non-custodial wallet for <a href="https://boing.network" target="_blank" rel="noopener noreferrer">Boing Network</a>.
          Your keys are generated and stored only on your device; we never see your private key.
        </p>
        <h2>Quick start</h2>
        <ol>
          <li>Go to <Link to="/wallet">Open wallet</Link> (or use the “Open wallet” button on the home page).</li>
          <li>Choose <strong>Create wallet</strong> to generate a new keypair, or <strong>Import wallet</strong> if you have an existing private key (64 hex characters).</li>
          <li>Set a strong password (min 8 characters). This encrypts your key in browser storage. You’ll need it every time you unlock.</li>
          <li>If you created a new wallet, back up your private key when shown. Anyone with that key can control the wallet.</li>
        </ol>
        <h2>Networks</h2>
        <p>
          You can switch between <strong>Testnet</strong> and <strong>Mainnet</strong> in the wallet header. Testnet is for trying things out; use the faucet to get test BOING.
        </p>
        <h2>Next steps</h2>
        <ul>
          <li><Link to="/docs/using-the-wallet">Using the wallet</Link> — address, balance, send, faucet.</li>
          <li><Link to="/docs/browser-extension">Browser extension</Link> — install the extension for Chrome or Firefox.</li>
          <li><Link to="/docs/security">Security</Link> — best practices.</li>
        </ul>
      </>
    ),
  },
  'using-the-wallet': {
    title: 'Using the wallet',
    content: (
      <>
        <h2>Address</h2>
        <p>
          Your address is a 64-character hex string (32-byte Ed25519 public key). Use it to receive BOING and when requesting from the testnet faucet. Copy it from the dashboard or open it on the explorer.
        </p>
        <h2>Balance</h2>
        <p>
          The dashboard shows your balance for the selected network (Testnet or Mainnet). Use the refresh button (↻) to sync with the chain. Balance auto-refreshes when you return to the tab and every 45 seconds. If the fetch fails, use Retry.
        </p>
        <h2>Send</h2>
        <p>
          To send BOING, enter the recipient’s address (64 hex characters or 0x…) and the amount in BOING (e.g. 1 or 0.5). Use “Max” to send your full balance. On Mainnet, a warning appears when you enter an amount — real BOING is at risk. After a successful send, use “View on explorer” or “Copy tx hash” to inspect the transaction.
        </p>
        <h2>Testnet faucet</h2>
        <p>
          On Testnet, you can request test BOING for your address. Use the “Request testnet BOING” button in the wallet, or open the Boing Network faucet page and paste your address.
        </p>
        <p>
          <a href="https://boing.network/network/faucet" target="_blank" rel="noopener noreferrer">Boing Network Faucet →</a>
        </p>
        <h2>Getting started checklist</h2>
        <p>
          First-time users see an onboarding checklist: Create wallet → Get testnet BOING → Send a transaction. Complete each step to get familiar with the wallet.
        </p>
        <h2>Deploy contract (QA Pillar)</h2>
        <p>
          The dashboard includes a contract deployment validator. Paste bytecode (hex) and validate before deploy. See <Link to="/docs/qa-pillar">QA Pillar</Link> for details.
        </p>
        <h2>Recent transactions</h2>
        <p>
          After you send, bond, or unbond, the dashboard shows recent transactions with links to the explorer.
        </p>
        <h2>RPC override (dev)</h2>
        <p>
          For development, you can override the RPC URL (e.g. <code>http://localhost:8545</code> for a local node) in the collapsible &quot;RPC override (dev)&quot; section.
        </p>
      </>
    ),
  },
  'browser-extension': {
    title: 'Browser extension',
    content: (
      <>
        <p>
          Boing Wallet is also available as a browser extension for Chrome and Firefox, with the same flows: create/import wallet, view address and balance, send BOING, use the faucet, and switch networks.
        </p>
        <h2>Building the extension</h2>
        <p>From the project root:</p>
        <pre><code>pnpm run build:extension</code></pre>
        <p>Output is in <code>dist-extension/</code>. Load that folder as an unpacked extension in Chrome (chrome://extensions) or Firefox (about:debugging → This Firefox → Load Temporary Add-on).</p>
        <h2>Extension vs web</h2>
        <p>
          The extension uses the same core logic as the website but runs in an isolated context. Wallets created on the web are not automatically available in the extension (and vice versa); you can import the same private key into both if you want the same address in each.
        </p>
      </>
    ),
  },
  'security': {
    title: 'Security',
    content: (
      <>
        <h2>Your responsibility</h2>
        <p>
          Boing Wallet is non-custodial. You are responsible for backing up your private key and keeping your password safe. We cannot recover your key or reset your password.
        </p>
        <h2>Best practices</h2>
        <ul>
          <li><strong>Back up your key</strong> — When you create a wallet, save the private key in a safe place. If you lose the key and the encrypted copy in this browser, the funds are unrecoverable.</li>
          <li><strong>Use a strong password</strong> — The password encrypts your key in storage. Prefer a long, unique password.</li>
          <li><strong>Phishing</strong> — Only use the official site (boing.express) and the official extension. Don’t enter your key or password on other sites.</li>
          <li><strong>Testnet first</strong> — Use Testnet and the faucet to get comfortable before using mainnet funds.</li>
        </ul>
        <h2>Technical details</h2>
        <p>
          Keys are generated locally (Ed25519). The private key is encrypted with AES-GCM using a key derived from your password and stored in the browser (e.g. localStorage). It is never sent to our servers.
        </p>
      </>
    ),
  },
  'faq': {
    title: 'FAQ',
    content: (
      <>
        <h2>I forgot my password. Can I recover my wallet?</h2>
        <p>No. The key is encrypted with your password; we don’t store or know it. If you have your private key backup, you can import the wallet again with a new password.</p>

        <h2>I lost my private key. Can you help?</h2>
        <p>We cannot recover or reset keys. If you didn’t back up the key and you clear site data or use another device, the wallet cannot be recovered.</p>

        <h2>Is Boing Wallet open source?</h2>
        <p>Yes. The project is available on GitHub; you can build and run it yourself.</p>

        <h2>Which networks are supported?</h2>
        <p>Boing Testnet and Boing Mainnet. You can switch between them in the wallet. More networks may be added later.</p>

        <h2>Where can I get test BOING?</h2>
        <p>Use the testnet faucet from the wallet (“Request testnet BOING”) or open the <a href="https://boing.network/network/faucet" target="_blank" rel="noopener noreferrer">Boing Network faucet page</a> and enter your address.</p>
      </>
    ),
  },
  'qa-pillar': {
    title: 'QA Pillar — Contract deployment',
    content: (
      <>
        <p>
          The <strong>Quality Assurance</strong> (Pillar 6) ensures only safe, well-formed contracts reach the network. Aligned with <a href="https://github.com/chiku524/boing-network/blob/main/docs/TECHNICAL-SPECIFICATION.md" target="_blank" rel="noopener noreferrer">TECHNICAL-SPECIFICATION</a> and <a href="https://github.com/chiku524/boing-network/blob/main/docs/QA-PASS-GUIDE.md" target="_blank" rel="noopener noreferrer">QA-PASS-GUIDE</a>.
        </p>
        <h2>Validation flow</h2>
        <p>
          Contract bytecode is checked and routed to: <strong>REJECT</strong> (blocked), <strong>ALLOW</strong> (permitted), or <strong>UNSURE</strong> (community QA pool).
        </p>
        <p>
          <strong>REJECT</strong>: empty, oversized (&gt;32 KiB), invalid Boing opcode, malformed (truncated PUSH). <strong>ALLOW</strong>: valid Boing VM opcodes, well-formed. Blocklist (bytecode hash) and purpose checks run server-side via <code>boing_qaCheck</code>. Malice categories (scams, phishing, etc.) are defined in <a href="https://github.com/chiku524/boing-network/blob/main/docs/CANONICAL-MALICE-DEFINITION.md" target="_blank" rel="noopener noreferrer">CANONICAL-MALICE-DEFINITION</a>.
        </p>
        <h2>Using the validator</h2>
        <p>
          In the dashboard, paste bytecode (hex), optionally select a <strong>purpose</strong> (dApp, token, NFT, meme, community, entertainment, tooling, other), and click <strong>Validate</strong>. Enable &quot;Also call boing_qaCheck&quot; for protocol validation when the node supports it.
        </p>
        <h2>References</h2>
        <ul>
          <li><a href="https://github.com/chiku524/boing-network/blob/main/docs/QA-PASS-GUIDE.md" target="_blank" rel="noopener noreferrer">QA-PASS-GUIDE</a> — Deployer checklist, valid purpose categories</li>
          <li><a href="https://github.com/chiku524/boing-network/blob/main/docs/CANONICAL-MALICE-DEFINITION.md" target="_blank" rel="noopener noreferrer">CANONICAL-MALICE-DEFINITION</a> — Malice categories for pool review</li>
          <li><a href="https://github.com/chiku524/boing-network/blob/main/docs/TECHNICAL-SPECIFICATION.md" target="_blank" rel="noopener noreferrer">TECHNICAL-SPECIFICATION</a> — VM opcodes, bytecode limits (32 KiB)</li>
        </ul>
      </>
    ),
  },
  'launch-readiness': {
    title: 'Launch readiness',
    content: (
      <>
        <p>
          Boing Express is prepared for the Boing Network incentivized testnet and mainnet. See the full roadmap in{' '}
          <a href="https://github.com/chiku524/boing.express/blob/main/docs/LAUNCH_READINESS.md" target="_blank" rel="noopener noreferrer">
            docs/LAUNCH_READINESS.md
          </a>{' '}
          (or the local <code>docs/LAUNCH_READINESS.md</code> file).
        </p>
        <h2>Current status</h2>
        <p>
          The wallet supports create/import, send/receive, testnet faucet, and network switching. All features use real RPC calls — nothing is simulated. When the Boing testnet RPC is live, the wallet will work without code changes.
        </p>
        <h2>VibeMiner vs boing.express</h2>
        <p>
          <strong>VibeMiner</strong> runs nodes and stakes (one-click mining/validating). It needs P2P bootnodes to join the public testnet. <strong>boing.express</strong> is the wallet — it needs RPC endpoints for balance and transactions. Both depend on Boing Network infrastructure; the wallet is ready when the RPC is available.
        </p>
        <h2>Priorities for testnet launch</h2>
        <ul>
          <li>Chrome Web Store listing — in review</li>
          <li>Staking UI (Bond/Unbond) — implemented</li>
          <li>Backup reminder for new wallets — implemented</li>
        </ul>
        <h2>Links</h2>
        <ul>
          <li><a href="https://boing.network/network/testnet" target="_blank" rel="noopener noreferrer">Boing Network — Join Testnet</a></li>
          <li><a href="https://boing.network/network/faucet" target="_blank" rel="noopener noreferrer">Testnet Faucet</a></li>
          <li><Link to="/support">Support</Link> — help and contact</li>
        </ul>
      </>
    ),
  },
  'links': {
    title: 'Links & resources',
    content: (
      <>
        <h2>Boing Network</h2>
        <ul>
          <li><a href="https://boing.network" target="_blank" rel="noopener noreferrer">Boing Network</a> — Official site</li>
          <li><a href="https://boing.network/network/faucet" target="_blank" rel="noopener noreferrer">Faucet</a> — Testnet BOING</li>
          <li><a href="https://boing.network/docs/rpc-api" target="_blank" rel="noopener noreferrer">RPC API</a> — Network API docs</li>
        </ul>
        <h2>Boing Wallet (Boing Express)</h2>
        <ul>
          <li><Link to="/">Home</Link> — Landing page</li>
          <li><Link to="/wallet">Wallet</Link> — Create, import, or unlock</li>
          <li><Link to="/docs">Documentation</Link> — This docs section</li>
          <li><Link to="/support">Support</Link> — Help, FAQ, testnet, contact</li>
        </ul>
        <h2>RPC endpoints</h2>
        <p>For reference (used by the wallet):</p>
        <ul>
          <li>Testnet: <code>https://testnet-rpc.boing.network</code></li>
          <li>Mainnet: <code>https://rpc.boing.network</code></li>
        </ul>
      </>
    ),
  },
};
