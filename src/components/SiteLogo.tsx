import { Link } from 'react-router-dom';
import styles from './SiteLogo.module.css';

const LOGO_ICON = '/assets/icon-only-transparent.png';

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
          src={LOGO_ICON}
          alt=""
          className={styles.logoImg}
          width={44}
          height={44}
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
