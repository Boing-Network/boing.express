/**
 * Build + zip the extension, then upload it to the Chrome Web Store as a DRAFT.
 * Publishing is opt-in: `pnpm run publish:extension -- --publish` (submits the uploaded draft for review).
 *
 * Env (never commit values): CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN, CHROME_EXTENSION_ID.
 * Credentials are passed to chrome-webstore-upload-cli via env vars, not argv.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = path.join(root, 'boing-wallet-extension.zip');
const args = process.argv.slice(2);
const doPublish = args.includes('--publish');
const skipZip = args.includes('--skip-zip');

const required = ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN', 'CHROME_EXTENSION_ID'];
const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')} (see docs/EXTENSION_STORE.md)`);
  process.exit(1);
}

const env = {
  ...process.env,
  CLIENT_ID: process.env.CHROME_CLIENT_ID,
  CLIENT_SECRET: process.env.CHROME_CLIENT_SECRET,
  REFRESH_TOKEN: process.env.CHROME_REFRESH_TOKEN,
  EXTENSION_ID: process.env.CHROME_EXTENSION_ID,
};

if (!skipZip) execSync('pnpm run zip:extension', { cwd: root, stdio: 'inherit' });

const run = (cmd) => execSync(`npx --no chrome-webstore-upload ${cmd}`, { cwd: root, stdio: 'inherit', env });
run(`upload --source "${zip}"`);
console.log('Uploaded as draft.');
if (doPublish) {
  run('publish');
  console.log('Publish requested (submitted for review).');
} else {
  console.log('Not published. Review the draft in the Developer Dashboard, or rerun with -- --publish.');
}