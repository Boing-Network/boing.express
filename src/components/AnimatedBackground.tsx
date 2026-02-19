import styles from './AnimatedBackground.module.css';

/**
 * Animated gradient orbs — exact match to boing.network hero (cyan, blue, violet).
 */
export function AnimatedBackground() {
  return (
    <div className={styles.wrapper} aria-hidden>
      <div className={styles.orb} data-orb="cyan" />
      <div className={styles.orb} data-orb="blue" />
      <div className={styles.orb} data-orb="violet" />
    </div>
  );
}
