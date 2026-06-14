import type { SiteHeaderLink } from '../components/SiteHeader';
import { CHROME_EXTENSION_STORE_URL } from './chromeExtension';

export const LEGAL_HEADER_LINKS: SiteHeaderLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Docs', to: '/docs' },
  { label: 'Wallet', to: '/wallet' },
  { label: 'Support', to: '/support' },
  { label: 'Terms', to: '/terms' },
];

export const SUPPORT_HEADER_LINKS: SiteHeaderLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Docs', to: '/docs' },
  { label: 'Wallet', to: '/wallet' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Terms', to: '/terms' },
];

export const DOCS_HEADER_LINKS: SiteHeaderLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Docs', to: '/docs', active: true },
  { label: 'Extension', href: CHROME_EXTENSION_STORE_URL, external: true },
  { label: 'Wallet', to: '/wallet' },
  { label: 'Support', to: '/support' },
];
