import styles from './BoingAppsMenu.module.css';

/** Shared "Boing apps" switcher (same links on boing.network, boing.express, boing.finance, boing.observer). */
export const BOING_APPS = [
  { name: 'Boing Network', desc: 'The quality-assured Layer 1', href: 'https://boing.network' },
  { name: 'Boing Express', desc: 'Your gateway to Boing', href: 'https://boing.express' },
  { name: 'Boing Observer', desc: 'See what happens on-chain', href: 'https://boing.observer' },
  { name: 'Boing Finance', desc: 'Move liquidity across chains', href: 'https://boing.finance' },
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