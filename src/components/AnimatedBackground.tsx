import styles from './AnimatedBackground.module.css';

/**
 * Animated gradient blob background matching Boing Network / boing.finance.
 * Soft, slow-moving orbs in teal, violet, and gold; fixed behind all content.
 */
export function AnimatedBackground() {
  return (
    <div className={styles.wrapper} aria-hidden>
      <div className={styles.orb} data-orb="teal" />
      <div className={styles.orb} data-orb="violet" />
      <div className={styles.orb} data-orb="gold" />
      <div className={styles.orb} data-orb="teal2" />
      <div className={styles.orb} data-orb="violet2" />
    </div>
  );
}
