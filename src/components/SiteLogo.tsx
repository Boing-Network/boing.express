import { Link } from 'react-router-dom';
import styles from './SiteLogo.module.css';

type Props = {
  href?: string;
  className?: string;
  asSpan?: boolean;
};

/** Inline logo icon (same as favicon) so we can style with currentColor/neon */
function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      width={28}
      height={28}
      aria-hidden
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 16h4l2 6 2-6h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteLogo({ href = '/', className, asSpan }: Props) {
  const content = (
    <>
      <span className={styles.logoIconWrap}>
        <LogoIcon className={styles.logoIcon} />
      </span>
      <span className={styles.logoText}>Boing Express</span>
    </>
  );

  if (asSpan) {
    return <span className={`${styles.logo} ${className ?? ''}`}>{content}</span>;
  }

  return (
    <Link to={href} className={`${styles.logo} ${className ?? ''}`}>
      {content}
    </Link>
  );
}
