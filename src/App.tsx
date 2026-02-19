import { WalletProvider } from './context/WalletContext';
import { Welcome } from './screens/Welcome';
import { Dashboard } from './screens/Dashboard';
import { useWallet } from './context/WalletContext';

function AppContent() {
  const { isUnlocked } = useWallet();
  return isUnlocked ? <Dashboard /> : <Welcome />;
}

export default function App() {
  return (
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  );
}
