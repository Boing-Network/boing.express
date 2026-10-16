/**
 * QR helpers. Encoding uses `qrcode-generator` (MIT, ~20 KB, no dependencies) and renders to an SVG path,
 * so no canvas or network is involved. Decoding (scan) lives in `QrScanner.tsx`.
 */
import qrcode from 'qrcode-generator';

/** SVG `d` path (one unit per module) + module count for `text`, error correction M. */
export function qrSvgPath(text: string): { d: string; size: number } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { d, size: n };
}

/**
 * Pull a Boing address (64 hex) out of scanned QR text: raw hex, `0x…`, `boing:0x…?amount=…`, or a URL that
 * contains one (e.g. an Observer account link). Returns `0x` + lowercase hex, or null.
 */
export function parseScannedAddress(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/(?:^|[^0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/);
  return m ? `0x${m[1]!.toLowerCase()}` : null;
}

/** `0x1234…abcd` */
export function shortAddress(hex: string, head = 6, tail = 4): string {
  const h = hex.replace(/^0x/i, '');
  return h.length <= head + tail ? `0x${h}` : `0x${h.slice(0, head)}…${h.slice(-tail)}`;
}
