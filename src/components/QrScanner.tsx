import { useEffect, useRef, useState } from 'react';
import { parseScannedAddress } from '../boing/qr';
import styles from './ReceivePanel.module.css';

type Detector = { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };

function nativeDetector(): Detector | null {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try {
    return BD ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** Decode a QR from an image file: BarcodeDetector when present, else jsQR (loaded on demand, ~40 KB). */
export async function decodeQrFromFile(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const det = nativeDetector();
  if (det) {
    const r = await det.detect(bmp);
    if (r[0]?.rawValue) return r[0].rawValue;
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { default: jsQR } = await import('jsqr');
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

/**
 * Scan a recipient QR. Camera path: getUserMedia + BarcodeDetector (Chrome, Edge, Android). Fallback (no camera,
 * permission denied, or no BarcodeDetector): pick or take a photo, decoded locally. Nothing leaves the device.
 */
export function QrScanner(props: { onResult: (addressHex: string) => void; onClose: () => void; standalone?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const det = useRef<Detector | null>(nativeDetector());

  function accept(raw: string | null): boolean {
    const a = raw ? parseScannedAddress(raw) : null;
    if (a) {
      props.onResult(a);
      return true;
    }
    setError(raw ? 'That QR code does not contain a Boing address (64 hex characters).' : 'No QR code found in that image.');
    return false;
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    async function start() {
      if (!det.current || !navigator.mediaDevices?.getUserMedia) {
        setStatus('Camera scanning is not supported in this browser. Upload a photo of the QR code instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        setStatus('Camera unavailable or permission denied. Upload a photo of the QR code instead.');
        return;
      }
      if (stopped || !videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
      setCameraOn(true);
      setStatus('Point the camera at a Boing address QR code.');
      const tick = async () => {
        if (stopped || !videoRef.current || !det.current) return;
        try {
          const r = await det.current.detect(videoRef.current);
          const raw = r[0]?.rawValue;
          if (raw && parseScannedAddress(raw)) {
            accept(raw);
            return;
          }
        } catch {
          /* frame not ready */
        }
        raf = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    }
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={styles.card} data-testid="qr-scanner" aria-label="Scan QR code">
      {!props.standalone && (
        <button type="button" className={styles.back} onClick={props.onClose} aria-label="Close scanner" data-testid="qr-scan-close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <h2 className={styles.title}>Scan QR</h2>
      <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 320, borderRadius: 12, display: cameraOn ? 'block' : 'none', margin: '0 auto 10px' }} />
      {status && <p className={styles.hint} data-testid="qr-scan-status">{status}</p>}
      <label className={styles.copy} style={{ display: 'block', marginTop: 12 }}>
        Upload QR image
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          data-testid="qr-scan-upload"
          onChange={async (e) => {
            setError('');
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              accept(await decodeQrFromFile(f));
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
            e.target.value = '';
          }}
        />
      </label>
      {error && (
        <p className={styles.hint} style={{ color: '#ff8a8a' }} role="alert" data-testid="qr-scan-error">
          {error}
        </p>
      )}
    </section>
  );
}
