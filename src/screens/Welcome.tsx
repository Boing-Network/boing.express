import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import styles from './Welcome.module.css';

type Step = 'choose' | 'create' | 'import' | 'unlock';

export function Welcome() {
  const {
    hasWallet,
    storedAddressHint,
    unlock,
    createWallet,
    importWallet,
  } = useWallet();

  const [step, setStep] = useState<Step>(hasWallet ? 'unlock' : 'choose');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyHex, setPrivateKeyHex] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await createWallet(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const hex = privateKeyHex.replace(/\s/g, '').replace(/^0x/i, '');
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      setError('Private key must be 64 hex characters (32 bytes)');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await importWallet(password, hex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'choose') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>Boing Wallet</h1>
          <p className={styles.subtitle}>The DeFi that always bounces back. Non-custodial wallet for Boing Network.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setStep('create')}>
              Create wallet
            </button>
            <button type="button" className={styles.secondary} onClick={() => setStep('import')}>
              Import wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'unlock') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>Unlock wallet</h1>
          {storedAddressHint && (
            <p className={styles.hint}>Address: {storedAddressHint}</p>
          )}
          <form onSubmit={handleUnlock} className={styles.form}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
          <button type="button" className={styles.textBtn} onClick={() => setStep('choose')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>Create wallet</h1>
          <p className={styles.subtitle}>
            Generate a new Ed25519 keypair. Back up your key — we don’t store it on any server.
          </p>
          <form onSubmit={handleCreate} className={styles.form}>
            <input
              type="password"
              placeholder="Password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primary} disabled={loading}>
              {loading ? 'Creating…' : 'Create wallet'}
            </button>
          </form>
          <button type="button" className={styles.textBtn} onClick={() => setStep('choose')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // import
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>Import wallet</h1>
        <p className={styles.subtitle}>
          Enter your 64-character hex private key (32 bytes). It will be encrypted with your password.
        </p>
        <form onSubmit={handleImport} className={styles.form}>
          <textarea
            placeholder="0x... or 64 hex chars"
            value={privateKeyHex}
            onChange={(e) => setPrivateKeyHex(e.target.value)}
            className={styles.textarea}
            rows={3}
          />
          <input
            type="password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={styles.input}
            autoComplete="new-password"
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={loading}>
            {loading ? 'Importing…' : 'Import wallet'}
          </button>
        </form>
        <button type="button" className={styles.textBtn} onClick={() => setStep('choose')}>
          Back
        </button>
      </div>
    </div>
  );
}
