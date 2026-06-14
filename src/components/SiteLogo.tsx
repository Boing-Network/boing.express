import { Link } from 'react-router-dom';
import { LogoMark } from './LogoMark';
import styles from './SiteLogo.module.css';

type Props = {
  href?: string;
  className?: string;
  asSpan?: boolean;
  /** Smaller wordmark on narrow viewports (used in site header). */
  compact?: boolean;
};

export function SiteLogo({ href = '/', className, asSpan, compact }: Props) {
  const content = (
    <>
      <span className={styles.logoImgWrap}>
        <LogoMark className={styles.logoMark} size={44} />
      </span>
      <span className={styles.logoText}>Boing Express</span>
    </>
  );

  const logoClass = `${styles.logo} ${compact ? styles.compact : ''} ${className ?? ''}`.trim();

  if (asSpan) {
    return <span className={logoClass}>{content}</span>;
  }

  return (
    <Link to={href} className={logoClass}>
      {content}
    </Link>
  );
}
