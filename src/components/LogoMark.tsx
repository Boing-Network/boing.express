import { useId } from 'react';
import styles from './LogoMark.module.css';

type Props = {
  className?: string;
  /** Default matches SiteLogo nav size */
  size?: number;
};

/**
 * Boing Express mark ("Arc Slab"): the shared Boing recovery arc + orb on a rounded slab
 * (boing.finance shell, boing.network motif) in Express teal, with speed streaks.
 * Source of truth for rasters: public/assets/boing-express-mark.svg (keep geometry in sync).
 * Frame gradient uses CSS variables so wallet/docs `data-page` accents apply.
 */
export function LogoMark({ className, size = 44 }: Props) {
  const uid = useId().replace(/:/g, '');
  const frame = `bx-frame-${uid}`;
  const orb = `bx-orb-${uid}`;
  const slab = `bx-slab-${uid}`;
  const glow = `bx-glow-${uid}`;

  return (
    <svg
      className={`${styles.mark} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={frame} x1="8" y1="54" x2="56" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--express-primary, #3B8CFF)" />
          <stop offset="0.5" stopColor="var(--logo-neon-mid, #5ab0ff)" />
          <stop offset="1" stopColor="var(--express-secondary, #2563EB)" />
        </linearGradient>
        <linearGradient id={orb} x1="40" y1="14" x2="56" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#CFE0FF" />
          <stop offset="0.5" stopColor="var(--express-primary, #3B8CFF)" />
          <stop offset="1" stopColor="#8DB8FF" />
        </linearGradient>
        <radialGradient id={slab} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#18244A" />
          <stop offset="1" stopColor="#0A1128" />
        </radialGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="14" fill={`url(#${slab})`} stroke={`url(#${frame})`} strokeWidth="2.25" />
      <path d="M15 21h9M12 27h8" stroke={`url(#${frame})`} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <path
        d="M13 45 C 19 45 21 40 25 33 C 29 26 33 21 38 19 C 43 17 47 20 49 24"
        stroke={`url(#${frame})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="49" cy="24" r="7.25" fill={`url(#${orb})`} filter={`url(#${glow})`} className={styles.core} />
      <circle cx="46.8" cy="21.6" r="2" fill="#F0F4F8" opacity="0.45" />
    </svg>
  );
}