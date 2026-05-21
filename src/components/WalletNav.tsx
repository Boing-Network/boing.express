import { Link } from 'react-router-dom';
import { CHROME_EXTENSION_STORE_URL } from '../constants/chromeExtension';
import { SiteLogo } from './SiteLogo';
import styles from './WalletNav.module.css';

export function WalletNav() {
  return (
    <nav className={styles.nav}>
      <SiteLogo className={styles.logoWrap} />
      <div className={styles.links}>
        <Link to="/">Home</Link>
        <Link to="/docs">Docs</Link>
        <a href={CHROME_EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">
          Chrome extension
        </a>
        <Link to="/wallet" className={styles.active}>Wallet</Link>
      </div>
    </nav>
  );
}
