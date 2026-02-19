import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { AnimatedBackground } from './components/AnimatedBackground';
import { WalletNav } from './components/WalletNav';
import { Landing } from './screens/Landing';
import { Welcome } from './screens/Welcome';
import { Dashboard } from './screens/Dashboard';
import { DocsLayout } from './screens/docs/DocsLayout';
import { DocPage } from './screens/docs/DocPage';
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <AnimatedBackground />
        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
          <AppContent />
        </div>
      </WalletProvider>
    </BrowserRouter>
  );
}
