/**
 * Full-viewport initial animation: Boing mascot centered with aquatic & outer-space
 * themed 3D elements revolving around it. Matches Aqua Personal design system.
 * Shown on every page load; respects prefers-reduced-motion.
 */
import { useEffect, useState, useCallback } from 'react';
import styles from './InitialAnimation.module.css';

const INTRO_DURATION_MS = 4800;
const MASCOT_SRC = '/assets/mascot-excited.png';

/** Orbital ring config: radius (vmin), duration (s), reverse, count, depth (translateZ px) */
const ORBITS = [
  { radius: 12, duration: 24, reverse: false, count: 8, depth: 40 },
  { radius: 22, duration: 32, reverse: true, count: 10, depth: 10 },
  { radius: 35, duration: 40, reverse: false, count: 12, depth: -30 },
  { radius: 48, duration: 52, reverse: true, count: 14, depth: -70 },
];

/** Floating 3D orbs (bubbles/planets): position %, depth (px), size (vmin), delay (s) */
const FLOATING_ORBS = [
  { x: 15, y: 20, depth: -120, size: 4, delay: 0 },
  { x: 88, y: 25, depth: -80, size: 5, delay: 0.4 },
  { x: 22, y: 75, depth: -100, size: 3, delay: 0.8 },
  { x: 78, y: 70, depth: -140, size: 4, delay: 0.2 },
  { x: 8, y: 50, depth: -60, size: 3, delay: 0.6 },
  { x: 92, y: 45, depth: -90, size: 4, delay: 0.3 },
  { x: 50, y: 15, depth: -110, size: 3, delay: 0.5 },
  { x: 45, y: 88, depth: -130, size: 4, delay: 0.7 },
];

/** Nebula blobs for depth (position %, size vmin, depth px) */
const NEBULA_BLOBS = [
  { x: 20, y: 30, size: 35, depth: -200 },
  { x: 80, y: 60, size: 40, depth: -180 },
  { x: 50, y: 85, size: 28, depth: -220 },
];

const EXIT_DURATION_MS = 1600;

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
    const duration = prefersReduced ? 1500 : INTRO_DURATION_MS;
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
      <div className={styles.bg}>
        <div className={styles.bgGradient} />
        <div className={styles.caustics} aria-hidden />
        <div className={styles.starfield} aria-hidden />
        <div className={styles.starfieldFar} aria-hidden />
        {NEBULA_BLOBS.map((n, i) => (
          <div
            key={i}
            className={styles.nebulaBlob}
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              width: `${n.size}vmin`,
              height: `${n.size}vmin`,
              marginLeft: `-${n.size / 2}vmin`,
              marginTop: `-${n.size / 2}vmin`,
              ['--nebula-depth' as string]: `${n.depth}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Floating 3D bubbles / small planets */}
      <div className={styles.floatingOrbs}>
        {FLOATING_ORBS.map((orb, i) => (
          <div
            key={i}
            className={styles.floatingOrb}
            style={{
              left: `${orb.x}%`,
              top: `${orb.y}%`,
              width: `${orb.size}vmin`,
              height: `${orb.size}vmin`,
              marginLeft: `-${orb.size / 2}vmin`,
              marginTop: `-${orb.size / 2}vmin`,
              ['--depth' as string]: `${orb.depth}px`,
              animationDelay: `${orb.delay}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className={styles.orbits}>
        {ORBITS.map((orbit, ringIndex) => (
          <div
            key={ringIndex}
            className={`${styles.orbit} ${orbit.reverse ? styles.orbitReverse : ''}`}
            style={{
              ['--orbit-radius' as string]: `${orbit.radius}vmin`,
              ['--orbit-duration' as string]: `${orbit.duration}s`,
              ['--orbit-depth' as string]: `${orbit.depth}px`,
            } as React.CSSProperties}
          >
            {Array.from({ length: orbit.count }).map((_, i) => {
              const angle = (360 / orbit.count) * i;
              const variant = (ringIndex + i) % 3;
              return (
                <div
                  key={i}
                  className={`${styles.orbItem} ${styles[`variant${variant}`]}`}
                  style={{
                    ['--orb-angle' as string]: `${angle}deg`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.center}>
        <div className={styles.mascotRing} aria-hidden />
        <img
          src={MASCOT_SRC}
          alt=""
          className={styles.mascot}
        />
      </div>

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

