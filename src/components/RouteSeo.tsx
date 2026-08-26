import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DOCS } from '../screens/docs/docContent';

const SITE = 'https://boing.express';
const HOME_TITLE = 'Boing Express — Non-Custodial Wallet for Boing Network | boing.express';
const HOME_DESC =
  'Boing Express is the official non-custodial wallet for Boing Network. Create or import a wallet, send and receive BOING, use the testnet faucet. The DeFi that always bounces back.';

function setNamedMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setPropertyMeta(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function seoForPath(pathname: string): { title: string; description: string; canonicalPath: string } {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/wallet' || path.startsWith('/wallet/')) {
    return {
      title: 'Wallet | Boing Express',
      description:
        'Create or import a non-custodial Boing Express wallet. Send and receive BOING on Boing Network.',
      canonicalPath: '/wallet',
    };
  }

  if (path === '/docs' || path.startsWith('/docs/')) {
    const slug = path === '/docs' ? 'getting-started' : path.slice('/docs/'.length);
    const doc = DOCS[slug];
    return {
      title: doc ? `${doc.title} | Boing Express Docs` : 'Docs | Boing Express',
      description:
        'Boing Express wallet documentation: getting started, security, browser extension, QA, and FAQ.',
      canonicalPath: path === '/docs' ? '/docs' : `/docs/${slug}`,
    };
  }

  if (path === '/privacy') {
    return {
      title: 'Privacy Policy | Boing Express',
      description: 'How Boing Express handles wallet data. Keys stay on your device — we do not custody funds.',
      canonicalPath: '/privacy',
    };
  }

  if (path === '/support') {
    return {
      title: 'Support | Boing Express',
      description: 'Get help with Boing Express, the official non-custodial wallet for Boing Network.',
      canonicalPath: '/support',
    };
  }

  if (path === '/terms') {
    return {
      title: 'Terms of Use | Boing Express',
      description: 'Terms of use for Boing Express, the official non-custodial wallet for Boing Network.',
      canonicalPath: '/terms',
    };
  }

  return {
    title: HOME_TITLE,
    description: HOME_DESC,
    canonicalPath: '/',
  };
}

/** Updates title, description, canonical, and social tags for the current SPA route. */
export function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const { title, description, canonicalPath } = seoForPath(pathname);
    const canonical = `${SITE}${canonicalPath}`;
    document.title = title;
    setNamedMeta('description', description);
    setCanonical(canonical);
    setPropertyMeta('og:url', canonical);
    setPropertyMeta('og:title', title);
    setPropertyMeta('og:description', description);
    setNamedMeta('twitter:url', canonical);
    setNamedMeta('twitter:title', title);
    setNamedMeta('twitter:description', description);
  }, [pathname]);

  return null;
}
