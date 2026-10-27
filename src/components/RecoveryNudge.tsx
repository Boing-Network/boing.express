import {
  RECOVERY_NUDGE_ACTION_LABEL,
  RECOVERY_NUDGE_DISMISS_LABEL,
  RECOVERY_NUDGE_TEXT,
  RECOVERY_NUDGE_TITLE,
} from '../boing/recoveryNudge';
import styles from '../screens/Dashboard.module.css';

/** Dismissible, plain-language tip shown to raw-private-key accounts about the recovery phrase option. */
export function RecoveryNudge({ onShow, onDismiss }: { onShow: () => void; onDismiss: () => void }) {
  return (
    <aside className={styles.networkDiscoveryBar} role="note" data-testid="recovery-nudge">
      <span>
        <strong>{RECOVERY_NUDGE_TITLE}</strong> {RECOVERY_NUDGE_TEXT}
      </span>
      <button type="button" className={styles.compatDismiss} onClick={onShow} data-testid="recovery-nudge-show">
        {RECOVERY_NUDGE_ACTION_LABEL}
      </button>
      <button
        type="button"
        className={styles.compatDismiss}
        onClick={onDismiss}
        aria-label={RECOVERY_NUDGE_DISMISS_LABEL}
        data-testid="recovery-nudge-dismiss"
      >
        Dismiss
      </button>
    </aside>
  );
}