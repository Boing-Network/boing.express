import { useId, useMemo } from 'react';
import styles from './EngravingBackdrop.module.css';

/** Fixed “slab” texture — visible through the semi-transparent canvas. */
export function StoneSlabBackdrop() {
  return <div className={styles.stoneFixed} aria-hidden />;
}

/**
 * One continuous engraved path with neon accent + nodes; stretches with the page.
 * Coordinates are in viewBox user space (0–100 × 0–240).
 */
export function EngravingVeinBackdrop() {
  const reactId = useId();
  const filterId = useMemo(() => `engrave-neon-${reactId.replace(/:/g, '')}`, [reactId]);

  const pathD = useMemo(
    () =>
      [
        'M 14 6',
        'C 34 4 48 12 68 20',
        'C 88 28 94 44 76 56',
        'C 58 68 28 62 16 82',
        'C 4 102 20 118 40 124',
        'C 60 130 86 126 90 146',
        'C 94 166 72 180 48 184',
        'C 24 188 8 204 22 220',
        'C 36 236 58 238 78 232',
        'C 92 228 88 238 50 236',
      ].join(' '),
    [],
  );

  const nodes = useMemo(
    () =>
      [
        { cx: 14, cy: 6, rH: 5, rC: 1.1 },
        { cx: 68, cy: 20, rH: 4.8, rC: 1.05 },
        { cx: 76, cy: 56, rH: 5, rC: 1.1 },
        { cx: 16, cy: 82, rH: 4.6, rC: 1 },
        { cx: 40, cy: 124, rH: 5.2, rC: 1.15 },
        { cx: 90, cy: 146, rH: 4.8, rC: 1.05 },
        { cx: 48, cy: 184, rH: 5, rC: 1.1 },
        { cx: 22, cy: 220, rH: 4.6, rC: 1 },
        { cx: 50, cy: 236, rH: 5.5, rC: 1.2 },
      ] as const,
    [],
  );

  const accents = useMemo(
    () =>
      [
        { cx: 44, cy: 42, r: 7 },
        { cx: 64, cy: 102, r: 5.5 },
        { cx: 36, cy: 158, r: 6 },
        { cx: 84, cy: 200, r: 5 },
      ] as const,
    [],
  );

  return (
    <svg
      className={styles.veinLayer}
      viewBox="0 0 100 240"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <filter id={filterId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Faint links from floating orbs into the main vein */}
      <path
        className={styles.connector}
        d="M 44 42 L 56 34 M 64 102 L 52 112 M 36 158 L 48 148 M 84 200 L 68 188"
      />

      <path className={styles.track} d={pathD} />
      <path className={styles.trackHighlight} d={pathD} />
      <path className={styles.neonLine} d={pathD} filter={`url(#${filterId})`} />

      {accents.map((a, i) => (
        <circle
          key={`accent-${i}`}
          className={styles.accentOrb}
          cx={a.cx}
          cy={a.cy}
          r={a.r}
        />
      ))}

      {nodes.map((n, i) => (
        <g key={`node-${i}`}>
          <circle className={styles.nodeHalo} cx={n.cx} cy={n.cy} r={n.rH} />
          <circle className={styles.nodeCore} cx={n.cx} cy={n.cy} r={n.rC} />
        </g>
      ))}
    </svg>
  );
}
