import { useEffect, useRef, useState } from 'react';
import { getActiveRecoveryInfo, unlockActiveRecoveryPhrase } from '../storage/walletStore';
import { REVEAL_AUTO_HIDE_MS, RevealError, createRevealSession, type RevealState } from '../security/revealPrivateKey';
import { revealActiveRecoveryPhrase } from '../security/revealRecoveryPhrase';
import { RecoveryPhraseGrid } from './RecoveryPhraseGrid';
import styles from '../screens/Dashboard.module.css';

/** Settings panel: password-gated, hidden-by-default, auto-clearing recovery phrase view. No copy button on purpose. */
export function RevealRecoveryPhrasePanel() {
  const info = getActiveRecoveryInfo();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<RevealState>({ keyHex: null, visible: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<ReturnType<typeof createRevealSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = createRevealSession(setState);
  const session = sessionRef.current;

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') session.clear();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      session.clear();
    };
  }, [session]);

  async function reveal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      session.set(await revealActiveRecoveryPhrase(password, { readPhrase: unlockActiveRecoveryPhrase }));
    } catch (err) {
      setError(err instanceof RevealError ? err.message : 'Could not show the recovery phrase.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  const seconds = Math.round(REVEAL_AUTO_HIDE_MS / 1000);
  return (
    <details className={styles.section} data-testid="reveal-recovery-phrase">
      <summary className={styles.sectionTitle}>Recovery phrase</summary>
      {!info ? (
        <p className={styles.faucetHint} data-testid="reveal-recovery-phrase-none">
          This account was set up with a private key, so it has no recovery phrase. Its private key (below) is its
          backup. To get a recovery phrase, add a new account and choose “Recovery phrase”.
        </p>
      ) : (
        <>
          <p className={styles.error} role="note">
            Anyone with these {info.words} words controls this account and its funds. Never type them into a website,
            share them, or send them to anyone (Boing will never ask). Write them on paper and keep them offline.
          </p>
          {!state.keyHex ? (
            <form onSubmit={(e) => void reveal(e)}>
              <input
                type="password"
                className={styles.input}
                placeholder="Wallet password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Wallet password"
                data-testid="reveal-phrase-password"
              />
              <button type="submit" className={styles.secondary} disabled={busy || !password} data-testid="reveal-phrase-submit">
                {busy ? 'Checking…' : 'Show phrase'}
              </button>
            </form>
          ) : (
            <div>
              <p className={styles.faucetHint}>Hidden automatically after {seconds} seconds or when you leave this tab.</p>
              <RecoveryPhraseGrid words={state.keyHex.split(' ')} hidden={!state.visible} />
              <button type="button" className={styles.secondary} onClick={() => session.toggleVisible()} data-testid="reveal-phrase-toggle">
                {state.visible ? 'Hide' : 'Show'}
              </button>
              <button type="button" className={styles.secondary} onClick={() => session.clear()}>
                Done
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </details>
  );
}
