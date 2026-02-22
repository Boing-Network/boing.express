/**
 * Full-viewport initial animation: Boing mascot centered with aquatic & outer-space
 * themed elements revolving around it. Matches Aqua Personal design system.
 * Shown once per session; respects prefers-reduced-motion.
 */
import { useEffect, useState, useCallback } from 'react';
import styles from './InitialAnimation.module.css';

const STORAGE_KEY = 'boing-express-intro-seen';
const INTRO_DURATION_MS = 4200;
const MASCOT_SRC = '/assets/mascot-excited.png';

/** Orbital ring config: radius (vmin), duration (s), reverse, element count */
const ORBITS = [
  { radius: 12, duration: 24, reverse: false, count: 8 },   // inner: bubbles
  { radius: 22, duration: 32, reverse: true, count: 10 },  // mid: orbs + stars
  { radius: 35, duration: 40, reverse: false, count: 12 }, // outer: space + aquatic
  { radius: 48, duration: 52, reverse: true, count: 14 },  // far: subtle elements
];

export function InitialAnimation({
  onComplete,
  skipStorage = false,
}: {
  onComplete: () => void;
  skipStorage?: boolean;
}) {
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);

  const finish = useCallback(() => {
    if (!skipStorage) try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setExiting(true);
    const t = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 800); // match .exit animation duration
    return () => clearTimeout(t);
  }, [onComplete, skipStorage]);

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
        <div className={styles.starfield} aria-hidden />
      </div>

      <div className={styles.orbits}>
        {ORBITS.map((orbit, ringIndex) => (
          <div
            key={ringIndex}
            className={`${styles.orbit} ${orbit.reverse ? styles.orbitReverse : ''}`}
            style={{
              ['--orbit-radius' as string]: `${orbit.radius}vmin`,
              ['--orbit-duration' as string]: `${orbit.duration}s`,
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

/** Whether the intro has already been shown this session */
export function hasSeenIntro(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
