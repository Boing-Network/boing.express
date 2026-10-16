import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { qrLogoBox, qrMatrix, qrSvgPath, QR_LOGO_FRACTION } from '../src/boing/qr';

const ADDRS = ['0x' + 'ab'.repeat(32), '0x' + '0f'.repeat(32), '0x54857e0a7cbb53eda094053a9a6c84775a5051a1fad2df3951fb17d9642072a4'];

/** Rasterise like AddressQr: cyan-on-navy (inverted), 2-module quiet zone, logo box painted by `fillLogo`. */
function raster(text: string, fillLogo: (r: number, c: number) => boolean, scale = 6) {
  const m = qrMatrix(text, 'H');
  const n = m.length;
  const box = qrLogoBox(n);
  const pad = 2;
  const W = (n + pad * 2) * scale;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.floor(y / scale) - pad;
      const c = Math.floor(x / scale) - pad;
      let fg = r >= 0 && c >= 0 && r < n && c < n && m[r]![c]!;
      if (r >= box.y && r < box.y + box.w && c >= box.x && c < box.x + box.w) fg = fillLogo(r, c);
      const i = (y * W + x) * 4;
      const [R, G, B] = fg ? [0x22, 0xe5, 0xff] : [0x04, 0x11, 0x1f];
      data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = 255;
    }
  }
  return { data, W, n, box };
}

describe('QR with centre mascot (level H)', () => {
  it('logo box stays at or under 20% of the width and is centred', () => {
    for (const a of ADDRS) {
      const { size, logo } = qrSvgPath(a);
      expect(logo).not.toBeNull();
      expect(logo!.w / size).toBeLessThanOrEqual(QR_LOGO_FRACTION);
      expect(logo!.w).toBeGreaterThan(0);
      expect(logo!.x * 2 + logo!.w).toBe(size);
    }
  });

  it('decodes with the dark backing over the centre', () => {
    for (const a of ADDRS) {
      const { data, W } = raster(a, () => false);
      expect(jsQR(data, W, W)?.data).toBe(a);
    }
  });

  it('decodes even if the logo area is pure noise (worst-case mascot pixels)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) > 0.5;
    for (const a of ADDRS) {
      const { data, W } = raster(a, () => rnd());
      expect(jsQR(data, W, W)?.data).toBe(a);
    }
  });
});