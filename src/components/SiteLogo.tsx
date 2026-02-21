import { Link } from 'react-router-dom';
import styles from './SiteLogo.module.css';

const LOGO_LIGHT = '/assets/logo-light-transparent.png'; // dark backgrounds (default)
const LOGO_DARK = '/assets/logo-dark-transparent.png';  // light backgrounds

type Props = {
  href?: string;
  className?: string;
  asSpan?: boolean;
};

export function SiteLogo({ href = '/', className, asSpan }: Props) {
  const content = (
    <>
      <span className={styles.logoImgWrap}>
        <img
          src={LOGO_LIGHT}
          alt=""
          className={styles.logoImg}
          width={140}
          height={32}
        />
        <img
          src={LOGO_DARK}
          alt=""
          className={styles.logoImgDark}
          width={140}
          height={32}
        />
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
