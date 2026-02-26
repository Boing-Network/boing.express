import { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import styles from './Welcome.module.css';

const ASSETS = '/assets';

const MASCOT_BY_STEP: Record<string, string> = {
  choose: 'mascot-excited.png',
  unlock: 'mascot-thinking.png',
  create: 'mascot-default.png',
  import: 'mascot-default.png',
  backup: 'mascot-default.png',
};

type Step = 'choose' | 'create' | 'import' | 'unlock' | 'backup';

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
  const [backupKeyHex, setBackupKeyHex] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

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
      const { privateKeyHex: keyHex } = await createWallet(password);
      setBackupKeyHex(keyHex);
      setStep('backup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  }

  async function handleBackupContinue() {
    setError('');
    setLoading(true);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock');
    } finally {
      setLoading(false);
    }
  }

  async function copyBackupKey() {
    if (!backupKeyHex) return;
    await navigator.clipboard.writeText(backupKeyHex);
    setCopiedBackup(true);
    setTimeout(() => setCopiedBackup(false), 2000);
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
      <div className={`${styles.wrap} page-app`}>
        <div className={styles.card}>
          <img src={`${ASSETS}/${MASCOT_BY_STEP.choose}`} alt="" className={styles.mascot} aria-hidden />
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
      <div className={`${styles.wrap} page-app`}>
        <div className={styles.card}>
          <img src={`${ASSETS}/${MASCOT_BY_STEP.unlock}`} alt="" className={styles.mascot} aria-hidden />
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

  if (step === 'backup') {
    return (
      <div className={`${styles.wrap} page-app`}>
        <div className={styles.card}>
          <img src={`${ASSETS}/${MASCOT_BY_STEP.backup}`} alt="" className={styles.mascot} aria-hidden />
          <h1 className={styles.title}>Back up your private key</h1>
          <p className={styles.subtitle}>
            Save this key in a safe place. Anyone with it can control your wallet. You won’t see it again here.
          </p>
          <div className={styles.backupKeyWrap}>
            <code className={styles.backupKey}>{backupKeyHex}</code>
            <button type="button" className={styles.copyBtn} onClick={copyBackupKey}>
              {copiedBackup ? 'Copied' : 'Copy'}
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.primary}
            onClick={handleBackupContinue}
            disabled={loading}
          >
            {loading ? 'Unlocking…' : "I've backed it up — Continue"}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className={`${styles.wrap} page-app`}>
        <div className={styles.card}>
          <img src={`${ASSETS}/${MASCOT_BY_STEP.create}`} alt="" className={styles.mascot} aria-hidden />
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
    <div className={`${styles.wrap} page-app`}>
      <div className={styles.card}>
        <img src={`${ASSETS}/${MASCOT_BY_STEP.import}`} alt="" className={styles.mascot} aria-hidden />
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
