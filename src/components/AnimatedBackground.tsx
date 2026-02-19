import styles from './AnimatedBackground.module.css';

/**
 * Animated background: orbs (boing.network) + shooting stars + floating particles.
 */
export function AnimatedBackground() {
  return (
    <div className={styles.wrapper} aria-hidden>
      {/* Gradient orbs */}
      <div className={styles.orb} data-orb="cyan" />
      <div className={styles.orb} data-orb="blue" />
      <div className={styles.orb} data-orb="violet" />

      {/* Shooting stars */}
      <div className={styles.shootingStar} data-star="1">
        <div className={`${styles.shootingStarLine} ${styles.line1}`} />
      </div>
      <div className={styles.shootingStar} data-star="2">
        <div className={`${styles.shootingStarLine} ${styles.line2}`} />
      </div>
      <div className={styles.shootingStar} data-star="3">
        <div className={`${styles.shootingStarLine} ${styles.line3}`} />
      </div>
      <div className={styles.shootingStar} data-star="4">
        <div className={`${styles.shootingStarLine} ${styles.line4}`} />
      </div>
      <div className={styles.shootingStar} data-star="5">
        <div className={`${styles.shootingStarLine} ${styles.line5}`} />
      </div>

      {/* Floating particles */}
      <div className={`${styles.floatParticle} ${styles.particle1}`} />
      <div className={`${styles.floatParticle} ${styles.particle2}`} />
      <div className={`${styles.floatParticle} ${styles.particle3}`} />
      <div className={`${styles.floatParticle} ${styles.particle4}`} />
      <div className={`${styles.floatParticle} ${styles.particle5}`} />
    </div>
  );
}
