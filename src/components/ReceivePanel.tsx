import { useState } from 'react';
import { qrSvgPath, shortAddress } from '../boing/qr';
import styles from './ReceivePanel.module.css';

/** Receive: QR of the address (plain 0x… hex, which every Boing wallet and the scanner accept), copy, hint. */
export function ReceivePanel(props: { address: string; onBack?: () => void; symbol?: string }) {
  const addr = props.address.startsWith('0x') ? props.address : `0x${props.address}`;
  const { d, size } = qrSvgPath(addr);
  const [copied, setCopied] = useState(false);
  const pad = 2;
  return (
    <section className={styles.card} data-testid="receive-panel" aria-label="Receive">
      {props.onBack && (
        <button type="button" className={styles.back} onClick={props.onBack} aria-label="Back" data-testid="receive-back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <h2 className={styles.title}>Receive {props.symbol ?? 'BOING'}</h2>
      <div className={styles.qrWrap}>
        <svg
          className={styles.qr}
          viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`QR code for ${addr}`}
          data-testid="receive-qr"
          data-value={addr}
        >
          <rect x={-pad} y={-pad} width={size + pad * 2} height={size + pad * 2} fill="#04111f" />
          <path d={d} fill="#22e5ff" />
        </svg>
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
      <p className={styles.hint}>Share this address to receive {props.symbol ?? 'BOING'} tokens (and Boing tokens or NFTs).</p>
    </section>
  );
}
