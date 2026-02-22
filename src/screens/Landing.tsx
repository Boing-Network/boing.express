import { Link } from 'react-router-dom';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Landing.module.css';

const ASSETS_BASE = '/assets';

const PILLARS = [
  { key: 'security', label: 'Security', img: 'pillar-security.png' },
  { key: 'scalability', label: 'Scalability', img: 'pillar-scalability.png' },
  { key: 'decentralization', label: 'Decentralization', img: 'pillar-decentralization.png' },
  { key: 'authenticity', label: 'Authenticity', img: 'pillar-authenticity.png' },
  { key: 'transparency', label: 'Transparency', img: 'pillar-transparency.png' },
  { key: 'quality', label: 'Quality Assurance', img: 'pillar-quality.png' },
] as const;

export function Landing() {
  return (
    <div className={`${styles.page} page-landing`}>
      <div className={styles.pageContent}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/docs">Docs</Link>
          <Link to="/wallet" className={styles.ctaNav}>Open wallet</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroVisual}>
            <div className={styles.heroMascotWrap}>
              <img
                src={`${ASSETS_BASE}/mascot-excited.png`}
                alt="Boing Bot — Boing Network mascot"
                className={styles.heroMascotImg}
              />
            </div>
          </div>
          <h1 className={styles.heroTitle}>Boing Express</h1>
          <p className={styles.heroTagline}>Authentic. Decentralized. Optimal. Quality-Assured.</p>
          <div className={styles.heroPills}>
            {PILLARS.map(({ key, label, img }) => (
              <span key={key}>
                <img src={`${ASSETS_BASE}/${img}`} alt="" className={styles.pillarIcon} aria-hidden />
                {label}
              </span>
            ))}
          </div>
          <p className={styles.heroDesc}>
            Non-custodial wallet for Boing Network. Create or import a wallet, send and receive BOING,
            use the testnet faucet — all from the browser or extension. Your keys never leave your device.
          </p>
          <div className={styles.heroActions}>
            <Link to="/wallet" className={styles.primaryBtn}>Get started</Link>
            <Link to="/docs" className={styles.secondaryBtn}>Documentation</Link>
          </div>
        </section>

        <section className={styles.features}>
          <div className="section-header">
            <span className="section-eyebrow">Why Boing Express</span>
            <h2 className="section-title">Your Wallet, Your Rules</h2>
            <p className="section-subtitle">Everything you need to interact with the Boing Network, with nothing you don&apos;t.</p>
          </div>
          <div className={styles.featureGrid}>
            <div className={styles.card}>
              <img src={`${ASSETS_BASE}/pillar-security.png`} alt="" className={styles.cardIconImg} aria-hidden />
              <h3>Non-custodial</h3>
              <p>Keys are generated and stored only on your device. Password-encrypted; we never see your private key.</p>
            </div>
            <div className={styles.card}>
              <img src={`${ASSETS_BASE}/pillar-scalability.png`} alt="" className={styles.cardIconImg} aria-hidden />
              <h3>Web & extension</h3>
              <p>Use the wallet at boing.express or install the browser extension for Chrome and Firefox.</p>
            </div>
            <div className={styles.card}>
              <img src={`${ASSETS_BASE}/pillar-decentralization.png`} alt="" className={styles.cardIconImg} aria-hidden />
              <h3>Boing Network</h3>
              <p>Native support for Boing: Ed25519 addresses, send/receive BOING, testnet faucet, mainnet when live.</p>
            </div>
          </div>
        </section>

        <section className={styles.cta}>
          <h2 className={styles.sectionTitle}>Ready to start?</h2>
          <p className={styles.ctaText}>Create a new wallet or import an existing one.</p>
          <Link to="/wallet" className={styles.primaryBtn}>Open wallet</Link>
        </section>

        <footer className={styles.footer}>
          <h3 className={styles.footerTitle}>Resources</h3>
          <div className={styles.footerLinks}>
            <a href="https://boing.network/network/testnet" target="_blank" rel="noopener noreferrer">Join Testnet</a>
            <a href="https://boing.network/network/faucet" target="_blank" rel="noopener noreferrer">Faucet</a>
            <a href="https://boing.network" target="_blank" rel="noopener noreferrer">Boing Network</a>
            <a href="https://boing.network/docs/rpc-api" target="_blank" rel="noopener noreferrer">RPC API</a>
            <Link to="/docs">Documentation</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </div>
          <p className={styles.footerCopy}>Boing Express · boing.express · Authentic. Decentralized. Optimal. Quality-Assured.</p>
        </footer>
      </main>
      </div>
    </div>
  );
}
