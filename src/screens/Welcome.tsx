import { useState, useEffect } from 'react';
import { useWallet } from '../context/WalletContext';
import styles from './Welcome.module.css';
import { displayName, getNameInfo, normalizeName, rentFor, type NameInfo } from '../boing/names';
import { setPendingName } from '../storage/pendingName';

export type WelcomeProps = {
  /** From dashboard while unlocked: open multi-account create/import flow */
  addAccountWhileUnlocked?: boolean;
  /** Close add-account flow and return to dashboard */
  onLeaveAddAccount?: () => void;
};

const ASSETS = '/assets';

const MASCOT_BY_STEP: Record<string, string> = {
  choose: 'mascot-excited.png',
  unlock: 'mascot-thinking.png',
  create: 'mascot-default.png',
  import: 'mascot-default.png',
  backup: 'mascot-default.png',
};

type Step = 'choose' | 'create' | 'import' | 'unlock' | 'backup' | 'claim-name' | 'add-pick';

/** When adding a 2+ account to an existing vault (web parity with extension). */
type AccountFlow = 'initial' | 'add-secondary';

export function Welcome({ addAccountWhileUnlocked = false, onLeaveAddAccount }: WelcomeProps = {}) {
  const {
    hasWallet,
    storedAddressHint,
    unlock,
    createWallet,
    importWallet,
    createAnotherAccount,
    importAnotherAccount,
    network,
  } = useWallet();

  const [step, setStep] = useState<Step>(() => (addAccountWhileUnlocked ? 'add-pick' : hasWallet ? 'unlock' : 'choose'));
  const [accountFlow, setAccountFlow] = useState<AccountFlow>(() => (addAccountWhileUnlocked ? 'add-secondary' : 'initial'));

  useEffect(() => {
    if (addAccountWhileUnlocked && !hasWallet) {
      onLeaveAddAccount?.();
    }
  }, [addAccountWhileUnlocked, hasWallet, onLeaveAddAccount]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyHex, setPrivateKeyHex] = useState('');
  const [backupKeyHex, setBackupKeyHex] = useState('');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [wantName, setWantName] = useState('');
  const [nameCheck, setNameCheck] = useState<NameInfo | null>(null);
  const [namesLive, setNamesLive] = useState<boolean | null>(null);

  useEffect(() => {
    if (step !== 'claim-name') return;
    void getNameInfo(network.config.rpcUrl, 'boing')
      .then((i) => setNamesLive(Boolean(i?.registry?.enabled && i.registry.active)))
      .catch(() => setNamesLive(false));
  }, [step, network.config.rpcUrl]);

  useEffect(() => {
    setNameCheck(null);
    const v = normalizeName(wantName);
    if (step !== 'claim-name' || !v.ok) return;
    let live = true;
    const t = window.setTimeout(() => {
      void getNameInfo(network.config.rpcUrl, v.label)
        .then((i) => {
          if (live) setNameCheck(i);
        })
        .catch(() => {});
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [wantName, step, network.config.rpcUrl]);

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
    if (step === 'backup' && accountFlow === 'initial' && !addAccountWhileUnlocked) {
      setError('');
      setStep('claim-name');
      return;
    }
    await finishCreate();
  }

  async function finishCreate() {
    setError('');
    setLoading(true);
    try {
      await unlock(password);
      setAccountFlow('initial');
      if (addAccountWhileUnlocked) {
        onLeaveAddAccount?.();
      }
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
        if (addAccountWhileUnlocked) {
          onLeaveAddAccount?.();
        }
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
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`}>
          <img src={`${ASSETS}/${MASCOT_BY_STEP.choose}`} alt="" className={styles.mascot} aria-hidden />
          <h1 className={styles.title}>Welcome to Boing Express</h1>
          <p className={styles.subtitle}>Your non-custodial wallet for Boing Network</p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.primary} ${styles.heroPrimary}`} data-testid="wallet-landing-create" onClick={() => setStep('create')}>
              Create New Wallet
            </button>
            <button type="button" className={`${styles.secondary} ${styles.heroSecondary}`} data-testid="wallet-landing-import" onClick={() => setStep('import')}>
              Import Existing Wallet
            </button>
          </div>
          <p className={styles.keysNote} data-testid="wallet-keys-note">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Your keys never leave your device
          </p>
        </div>
      </div>
    );
  }

  if (step === 'unlock') {
    return (
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`}>
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
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`}>
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
              if (addAccountWhileUnlocked && onLeaveAddAccount) {
                onLeaveAddAccount();
                return;
              }
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
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`}>
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

  if (step === 'claim-name') {
    const v = normalizeName(wantName);
    return (
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`} data-testid="wallet-claim-name">
          <img src={`${ASSETS}/${MASCOT_BY_STEP.create}`} alt="" className={styles.mascot} aria-hidden />
          <h1 className={styles.title}>Pick a name (optional)</h1>
          <p className={styles.subtitle}>
            Get a <strong>.boing</strong> name so friends can send to <em>you.boing</em> instead of a long address. It is claimed
            automatically once your wallet has BOING for the rent (6+ letters: 1 BOING a year).
          </p>
          {namesLive === false && <p className={styles.subtitle}>Names are not live on this network yet. You can skip for now.</p>}
          <input
            type="text"
            className={styles.input}
            placeholder="yourname"
            value={wantName}
            onChange={(e) => setWantName(e.target.value)}
            aria-label="Name to claim"
            data-testid="wallet-claim-name-input"
            autoCapitalize="none"
            spellCheck={false}
          />
          {wantName.trim() && !v.ok && <p className={styles.error}>{v.error}</p>}
          {v.ok && nameCheck && (
            <p className={nameCheck.available ? styles.nameOk : styles.error} data-testid="wallet-claim-name-status">
              {nameCheck.available
                ? `${displayName(v.label)} is available: ${rentFor(v.label, 1).toString()} BOING / year`
                : nameCheck.reserved
                  ? `${displayName(v.label)} is reserved`
                  : `${displayName(v.label)} is taken`}
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.primary}
            data-testid="wallet-claim-name-reserve"
            disabled={loading || !v.ok || !nameCheck?.available || namesLive === false}
            onClick={() => {
              if (!v.ok) return;
              setPendingName({ name: v.label, createdAt: Date.now() });
              void finishCreate();
            }}
          >
            {v.ok ? `Claim ${displayName(v.label)} after funding` : 'Claim after funding'}
          </button>
          <button type="button" className={styles.textBtn} data-testid="wallet-claim-name-skip" disabled={loading} onClick={() => void finishCreate()}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
        <div className={`${styles.card} ${styles.heroCard}`}>
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
    <div className={`${styles.wrap} ${styles.heroWrap} page-app`}>
      <div className={`${styles.card} ${styles.heroCard}`}>
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
