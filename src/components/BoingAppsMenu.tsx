import styles from './BoingAppsMenu.module.css';

/** Shared "Boing apps" switcher (same links on boing.network, boing.express, boing.finance, boing.observer). */
export const BOING_APPS = [
  { name: 'Boing Network', desc: 'Home, docs, faucet', href: 'https://boing.network' },
  { name: 'Boing Express', desc: 'Wallet', href: 'https://boing.express' },
  { name: 'Boing Observer', desc: 'Block explorer', href: 'https://boing.observer' },
  { name: 'boing.finance', desc: 'Swap, pools, deploy tokens', href: 'https://boing.finance' },
] as const;

export function BoingAppsMenu() {
  return (
    <details className={styles.menu}>
      <summary className={styles.summary} aria-label="Boing apps">Apps</summary>
      <ul className={styles.list}>
        {BOING_APPS.map((a) => (
          <li key={a.href}>
            <a href={a.href} rel="noopener" className={styles.item}>
              <strong>{a.name}</strong>
              <span>{a.desc}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}