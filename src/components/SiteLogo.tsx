import { Link } from 'react-router-dom';
import styles from './SiteLogo.module.css';

type Props = {
  href?: string;
  className?: string;
  /** If true, render as span (non-link) for use inside another link */
  asSpan?: boolean;
};

export function SiteLogo({ href = '/', className, asSpan }: Props) {
  const content = (
    <>
      <img src="/favicon.svg" alt="" className={styles.logoIcon} width={28} height={28} />
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
