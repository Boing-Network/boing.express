/**
 * Cinematic 3D initial animation with a ~3–5s plot starring the Boing mascot:
 * Act 1 — In the dark (silhouette, angled away); Act 2 — Light finds them (turn to
 * camera, step into light); Act 3 — Acknowledge (subtle nod, ring greets);
 * Act 4 — Ready (hold, brand in). Lighting and angles are synced to the story.
 * Shown on every page load; respects prefers-reduced-motion. Skip anytime.
 *
 * Future: consider a plot beat tied to wallet/transaction (e.g. secure handoff,
 * exchange, or “ready to send”) to align the intro with Boing Express as a wallet.
 */
import { useEffect, useState, useCallback } from 'react';
import styles from './InitialAnimation.module.css';

const INTRO_DURATION_MS = 6200;
const EXIT_DURATION_MS = 2200;
const MASCOT_SRC = '/assets/mascot-excited.png';

/** Drifting particles: position %, translate path (x y in %), duration (s), delay (s), size (px) */
const DRIFTERS = [
  { x: 30, y: 25, dx: 8, dy: -4, duration: 14, delay: 2.5, size: 3 },
  { x: 70, y: 30, dx: -6, dy: 5, duration: 12, delay: 2.8, size: 2 },
  { x: 25, y: 70, dx: -5, dy: -6, duration: 16, delay: 2.2, size: 4 },
  { x: 75, y: 65, dx: 7, dy: 4, duration: 13, delay: 3, size: 2 },
  { x: 50, y: 20, dx: 3, dy: 8, duration: 15, delay: 2.6, size: 3 },
  { x: 45, y: 80, dx: -4, dy: -3, duration: 11, delay: 2.4, size: 2 },
  { x: 15, y: 50, dx: 10, dy: 2, duration: 17, delay: 2.7, size: 3 },
  { x: 85, y: 45, dx: -8, dy: -5, duration: 14, delay: 2.9, size: 2 },
];

export function InitialAnimation({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);

  const finish = useCallback(() => {
    setExiting(true);
    const t = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, EXIT_DURATION_MS);
    return () => clearTimeout(t);
  }, [onComplete]);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReduced ? 2000 : INTRO_DURATION_MS;
    const id = setTimeout(finish, duration);
    return () => clearTimeout(id);
  }, [finish]);

  if (!visible) return null;

  return (
    <div
      className={`${styles.wrapper} ${exiting ? styles.exit : ''}`}
      role="img"
      aria-label="Boing Express loading"
    >
      {/* Cinematic vignette (edges darken, subtle pulse) */}
      <div className={styles.vignette} aria-hidden />

      {/* Layer 1: Void / tunnel — radial convergence + subtle drift */}
      <div className={styles.tunnel} aria-hidden />

      {/* Layer 2: Deep space gradient + starfield (parallax motion) */}
      <div className={styles.bg}>
        <div className={styles.bgGradient} />
        <div className={styles.starfield} aria-hidden />
        <div className={styles.starfieldFar} aria-hidden />
        <div className={styles.caustics} aria-hidden />
      </div>

      {/* Rim light / key light from top-left */}
      <div className={styles.rimLight} aria-hidden />

      {/* Lens flare — shifts subtly for living light */}
      <div className={styles.lensFlare} aria-hidden />

      {/* Layer 3: Core glow — ignites then softens behind mascot */}
      <div className={styles.core} aria-hidden />

      {/* Spotlight on mascot — "key light" finds them (plot-synced) */}
      <div className={styles.mascotSpotlight} aria-hidden />

      {/* Layer 4: Impact ring — expands once when mascot appears */}
      <div className={styles.impactRing} aria-hidden />

      {/* Layer 5: Single cinematic spiral trail (one revolution) */}
      <div className={styles.spiral} aria-hidden>
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className={styles.spiralDot}
            style={{ ['--spiral-i' as string]: i } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Layer 6: Drifting 3D particles (no orbits) */}
      <div className={styles.driftLayer}>
        {DRIFTERS.map((d, i) => (
          <div
            key={i}
            className={styles.drifter}
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.size,
              height: d.size,
              marginLeft: -d.size / 2,
              marginTop: -d.size / 2,
              ['--drift-dx' as string]: `${d.dx}%`,
              ['--drift-dy' as string]: `${d.dy}%`,
              ['--drift-duration' as string]: `${d.duration}s`,
              animationDelay: `${d.delay}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Layer 7: Mascot — emerges from core with 3D pop */}
      <div className={styles.hero}>
        <div className={styles.mascotRing} aria-hidden />
        <img src={MASCOT_SRC} alt="" className={styles.mascot} />
      </div>

      {/* Layer 8: Brand line */}
      <p className={styles.brandLine}>Boing Express</p>

      <button
        type="button"
        className={styles.skipBtn}
        onClick={finish}
        aria-label="Skip intro"
      >
        Skip
      </button>
    </div>
  );
}
