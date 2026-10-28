import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { LEGAL_HEADER_LINKS } from '../constants/siteNav';
import styles from './Legal.module.css';

export function NotFound() {
  return (
    <div className={`${styles.page} page-app`} data-testid="not-found">
      <SiteHeader links={LEGAL_HEADER_LINKS} />
      <main className={styles.main}>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.updated}>That address doesn&apos;t exist on boing.express.</p>
        <article className={styles.article}>
          <p>
            Try the <Link to="/">home page</Link>, open the <Link to="/wallet">wallet</Link>, or read the{' '}
            <Link to="/docs">docs</Link>. If you followed a link from another app, the link may be out of date;
            let us know on the <Link to="/support">support page</Link>.
          </p>
        </article>
      </main>
    </div>
  );
}
