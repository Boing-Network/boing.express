/**
 * Copy the extension to a local folder (e.g. %LOCALAPPDATA%\boing-extension on Windows)
 * so Chrome's "Load unpacked" can see all files. Use this if your project
 * lives in OneDrive/cloud and the picker only shows empty folders.
 *
 * Run: node scripts/prepare-extension-for-load.js (or pnpm run prepare:extension)
 * Then in Chrome: Load unpacked → select the printed path.
 */

import {
  cpSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');

const isWin = process.platform === 'win32';
const outDir = isWin
  ? path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Public', 'boing-extension')
  : path.join(process.env.HOME || '/tmp', 'boing-extension');

execSync('pnpm build:extension', { cwd: root, stdio: 'inherit' });

/** Copy directory contents recursively (file-by-file for reliable behavior on Windows). */
function copyDirContentsSync(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    if (statSync(srcPath).isDirectory()) {
      copyDirContentsSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function shouldCopyRootEntry(name) {
  if (name.endsWith('.map') || name.endsWith('.ts')) return false;
  const fullPath = path.join(extDir, name);
  if (statSync(fullPath).isDirectory()) return name === 'icons' || name === 'fonts';
  return ['.html', '.js', '.css', '.json'].includes(path.extname(name));
}

// Start from a clean output dir so stale build artifacts do not linger.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of readdirSync(extDir)) {
  if (!shouldCopyRootEntry(name)) continue;
  const src = path.join(extDir, name);
  const dest = path.join(outDir, name);
  if (statSync(src).isDirectory()) {
    copyDirContentsSync(src, dest);
  } else {
    cpSync(src, dest, { force: true });
  }
}

// Verify and write a marker file so you can confirm the folder in Explorer
const listed = readdirSync(outDir);
const hasManifest = listed.includes('manifest.json');
writeFileSync(
  path.join(outDir, 'LOAD-THIS-FOLDER-IN-CHROME.txt'),
  `Boing Express extension – load this folder in Chrome (Load unpacked).

Path: ${outDir}

Files here: ${listed.join(', ')}
manifest.json present: ${hasManifest}

In Chrome: chrome://extensions → Developer mode ON → Load unpacked → paste path above (or open this folder and select it).
`,
  'utf8'
);

if (!hasManifest) {
  console.error('ERROR: manifest.json was not copied. Check paths.');
  process.exit(1);
}

console.log('Extension copied to:', outDir);
console.log('Contents:', listed.join(', '));
console.log('In Chrome: Load unpacked → select this folder:', outDir);
if (isWin) {
  try {
    execSync(`explorer "${outDir}"`, { stdio: 'ignore' });
    console.log('Opened folder in Explorer. If you see all files there, use this folder in Chrome.');
  } catch (_) {}
}
