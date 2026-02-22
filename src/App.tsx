import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { AnimatedBackground } from './components/AnimatedBackground';
import { InitialAnimation, hasSeenIntro } from './components/InitialAnimation';
import { WalletNav } from './components/WalletNav';
import { Landing } from './screens/Landing';
import { Welcome } from './screens/Welcome';
import { Dashboard } from './screens/Dashboard';
import { DocsLayout } from './screens/docs/DocsLayout';
import { DocPage } from './screens/docs/DocPage';
import { Privacy } from './screens/Privacy';
import { Terms } from './screens/Terms';
import { useWallet } from './context/WalletContext';

function WalletApp() {
  const { isUnlocked } = useWallet();
  return (
    <>
      <WalletNav />
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
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Page key for design-system color variant (data-page). */
function getPageKey(pathname: string): string {
  if (pathname === '/') return 'landing';
  if (pathname.startsWith('/wallet')) return 'wallet';
  if (pathname.startsWith('/docs')) return 'docs';
  if (pathname === '/privacy' || pathname === '/terms') return 'legal';
  return 'landing';
}

function AppShell() {
  const location = useLocation();
  const pageKey = getPageKey(location.pathname);
  const [introDone, setIntroDone] = useState(hasSeenIntro);
  const handleIntroComplete = useCallback(() => setIntroDone(true), []);

  return (
    <>
      <AnimatedBackground />
      <div data-page={pageKey} style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        <AppContent />
      </div>
      {!introDone && (
        <InitialAnimation onComplete={handleIntroComplete} />
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <AppShell />
      </WalletProvider>
    </BrowserRouter>
  );
}
