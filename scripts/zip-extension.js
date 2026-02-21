/**
 * Create boing-wallet-extension.zip for Chrome Web Store (extension folder only).
 * Run: node scripts/zip-extension.js (or pnpm run zip:extension)
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const outZip = path.join(root, 'boing-wallet-extension.zip');

const isWin = process.platform === 'win32';

if (isWin) {
  execSync(
    `powershell -Command "Compress-Archive -Path manifest.json, popup.html, popup.js, popup.css, icons, fonts -DestinationPath '${outZip.replace(/'/g, "''")}' -Force"`,
    { cwd: extDir }
  );
} else {
  execSync(
    `zip -r '${outZip}' manifest.json popup.html popup.js popup.css icons fonts -x "*.map"`,
    { cwd: extDir }
  );
}

console.log('Created:', outZip);
