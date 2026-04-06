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

type Step = 'choose' | 'create' | 'import' | 'unlock' | 'backup' | 'add-pick';

/** When adding a 2+ account to an existing vault (web parity with extension). */
type AccountFlow = 'initial' | 'add-secondary';

export function Welcome() {
  const {
    hasWallet,
    storedAddressHint,
    unlock,
    createWallet,
    importWallet,
    createAnotherAccount,
    importAnotherAccount,
  } = useWallet();

  const [step, setStep] = useState<Step>(hasWallet ? 'unlock' : 'choose');
  const [accountFlow, setAccountFlow] = useState<AccountFlow>('initial');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyHex, setPrivateKeyHex] = useState('');
  const [backupKeyHex, setBackupKeyHex] = useState('');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
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
      const { privateKeyHex: keyHex } =
        accountFlow === 'add-secondary' ? await createAnotherAccount(password) : await createWallet(password);
      setBackupKeyHex(keyHex);
      setStep('backup');
      setBackupAcknowledged(false);
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
      setAccountFlow('initial');
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
      if (accountFlow === 'add-secondary') {
        await importAnotherAccount(password, hex);
        setAccountFlow('initial');
      } else {
        await importWallet(password, hex);
      }
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
            <button type="button" className={styles.primary} data-testid="wallet-landing-create" onClick={() => setStep('create')}>
              Create wallet
            </button>
            <button type="button" className={styles.secondary} data-testid="wallet-landing-import" onClick={() => setStep('import')}>
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
              data-testid="wallet-unlock-password"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primary} disabled={loading} data-testid="wallet-unlock-submit">
              {loading ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
          {hasWallet && (
            <button
              type="button"
              className={`${styles.secondary} ${styles.secondaryFullWidth}`}
              data-testid="wallet-unlock-add-account"
              onClick={() => {
                setError('');
                setAccountFlow('add-secondary');
                setStep('add-pick');
              }}
            >
              Add another account
            </button>
          )}
          {!hasWallet && (
            <button type="button" className={styles.textBtn} onClick={() => setStep('choose')}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === 'add-pick') {
    return (
      <div className={`${styles.wrap} page-app`}>
        <div className={styles.card}>
          <img src={`${ASSETS}/mascot-default.png`} alt="" className={styles.mascot} aria-hidden />
          <h1 className={styles.title}>Add another account</h1>
          <p className={styles.subtitle}>
            New keys are encrypted with your password and stored alongside your existing wallet. Use Boing Express on
            desktop for the same multi-account vault.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} data-testid="wallet-add-pick-create" onClick={() => setStep('create')}>
              Create new keypair
            </button>
            <button type="button" className={styles.secondary} data-testid="wallet-add-pick-import" onClick={() => setStep('import')}>
              Import private key
            </button>
          </div>
          <button
            type="button"
            className={styles.textBtn}
            data-testid="wallet-add-pick-back"
            onClick={() => {
              setAccountFlow('initial');
              setStep('unlock');
            }}
          >
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
          <label className={styles.checkboxWrap}>
            <input
              type="checkbox"
              checked={backupAcknowledged}
              onChange={(e) => setBackupAcknowledged(e.target.checked)}
              className={styles.checkbox}
              data-testid="wallet-backup-ack"
            />
            <span>I have saved my private key in a safe place</span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.primary}
            data-testid="wallet-backup-continue"
            onClick={handleBackupContinue}
            disabled={loading || !backupAcknowledged}
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
          <h1 className={styles.title}>{accountFlow === 'add-secondary' ? 'Create another account' : 'Create wallet'}</h1>
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
              data-testid="wallet-create-password"
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
              data-testid="wallet-create-password-confirm"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primary} disabled={loading} data-testid="wallet-create-submit">
              {loading ? 'Creating…' : accountFlow === 'add-secondary' ? 'Create account' : 'Create wallet'}
            </button>
          </form>
          <button
            type="button"
            className={styles.textBtn}
            onClick={() => setStep(accountFlow === 'add-secondary' ? 'add-pick' : 'choose')}
          >
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
        <h1 className={styles.title}>{accountFlow === 'add-secondary' ? 'Import another account' : 'Import wallet'}</h1>
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
            data-testid="wallet-import-key"
          />
          <input
            type="password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            autoComplete="new-password"
            data-testid="wallet-import-password"
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={styles.input}
            autoComplete="new-password"
            data-testid="wallet-import-password-confirm"
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={loading} data-testid="wallet-import-submit">
            {loading ? 'Importing…' : accountFlow === 'add-secondary' ? 'Import account' : 'Import wallet'}
          </button>
        </form>
        <button
          type="button"
          className={styles.textBtn}
          onClick={() => setStep(accountFlow === 'add-secondary' ? 'add-pick' : 'choose')}
        >
          Back
        </button>
      </div>
    </div>
  );
}
