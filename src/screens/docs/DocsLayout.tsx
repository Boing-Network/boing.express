import { Link, Outlet, useLocation } from 'react-router-dom';
import { SiteHeader } from '../../components/SiteHeader';
import { DOCS_HEADER_LINKS } from '../../constants/siteNav';
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
      <SiteHeader links={DOCS_HEADER_LINKS} />

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
