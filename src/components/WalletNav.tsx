import { Link } from 'react-router-dom';
import styles from './WalletNav.module.css';

export function WalletNav() {
  return (
    <nav className={styles.nav}>
      <Link to="/">Home</Link>
      <Link to="/docs">Docs</Link>
      <Link to="/wallet" className={styles.active}>Wallet</Link>
    </nav>
  );
}
