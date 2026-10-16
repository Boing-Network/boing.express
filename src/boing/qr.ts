/**
 * QR helpers. Encoding uses `qrcode-generator` (MIT, ~20 KB, no dependencies) and renders to an SVG path,
 * so no canvas or network is involved. Decoding (scan) lives in `QrScanner.tsx`.
 */
import qrcode from 'qrcode-generator';

/** Largest share of the module area's width the centre logo (incl. its backing) may take. */
export const QR_LOGO_FRACTION = 0.2;

export type QrLogoBox = { x: number; y: number; w: number };

/**
 * Centre square for the logo, in module units. Width = floor(size × 0.2), forced odd so it sits symmetrically,
 * so it always stays at or under 20% of the code's width. Level H restores up to ~30% damaged codewords.
 */
export function qrLogoBox(size: number, fraction = QR_LOGO_FRACTION): QrLogoBox {
  let w = Math.floor(size * fraction);
  if (w % 2 === 0) w -= 1;
  w = Math.max(w, 0);
  const x = (size - w) / 2;
  return { x, y: x, w };
}

/** Module matrix (true = dark) for `text`. */
export function qrMatrix(text: string, ec: 'L' | 'M' | 'Q' | 'H' = 'H'): boolean[][] {
  const qr = qrcode(0, ec);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * SVG `d` path (one unit per module) + module count for `text`. Error correction H by default; with `logo`
 * (default true) modules under the centre logo box are left out and the box is returned for the backing + mascot.
 */
export function qrSvgPath(
  text: string,
  opts: { ec?: 'L' | 'M' | 'Q' | 'H'; logo?: boolean } = {}
): { d: string; size: number; logo: QrLogoBox | null } {
  const m = qrMatrix(text, opts.ec ?? 'H');
  const n = m.length;
  const logo = opts.logo === false ? null : qrLogoBox(n);
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (logo && r >= logo.y && r < logo.y + logo.w && c >= logo.x && c < logo.x + logo.w) continue;
      if (m[r]![c]) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { d, size: n, logo };
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
