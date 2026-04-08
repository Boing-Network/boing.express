/**
 * Generate 16, 48, 128 PNG icons for the extension from extension/favicon.svg.
 * Run: node scripts/generate-extension-icons.js
 * Requires: pnpm add -D sharp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'extension', 'favicon.svg');
const dir = path.join(root, 'extension', 'icons');

const ICON_COLOR = '#00E5CC'; // Boing Network primary accent (Marketing Asset Package)

if (!fs.existsSync(svgPath)) {
  console.error('extension/favicon.svg not found');
  process.exit(1);
}

let svg = fs.readFileSync(svgPath, 'utf8');
// Legacy: extension favicon used currentColor; gradient SVGs ignore this replacement
svg = svg.replace(/currentColor/g, ICON_COLOR);
// Normalize SVG attributes for libvips (stroke-width → stroke-width is fine; some engines want lowercase)
const svgBuffer = Buffer.from(svg);

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const sizes = [16, 48, 128];

for (const size of sizes) {
  // Density: 32 is viewBox size; we want crisp output at size x size
  const density = Math.round((size / 32) * 72 * 2); // 2x for retina clarity
  const png = await sharp(svgBuffer, { density })
    .resize(size, size)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png);
}

console.log('Extension icons written to extension/icons/ (16, 48, 128 from favicon.svg)');
