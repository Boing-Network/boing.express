import { readdirSync, rmSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');

for (const name of readdirSync(extDir)) {
  const fullPath = path.join(extDir, name);
  if (statSync(fullPath).isDirectory()) continue;
  if (name.endsWith('.js') || name.endsWith('.js.map')) {
    rmSync(fullPath, { force: true });
  }
}

console.log('Removed stale generated extension JS artifacts.');
