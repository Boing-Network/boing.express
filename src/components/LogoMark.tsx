import { useId } from 'react';
import styles from './LogoMark.module.css';

type Props = {
  className?: string;
  /** Default matches SiteLogo nav size */
  size?: number;
};

/**
 * Boing Express mark — stone slab chip, engraved hex ring, neon gradient core.
 * Gradients use CSS variables so wallet/docs `data-page` accents apply.
 */
export function LogoMark({ className, size = 44 }: Props) {
  const uid = useId().replace(/:/g, '');
  const gradStroke = `logo-stroke-${uid}`;
  const gradFill = `logo-fill-${uid}`;
  const softBlur = `logo-soft-${uid}`;

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
        <linearGradient id={gradStroke} x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--express-primary)" />
          <stop offset="48%" stopColor="var(--logo-neon-mid, #5ab0ff)" />
          <stop offset="100%" stopColor="var(--express-secondary)" />
        </linearGradient>
        <linearGradient id={gradFill} x1="22" y1="42" x2="42" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--express-primary)" />
          <stop offset="100%" stopColor="var(--express-secondary)" />
        </linearGradient>
        <filter id={softBlur} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.35" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Stone chip */}
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="14"
        className={styles.slab}
      />
      <rect
        x="4.5"
        y="4.5"
        width="55"
        height="55"
        rx="13.5"
        className={styles.slabHighlight}
      />
      {/* Groove (engraved hex) */}
      <path
        className={styles.hexGroove}
        d="M32 9 L51.5 20.25 V43.75 L32 55 L12.5 43.75 V20.25 Z"
      />
      {/* Neon hex */}
      <path
        d="M32 9 L51.5 20.25 V43.75 L32 55 L12.5 43.75 V20.25 Z"
        stroke={`url(#${gradStroke})`}
        strokeWidth="1.35"
        strokeLinejoin="round"
        filter={`url(#${softBlur})`}
      />
      {/* Core */}
      <circle cx="32" cy="32" r="6.25" fill={`url(#${gradFill})`} className={styles.core} />
      <circle cx="32" cy="32" r="2.4" fill="var(--text-primary)" opacity="0.14" />
    </svg>
  );
}
