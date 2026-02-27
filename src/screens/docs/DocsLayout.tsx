import { Link, Outlet, useLocation } from 'react-router-dom';
import { SiteLogo } from '../../components/SiteLogo';
import styles from './Docs.module.css';

const DOC_NAV: { slug: string; label: string }[] = [
  { slug: 'getting-started', label: 'Getting started' },
  { slug: 'using-the-wallet', label: 'Using the wallet' },
  { slug: 'browser-extension', label: 'Browser extension' },
  { slug: 'security', label: 'Security' },
  { slug: 'qa-pillar', label: 'QA Pillar' },
  { slug: 'faq', label: 'FAQ' },
  { slug: 'launch-readiness', label: 'Launch readiness' },
  { slug: 'links', label: 'Links & resources' },
];

export function DocsLayout() {
  const location = useLocation();
  const currentSlug = location.pathname.replace(/^\/docs\/?/, '') || 'getting-started';

  return (
    <div className={`${styles.page} page-app`}>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} />
        <nav className={styles.nav}>
          <Link to="/">Home</Link>
          <Link to="/docs" className={styles.active}>Docs</Link>
          <Link to="/wallet">Wallet</Link>
          <Link to="/support">Support</Link>
        </nav>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <h2 className={styles.sidebarTitle}>Documentation</h2>
          <ul className={styles.sidebarList}>
            {DOC_NAV.map(({ slug, label }) => (
              <li key={slug}>
                <Link
                  to={slug === 'getting-started' ? '/docs' : `/docs/${slug}`}
                  className={currentSlug === slug ? styles.sidebarActive : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
