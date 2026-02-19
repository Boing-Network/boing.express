/**
 * Generate 16, 48, 128 PNG icons for the extension.
 * Run: node scripts/generate-extension-icons.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'extension', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const minimalPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmiQQAAAABJRU5ErkJggg==',
  'base64'
);

for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), minimalPng);
}

console.log('Extension icons written to extension/icons/');
