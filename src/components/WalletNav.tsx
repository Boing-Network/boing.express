import { Link } from 'react-router-dom';
import { SiteLogo } from './SiteLogo';
import styles from './WalletNav.module.css';

export function WalletNav() {
  return (
    <nav className={styles.nav}>
      <SiteLogo className={styles.logoWrap} />
      <div className={styles.links}>
        <Link to="/">Home</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/wallet" className={styles.active}>Wallet</Link>
      </div>
    </nav>
  );
}
