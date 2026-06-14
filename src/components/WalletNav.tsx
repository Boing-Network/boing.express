import { SiteHeader, type SiteHeaderLink } from './SiteHeader';
import { CHROME_EXTENSION_STORE_URL } from '../constants/chromeExtension';

const LINKS: SiteHeaderLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Docs', to: '/docs' },
  { label: 'Extension', href: CHROME_EXTENSION_STORE_URL, external: true },
  { label: 'Wallet', to: '/wallet', active: true },
];

export function WalletNav() {
  return <SiteHeader links={LINKS} />;
}
