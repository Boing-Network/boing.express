/**
 * Create boing-wallet-extension.zip for Chrome Web Store (extension folder only).
 * Run: node scripts/zip-extension.js (or pnpm run zip:extension)
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const outZip = path.join(root, 'boing-wallet-extension.zip');

const isWin = process.platform === 'win32';
execSync('pnpm build:extension', { cwd: root, stdio: 'inherit' });
const bundledEntries = readdirSync(extDir).filter((name) => {
  if (name.endsWith('.map') || name.endsWith('.ts')) return false;
  const fullPath = path.join(extDir, name);
  if (statSync(fullPath).isDirectory()) return ['icons', 'fonts'].includes(name);
  return ['.html', '.js', '.css', '.json'].includes(path.extname(name));
});
const archiveEntries = bundledEntries.join(', ');

if (isWin) {
  execSync(
    `powershell -Command "Compress-Archive -Path ${archiveEntries} -DestinationPath '${outZip.replace(/'/g, "''")}' -Force"`,
    { cwd: extDir }
  );
} else {
  execSync(
    `zip -r '${outZip}' ${bundledEntries.map((entry) => `'${entry}'`).join(' ')} -x "*.map"`,
    { cwd: extDir }
  );
}

console.log('Created:', outZip);
