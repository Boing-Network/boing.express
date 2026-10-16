import { useEffect, useState } from 'react';
import { shortAddress } from '../boing/qr';
import { AddressQr } from './AddressQr';
import styles from './ReceivePanel.module.css';

/** Header QR sheet: address QR (with mascot), short address, Copy Address. Closes on ×, backdrop or Escape. */
export function AddressQrModal(props: { address: string; onClose: () => void; logoSrc?: string; inline?: boolean }) {
  const addr = props.address.startsWith('0x') ? props.address : `0x${props.address}`;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  const card = (
    <section className={styles.card} role="dialog" aria-modal="true" aria-label="Your address QR code" data-testid="address-qr-modal" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={styles.close} onClick={props.onClose} aria-label="Close" data-testid="address-qr-close">
        ×
      </button>
      <h2 className={styles.title}>Your address</h2>
      <div className={styles.qrWrap}>
        <AddressQr value={addr} className={styles.qr} logoSrc={props.logoSrc} />
      </div>
      <code className={styles.address} title={addr} data-testid="receive-address">
        {shortAddress(addr, 8, 6)}
      </code>
      <button
        type="button"
        className={styles.copy}
        data-testid="receive-copy"
        onClick={async () => {
          await navigator.clipboard.writeText(addr);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy Address'}
      </button>
      <p className={styles.hint}>Share this address to receive BOING, Boing tokens or NFTs.</p>
    </section>
  );
  if (props.inline) return card;
  return (
    <div className={styles.backdrop} onClick={props.onClose} data-testid="address-qr-backdrop">
      {card}
    </div>
  );
}