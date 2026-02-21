import styles from './AnimatedBackground.module.css';

/**
 * Animated background: official Boing art + outerspace-oceanic theme (promo video).
 * Official background image, gradient overlay, optional hex grid, orbs, shooting stars, particles.
 */
export function AnimatedBackground() {
  return (
    <div className={styles.wrapper} aria-hidden>
      {/* Official Boing background (hex grid, circuit lines, cosmic/oceanic) */}
      <div className={styles.officialBg} />

      {/* Subtle overlay for content readability */}
      <div className={styles.baseGradient} />

      {/* Optional CSS hex grid (can blend with official art) — lower opacity */}
      <div className={styles.hexGridWrap}>
        <svg className={styles.hexGrid} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="hexPattern" width="17.32" height="30" patternUnits="userSpaceOnUse">
              <path d="M8.66 0 L17.32 5 L17.32 15 L8.66 20 L0 15 L0 5 Z" fill="none" stroke="rgba(0,229,204,0.08)" strokeWidth="0.4" />
              <path d="M8.66 15 L17.32 20 L17.32 30 L8.66 35 L0 30 L0 20 Z" fill="none" stroke="rgba(0,229,204,0.08)" strokeWidth="0.4" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#hexPattern)" />
        </svg>
      </div>

      {/* Gradient orbs (teal / electric blue — bioluminescent glow) */}
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
