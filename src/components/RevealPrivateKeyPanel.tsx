import { useEffect, useRef, useState } from 'react';
import { getStoredWallet, unlockWallet } from '../storage/walletStore';
import {
  REVEAL_AUTO_HIDE_MS,
  RevealError,
  createRevealSession,
  revealActivePrivateKeyHex,
  type RevealState,
} from '../security/revealPrivateKey';
import styles from '../screens/Dashboard.module.css';

/** Settings panel: password-gated, hidden-by-default, auto-clearing private key export. */
export function RevealPrivateKeyPanel() {
  const [password, setPassword] = useState('');
  const [state, setState] = useState<RevealState>({ keyHex: null, visible: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
    setCopied(false);
    setBusy(true);
    try {
      const hex = await revealActivePrivateKeyHex(password, {
        unlock: unlockWallet,
        expectedAddressHex: getStoredWallet()?.addressHex ?? null,
      });
      session.set(hex);
    } catch (err) {
      setError(err instanceof RevealError ? err.message : 'Could not reveal the key.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function copy() {
    if (!state.keyHex) return;
    try {
      await navigator.clipboard.writeText(state.keyHex);
      setCopied(true);
    } catch {
      setError('Copy failed. Select the key manually.');
    }
  }

  const seconds = Math.round(REVEAL_AUTO_HIDE_MS / 1000);
  return (
    <details className={styles.section} data-testid="reveal-private-key">
      <summary className={styles.sectionTitle}>Export private key</summary>
      <p className={styles.error} role="note">
        Anyone with this key controls this account and its funds. Never share it, paste it into a website, or send
        it to anyone (Boing will never ask). Use it only in tools you trust, such as the <code>boing</code> CLI
        (<code>BOING_SECRET_HEX</code>).
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
          />
          <button type="submit" className={styles.secondary} disabled={busy || !password}>
            {busy ? 'Checking…' : 'Reveal'}
          </button>
        </form>
      ) : (
        <div>
          <p className={styles.faucetHint}>Hidden automatically after {seconds} seconds or when you leave this tab.</p>
          <code
            style={{ display: 'block', wordBreak: 'break-all', userSelect: state.visible ? 'all' : 'none' }}
            aria-label="Private key"
          >
            {state.visible ? state.keyHex : '•'.repeat(64)}
          </code>
          <button type="button" className={styles.secondary} onClick={() => session.toggleVisible()}>
            {state.visible ? 'Hide' : 'Show'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => session.clear()}>
            Done
          </button>
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </details>
  );
}