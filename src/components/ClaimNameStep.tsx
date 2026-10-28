import { useEffect, useState } from 'react';
import { displayName, getNameInfo, normalizeName, rentFor, type NameInfo } from '../boing/names';
import styles from '../screens/Welcome.module.css';

export type ClaimNameStepProps = {
  rpcUrl: string;
  /** Called with the normalized label; the caller stores it as a pending claim and continues. */
  onReserve: (label: string) => void;
  onSkip: () => void;
  busy?: boolean;
  error?: string;
  mascotSrc?: string;
};

/** Optional "pick a .boing name" step after creating a wallet (web + extension). Claimed once funded. */
export function ClaimNameStep(p: ClaimNameStepProps) {
  const [wantName, setWantName] = useState('');
  const [nameCheck, setNameCheck] = useState<NameInfo | null>(null);
  const [namesLive, setNamesLive] = useState<boolean | null>(null);

  useEffect(() => {
    void getNameInfo(p.rpcUrl, 'boing')
      .then((i) => setNamesLive(Boolean(i?.registry?.enabled && i.registry.active)))
      .catch(() => setNamesLive(false));
  }, [p.rpcUrl]);

  useEffect(() => {
    setNameCheck(null);
    const v = normalizeName(wantName);
    if (!v.ok) return;
    let live = true;
    const t = window.setTimeout(() => {
      void getNameInfo(p.rpcUrl, v.label)
        .then((i) => {
          if (live) setNameCheck(i);
        })
        .catch(() => {});
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [wantName, p.rpcUrl]);

  const v = normalizeName(wantName);
  return (
    <div className={`${styles.card} ${styles.heroCard}`} data-testid="wallet-claim-name">
      <img src={p.mascotSrc ?? '/assets/mascot-default.webp'} alt="" className={styles.mascot} aria-hidden />
      <h1 className={styles.title}>Pick a name (optional)</h1>
      <p className={styles.subtitle}>
        Get a <strong>.boing</strong> name so friends can send to <em>you.boing</em> instead of a long address. It is claimed
        automatically once your wallet has BOING for the rent (6+ letters: 1 BOING a year). You can cancel it until then.
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
      {p.error && <p className={styles.error}>{p.error}</p>}
      <button
        type="button"
        className={styles.primary}
        data-testid="wallet-claim-name-reserve"
        disabled={p.busy || !v.ok || !nameCheck?.available || namesLive === false}
        onClick={() => v.ok && p.onReserve(v.label)}
      >
        {v.ok ? `Claim ${displayName(v.label)} after funding` : 'Claim after funding'}
      </button>
      <button type="button" className={styles.textBtn} data-testid="wallet-claim-name-skip" disabled={p.busy} onClick={p.onSkip}>
        Skip for now
      </button>
    </div>
  );
}