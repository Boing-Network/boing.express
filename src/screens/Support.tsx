import { Link } from 'react-router-dom';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Legal.module.css';

export function Support() {
  return (
    <div className={`${styles.page} page-app`}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/">Home</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/wallet">Wallet</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Support</h1>
        <p className={styles.updated}>Boing Express — wallet for Boing Network</p>

        <article className={styles.article}>
          <p>
            Boing Express is the non-custodial wallet for Boing Network. Use this page to find help,
            docs, and links for the incentivized testnet and beyond.
          </p>

          <h2>Boing Network incentivized testnet</h2>
          <p>
            Get ready for the Boing Network incentivized testnet with Boing Express: create or import
            a wallet, switch to <strong>Boing Testnet</strong>, use the faucet to receive test BOING,
            and send transactions. Your keys stay on your device; we never see them. See the{' '}
            <Link to="/docs/launch-readiness">launch readiness roadmap</Link>{' '}
            for current status and upcoming features.
          </p>
          <ul>
            <li>
              <a href="https://boing.network/testnet/join" target="_blank" rel="noopener noreferrer">
                Boing Network — Join Testnet
              </a>
            </li>
            <li>
              <a href="https://boing.network/faucet" target="_blank" rel="noopener noreferrer">
                Testnet faucet
              </a>{' '}
              — request test BOING (or use the faucet button in the wallet).
            </li>
          </ul>

          <h2>Get help</h2>
          <ul>
            <li>
              <Link to="/docs">Documentation</Link> — Getting started, using the wallet, browser extension, security.
            </li>
            <li>
              <Link to="/docs/faq">FAQ</Link> — Password recovery, lost key, networks, test BOING.
            </li>
            <li>
              <Link to="/docs/security">Security</Link> — Best practices and technical details.
            </li>
            <li>
              <Link to="/docs/browser-extension">Browser extension</Link> — Install and use the Chrome/Firefox extension.
            </li>
          </ul>

          <h2>Legal &amp; privacy</h2>
          <ul>
            <li>
              <Link to="/privacy">Privacy Policy</Link> — How we handle data (keys stay on device; no off-device collection).
            </li>
            <li>
              <Link to="/terms">Terms of Service</Link> — Use of Boing Express.
            </li>
          </ul>

          <h2>Contact</h2>
          <p>
            For questions about Boing Network (testnet, mainnet, RPC, or ecosystem), visit{' '}
            <a href="https://boing.network" target="_blank" rel="noopener noreferrer">
              Boing Network
            </a>
            . For wallet-specific issues, you can open an issue on the project repository or reach out via the Boing community.
          </p>

          <Link to="/" className={styles.back}>← Back to home</Link>
        </article>
      </main>
    </div>
  );
}
