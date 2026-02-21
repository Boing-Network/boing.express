import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteLogo } from '../components/SiteLogo';
import styles from './Landing.module.css';

const HERO_OBJECTS_BASE = '/images/hero_objects';
const HERO_MANIFEST_URL = `${HERO_OBJECTS_BASE}/manifest.json`;

type HeroManifest = { robot: string | null; objects: string[] } | null;

export function Landing() {
  const [heroManifest, setHeroManifest] = useState<HeroManifest>(null);
  const [heroManifestLoaded, setHeroManifestLoaded] = useState(false);

  useEffect(() => {
    fetch(HERO_MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: HeroManifest) => {
        setHeroManifest(data ?? null);
        setHeroManifestLoaded(true);
      })
      .catch(() => setHeroManifestLoaded(true));
  }, []);

  const useExtracted = heroManifestLoaded && heroManifest && heroManifest.robot;
  const robotSrc = useExtracted ? `${HERO_OBJECTS_BASE}/${heroManifest!.robot}` : '/images/boing_robot_hero.png';
  const objectFiles = useExtracted ? heroManifest!.objects : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/docs">Docs</Link>
          <Link to="/wallet" className={styles.ctaNav}>Open wallet</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={`${styles.heroVisual} ${useExtracted ? styles.heroVisual3d : ''}`}>
            {/* Base layer: full scene (when not extracted) or background (when extracted) */}
            {!useExtracted && (
              <>
                <div className={styles.heroEnv}>
                  <img src="/images/boing_robot_hero.png" alt="" aria-hidden className={styles.heroEnvImg} />
                </div>
                <div className={styles.heroRobotWrap}>
                  <img
                    src="/images/boing_robot_hero.png"
                    alt="Boing Network mascot — teal robot in outerspace-oceanic world"
                    className={styles.heroRobot}
                  />
                </div>
              </>
            )}
            {/* Extracted layers: 3D depth + motion (robot + env objects) */}
            {useExtracted && (
              <>
                <div className={styles.heroScene3d}>
                  {/* Back layer: original scene as environment (slightly scaled) */}
                  <div className={styles.heroLayer3d} data-depth="far">
                    <img src="/images/boing_robot_hero.png" alt="" aria-hidden className={styles.heroLayerImg} />
                  </div>
                  {/* Environment objects (jellyfish, coral, etc.) when SAM/multi-object used */}
                  {objectFiles.map((file, i) => (
                    <div
                      key={file}
                      className={styles.heroLayer3d}
                      data-depth="mid"
                      style={{ animationDelay: `${i * 0.4}s` }}
                    >
                      <img src={`${HERO_OBJECTS_BASE}/${file}`} alt="" aria-hidden className={styles.heroLayerImg} />
                    </div>
                  ))}
                  {/* Robot: front layer with strongest 3D motion */}
                  <div className={`${styles.heroLayer3d} ${styles.heroRobotLayer3d}`} data-depth="near">
                    <img
                      src={robotSrc}
                      alt="Boing Network mascot — teal robot in outerspace-oceanic world"
                      className={styles.heroLayerImg}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <h1 className={styles.heroTitle}>Boing Express</h1>
          <p className={styles.heroTagline}>Authentic. Decentralized. Optimal. Quality-Assured.</p>
          <div className={styles.heroPills}>
            <span>🔐 Security</span>
            <span>⚡ Scalability</span>
            <span>🌐 Decentralization</span>
            <span>✓ Authenticity</span>
            <span>📋 Transparency</span>
            <span>✓ True Quality Assurance</span>
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
          <h2 className={styles.sectionTitle}>Why Boing Express</h2>
          <div className={styles.featureGrid}>
            <div className={styles.card}>
              <span className={styles.cardIcon}>🔐</span>
              <h3>Non-custodial</h3>
              <p>Keys are generated and stored only on your device. Password-encrypted; we never see your private key.</p>
            </div>
            <div className={styles.card}>
              <span className={styles.cardIcon}>⚡</span>
              <h3>Web & extension</h3>
              <p>Use the wallet at boing.express or install the browser extension for Chrome and Firefox.</p>
            </div>
            <div className={styles.card}>
              <span className={styles.cardIcon}>🌐</span>
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
  );
}
