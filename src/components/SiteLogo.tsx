import { Link } from 'react-router-dom';
import { LogoMark } from './LogoMark';
import styles from './SiteLogo.module.css';

type Props = {
  href?: string;
  className?: string;
  asSpan?: boolean;
};

export function SiteLogo({ href = '/', className, asSpan }: Props) {
  const content = (
    <>
      <span className={styles.logoImgWrap}>
        <LogoMark className={styles.logoMark} size={44} />
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
