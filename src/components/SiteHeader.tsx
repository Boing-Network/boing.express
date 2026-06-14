import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteLogo } from './SiteLogo';
import styles from './SiteHeader.module.css';

export type SiteHeaderLink = {
  label: string;
  to?: string;
  href?: string;
  active?: boolean;
  variant?: 'default' | 'cta';
  external?: boolean;
};

type Props = {
  links: SiteHeaderLink[];
};

function NavLink({ link, className, onNavigate }: { link: SiteHeaderLink; className: string; onNavigate?: () => void }) {
  const activeClass = link.active ? styles.active : '';
  const variantClass = link.variant === 'cta' ? styles.cta : '';
  const combined = `${className} ${activeClass} ${variantClass}`.trim();

  if (link.href) {
    return (
      <a
        href={link.href}
        className={combined}
        target={link.external !== false ? '_blank' : undefined}
        rel={link.external !== false ? 'noopener noreferrer' : undefined}
        onClick={onNavigate}
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link to={link.to ?? '/'} className={combined} onClick={onNavigate}>
      {link.label}
    </Link>
  );
}

export function SiteHeader({ links }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    closeMenu();
  }, [location.pathname, closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, closeMenu]);

  return (
    <>
      <header className={styles.header}>
        <SiteLogo className={styles.logoWrap} compact />
        <nav className={styles.navDesktop} aria-label="Main navigation">
          {links.map((link) => (
            <NavLink key={link.label} link={link} className="" />
          ))}
        </nav>
        <button
          type="button"
          className={styles.menuBtn}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? (
            <svg className={styles.menuIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className={styles.menuIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </header>
      <nav
        id={menuId}
        className={`${styles.navMobile} ${menuOpen ? styles.navMobileOpen : ''}`}
        aria-label="Mobile navigation"
        hidden={!menuOpen}
      >
        {links.map((link) => (
          <NavLink key={link.label} link={link} className="" onNavigate={closeMenu} />
        ))}
      </nav>
    </>
  );
}
