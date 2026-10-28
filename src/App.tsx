import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { EngraveSceneBackdrop } from './components/EngravingBackdrop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InitialAnimation } from './components/InitialAnimation';
import { RouteSeo } from './components/RouteSeo';
import { CollaborationBanner } from './components/CollaborationBanner';
import styles from './App.module.css';
import { WalletNav } from './components/WalletNav';
import { Landing } from './screens/Landing';
import { Welcome } from './screens/Welcome';
import { Dashboard } from './screens/Dashboard';
import { DocsLayout } from './screens/docs/DocsLayout';
import { DocPage } from './screens/docs/DocPage';
import { Privacy } from './screens/Privacy';
import { Support } from './screens/Support';
import { Terms } from './screens/Terms';
import { WebSign } from './screens/WebSign';
import { NotFound } from './screens/NotFound';
import { useWallet } from './context/WalletContext';

function WalletApp() {
  const { isUnlocked } = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const pathNorm = (location.pathname.replace(/\/+$/, '') || '/') as string;
  const addAccountRoute = pathNorm === '/wallet/add-account';

  const showTopNav = !isUnlocked || addAccountRoute;

  if (!isUnlocked && addAccountRoute) {
    return (
      <>
        <WalletNav />
        <Navigate to="/wallet" replace />
      </>
    );
  }

  if (isUnlocked && addAccountRoute) {
    return (
      <>
        <WalletNav />
        <Welcome
          addAccountWhileUnlocked
          onLeaveAddAccount={() => navigate('/wallet', { replace: true })}
        />
      </>
    );
  }

  return (
    <>
      {showTopNav ? <WalletNav /> : null}
      {isUnlocked ? <Dashboard /> : <Welcome />}
    </>
  );
}

function AppContent() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/wallet/*" element={<WalletApp />} />
      <Route path="/docs" element={<DocsLayout />}>
        <Route index element={<DocPage slug="getting-started" />} />
        <Route path=":slug" element={<DocPage />} />
      </Route>
      <Route path="/connect" element={<WebSign />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/support" element={<Support />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** Page key for design-system color variant (data-page). */
function getPageKey(pathname: string): string {
  if (pathname === '/') return 'landing';
  if (pathname.startsWith('/wallet')) return 'wallet';
  if (pathname.startsWith('/docs')) return 'docs';
  if (pathname === '/privacy' || pathname === '/support' || pathname === '/terms') return 'legal';
  return 'landing';
}

const INTRO_SEEN_KEY = 'boing-express:intro-seen';

function shouldSkipIntro(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* storage unavailable (private mode): the intro simply plays again next load */
  }
}

function AppShell() {
  const location = useLocation();
  const pageKey = getPageKey(location.pathname);
  // The intro plays once per browser session. It is skipped for the web signing page (/connect), which must
  // never sit behind an animation, and for visitors who prefer reduced motion.
  const [introDone, setIntroDone] = useState(
    () => location.pathname.startsWith('/connect') || shouldSkipIntro(),
  );
  const handleIntroComplete = useCallback(() => {
    markIntroSeen();
    setIntroDone(true);
  }, []);

  /* Colosseum-style stone + engraved vein + neon; intro overlays until complete. */
  return (
    <>
      <div className={styles.pageWrap} data-page={pageKey}>
        <EngraveSceneBackdrop />
        <RouteSeo />
        <div
          className={introDone ? styles.appEntrance : styles.appContentAwaitingIntro}
          style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}
          aria-hidden={!introDone}
          {...(!introDone ? { inert: true } : {})}
        >
          <CollaborationBanner />
          <AppContent />
        </div>
      </div>
      {!introDone ? <InitialAnimation onComplete={handleIntroComplete} /> : null}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <WalletProvider>
          <AppShell />
        </WalletProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
