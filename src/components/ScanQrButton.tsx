import { useState } from 'react';
import { QrScanner } from './QrScanner';

/** Small "Scan QR" button for a recipient field; opens the scanner inline (web) or calls `onExternal` (extension). */
export function ScanQrButton(props: { onResult: (addr: string) => void; testId: string; className?: string; onExternal?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={props.className}
        aria-label="Scan recipient QR code"
        title="Scan QR"
        data-testid={props.testId}
        onClick={() => (props.onExternal ? props.onExternal() : setOpen(true))}
        style={{ whiteSpace: 'nowrap' }}
      >
        Scan QR
      </button>
      {open && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <QrScanner
              onClose={() => setOpen(false)}
              onResult={(a) => {
                setOpen(false);
                props.onResult(a);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
