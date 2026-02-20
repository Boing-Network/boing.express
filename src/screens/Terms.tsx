import { Link } from 'react-router-dom';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Legal.module.css';

export function Terms() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/">Home</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/wallet">Wallet</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated: February 2025</p>

        <article className={styles.article}>
          <p>
            These Terms of Service (“Terms”) apply to your use of Boing Express, including the web
            application at boing.express and the Boing Wallet browser extension (together, “the
            wallet” or “Boing Express”). By using the wallet, you agree to these Terms.
          </p>

          <h2>Non-custodial wallet</h2>
          <p>
            Boing Express is a non-custodial wallet. You alone control the keys to your wallet.
            We do not custody, hold, or have access to your funds or private keys. You are solely
            responsible for securing your password and any backup of your keys. Loss of access to
            your keys may result in permanent loss of access to your funds.
          </p>

          <h2>No guarantee of service</h2>
          <p>
            The wallet is provided “as is” and “as available.” We do not guarantee uninterrupted
            availability, accuracy of balance or transaction display, or that the wallet will be
            error-free. Network conditions, RPC providers, and third-party services may affect
            functionality. You use the wallet at your own risk.
          </p>

          <h2>Your responsibilities</h2>
          <p>You agree to:</p>
          <ul>
            <li>Use the wallet only for lawful purposes and in compliance with applicable laws.</li>
            <li>Keep your password and any backup of your private key secure and confidential.</li>
            <li>Verify addresses and amounts before confirming any transaction.</li>
            <li>Understand that transactions on a blockchain are generally irreversible.</li>
          </ul>

          <h2>No financial or legal advice</h2>
          <p>
            Nothing in the wallet or its documentation constitutes financial, investment, tax, or
            legal advice. You should seek independent advice before making financial decisions.
            Cryptocurrency and blockchain assets can be volatile and involve risk.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we and our affiliates are not liable for any
            indirect, incidental, special, consequential, or punitive damages, or for any loss of
            funds, data, or profits, arising from your use or inability to use the wallet. Our total
            liability is limited to the amount you paid to us (if any) in the twelve months before
            the claim. Some jurisdictions do not allow certain limitations; in those jurisdictions,
            our liability will be limited to the greatest extent permitted by law.
          </p>

          <h2>Third-party services and networks</h2>
          <p>
            The wallet interacts with Boing Network and related RPC and faucet services. Your use
            of those networks and services is subject to their respective terms and policies. We are
            not responsible for the actions, availability, or policies of third parties.
          </p>

          <h2>Changes to the wallet and Terms</h2>
          <p>
            We may update the wallet and these Terms from time to time. Continued use after changes
            constitutes acceptance. We encourage you to review the Terms and the Privacy Policy
            periodically. The “Last updated” date at the top of this page will be revised when we
            change these Terms.
          </p>

          <h2>Termination</h2>
          <p>
            You may stop using the wallet at any time. We may suspend or discontinue offering the
            wallet or access to it, without liability, to the extent permitted by law. Provisions
            that by their nature should survive (including limitation of liability and
            indemnification) will survive.
          </p>

          <h2>General</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which we operate, without
            regard to conflict of law principles. If any part of these Terms is held invalid, the
            rest remains in effect. Our failure to enforce any right does not waive that right.
          </p>

          <h2>Contact</h2>
          <p>
            For questions about these Terms or Boing Express, you can reach out via{' '}
            <a href="https://boing.network" target="_blank" rel="noopener noreferrer">Boing Network</a>.
          </p>

          <Link to="/" className={styles.back}>← Back to home</Link>
        </article>
      </main>
    </div>
  );
}
