import { Link } from 'react-router-dom';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Legal.module.css';

export function Privacy() {
  return (
    <div className={`${styles.page} page-app`}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/">Home</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/wallet">Wallet</Link>
          <Link to="/terms">Terms of Service</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: February 2025</p>

        <article className={styles.article}>
          <p>
            Boing Express (“we”, “our”, or “the wallet”) is a non-custodial wallet for Boing Network.
            This policy describes how we handle information in the Boing Express web app and browser extension.
          </p>

          <h2>We do not collect your keys or passwords</h2>
          <p>
            Private keys and wallet passwords are generated and stored only on your device. They are
            never sent to our servers or any third party. The wallet uses password-based encryption
            (AES-GCM) to store wallet data in your browser’s local storage (web app) or extension
            storage (browser extension). We have no access to your keys or passwords.
          </p>

          <h2>What is stored on your device</h2>
          <p>
            The wallet stores encrypted wallet data (including an encrypted copy of your key material)
            in the browser’s local storage or the extension’s storage. This data stays on your device.
            Clearing site data or uninstalling the extension will remove it. We do not have access to
            this data.
          </p>

          <h2>Network and RPC communication</h2>
          <p>
            To show balances and send transactions, the wallet sends requests to Boing Network RPC
            endpoints (for example <code>testnet-rpc.boing.network</code> and <code>rpc.boing.network</code>).
            These requests include your public address (account ID) and transaction data as needed.
            Private keys are never sent. RPC providers may log requests according to their own policies.
          </p>

          <h2>Extension permissions</h2>
          <p>
            The browser extension requests only the permissions it needs: <strong>storage</strong> (to
            save encrypted wallet data locally), <strong>tabs</strong> (to open the faucet or other
            pages in a new tab), and <strong>host permissions</strong> for Boing Network RPC and
            boing.network. The extension does not read or modify your browsing history or other sites.
          </p>

          <h2>No off-device collection</h2>
          <p>
            We do not collect, sell, or share your personal data. We do not run analytics that track
            you across the web. The wallet is designed so that sensitive operations stay on your
            device.
          </p>

          <h2>Changes</h2>
          <p>
            We may update this privacy policy from time to time. The “Last updated” date at the top
            will be revised when we do. Continued use of the wallet after changes constitutes
            acceptance of the updated policy.
          </p>

          <h2>Contact</h2>
          <p>
            For questions about this privacy policy or Boing Express, you can reach out via{' '}
            <a href="https://boing.network" target="_blank" rel="noopener noreferrer">Boing Network</a>.
          </p>

          <Link to="/" className={styles.back}>← Back to home</Link>
        </article>
      </main>
    </div>
  );
}
