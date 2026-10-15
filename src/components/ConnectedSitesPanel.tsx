import { useCallback, useEffect, useState } from 'react';
import { createConnectedSitesStore, type WebConnectedSite } from '../boing/webSigning';
import styles from '../screens/Dashboard.module.css';

/** Settings: origins approved through the web signing flow (/connect). Disconnecting revokes signing for that site. */
export function ConnectedSitesPanel() {
  const [sites, setSites] = useState<Array<[string, WebConnectedSite]>>([]);
  const reload = useCallback(() => {
    try {
      setSites(Object.entries(createConnectedSitesStore(window.localStorage).list()).sort((a, b) => b[1].connectedAt - a[1].connectedAt));
    } catch {
      setSites([]);
    }
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [reload]);

  return (
    <section className={styles.section} data-testid="settings-connected-sites">
      <h2 className={styles.sectionTitle}>Connected sites</h2>
      <p className={styles.faucetHint}>Sites that can see your address and request signatures through boing.express.</p>
      {sites.length === 0 ? (
        <p className={styles.addressHint} data-testid="connected-sites-empty">No sites connected.</p>
      ) : (
        <ul className={styles.txHistoryList} aria-label="Connected sites" data-testid="connected-sites-list">
          {sites.map(([origin, s]) => (
            <li key={origin} className={styles.txHistoryItem} data-testid="connected-site-row">
              <span className={styles.connectedOrigin} title={`Account ${s.account} · chain ${s.chainId}`}>
                {origin}
              </span>
              <button
                type="button"
                className={styles.copyBtn}
                aria-label={`Disconnect ${origin}`}
                onClick={() => {
                  createConnectedSitesStore(window.localStorage).remove(origin);
                  reload();
                }}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
