/**
 * Extension toolbar/store icons (16, 32, 48, 128) for the "Arc Slab" mark.
 * 16 + 32 px come from the simplified extension/favicon.svg (32 grid, heavier strokes);
 * 48 + 128 px come from the full mark extension/logo-mark.svg (copy of public/assets/boing-express-mark.svg).
 * Run: node scripts/generate-extension-icons.js (part of build:extension).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const smallSvg = path.join(root, 'extension', 'favicon.svg');
const markSvg = path.join(root, 'extension', 'logo-mark.svg');
const brandMark = path.join(root, 'public', 'assets', 'boing-express-mark.svg');
const dir = path.join(root, 'extension', 'icons');

for (const p of [smallSvg, markSvg]) {
  if (!fs.existsSync(p)) {
    console.error(`${path.relative(root, p)} not found`);
    process.exit(1);
  }
}
if (fs.existsSync(brandMark) && fs.readFileSync(brandMark, 'utf8') !== fs.readFileSync(markSvg, 'utf8')) {
  console.warn('warning: extension/logo-mark.svg differs from public/assets/boing-express-mark.svg');
}
fs.mkdirSync(dir, { recursive: true });

const targets = [
  [16, smallSvg, 32],
  [32, smallSvg, 32],
  [48, markSvg, 64],
  [128, markSvg, 64],
];

for (const [size, src, viewBox] of targets) {
  // Rasterize at 4x the target, then downsample: crisp edges, stable output.
  const density = Math.round(((size * 4) / viewBox) * 72);
  const png = await sharp(fs.readFileSync(src), { density })
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png);
}

console.log('Extension icons written to extension/icons/ (16/32 from favicon.svg, 48/128 from logo-mark.svg)');
