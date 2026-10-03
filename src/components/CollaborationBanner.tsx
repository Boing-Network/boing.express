import styles from './CollaborationBanner.module.css';

const EMAIL = 'nico.builds@boing.network';

/** Site-wide invitation for anyone who wants to collaborate on Boing Network. */
export function CollaborationBanner() {
  return (
    <aside className={styles.banner} role="note" aria-label="Collaboration">
      <p className={styles.text}>
        Want to collaborate on the Boing Network? Email Nico at{' '}
        <a className={styles.link} href={`mailto:${EMAIL}`}>
          {EMAIL}
        </a>
        .
      </p>
    </aside>
  );
}
